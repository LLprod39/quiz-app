from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from .config import settings
from .db import get_db
from .game import bump_version, check_answer, generate_join_code, iso_utc, leaderboard, ordered_questions, recalculate_submissions, session_snapshot, utcnow
from .models import (
    AnswerOption, AuditLog, DeviceTransfer, Event, GameSession, Participant, Question, Questionnaire,
    QuestionnaireItem, QuestionnaireResponse, Round, Submission, Team, uid,
)
from .realtime import hub
from .security import create_admin_token, new_device_token, require_admin, token_hash


router = APIRouter(prefix="/api")


class LoginBody(BaseModel):
    email: str
    password: str


class ThemeBody(BaseModel):
    accent: str = "#ff6b6b"
    secondary: str = "#8b5cf6"
    background: str = "#111120"
    panel: str = "#1a1a2b"
    panel_2: str = "#222237"
    text: str = "#f7f2eb"
    muted: str = "#aaa8b7"
    mode: Literal["dark"] = "dark"
    decor: Literal["confetti", "glow", "minimal", "neon"] = "confetti"
    theme_preset: str = "coral-night"
    brand_name: str = Field(default="Quiz App", min_length=1, max_length=60)
    brand_tagline: str = Field(default="викторина для своих", max_length=100)
    logo_mark: str = Field(default="QA", min_length=1, max_length=4)
    landing_eyebrow: str = Field(default="Любой повод. Любая тема. Одна игра.", max_length=160)
    landing_title: str = Field(default="Создайте квиз,", min_length=1, max_length=120)
    landing_highlight: str = Field(default="который запомнят", max_length=120)
    landing_description: str = Field(
        default="Праздник о близком человеке или тематический квиз-баттл о кино, музыке, спорте и чём угодно. Игроки отвечают с телефонов, а игра оживает на большом экране.",
        max_length=500,
    )
    organizer_link_label: str = Field(default="Организатору", max_length=60)
    join_code_label: str = Field(default="Код комнаты", max_length=60)
    join_button_label: str = Field(default="Войти в игру", max_length=60)
    trust_no_registration: str = Field(default="Без регистрации", max_length=80)
    trust_players: str = Field(default="До 100+ игроков", max_length=80)
    trust_offline: str = Field(default="Работает без интернета", max_length=80)
    step_format: str = Field(default="Выберите формат и тему", max_length=100)
    step_join: str = Field(default="Игроки войдут по QR-коду", max_length=100)
    step_show: str = Field(default="Устройте настоящее шоу", max_length=100)


class EventBody(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    event_format: Literal["celebration", "battle"] = "celebration"
    topic: str = Field(default="", max_length=160)
    hero_name: str = Field(default="", max_length=100)
    event_date: str = ""
    game_mode: Literal["individual", "team"] = "individual"
    allow_late_join: bool = True
    hero_photo_url: str | None = None
    theme: ThemeBody = Field(default_factory=ThemeBody)

    @model_validator(mode="after")
    def validate_format_details(self):
        self.title = self.title.strip()
        self.hero_name = self.hero_name.strip()
        self.topic = self.topic.strip()
        if self.event_format == "celebration" and not self.hero_name:
            raise ValueError("Укажите имя героя праздника")
        if self.event_format == "battle" and not self.topic:
            raise ValueError("Укажите тему квиз-баттла")
        return self


class QuestionBody(BaseModel):
    round_id: str | None = None
    round_title: str = "Без раунда"
    type: str = "single"
    text: str = Field(min_length=2)
    time_limit_seconds: int = Field(default=30, ge=5, le=180)
    correct_answer: Any = None
    accepted_answers: list = Field(default_factory=list)
    numeric_tolerance: float | None = None
    shuffle_options: bool = False
    explanation: str = ""
    media_url: str | None = None
    media_type: str | None = None
    audio_replays: int = Field(default=1, ge=1, le=5)
    options: list[dict] = Field(default_factory=list)


QUESTION_PRESETS = [
    {
        "type": "single",
        "text": "Какой океан самый большой на Земле?",
        "options": ["Атлантический", "Тихий", "Индийский", "Северный Ледовитый"],
        "correct_indexes": [1],
        "explanation": "Тихий океан занимает больше трети поверхности Земли.",
    },
    {
        "type": "multiple",
        "text": "Какие из этих животных относятся к млекопитающим?",
        "options": ["Дельфин", "Акула", "Летучая мышь", "Пингвин"],
        "correct_indexes": [0, 2],
        "explanation": "Дельфин и летучая мышь кормят детёнышей молоком.",
    },
    {
        "type": "number",
        "text": "Сколько минут в двух часах?",
        "correct_answer": 120,
        "numeric_tolerance": 0,
        "explanation": "В одном часе 60 минут, поэтому 2 × 60 = 120.",
    },
    {
        "type": "text",
        "text": "Как называется естественный спутник Земли?",
        "correct_answer": "Луна",
        "accepted_answers": ["луна"],
        "explanation": "Луна — единственный естественный спутник Земли.",
    },
    {
        "type": "closest",
        "text": "В каком году человек впервые высадился на Луне?",
        "correct_answer": 1969,
        "explanation": "Экипаж Apollo 11 высадился на Луне в 1969 году.",
    },
]


class JoinBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    patronymic_initial: str = Field(default="", max_length=1)
    avatar: str = "🎈"
    team_id: str | None = None
    role: str = "guest"


class ReadyBody(BaseModel):
    device_token: str
    latency_ms: int | None = None
    media_ready: bool = True
    sound_ready: bool = True


class AnswerBody(BaseModel):
    device_token: str
    request_id: str
    answer: Any = None


class ActionBody(BaseModel):
    action: str


class CorrectAnswerBody(BaseModel):
    correct_answer: Any


class ReviewBody(BaseModel):
    is_correct: bool


class QuestionnaireSubmitBody(BaseModel):
    responses: dict[str, str]


class QuestionnaireItemBody(BaseModel):
    text: str
    type: str = "text"


class TransferRequestBody(BaseModel):
    display_name: str
    patronymic_initial: str = ""


class TransferClaimBody(BaseModel):
    claim_token: str


def event_query():
    return select(Event).options(
        selectinload(Event.rounds).selectinload(Round.questions).selectinload(Question.options),
        selectinload(Event.questionnaire).selectinload(Questionnaire.items).selectinload(QuestionnaireItem.response),
        selectinload(Event.sessions).selectinload(GameSession.participants),
    )


def session_query():
    return select(GameSession).options(
        selectinload(GameSession.event).selectinload(Event.rounds).selectinload(Round.questions).selectinload(Question.options),
        selectinload(GameSession.current_question).selectinload(Question.options),
        selectinload(GameSession.current_question).selectinload(Question.round),
        selectinload(GameSession.participants), selectinload(GameSession.teams),
    )


def serialize_question(question: Question) -> dict:
    return {
        "id": question.id, "round_id": question.round_id, "round_title": question.round.title,
        "type": question.type, "text": question.text, "time_limit_seconds": question.time_limit_seconds,
        "correct_answer": question.correct_answer, "accepted_answers": question.accepted_answers or [],
        "numeric_tolerance": question.numeric_tolerance, "shuffle_options": question.shuffle_options,
        "explanation": question.explanation, "media_url": question.media_url, "media_type": question.media_type,
        "audio_replays": question.audio_replays, "sort_order": question.sort_order,
        "options": [{"id": o.id, "text": o.text, "is_correct": o.is_correct, "sort_order": o.sort_order} for o in question.options],
    }


def normalize_theme(theme: dict | None) -> dict:
    raw = theme or {}
    normalized = ThemeBody(**raw).model_dump()
    if "theme_preset" not in raw and raw.get("accent", "#ff6b6b").lower() != "#ff6b6b":
        normalized["theme_preset"] = "custom"
    return normalized


def serialize_event(event: Event) -> dict:
    questions = ordered_questions(event)
    def session_time(item: GameSession) -> float:
        if not item.started_at:
            return 0
        value = item.started_at if item.started_at.tzinfo else item.started_at.replace(tzinfo=timezone.utc)
        return value.timestamp()
    ordered_sessions = sorted(event.sessions, key=session_time, reverse=True)
    active = next((s for s in ordered_sessions if s.status not in {"finished", "archived"}), None)
    return {
        "id": event.id, "title": event.title, "event_format": event.event_format, "topic": event.topic,
        "hero_name": event.hero_name, "event_date": event.event_date,
        "status": event.status, "game_mode": event.game_mode, "theme": normalize_theme(event.theme),
        "hero_photo_url": event.hero_photo_url, "allow_late_join": event.allow_late_join,
        "question_count": len(questions), "active_session_code": active.join_code if active else None,
        "latest_session_code": ordered_sessions[0].join_code if ordered_sessions else None,
        "sessions": [{"id": session.id, "join_code": session.join_code, "status": session.status, "participant_count": len(session.participants), "started_at": iso_utc(session.started_at), "finished_at": iso_utc(session.finished_at)} for session in ordered_sessions],
        "rounds": [{"id": r.id, "title": r.title, "sort_order": r.sort_order, "questions": [serialize_question(q) for q in r.questions]} for r in event.rounds],
        "questionnaire": serialize_questionnaire(event.questionnaire) if event.event_format == "celebration" and event.questionnaire else None,
    }


def serialize_questionnaire(questionnaire: Questionnaire) -> dict:
    return {
        "id": questionnaire.id, "event_id": questionnaire.event_id, "public_token": questionnaire.public_token,
        "status": questionnaire.status,
        "items": [{"id": item.id, "text": item.text, "type": item.type, "sort_order": item.sort_order, "response": item.response.value if item.response else ""} for item in questionnaire.items],
        "public_url": f"{settings.public_base_url}/hero/{questionnaire.public_token}",
    }


def find_session(db: Session, code: str) -> GameSession:
    session = db.scalar(session_query().where(GameSession.join_code == code.upper()).execution_options(populate_existing=True))
    if not session:
        raise HTTPException(404, "Комната не найдена")
    return session


def find_participant(db: Session, session: GameSession, device_token: str) -> Participant:
    participant = db.scalar(select(Participant).where(Participant.session_id == session.id, Participant.device_token_hash == token_hash(device_token)))
    if not participant:
        raise HTTPException(401, "Устройство не подтверждено")
    participant.last_seen_at = utcnow()
    participant.connection_status = "online"
    return participant


async def broadcast_state(db: Session, session: GameSession) -> None:
    await hub.broadcast(session.join_code, session_snapshot(db, session))


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.scalar(select(func.count()).select_from(Event))
    return {"status": "ok", "mode": settings.deployment_mode, "server_time": utcnow().isoformat()}


@router.get("/branding")
def public_branding(db: Session = Depends(get_db)):
    event = db.scalar(
        select(Event)
        .where(Event.status.notin_(["archived", "finished"]))
        .order_by(Event.updated_at.desc())
    )
    if not event:
        event = db.scalar(select(Event).order_by(Event.updated_at.desc()))
    return normalize_theme(event.theme) if event else ThemeBody().model_dump()


@router.post("/auth/login")
def login(body: LoginBody):
    if body.email.lower() != settings.organizer_email.lower() or body.password != settings.organizer_password:
        raise HTTPException(401, "Неверная почта или пароль")
    return {"access_token": create_admin_token(settings.organizer_email), "organizer": {"email": settings.organizer_email}}


@router.get("/events")
def list_events(_: str = Depends(require_admin), db: Session = Depends(get_db)):
    return [serialize_event(event) for event in db.scalars(event_query().order_by(Event.updated_at.desc())).unique().all()]


@router.post("/events")
def create_event(body: EventBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    active = db.scalar(select(Event).where(Event.status.notin_(["archived", "finished"])))
    if active:
        raise HTTPException(409, "Сначала завершите или архивируйте активное мероприятие")
    event = Event(**body.model_dump(), status="draft")
    round_ = Round(title="Раунд 1", sort_order=0)
    event.rounds.append(round_)
    if body.event_format == "celebration":
        event.questionnaire = Questionnaire(items=[
            QuestionnaireItem(text="Какое блюдо вы можете есть снова и снова?", sort_order=0),
            QuestionnaireItem(text="Какое место связано с самым тёплым воспоминанием?", sort_order=1),
            QuestionnaireItem(text="Какую песню друзья сразу связывают с вами?", sort_order=2),
        ])
    db.add(event); db.commit()
    event = db.scalar(event_query().where(Event.id == event.id))
    return serialize_event(event)


@router.get("/events/{event_id}")
def get_event(event_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    return serialize_event(event)


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    if body.event_format == "battle" and any(question.type == "hero_choice" for question in ordered_questions(event)):
        raise HTTPException(400, "Сначала удалите вопросы типа «Выбор героя»")
    for key, value in body.model_dump().items(): setattr(event, key, value)
    if body.event_format == "celebration" and not event.questionnaire:
        event.questionnaire = Questionnaire(items=[
            QuestionnaireItem(text="Какое блюдо вы можете есть снова и снова?", sort_order=0),
            QuestionnaireItem(text="Какое место связано с самым тёплым воспоминанием?", sort_order=1),
            QuestionnaireItem(text="Какую песню друзья сразу связывают с вами?", sort_order=2),
        ])
    db.add(AuditLog(action="event.updated", before=None, after=body.model_dump()))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.post("/events/{event_id}/archive")
def archive_event(event_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    event.status = "archived"; db.commit()
    return {"status": "archived"}


@router.post("/events/{event_id}/questionnaire/items")
def add_questionnaire_item(event_id: str, body: QuestionnaireItemBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    if event.event_format != "celebration":
        raise HTTPException(400, "Анкета доступна только для персонального праздника")
    if not event.questionnaire:
        event.questionnaire = Questionnaire()
    item = QuestionnaireItem(text=body.text, type=body.type, sort_order=len(event.questionnaire.items))
    event.questionnaire.items.append(item); db.commit()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_questionnaire(event.questionnaire)


@router.get("/questionnaires/{token}")
def public_questionnaire(token: str, db: Session = Depends(get_db)):
    questionnaire = db.scalar(select(Questionnaire).options(selectinload(Questionnaire.event), selectinload(Questionnaire.items).selectinload(QuestionnaireItem.response)).where(Questionnaire.public_token == token))
    if not questionnaire: raise HTTPException(404, "Анкета не найдена")
    return {**serialize_questionnaire(questionnaire), "event_title": questionnaire.event.title, "hero_name": questionnaire.event.hero_name}


@router.post("/questionnaires/{token}/submit")
def submit_questionnaire(token: str, body: QuestionnaireSubmitBody, db: Session = Depends(get_db)):
    questionnaire = db.scalar(select(Questionnaire).options(selectinload(Questionnaire.items).selectinload(QuestionnaireItem.response)).where(Questionnaire.public_token == token))
    if not questionnaire: raise HTTPException(404, "Анкета не найдена")
    for item in questionnaire.items:
        value = body.responses.get(item.id, "").strip()
        if not value: continue
        if item.response: item.response.value = value; item.response.submitted_at = utcnow()
        else: item.response = QuestionnaireResponse(value=value)
    questionnaire.status = "completed"; db.commit()
    return {"status": "completed"}


@router.post("/questionnaire-items/{item_id}/to-question")
def questionnaire_to_question(item_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.scalar(select(QuestionnaireItem).options(selectinload(QuestionnaireItem.response), selectinload(QuestionnaireItem.questionnaire).selectinload(Questionnaire.event).selectinload(Event.rounds).selectinload(Round.questions)).where(QuestionnaireItem.id == item_id))
    if not item or not item.response: raise HTTPException(400, "Сначала нужен ответ героя")
    event = item.questionnaire.event
    if len(ordered_questions(event)) >= 15: raise HTTPException(400, "В викторине уже 15 вопросов")
    round_ = event.rounds[0] if event.rounds else Round(title="Раунд 1", sort_order=0, event=event)
    question = Question(text=item.text, type="text", correct_answer=item.response.value, accepted_answers=[], sort_order=len(round_.questions), explanation=f"Ответ {event.hero_name}: {item.response.value}")
    round_.questions.append(question); db.commit()
    return serialize_question(question)


@router.post("/events/{event_id}/questions")
def create_question(event_id: str, body: QuestionBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    if event.event_format == "battle" and body.type == "hero_choice":
        raise HTTPException(400, "В тематическом баттле нет типа «Выбор героя»")
    if len(ordered_questions(event)) >= 15: raise HTTPException(400, "В викторине может быть не более 15 вопросов")
    round_ = next((r for r in event.rounds if r.id == body.round_id), None)
    if not round_:
        round_ = Round(event_id=event.id, title=body.round_title, sort_order=len(event.rounds)); db.add(round_); db.flush()
    data = body.model_dump(exclude={"round_id", "round_title", "options"})
    question = Question(round_id=round_.id, sort_order=len(round_.questions), **data)
    db.add(question); db.flush()
    option_ids = []
    for index, option_data in enumerate(body.options):
        option = AnswerOption(id=option_data.get("id") or uid(), question_id=question.id, text=option_data.get("text", ""), is_correct=bool(option_data.get("is_correct")), sort_order=index)
        db.add(option); option_ids.append(option.id)
    if question.type == "single" and question.correct_answer is None:
        selected = next((o.get("id") for o in body.options if o.get("is_correct")), None)
        question.correct_answer = selected
    db.commit()
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question.id))
    return serialize_question(question)


@router.put("/questions/{question_id}")
def update_question(question_id: str, body: QuestionBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question_id))
    if not question: raise HTTPException(404, "Вопрос не найден")
    event = db.get(Event, question.round.event_id)
    if event and event.event_format == "battle" and body.type == "hero_choice":
        raise HTTPException(400, "В тематическом баттле нет типа «Выбор героя»")
    before = serialize_question(question)
    for key, value in body.model_dump(exclude={"round_id", "round_title", "options"}).items(): setattr(question, key, value)
    db.execute(delete(AnswerOption).where(AnswerOption.question_id == question.id))
    for index, option_data in enumerate(body.options):
        db.add(AnswerOption(id=option_data.get("id") or uid(), question_id=question.id, text=option_data.get("text", ""), is_correct=bool(option_data.get("is_correct")), sort_order=index))
    db.add(AuditLog(action="question.updated", before=before, after=body.model_dump()))
    db.commit()
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question_id))
    return serialize_question(question)


@router.post("/events/{event_id}/question-presets")
def add_question_presets(event_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event:
        raise HTTPException(404, "Мероприятие не найдено")
    remaining = 15 - len(ordered_questions(event))
    if remaining <= 0:
        raise HTTPException(400, "В викторине уже 15 вопросов")
    round_ = event.rounds[0] if event.rounds else Round(event_id=event.id, title="Раунд 1", sort_order=0)
    if not event.rounds:
        db.add(round_)
        db.flush()
    created_ids = []
    base_sort_order = len(round_.questions)
    for preset_index, preset in enumerate(QUESTION_PRESETS[:remaining]):
        question = Question(
            round_id=round_.id,
            type=preset["type"],
            text=preset["text"],
            time_limit_seconds=30,
            correct_answer=preset.get("correct_answer"),
            accepted_answers=preset.get("accepted_answers", []),
            numeric_tolerance=preset.get("numeric_tolerance"),
            explanation=preset.get("explanation", ""),
            sort_order=base_sort_order + preset_index,
        )
        db.add(question)
        db.flush()
        correct_indexes = set(preset.get("correct_indexes", []))
        correct_ids = []
        for index, text in enumerate(preset.get("options", [])):
            option_id = uid()
            is_correct = index in correct_indexes
            db.add(AnswerOption(id=option_id, question_id=question.id, text=text, is_correct=is_correct, sort_order=index))
            if is_correct:
                correct_ids.append(option_id)
        if question.type == "single" and correct_ids:
            question.correct_answer = correct_ids[0]
        elif question.type == "multiple":
            question.correct_answer = correct_ids
        created_ids.append(question.id)
    db.add(AuditLog(action="questions.presets_added", after={"event_id": event.id, "question_ids": created_ids}))
    db.commit()
    db.expire_all()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.delete("/questions/{question_id}")
def delete_question(question_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    question = db.get(Question, question_id)
    if not question: raise HTTPException(404, "Вопрос не найден")
    db.delete(question); db.commit(); return {"status": "deleted"}


@router.post("/events/{event_id}/sessions")
def open_session(event_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(event_query().where(Event.id == event_id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    if not ordered_questions(event): raise HTTPException(400, "Добавьте хотя бы один вопрос")
    active = next((s for s in event.sessions if s.status not in {"finished", "archived"}), None)
    if active:
        session = db.scalar(session_query().where(GameSession.id == active.id)); return session_snapshot(db, session)
    session = GameSession(event_id=event.id, join_code=generate_join_code(db), status="lobby", deployment_mode=settings.deployment_mode)
    if event.game_mode == "team":
        session.teams = [Team(name="Мандарины", avatar="🍊", color="#ff9f43"), Team(name="Искры", avatar="✨", color="#a78bfa")]
    event.status = "ready"; db.add(session); db.commit()
    session = db.scalar(session_query().where(GameSession.id == session.id)); return session_snapshot(db, session)


@router.get("/sessions/{code}")
def get_session(code: str, device_token: str | None = None, db: Session = Depends(get_db)):
    session = find_session(db, code)
    participant = find_participant(db, session, device_token) if device_token else None
    db.commit()
    return session_snapshot(db, session, participant)


@router.post("/sessions/{code}/join")
def join_session(code: str, body: JoinBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = find_session(db, code)
    if session.status in {"finished", "archived"}: raise HTTPException(409, "Игра уже завершена")
    if session.status != "lobby" and not session.event.allow_late_join: raise HTTPException(409, "Поздний вход отключён")
    same = [p for p in session.participants if p.display_name.casefold() == body.display_name.strip().casefold()]
    initial = body.patronymic_initial.strip().upper()
    if same and not initial: raise HTTPException(409, "name_initial_required")
    if any(p.patronymic_initial == initial for p in same): raise HTTPException(409, "Такое имя и буква отчества уже заняты")
    if body.role not in {"guest", "hero"}: raise HTTPException(400, "Недопустимая роль")
    if body.role == "hero" and session.event.event_format != "celebration":
        raise HTTPException(400, "В тематическом баттле все входят как игроки")
    team = next((t for t in session.teams if t.id == body.team_id), None) if body.team_id else None
    if session.event.game_mode == "team" and not team: raise HTTPException(400, "Выберите команду")
    raw_token = new_device_token()
    eligible = 0 if session.status == "lobby" else session.current_question_index + 1
    participant = Participant(session_id=session.id, team_id=team.id if team else None, display_name=body.display_name.strip(), patronymic_initial=initial, avatar=body.avatar, role=body.role, device_token_hash=token_hash(raw_token), eligible_from_index=eligible)
    db.add(participant); db.flush()
    if team and not team.captain_participant_id: team.captain_participant_id = participant.id
    version = bump_version(db, session.id); db.commit()
    if hub.has_connections(session.join_code):
        background_tasks.add_task(hub.broadcast, session.join_code, {"type": "participant.joined", "version": version, "participant": {"id": participant.id, "name": participant.full_name, "avatar": participant.avatar, "role": participant.role, "team_id": participant.team_id, "ready": False, "connection_status": "online", "latency_ms": None, "eligible": session.status == "lobby" or eligible <= session.current_question_index}})
    return {"device_token": raw_token, "participant_id": participant.id, "eligible_from_index": eligible}


@router.post("/sessions/{code}/ready")
def participant_ready(code: str, body: ReadyBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = find_session(db, code); participant = find_participant(db, session, body.device_token)
    participant.ready = True; participant.latency_ms = body.latency_ms; participant.media_ready = body.media_ready; participant.sound_ready = body.sound_ready
    version = bump_version(db, session.id); db.commit()
    if hub.has_connections(session.join_code):
        background_tasks.add_task(hub.broadcast, session.join_code, {"type": "participant.ready", "version": version, "participant_id": participant.id, "latency_ms": participant.latency_ms})
    return {"status": "ready", "version": version}


@router.post("/sessions/{code}/transfer-requests")
def request_transfer(code: str, body: TransferRequestBody, db: Session = Depends(get_db)):
    session = find_session(db, code)
    participant = next((item for item in session.participants if item.display_name.casefold() == body.display_name.strip().casefold() and item.patronymic_initial == body.patronymic_initial.strip().upper()), None)
    if not participant:
        raise HTTPException(404, "Игрок с таким именем не найден")
    existing = db.scalar(select(DeviceTransfer).where(DeviceTransfer.participant_id == participant.id, DeviceTransfer.status == "pending"))
    if existing:
        db.delete(existing); db.flush()
    claim_token = new_device_token()
    transfer = DeviceTransfer(session_id=session.id, participant_id=participant.id, claim_token_hash=token_hash(claim_token), expires_at=utcnow() + timedelta(minutes=10))
    db.add(transfer); db.add(AuditLog(session_id=session.id, actor_id=participant.id, action="device.transfer.requested")); db.commit()
    return {"request_id": transfer.id, "claim_token": claim_token, "status": "pending", "expires_in_seconds": 600}


@router.get("/sessions/{code}/transfer-requests")
def list_transfer_requests(code: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code)
    rows = db.scalars(select(DeviceTransfer).options(selectinload(DeviceTransfer.participant)).where(DeviceTransfer.session_id == session.id, DeviceTransfer.status == "pending").order_by(DeviceTransfer.created_at)).all()
    return [{"id": row.id, "participant_id": row.participant_id, "name": row.participant.full_name, "avatar": row.participant.avatar, "created_at": iso_utc(row.created_at), "expires_at": iso_utc(row.expires_at)} for row in rows]


@router.post("/sessions/{code}/transfer-requests/{request_id}/approve")
def approve_transfer(code: str, request_id: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code); transfer = db.get(DeviceTransfer, request_id)
    if not transfer or transfer.session_id != session.id or transfer.status != "pending":
        raise HTTPException(404, "Запрос переноса не найден")
    expires = transfer.expires_at if transfer.expires_at.tzinfo else transfer.expires_at.replace(tzinfo=timezone.utc)
    if expires < utcnow():
        transfer.status = "expired"; db.commit(); raise HTTPException(410, "Запрос переноса истёк")
    transfer.status = "approved"; transfer.approved_at = utcnow(); db.add(AuditLog(session_id=session.id, actor_id=transfer.participant_id, action="device.transfer.approved")); db.commit()
    return {"status": "approved"}


@router.post("/sessions/{code}/transfer-requests/{request_id}/claim")
def claim_transfer(code: str, request_id: str, body: TransferClaimBody, db: Session = Depends(get_db)):
    session = find_session(db, code); transfer = db.get(DeviceTransfer, request_id)
    if not transfer or transfer.session_id != session.id or transfer.claim_token_hash != token_hash(body.claim_token):
        raise HTTPException(404, "Запрос переноса не найден")
    if transfer.status == "pending": raise HTTPException(409, "Организатор ещё не подтвердил перенос")
    if transfer.status != "approved": raise HTTPException(409, "Запрос уже использован или истёк")
    raw_token = new_device_token(); participant = db.get(Participant, transfer.participant_id)
    participant.device_token_hash = token_hash(raw_token); participant.last_seen_at = utcnow(); transfer.status = "claimed"
    version = bump_version(db, session.id); db.add(AuditLog(session_id=session.id, actor_id=participant.id, action="device.transfer.claimed")); db.commit()
    return {"status": "claimed", "device_token": raw_token, "participant_id": participant.id, "version": version}


@router.post("/sessions/{code}/answer")
def submit_answer(code: str, body: AnswerBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = find_session(db, code); participant = find_participant(db, session, body.device_token)
    existing_request = db.scalar(select(Submission).where(Submission.request_id == body.request_id))
    if existing_request:
        return {"status": "accepted", "duplicate": True, "elapsed_ms": existing_request.elapsed_ms}
    if session.status != "answering" or not session.current_question: raise HTTPException(409, "Ответы сейчас закрыты")
    if participant.eligible_from_index > session.current_question_index: raise HTTPException(409, "Вы сможете отвечать со следующего вопроса")
    now = utcnow()
    deadline = session.deadline_at
    if deadline and deadline.tzinfo is None: deadline = deadline.replace(tzinfo=timezone.utc)
    if deadline and now > deadline: raise HTTPException(409, "Время вышло")
    entity_filter = (Submission.team_id == participant.team_id) if session.event.game_mode == "team" else (Submission.participant_id == participant.id)
    existing = db.scalar(select(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id, entity_filter))
    if existing: return {"status": "accepted", "duplicate": True, "elapsed_ms": existing.elapsed_ms}
    if session.event.game_mode == "team":
        team = next(t for t in session.teams if t.id == participant.team_id)
        if team.captain_participant_id != participant.id: raise HTTPException(403, "Ответ отправляет капитан команды")
    started = (deadline - timedelta(seconds=session.current_question.time_limit_seconds)) if deadline else now
    elapsed_ms = max(0, int((now - started).total_seconds() * 1000))
    submission = Submission(request_id=body.request_id, session_id=session.id, question_id=session.current_question_id, participant_id=None if session.event.game_mode == "team" else participant.id, team_id=participant.team_id if session.event.game_mode == "team" else None, answer_payload=body.answer, elapsed_ms=elapsed_ms, is_correct=check_answer(session.current_question, body.answer))
    db.add(submission); db.flush(); version = bump_version(db, session.id); db.commit()
    answered_count = db.scalar(select(func.count()).select_from(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id))
    if hub.has_connections(session.join_code):
        background_tasks.add_task(hub.broadcast, session.join_code, {"type": "question.progress", "version": version, "answered_count": answered_count})
    return {"status": "accepted", "duplicate": False, "elapsed_ms": elapsed_ms, "version": version}


@router.post("/sessions/{code}/actions")
async def game_action(code: str, body: ActionBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code); before = session_snapshot(db, session)["session"]; action = body.action
    questions = ordered_questions(session.event)
    if action in {"start_game", "prepare"}:
        if session.status not in {"lobby", "reveal", "between_questions", "cancelled"}: raise HTTPException(409, "Сейчас нельзя подготовить вопрос")
        next_index = 0 if session.current_question_index < 0 else session.current_question_index + 1
        if next_index >= len(questions):
            session.status = "finished"; session.finished_at = utcnow()
        else:
            session.current_question_index = next_index; session.current_question_id = questions[next_index].id; session.status = "countdown"; session.deadline_at = None
            if not session.started_at: session.started_at = utcnow()
    elif action == "start":
        if session.status != "countdown": raise HTTPException(409, "Сначала подготовьте вопрос")
        session.status = "answering"; session.deadline_at = utcnow() + timedelta(seconds=session.current_question.time_limit_seconds)
    elif action == "lock":
        if session.status != "answering": raise HTTPException(409, "Ответы уже закрыты")
        session.status = "review" if session.current_question.type == "text" else "locked"; session.deadline_at = None
        recalculate_submissions(db, session, session.current_question)
    elif action == "reveal":
        if session.status not in {"locked", "review"}: raise HTTPException(409, "Сначала закройте ответы")
        recalculate_submissions(db, session, session.current_question); session.status = "reveal"
    elif action == "next":
        if session.status not in {"reveal", "cancelled"}: raise HTTPException(409, "Сначала раскройте или отмените вопрос")
        next_index = session.current_question_index + 1
        if next_index >= len(questions): session.status = "finished"; session.finished_at = utcnow()
        else: session.current_question_index = next_index; session.current_question_id = questions[next_index].id; session.status = "countdown"; session.deadline_at = None
    elif action == "pause":
        if session.status != "answering": raise HTTPException(409, "Пауза доступна во время ответа")
        deadline = session.deadline_at.replace(tzinfo=timezone.utc) if session.deadline_at and session.deadline_at.tzinfo is None else session.deadline_at
        session.paused_remaining_ms = max(0, int((deadline - utcnow()).total_seconds() * 1000)) if deadline else 0
        session.status = "paused"; session.deadline_at = None
    elif action == "resume":
        if session.status != "paused": raise HTTPException(409, "Игра не на паузе")
        session.status = "answering"; session.deadline_at = utcnow() + timedelta(milliseconds=session.paused_remaining_ms or 0)
    elif action == "cancel":
        if session.status not in {"countdown", "answering", "locked", "review"}: raise HTTPException(409, "Этот вопрос нельзя отменить")
        db.execute(delete(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id)); session.status = "cancelled"; session.deadline_at = None
    elif action == "finish":
        recalculate_submissions(db, session); session.status = "finished"; session.finished_at = utcnow(); session.deadline_at = None; session.event.status = "finished"
    else: raise HTTPException(400, "Неизвестная команда")
    session.state_version += 1
    db.add(AuditLog(session_id=session.id, action=f"organizer.{action}", before=before, after={"status": session.status, "version": session.state_version}))
    db.commit(); session = find_session(db, code); payload = session_snapshot(db, session); await broadcast_state(db, session); return payload


@router.put("/sessions/{code}/questions/{question_id}/correct-answer")
async def change_correct_answer(code: str, question_id: str, body: CorrectAnswerBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code); question = db.get(Question, question_id)
    if not question: raise HTTPException(404, "Вопрос не найден")
    before = question.correct_answer; question.correct_answer = body.correct_answer; recalculate_submissions(db, session, question); session.state_version += 1
    db.add(AuditLog(session_id=session.id, action="question.correct_answer.update", before={"correct_answer": before}, after={"correct_answer": body.correct_answer})); db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return session_snapshot(db, session)


@router.put("/sessions/{code}/submissions/{submission_id}/review")
async def review_submission(code: str, submission_id: str, body: ReviewBody, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code); submission = db.get(Submission, submission_id)
    if not submission or submission.session_id != session.id: raise HTTPException(404, "Ответ не найден")
    submission.is_correct = body.is_correct; submission.validation_status = "manual"; session.state_version += 1; db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return session_snapshot(db, session)


@router.post("/sessions/{code}/hero-choice")
async def hero_choice(code: str, body: AnswerBody, db: Session = Depends(get_db)):
    session = find_session(db, code); participant = find_participant(db, session, body.device_token)
    if participant.role != "hero" or not session.current_question or session.current_question.type != "hero_choice": raise HTTPException(403, "Сейчас нет выбора героя")
    if session.status not in {"locked", "review"}: raise HTTPException(409, "Гости ещё выбирают")
    session.current_question.correct_answer = body.answer; session.state_version += 1; db.add(AuditLog(session_id=session.id, actor_id=participant.id, action="hero.choice.submit", after={"choice": body.answer})); db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return {"status": "accepted"}


@router.get("/sessions/{code}/results")
def results(code: str, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_session(db, code)
    answers = db.scalars(select(Submission).options(selectinload(Submission.participant), selectinload(Submission.team), selectinload(Submission.question)).where(Submission.session_id == session.id).order_by(Submission.submitted_at)).all()
    return {"leaderboard": leaderboard(db, session), "submissions": [{"id": s.id, "question": s.question.text, "name": s.participant.full_name if s.participant else s.team.name if s.team else "—", "answer": s.answer_payload, "is_correct": s.is_correct, "elapsed_ms": s.elapsed_ms, "validation_status": s.validation_status} for s in answers]}


ALLOWED_MEDIA = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg"}


@router.post("/media")
async def upload_media(event_id: str = Form(...), file: UploadFile = File(...), _: str = Depends(require_admin), db: Session = Depends(get_db)):
    if not db.get(Event, event_id): raise HTTPException(404, "Мероприятие не найдено")
    if file.content_type not in ALLOWED_MEDIA: raise HTTPException(415, "Поддерживаются JPG, PNG, WebP, MP3, M4A и OGG")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024: raise HTTPException(413, f"Файл больше {settings.max_upload_mb} МБ")
    name = f"{event_id}-{uuid4().hex}{ALLOWED_MEDIA[file.content_type]}"; path = settings.media_path / name
    path.write_bytes(content)
    return {"url": f"/media/{name}", "type": "image" if file.content_type.startswith("image/") else "audio", "size": len(content)}
