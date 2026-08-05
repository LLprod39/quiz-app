import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, HttpUrl, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from .config import settings
from .db import get_db
from .game import MAX_QUESTIONS, answer_target_count, auto_transition_deadline, bump_version, check_answer, generate_join_code, iso_utc, leaderboard, ordered_questions, recalculate_submissions, session_snapshot, utcnow
from .models import (
    Account, AnswerOption, AuditLog, DeviceTransfer, Event, GameSession, GuestDevice, MediaAsset, Participant, Question, Questionnaire,
    QuestionnaireItem, QuestionnaireResponse, QuizPackTemplate, Round, ScreenAccess, ScreenDevice, Submission, Team, uid,
)
from .realtime import hub
from .quiz_packs import PACKS_BY_SLUG, QUIZ_PACKS, public_pack
from .quotas import enforce_account_usage, enforce_new_quiz, enforce_new_room, enforce_participants, enforce_question_count, enforce_quota, lock_account_quota, quota_limit
from .security import new_device_token, optional_account, parse_user_agent, request_ip, require_admin, token_hash


router = APIRouter(prefix="/api")


def normalize_gpt_url(value: Any) -> Any:
    """Turn common GPT Markdown links back into a plain URL before validation."""
    if not isinstance(value, str):
        return value
    cleaned = value.strip().replace(r"\)", ")").replace(r"\(", "(")
    candidates = re.findall(r"https?://[^\s\[\]<>\"']+", cleaned)
    if not candidates:
        return cleaned
    candidate = candidates[-1].rstrip(".,;:")
    while candidate.endswith(")") and candidate.count(")") > candidate.count("("):
        candidate = candidate[:-1]
    return candidate


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

    @model_validator(mode="before")
    @classmethod
    def normalize_decor_alias(cls, data: Any):
        if not isinstance(data, dict):
            return data
        normalized = dict(data)
        decor = normalized.get("decor")
        if isinstance(decor, str):
            alias = decor.strip().casefold()
            for allowed in ("confetti", "glow", "minimal", "neon"):
                if allowed in alias:
                    normalized["decor"] = allowed
                    break
        return normalized


class EventBody(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    event_format: Literal["celebration", "battle"] = "celebration"
    topic: str = Field(default="", max_length=160)
    hero_name: str = Field(default="", max_length=100)
    event_date: str = ""
    game_mode: Literal["individual", "team"] = "individual"
    host_mode: Literal["auto", "manual"] = "auto"
    auto_advance_seconds: int = Field(default=5, ge=2, le=30)
    tv_display_mode: Literal["classic", "insights"] = "classic"
    tv_chart_style: Literal["both", "pie", "bar"] = "both"
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


class HostControlBody(BaseModel):
    host_mode: Literal["auto", "manual"] = "auto"
    auto_advance_seconds: int = Field(default=5, ge=2, le=30)


class TvDisplayBody(BaseModel):
    tv_display_mode: Literal["classic", "insights"] = "classic"
    tv_chart_style: Literal["both", "pie", "bar"] = "both"


class PackInstallBody(BaseModel):
    replace_active: bool = False


class PackPromptBody(BaseModel):
    topic: str = Field(min_length=2, max_length=120)
    question_count: int = Field(default=20, ge=3, le=MAX_QUESTIONS)
    difficulty: Literal["Лёгкая", "Средняя", "Сложная"] = "Средняя"


class PackSourceBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    url: HttpUrl
    license: str = Field(min_length=2, max_length=500)
    license_url: HttpUrl

    @model_validator(mode="before")
    @classmethod
    def normalize_markdown_urls(cls, data: Any):
        if not isinstance(data, dict):
            return data
        normalized = dict(data)
        normalized["url"] = normalize_gpt_url(normalized.get("url"))
        normalized["license_url"] = normalize_gpt_url(normalized.get("license_url"))
        return normalized


class PackQuestionImportBody(BaseModel):
    text: str = Field(min_length=5, max_length=500)
    correct_answer: str = Field(min_length=1, max_length=300)
    wrong_answers: list[str] = Field(min_length=3, max_length=3)
    explanation: str = Field(min_length=5, max_length=1000)
    source_urls: list[HttpUrl] = Field(min_length=1, max_length=5)
    time_limit_seconds: int = Field(default=30, ge=10, le=120)

    @model_validator(mode="before")
    @classmethod
    def normalize_markdown_urls(cls, data: Any):
        if not isinstance(data, dict):
            return data
        normalized = dict(data)
        source_urls = normalized.get("source_urls")
        if isinstance(source_urls, list):
            normalized["source_urls"] = [normalize_gpt_url(url) for url in source_urls]
        return normalized

    @model_validator(mode="after")
    def validate_answers(self):
        self.text = self.text.strip()
        self.correct_answer = self.correct_answer.strip()
        self.wrong_answers = [answer.strip() for answer in self.wrong_answers]
        answers = [self.correct_answer, *self.wrong_answers]
        if any(not answer for answer in answers):
            raise ValueError("Все варианты ответа должны быть заполнены")
        if len({answer.casefold() for answer in answers}) != 4:
            raise ValueError("Правильный и три неверных ответа должны отличаться")
        return self


class QuizPackImportBody(BaseModel):
    schema_version: Literal[1] = 1
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=3, max_length=120)
    title: str = Field(min_length=2, max_length=160)
    topic: str = Field(min_length=2, max_length=160)
    icon: str = Field(min_length=1, max_length=8)
    short_description: str = Field(min_length=10, max_length=240)
    description: str = Field(min_length=20, max_length=1000)
    estimated_minutes: int = Field(ge=5, le=180)
    difficulty: Literal["Лёгкая", "Средняя", "Сложная"]
    game_mode: Literal["individual", "team"] = "team"
    round_title: str = Field(min_length=2, max_length=120)
    disclaimer: str = Field(min_length=5, max_length=500)
    sources: list[PackSourceBody] = Field(min_length=1, max_length=12)
    theme: ThemeBody
    questions: list[PackQuestionImportBody] = Field(min_length=3, max_length=MAX_QUESTIONS)

    @model_validator(mode="after")
    def normalize_pack(self):
        self.title = self.title.strip()
        self.topic = self.topic.strip()
        self.round_title = self.round_title.strip()
        if len({question.text.casefold() for question in self.questions}) != len(self.questions):
            raise ValueError("В шаблоне есть повторяющиеся вопросы")
        colors = [self.theme.accent, self.theme.secondary, self.theme.background, self.theme.panel, self.theme.panel_2, self.theme.text, self.theme.muted]
        if any(not re.fullmatch(r"#[0-9a-fA-F]{6}", color) for color in colors):
            raise ValueError("Все цвета темы должны быть в формате HEX, например #22c55e")
        declared_sources = {str(source.url).rstrip("/") for source in self.sources}
        referenced_sources = {str(url).rstrip("/") for question in self.questions for url in question.source_urls}
        if not referenced_sources:
            raise ValueError("Добавьте источники к вопросам")
        if not all(any(reference.startswith(source) or source.startswith(reference) for source in declared_sources) for reference in referenced_sources):
            raise ValueError("Ссылки вопросов должны относиться к указанным источникам")
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
    if normalized["organizer_link_label"] == "Панель ведущего":
        normalized["organizer_link_label"] = "Управление"
    if "theme_preset" not in raw and raw.get("accent", "#ff6b6b").lower() != "#ff6b6b":
        normalized["theme_preset"] = "custom"
    return normalized


def serialize_event(event: Event) -> dict:
    questions = ordered_questions(event)
    def session_time(item: GameSession) -> float:
        source = item.started_at or item.finished_at
        if not source:
            return 0
        value = source if source.tzinfo else source.replace(tzinfo=timezone.utc)
        return value.timestamp()
    ordered_sessions = sorted(event.sessions, key=lambda item: (item.status not in {"finished", "archived"}, session_time(item)), reverse=True)
    active = next((s for s in ordered_sessions if s.status not in {"finished", "archived"}), None)
    return {
        "id": event.id, "title": event.title, "event_format": event.event_format, "topic": event.topic,
        "hero_name": event.hero_name, "event_date": event.event_date,
        "status": event.status, "is_selected": event.is_selected, "game_mode": event.game_mode,
        "host_mode": event.host_mode, "auto_advance_seconds": event.auto_advance_seconds,
        "tv_display_mode": event.tv_display_mode, "tv_chart_style": event.tv_chart_style, "theme": normalize_theme(event.theme),
        "hero_photo_url": event.hero_photo_url, "allow_late_join": event.allow_late_join,
        "created_at": iso_utc(event.created_at), "updated_at": iso_utc(event.updated_at),
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


def find_session(db: Session, code: str, for_update: bool = False) -> GameSession:
    query = session_query().where(GameSession.join_code == code.upper()).execution_options(populate_existing=True)
    if for_update:
        query = query.with_for_update()
    session = db.scalar(query)
    if not session:
        raise HTTPException(404, "Комната не найдена")
    return session


def find_owned_event(db: Session, event_id: str, account: Account) -> Event:
    event = db.scalar(event_query().where(Event.id == event_id, Event.owner_id == account.id))
    if not event:
        raise HTTPException(404, "Мероприятие не найдено")
    return event


def find_owned_session(db: Session, code: str, account: Account) -> GameSession:
    session = db.scalar(session_query().where(GameSession.join_code == code.upper(), GameSession.event.has(owner_id=account.id)))
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
    payload = session_snapshot(db, session)
    await hub.broadcast(session.join_code, participant_snapshot(payload))
    await hub.broadcast(f"screen:{session.join_code}", payload)
    await hub.broadcast(f"organizer:{session.join_code}", payload)


def participant_snapshot(payload: dict) -> dict:
    sanitized = dict(payload)
    sanitized["live_answers"] = []
    sanitized["answer_breakdown"] = []
    return sanitized


def find_screen_access(db: Session, raw_token: str, allow_finished: bool = False) -> ScreenAccess:
    access = db.scalar(
        select(ScreenAccess)
        .options(selectinload(ScreenAccess.session).selectinload(GameSession.event))
        .where(ScreenAccess.token_hash == token_hash(raw_token), ScreenAccess.revoked_at.is_(None))
    )
    if not access or (not allow_finished and access.session.status in {"finished", "archived"}):
        raise HTTPException(404, "Ссылка экрана недействительна")
    return access


def select_quiz(db: Session, event: Event) -> None:
    db.execute(update(Event).where(Event.owner_id == event.owner_id, Event.id != event.id).values(is_selected=False))
    event.is_selected = True


def quiz_pack_by_slug(db: Session, slug: str, account: Account | None = None) -> tuple[dict | None, bool]:
    built_in = PACKS_BY_SLUG.get(slug)
    if built_in:
        return built_in, False
    access = QuizPackTemplate.visibility == "public"
    if account:
        access = access | (QuizPackTemplate.owner_id == account.id)
    template = db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.slug == slug, access))
    return (template.definition, True) if template else (None, False)


def quiz_pack_definition(body: QuizPackImportBody) -> dict:
    return body.model_dump(mode="json")


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.scalar(select(func.count()).select_from(Event))
    return {"status": "ok", "mode": settings.deployment_mode, "server_time": utcnow().isoformat()}


@router.get("/branding")
def public_branding(account: Account | None = Depends(optional_account), db: Session = Depends(get_db)):
    if not account:
        return ThemeBody().model_dump()
    event = db.scalar(
        select(Event)
        .where(Event.owner_id == account.id, Event.is_selected.is_(True), Event.status != "archived")
        .order_by(Event.updated_at.desc())
    )
    if not event:
        event = db.scalar(select(Event).where(Event.owner_id == account.id, Event.status != "archived").order_by(Event.updated_at.desc()))
    if not event:
        event = db.scalar(select(Event).where(Event.owner_id == account.id).order_by(Event.updated_at.desc()))
    return normalize_theme(event.theme) if event else ThemeBody().model_dump()


@router.get("/quiz-packs")
def list_quiz_packs(account: Account | None = Depends(optional_account), db: Session = Depends(get_db)):
    access = QuizPackTemplate.visibility == "public"
    if account:
        access = access | (QuizPackTemplate.owner_id == account.id)
    custom = db.scalars(select(QuizPackTemplate).where(access).order_by(QuizPackTemplate.updated_at.desc())).all()
    return [public_pack(pack) for pack in QUIZ_PACKS] + [public_pack(template.definition, is_custom=True) for template in custom]


@router.post("/quiz-packs/gpt-prompt")
def create_quiz_pack_prompt(body: PackPromptBody, account: Account = Depends(require_admin)):
    topic = body.topic.strip()
    example = {
        "schema_version": 1,
        "slug": "short-english-slug",
        "title": f"Квиз: {topic}",
        "topic": topic,
        "icon": "🌍",
        "short_description": "Краткое описание квиза в одном предложении.",
        "description": "Расширенное описание игры и того, какие знания она проверяет.",
        "estimated_minutes": max(10, round(body.question_count * 1.7)),
        "difficulty": body.difficulty,
        "game_mode": "team",
        "round_title": topic,
        "disclaimer": "Факты проверены по перечисленным источникам; формулировки вопросов оригинальные.",
        "sources": [{
            "name": "Название надёжного источника",
            "url": "https://example.org/",
            "license": "Условия использования или лицензия",
            "license_url": "https://example.org/terms",
        }],
        "theme": {
            "accent": "#22c55e", "secondary": "#38bdf8", "background": "#07140e", "panel": "#10251a", "panel_2": "#173524",
            "text": "#f4fff8", "muted": "#9bbbaa", "mode": "dark", "decor": "glow", "theme_preset": "custom-topic",
            "brand_name": f"Квиз: {topic}", "brand_tagline": "знания · азарт · открытия", "logo_mark": "🌍",
            "landing_eyebrow": "ГОТОВЫ ПРОВЕРИТЬ СЕБЯ?", "landing_title": f"Квиз: {topic}", "landing_highlight": "начинаем баттл",
            "landing_description": "Описание тематической игры для главной страницы.", "organizer_link_label": "Управление",
            "join_code_label": "Код игры", "join_button_label": "Войти в баттл", "trust_no_registration": "Вход по коду",
            "trust_players": "Командная игра", "trust_offline": "Работает в локальной сети", "step_format": "Соберите команду",
            "step_join": "Войдите по коду", "step_show": "Покажите знания",
        },
        "questions": [{
            "text": "Оригинальная формулировка вопроса?",
            "correct_answer": "Правильный ответ",
            "wrong_answers": ["Неверный вариант 1", "Неверный вариант 2", "Неверный вариант 3"],
            "explanation": "Короткое объяснение правильного ответа и проверяемого факта.",
            "source_urls": ["https://example.org/direct-fact-page"],
            "time_limit_seconds": 30,
        }],
    }
    prompt = f"""Создай готовый квиз-баттл на русском языке по теме «{topic}».

Требования:
1. Используй веб-поиск и проверь каждый факт минимум по одному надёжному источнику. Предпочитай официальные сайты, международные организации, государственные и научные ресурсы, энциклопедии с редакционным контролем.
2. Создай ровно {body.question_count} разных вопросов сложности «{body.difficulty}». Для каждого вопроса дай один правильный и ровно три правдоподобных неверных ответа.
3. Формулировки вопросов и пояснений должны быть оригинальными. Не копируй готовые вопросы из коммерческих викторин.
4. У каждого вопроса в source_urls должны быть прямые HTTPS-ссылки на страницы, подтверждающие именно этот факт. В sources перечисли все использованные сайты и реальные условия их использования или лицензии. Поле license сделай кратким — не более 300 символов.
5. Не используй спорные, быстро устаревающие или неоднозначные факты. Если факт зависит от даты, явно укажи дату в вопросе.
6. Подбери уникальное оформление темы: читаемые контрастные HEX-цвета, короткие тексты и подходящий emoji. В поле decor используй строго одно из четырёх значений: "confetti", "glow", "minimal" или "neon". Не придумывай другие значения и не добавляй к ним приставки.
7. Все поля url, license_url и source_urls должны содержать только обычную строку, начинающуюся с https://. Никогда не оформляй ссылку как Markdown: запрещены [текст](https://...), [[https://...](https://...)](https://...), HTML-теги и ссылки с подписью.
8. Не ставь обратный слеш перед круглыми скобками в ссылках: нельзя писать \\) или \\(. Если скобки входят в URL, используй их обычный или percent-encoded вид (%28 и %29).
9. Перед ответом мысленно проверь результат строгим JSON-парсером: никаких недопустимых escape-последовательностей, запятых после последнего элемента и текста вне объекта.

Верни только один валидный JSON-объект UTF-8. Никаких пояснений, Markdown-блоков, комментариев, Python, QUIZ_PACKS или вызовов _q. Все ключи и строки должны быть в двойных кавычках.

Точная структура JSON (в массиве questions создай ровно {body.question_count} объектов по этому образцу):
{json.dumps(example, ensure_ascii=False, indent=2)}
"""
    return {"prompt": prompt, "topic": topic, "question_count": body.question_count}


@router.post("/quiz-packs/import")
def import_quiz_pack(body: QuizPackImportBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    existing, _ = quiz_pack_by_slug(db, body.slug, account)
    if existing:
        raise HTTPException(409, "Шаблон с таким slug уже существует")
    enforce_account_usage(db, account, "private_templates")
    template = QuizPackTemplate(owner_id=account.id, slug=body.slug, definition=quiz_pack_definition(body), visibility="private")
    db.add(template)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="quiz_pack.custom.created", after={"slug": body.slug, "question_count": len(body.questions)}))
    db.commit()
    return public_pack(template.definition, is_custom=True)


@router.get("/quiz-packs/{slug}")
def get_quiz_pack(slug: str, account: Account | None = Depends(optional_account), db: Session = Depends(get_db)):
    pack, is_custom = quiz_pack_by_slug(db, slug, account)
    if not pack:
        raise HTTPException(404, "Тематический квиз не найден")
    return public_pack(pack, is_custom=is_custom)


@router.get("/quiz-packs/{slug}/definition")
def get_quiz_pack_definition(slug: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    template = db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.slug == slug, QuizPackTemplate.owner_id == account.id, QuizPackTemplate.visibility == "private"))
    if not template:
        raise HTTPException(404, "Пользовательский шаблон не найден")
    return template.definition


@router.put("/quiz-packs/{slug}/definition")
def update_quiz_pack_definition(slug: str, body: QuizPackImportBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    template = db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.slug == slug, QuizPackTemplate.owner_id == account.id, QuizPackTemplate.visibility == "private"))
    if not template:
        raise HTTPException(404, "Пользовательский шаблон не найден")
    if body.slug != slug:
        collision, _ = quiz_pack_by_slug(db, body.slug, account)
        if collision:
            raise HTTPException(409, "Шаблон с новым slug уже существует")
    before = {"slug": template.slug, "question_count": len(template.definition.get("questions", []))}
    template.slug = body.slug
    template.definition = quiz_pack_definition(body)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="quiz_pack.custom.updated", before=before, after={"slug": body.slug, "question_count": len(body.questions)}))
    db.commit()
    return public_pack(template.definition, is_custom=True)


@router.delete("/quiz-packs/{slug}")
def delete_quiz_pack(slug: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    template = db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.slug == slug, QuizPackTemplate.owner_id == account.id, QuizPackTemplate.visibility == "private"))
    if not template:
        if slug in PACKS_BY_SLUG:
            raise HTTPException(400, "Встроенные шаблоны нельзя удалить")
        raise HTTPException(404, "Пользовательский шаблон не найден")
    db.delete(template)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="quiz_pack.custom.deleted", before={"slug": slug, "question_count": len(template.definition.get("questions", []))}))
    db.commit()
    return {"status": "deleted", "slug": slug}


@router.post("/quiz-packs/{slug}/install")
def install_quiz_pack(slug: str, body: PackInstallBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    pack, _ = quiz_pack_by_slug(db, slug, account)
    if not pack:
        raise HTTPException(404, "Тематический квиз не найден")
    enforce_new_quiz(db, account)
    question_limit = quota_limit(db, account, "questions_per_quiz")
    if question_limit is not None and len(pack["questions"]) > question_limit:
        enforce_quota(db, account, "questions_per_quiz", 0, len(pack["questions"]))
    event = Event(
        owner_id=account.id,
        title=pack["title"], event_format="battle", topic=pack["topic"], hero_name="", event_date="",
        status="draft", is_selected=True, game_mode=pack.get("game_mode", "team"), allow_late_join=True, hero_photo_url=None,
        theme=ThemeBody(**pack["theme"]).model_dump(),
    )
    round_ = Round(title=pack["round_title"], sort_order=0)
    event.rounds.append(round_)
    for question_index, item in enumerate(pack["questions"]):
        answers = item.get("answers") or [item["correct_answer"], *item["wrong_answers"]]
        correct_id = uid()
        question = Question(
            type="single", text=item["text"], time_limit_seconds=item.get("time_limit_seconds", 30), correct_answer=correct_id,
            shuffle_options=True, explanation=item["explanation"], sort_order=question_index,
        )
        question.options = [
            AnswerOption(id=correct_id if answer_index == 0 else uid(), text=answer, is_correct=answer_index == 0, sort_order=answer_index)
            for answer_index, answer in enumerate(answers)
        ]
        round_.questions.append(question)
    db.add(event)
    db.flush()
    select_quiz(db, event)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="quiz_pack.installed", after={"event_id": event.id, "pack": slug, "question_count": len(pack["questions"])}))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event.id))
    return serialize_event(event)


@router.get("/events")
def list_events(account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    return [serialize_event(event) for event in db.scalars(event_query().where(Event.owner_id == account.id).order_by(Event.updated_at.desc())).unique().all()]


@router.post("/events")
def create_event(body: EventBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    enforce_new_quiz(db, account)
    event = Event(owner_id=account.id, **body.model_dump(), status="draft", is_selected=True)
    round_ = Round(title="Раунд 1", sort_order=0)
    event.rounds.append(round_)
    if body.event_format == "celebration":
        event.questionnaire = Questionnaire(items=[
            QuestionnaireItem(text="Какое блюдо вы можете есть снова и снова?", sort_order=0),
            QuestionnaireItem(text="Какое место связано с самым тёплым воспоминанием?", sort_order=1),
            QuestionnaireItem(text="Какую песню друзья сразу связывают с вами?", sort_order=2),
        ])
    db.add(event); db.flush(); select_quiz(db, event)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.created", after={"event_id": event.id, "title": event.title}))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event.id))
    return serialize_event(event)


@router.get("/events/{event_id}")
def get_event(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    return serialize_event(event)


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if body.event_format == "battle" and any(question.type == "hero_choice" for question in ordered_questions(event)):
        raise HTTPException(400, "Сначала удалите вопросы типа «Выбор героя»")
    for key, value in body.model_dump().items(): setattr(event, key, value)
    if body.event_format == "celebration" and not event.questionnaire:
        event.questionnaire = Questionnaire(items=[
            QuestionnaireItem(text="Какое блюдо вы можете есть снова и снова?", sort_order=0),
            QuestionnaireItem(text="Какое место связано с самым тёплым воспоминанием?", sort_order=1),
            QuestionnaireItem(text="Какую песню друзья сразу связывают с вами?", sort_order=2),
        ])
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.updated", before=None, after={"event_id": event.id, **body.model_dump()}))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.put("/events/{event_id}/host-control")
async def update_host_control(event_id: str, body: HostControlBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    before = {"host_mode": event.host_mode, "auto_advance_seconds": event.auto_advance_seconds}
    event.host_mode = body.host_mode
    event.auto_advance_seconds = body.auto_advance_seconds
    active_session_ids = []
    for session in event.sessions:
        if session.status in {"finished", "archived"}:
            continue
        if session.status != "answering":
            session.deadline_at = auto_transition_deadline(event, session.status, session.current_question)
        session.state_version += 1
        active_session_ids.append(session.id)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.host_control.updated", before=before, after={"event_id": event.id, **body.model_dump()}))
    db.commit()
    for session_id in active_session_ids:
        session = db.scalar(session_query().where(GameSession.id == session_id).execution_options(populate_existing=True))
        if session:
            await broadcast_state(db, session)
    event = db.scalar(event_query().where(Event.id == event_id).execution_options(populate_existing=True))
    return serialize_event(event)


@router.put("/events/{event_id}/tv-display")
async def update_tv_display(event_id: str, body: TvDisplayBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    before = {"tv_display_mode": event.tv_display_mode, "tv_chart_style": event.tv_chart_style}
    event.tv_display_mode = body.tv_display_mode
    event.tv_chart_style = body.tv_chart_style
    active_session_ids = []
    for session in event.sessions:
        if session.status in {"finished", "archived"}:
            continue
        session.state_version += 1
        active_session_ids.append(session.id)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.tv_display.updated", before=before, after={"event_id": event.id, **body.model_dump()}))
    db.commit()
    for session_id in active_session_ids:
        session = db.scalar(session_query().where(GameSession.id == session_id).execution_options(populate_existing=True))
        if session:
            await broadcast_state(db, session)
    event = db.scalar(event_query().where(Event.id == event_id).execution_options(populate_existing=True))
    return serialize_event(event)


@router.post("/events/{event_id}/archive")
def archive_event(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if any(session.status not in {"finished", "archived"} for session in event.sessions):
        raise HTTPException(409, "Сначала завершите открытую игровую комнату")
    was_selected = event.is_selected
    replacement = db.scalar(select(Event).where(Event.owner_id == account.id, Event.id != event.id, Event.status != "archived").order_by(Event.updated_at.desc())) if was_selected else None
    if was_selected and not replacement:
        raise HTTPException(409, "Нельзя архивировать единственный квиз. Сначала создайте или восстановите другой.")
    event.status = "archived"; event.is_selected = False
    if was_selected:
        replacement.is_selected = True
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.archived", after={"event_id": event.id}))
    db.commit()
    return {"status": "archived", "selected_event_id": replacement.id if replacement else None}


@router.post("/events/{event_id}/restore")
def restore_event(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    enforce_new_quiz(db, account)
    event.status = "ready" if ordered_questions(event) else "draft"
    select_quiz(db, event)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.restored", after={"event_id": event.id}))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.post("/events/{event_id}/select")
def select_event(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if event.status == "archived": raise HTTPException(409, "Сначала восстановите квиз из архива")
    select_quiz(db, event)
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="event.selected", after={"event_id": event.id}))
    db.commit()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.post("/events/{event_id}/questionnaire/items")
def add_questionnaire_item(event_id: str, body: QuestionnaireItemBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if event.event_format != "celebration":
        raise HTTPException(400, "Анкета доступна только для персонального праздника")
    if not event.questionnaire:
        event.questionnaire = Questionnaire()
    item = QuestionnaireItem(text=body.text, type=body.type, sort_order=len(event.questionnaire.items))
    event.questionnaire.items.append(item); db.flush()
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="questionnaire.item.created", after={"event_id": event.id, "item_id": item.id}))
    db.commit()
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
def questionnaire_to_question(item_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.scalar(select(QuestionnaireItem).options(selectinload(QuestionnaireItem.response), selectinload(QuestionnaireItem.questionnaire).selectinload(Questionnaire.event).selectinload(Event.rounds).selectinload(Round.questions)).where(QuestionnaireItem.id == item_id))
    if not item or not item.response: raise HTTPException(400, "Сначала нужен ответ героя")
    event = item.questionnaire.event
    if event.owner_id != account.id:
        raise HTTPException(404, "Элемент анкеты не найден")
    enforce_question_count(db, account, event)
    if len(ordered_questions(event)) >= MAX_QUESTIONS: raise HTTPException(400, f"В викторине уже {MAX_QUESTIONS} вопросов")
    round_ = event.rounds[0] if event.rounds else Round(title="Раунд 1", sort_order=0, event=event)
    question = Question(text=item.text, type="text", correct_answer=item.response.value, accepted_answers=[], sort_order=len(round_.questions), explanation=f"Ответ {event.hero_name}: {item.response.value}")
    round_.questions.append(question); db.flush()
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="questionnaire.item.converted", after={"event_id": event.id, "item_id": item.id, "question_id": question.id}))
    db.commit()
    return serialize_question(question)


@router.post("/events/{event_id}/questions")
def create_question(event_id: str, body: QuestionBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if event.event_format == "battle" and body.type == "hero_choice":
        raise HTTPException(400, "В тематическом баттле нет типа «Выбор героя»")
    if len(ordered_questions(event)) >= MAX_QUESTIONS: raise HTTPException(400, f"В викторине может быть не более {MAX_QUESTIONS} вопросов")
    enforce_question_count(db, account, event)
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
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="question.created", after={"event_id": event.id, "question_id": question.id}))
    db.commit()
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question.id))
    return serialize_question(question)


@router.put("/questions/{question_id}")
def update_question(question_id: str, body: QuestionBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question_id))
    if not question: raise HTTPException(404, "Вопрос не найден")
    event = db.get(Event, question.round.event_id)
    if not event or event.owner_id != account.id:
        raise HTTPException(404, "Вопрос не найден")
    if event and event.event_format == "battle" and body.type == "hero_choice":
        raise HTTPException(400, "В тематическом баттле нет типа «Выбор героя»")
    before = serialize_question(question)
    for key, value in body.model_dump(exclude={"round_id", "round_title", "options"}).items(): setattr(question, key, value)
    db.execute(delete(AnswerOption).where(AnswerOption.question_id == question.id))
    for index, option_data in enumerate(body.options):
        db.add(AnswerOption(id=option_data.get("id") or uid(), question_id=question.id, text=option_data.get("text", ""), is_correct=bool(option_data.get("is_correct")), sort_order=index))
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="question.updated", before=before, after={"question_id": question.id, **body.model_dump()}))
    db.commit()
    question = db.scalar(select(Question).options(selectinload(Question.options), selectinload(Question.round)).where(Question.id == question_id))
    return serialize_question(question)


@router.post("/events/{event_id}/question-presets")
def add_question_presets(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    lock_account_quota(db, account)
    plan_limit = quota_limit(db, account, "questions_per_quiz")
    current = db.scalar(select(func.count()).select_from(Question).join(Round).where(Round.event_id == event.id)) or 0
    remaining = min(MAX_QUESTIONS, plan_limit if plan_limit is not None else MAX_QUESTIONS) - current
    if remaining <= 0:
        raise HTTPException(400, f"В викторине уже {MAX_QUESTIONS} вопросов")
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
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="questions.presets_added", after={"event_id": event.id, "question_ids": created_ids}))
    db.commit()
    db.expire_all()
    event = db.scalar(event_query().where(Event.id == event_id))
    return serialize_event(event)


@router.delete("/questions/{question_id}")
def delete_question(question_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    question = db.scalar(select(Question).join(Round).join(Event).where(Question.id == question_id, Event.owner_id == account.id))
    if not question: raise HTTPException(404, "Вопрос не найден")
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="question.deleted", before={"question_id": question.id, "text": question.text}))
    db.delete(question); db.commit(); return {"status": "deleted"}


@router.post("/events/{event_id}/sessions")
def open_session(event_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = find_owned_event(db, event_id, account)
    if not ordered_questions(event): raise HTTPException(400, "Добавьте хотя бы один вопрос")
    active = next((s for s in event.sessions if s.status not in {"finished", "archived"}), None)
    if active:
        session = db.scalar(session_query().where(GameSession.id == active.id)); return session_snapshot(db, session)
    enforce_new_room(db, account)
    session = GameSession(event_id=event.id, join_code=generate_join_code(db), status="lobby", deployment_mode=settings.deployment_mode)
    if event.game_mode == "team":
        session.teams = [Team(name="Мандарины", avatar="🍊", color="#ff9f43"), Team(name="Искры", avatar="✨", color="#a78bfa")]
    raw_screen_token = new_device_token()
    session.screen_access = ScreenAccess(token_hash=token_hash(raw_screen_token), created_by_id=account.id)
    event.status = "ready"; db.add(session); db.flush()
    db.add(AuditLog(session_id=session.id, actor_account_id=account.id, target_account_id=account.id, action="game_session.created", after={"event_id": event.id, "join_code": session.join_code}))
    db.commit()
    session = db.scalar(session_query().where(GameSession.id == session.id))
    payload = session_snapshot(db, session)
    payload["screen_url"] = f"{settings.public_base_url.rstrip('/')}/screen/{raw_screen_token}"
    return payload


@router.get("/sessions/{code}")
def get_session(code: str, device_token: str | None = None, account: Account | None = Depends(optional_account), db: Session = Depends(get_db)):
    session = find_session(db, code)
    if device_token:
        participant = find_participant(db, session, device_token)
        db.commit()
        return participant_snapshot(session_snapshot(db, session, participant))
    if account and session.event.owner_id == account.id:
        return session_snapshot(db, session)
    return {
        "type": "room.join_info",
        "session": {"join_code": session.join_code, "status": session.status, "deployment_mode": session.deployment_mode},
        "event": {"title": session.event.title, "event_format": session.event.event_format, "topic": session.event.topic, "hero_name": session.event.hero_name, "game_mode": session.event.game_mode, "theme": normalize_theme(session.event.theme)},
        "teams": [{"id": team.id, "name": team.name, "avatar": team.avatar, "color": team.color} for team in session.teams],
        "participant_count": len(session.participants),
    }


@router.get("/guest-device/profile")
def guest_profile(x_guest_device_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    device = db.scalar(select(GuestDevice).where(GuestDevice.token_hash == token_hash(x_guest_device_token))) if x_guest_device_token else None
    return {"display_name": device.last_display_name, "avatar": device.last_avatar} if device else {"display_name": "", "avatar": "🎈"}


@router.get("/screens/{screen_token}")
def screen_state(screen_token: str, request: Request, x_screen_installation: str | None = Header(default=None), db: Session = Depends(get_db)):
    access = find_screen_access(db, screen_token)
    if x_screen_installation:
        installation_hash = token_hash(x_screen_installation)
        device = db.scalar(select(ScreenDevice).where(ScreenDevice.screen_access_id == access.id, ScreenDevice.installation_hash == installation_hash))
        user_agent = request.headers.get("user-agent", "")[:500]
        browser, os_name, _ = parse_user_agent(user_agent)
        if not device:
            device = ScreenDevice(screen_access_id=access.id, installation_hash=installation_hash, browser=browser, os=os_name, user_agent=user_agent, ip_address=request_ip(request))
            db.add(device)
        else:
            device.last_seen_at = utcnow(); device.ip_address = request_ip(request)
        db.commit()
    session = db.scalar(session_query().where(GameSession.id == access.session_id))
    return session_snapshot(db, session)


@router.post("/sessions/{code}/screen-access")
async def regenerate_screen_access(code: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account)
    if session.status in {"finished", "archived"}:
        raise HTTPException(409, "Игра уже завершена")
    raw = new_device_token()
    access = session.screen_access
    if access:
        access.token_hash = token_hash(raw); access.generation += 1; access.revoked_at = None; access.devices.clear()
    else:
        access = ScreenAccess(session_id=session.id, token_hash=token_hash(raw), created_by_id=account.id)
        db.add(access)
    db.add(AuditLog(session_id=session.id, actor_account_id=account.id, target_account_id=account.id, action="screen.access.regenerated", after={"generation": access.generation}))
    db.commit()
    await hub.close_room(f"screen:{session.join_code}", reason="Ссылка экрана перевыпущена")
    return {"screen_url": f"{settings.public_base_url.rstrip('/')}/screen/{raw}", "generation": access.generation}


@router.get("/sessions/{code}/screens")
def list_screens(code: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account)
    if not session.screen_access:
        return []
    rows = db.scalars(select(ScreenDevice).where(ScreenDevice.screen_access_id == session.screen_access.id).order_by(ScreenDevice.last_seen_at.desc())).all()
    return [{"id": row.id, "browser": row.browser, "os": row.os, "ip_address": row.ip_address, "created_at": row.created_at.isoformat(), "last_seen_at": row.last_seen_at.isoformat()} for row in rows]


@router.post("/sessions/{code}/join")
def join_session(code: str, body: JoinBody, background_tasks: BackgroundTasks, request: Request, x_guest_device_token: str | None = Header(default=None), account: Account | None = Depends(optional_account), db: Session = Depends(get_db)):
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
    owner = db.get(Account, session.event.owner_id)
    enforce_participants(db, owner, session)
    device = None
    if x_guest_device_token:
        device = db.scalar(select(GuestDevice).where(GuestDevice.token_hash == token_hash(x_guest_device_token)))
        user_agent = request.headers.get("user-agent", "")[:500]
        browser, os_name, _ = parse_user_agent(user_agent)
        if not device:
            device = GuestDevice(token_hash=token_hash(x_guest_device_token), browser=browser, os=os_name, user_agent=user_agent, ip_address=request_ip(request))
            db.add(device); db.flush()
        device.last_display_name = body.display_name.strip(); device.last_avatar = body.avatar; device.last_seen_at = utcnow(); device.ip_address = request_ip(request)
    raw_token = new_device_token()
    eligible = 0 if session.status == "lobby" else session.current_question_index + 1
    participant = Participant(session_id=session.id, account_id=account.id if account else None, guest_device_id=device.id if device else None, team_id=team.id if team else None, display_name=body.display_name.strip(), patronymic_initial=initial, avatar=body.avatar, role=body.role, device_token_hash=token_hash(raw_token), eligible_from_index=eligible)
    db.add(participant); db.flush()
    if team and not team.captain_participant_id: team.captain_participant_id = participant.id
    version = bump_version(db, session.id); db.commit()
    if hub.has_connections(session.join_code) or hub.has_connections(f"screen:{session.join_code}") or hub.has_connections(f"organizer:{session.join_code}"):
        joined_payload = {"type": "participant.joined", "version": version, "participant": {"id": participant.id, "name": participant.full_name, "avatar": participant.avatar, "role": participant.role, "team_id": participant.team_id, "ready": False, "connection_status": "online", "latency_ms": None, "eligible": session.status == "lobby" or eligible <= session.current_question_index}}
        background_tasks.add_task(hub.broadcast, session.join_code, joined_payload)
        background_tasks.add_task(hub.broadcast, f"screen:{session.join_code}", joined_payload)
        background_tasks.add_task(hub.broadcast, f"organizer:{session.join_code}", joined_payload)
    return {"device_token": raw_token, "participant_id": participant.id, "eligible_from_index": eligible}


@router.post("/sessions/{code}/ready")
def participant_ready(code: str, body: ReadyBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = find_session(db, code); participant = find_participant(db, session, body.device_token)
    participant.ready = True; participant.latency_ms = body.latency_ms; participant.media_ready = body.media_ready; participant.sound_ready = body.sound_ready
    version = bump_version(db, session.id); db.commit()
    if hub.has_connections(session.join_code) or hub.has_connections(f"screen:{session.join_code}") or hub.has_connections(f"organizer:{session.join_code}"):
        ready_payload = {"type": "participant.ready", "version": version, "participant_id": participant.id, "latency_ms": participant.latency_ms}
        background_tasks.add_task(hub.broadcast, session.join_code, ready_payload)
        background_tasks.add_task(hub.broadcast, f"screen:{session.join_code}", ready_payload)
        background_tasks.add_task(hub.broadcast, f"organizer:{session.join_code}", ready_payload)
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
def list_transfer_requests(code: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account)
    rows = db.scalars(select(DeviceTransfer).options(selectinload(DeviceTransfer.participant)).where(DeviceTransfer.session_id == session.id, DeviceTransfer.status == "pending").order_by(DeviceTransfer.created_at)).all()
    return [{"id": row.id, "participant_id": row.participant_id, "name": row.participant.full_name, "avatar": row.participant.avatar, "created_at": iso_utc(row.created_at), "expires_at": iso_utc(row.expires_at)} for row in rows]


@router.post("/sessions/{code}/transfer-requests/{request_id}/approve")
def approve_transfer(code: str, request_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account); transfer = db.get(DeviceTransfer, request_id)
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
    session = find_session(db, code, for_update=True); participant = find_participant(db, session, body.device_token)
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
    db.add(submission); db.flush()
    answered_count = db.scalar(select(func.count()).select_from(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id))
    target_count = answer_target_count(session)
    question_closed = target_count > 0 and answered_count >= target_count
    if question_closed:
        recalculate_submissions(db, session, session.current_question)
        session.status = "review" if session.current_question.type in {"text", "hero_choice"} else "locked"
        session.deadline_at = auto_transition_deadline(session.event, session.status, session.current_question)
        db.add(AuditLog(session_id=session.id, action="question.all_answered", after={"answered_count": answered_count, "target_count": target_count, "status": session.status}))
    version = bump_version(db, session.id); db.commit()
    if hub.has_connections(session.join_code):
        if question_closed or session.event.tv_display_mode == "insights":
            session = find_session(db, code)
            full_payload = session_snapshot(db, session)
            background_tasks.add_task(hub.broadcast, session.join_code, participant_snapshot(full_payload))
            background_tasks.add_task(hub.broadcast, f"screen:{session.join_code}", full_payload)
            background_tasks.add_task(hub.broadcast, f"organizer:{session.join_code}", full_payload)
        else:
            progress_payload = {"type": "question.progress", "version": version, "answered_count": answered_count, "answer_target_count": target_count}
            background_tasks.add_task(hub.broadcast, session.join_code, progress_payload)
            background_tasks.add_task(hub.broadcast, f"screen:{session.join_code}", progress_payload)
            background_tasks.add_task(hub.broadcast, f"organizer:{session.join_code}", progress_payload)
    return {"status": "accepted", "duplicate": False, "elapsed_ms": elapsed_ms, "version": version, "question_closed": question_closed}


@router.post("/sessions/{code}/actions")
async def game_action(code: str, body: ActionBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account); before = session_snapshot(db, session)["session"]; action = body.action
    questions = ordered_questions(session.event)
    if action in {"start_game", "prepare"}:
        if session.status not in {"lobby", "reveal", "between_questions", "cancelled"}: raise HTTPException(409, "Сейчас нельзя подготовить вопрос")
        next_index = 0 if session.current_question_index < 0 else session.current_question_index + 1
        if next_index >= len(questions):
            session.status = "finished"; session.finished_at = utcnow()
        else:
            session.current_question_index = next_index; session.current_question_id = questions[next_index].id; session.status = "countdown"; session.deadline_at = auto_transition_deadline(session.event, "countdown", questions[next_index])
            if not session.started_at: session.started_at = utcnow()
    elif action == "start":
        if session.status != "countdown": raise HTTPException(409, "Сначала подготовьте вопрос")
        session.status = "answering"; session.deadline_at = utcnow() + timedelta(seconds=session.current_question.time_limit_seconds)
    elif action == "lock":
        if session.status != "answering": raise HTTPException(409, "Ответы уже закрыты")
        session.status = "review" if session.current_question.type in {"text", "hero_choice"} else "locked"; session.deadline_at = auto_transition_deadline(session.event, session.status, session.current_question)
        recalculate_submissions(db, session, session.current_question)
    elif action == "reveal":
        if session.status not in {"locked", "review"}: raise HTTPException(409, "Сначала закройте ответы")
        recalculate_submissions(db, session, session.current_question); session.status = "reveal"; session.deadline_at = auto_transition_deadline(session.event, "reveal", session.current_question)
    elif action == "next":
        if session.status not in {"reveal", "cancelled"}: raise HTTPException(409, "Сначала раскройте или отмените вопрос")
        next_index = session.current_question_index + 1
        if next_index >= len(questions): session.status = "finished"; session.finished_at = utcnow()
        else: session.current_question_index = next_index; session.current_question_id = questions[next_index].id; session.status = "countdown"; session.deadline_at = auto_transition_deadline(session.event, "countdown", questions[next_index])
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
        db.execute(delete(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id)); session.status = "cancelled"; session.deadline_at = auto_transition_deadline(session.event, "cancelled", session.current_question)
    elif action == "finish":
        recalculate_submissions(db, session); session.status = "finished"; session.finished_at = utcnow(); session.deadline_at = None
    else: raise HTTPException(400, "Неизвестная команда")
    session.state_version += 1
    db.add(AuditLog(session_id=session.id, actor_account_id=account.id, target_account_id=account.id, action=f"organizer.{action}", before=before, after={"status": session.status, "version": session.state_version}))
    db.commit(); session = find_session(db, code); payload = session_snapshot(db, session); await broadcast_state(db, session); return payload


@router.put("/sessions/{code}/questions/{question_id}/correct-answer")
async def change_correct_answer(code: str, question_id: str, body: CorrectAnswerBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account); question = db.get(Question, question_id)
    if not question or question.round.event_id != session.event_id: raise HTTPException(404, "Вопрос не найден")
    before = question.correct_answer; question.correct_answer = body.correct_answer; recalculate_submissions(db, session, question); session.state_version += 1
    db.add(AuditLog(session_id=session.id, actor_account_id=account.id, target_account_id=account.id, action="question.correct_answer.update", before={"correct_answer": before}, after={"correct_answer": body.correct_answer})); db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return session_snapshot(db, session)


@router.put("/sessions/{code}/submissions/{submission_id}/review")
async def review_submission(code: str, submission_id: str, body: ReviewBody, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account); submission = db.get(Submission, submission_id)
    if not submission or submission.session_id != session.id: raise HTTPException(404, "Ответ не найден")
    submission.is_correct = body.is_correct; submission.validation_status = "manual"; session.state_version += 1
    db.add(AuditLog(session_id=session.id, actor_account_id=account.id, target_account_id=account.id, action="submission.reviewed", after={"submission_id": submission.id, "is_correct": body.is_correct})); db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return session_snapshot(db, session)


@router.post("/sessions/{code}/hero-choice")
async def hero_choice(code: str, body: AnswerBody, db: Session = Depends(get_db)):
    session = find_session(db, code); participant = find_participant(db, session, body.device_token)
    if participant.role != "hero" or not session.current_question or session.current_question.type != "hero_choice": raise HTTPException(403, "Сейчас нет выбора героя")
    if session.status not in {"locked", "review"}: raise HTTPException(409, "Гости ещё выбирают")
    session.current_question.correct_answer = body.answer
    recalculate_submissions(db, session, session.current_question)
    session.deadline_at = auto_transition_deadline(session.event, "reveal", session.current_question)
    session.state_version += 1; db.add(AuditLog(session_id=session.id, actor_id=participant.id, action="hero.choice.submit", after={"choice": body.answer})); db.commit()
    session = find_session(db, code); await broadcast_state(db, session); return {"status": "accepted"}


@router.get("/sessions/{code}/results")
def results(code: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    session = find_owned_session(db, code, account)
    answers = db.scalars(select(Submission).options(selectinload(Submission.participant), selectinload(Submission.team), selectinload(Submission.question)).where(Submission.session_id == session.id).order_by(Submission.submitted_at)).all()
    return {"leaderboard": leaderboard(db, session), "submissions": [{"id": s.id, "question": s.question.text, "name": s.participant.full_name if s.participant else s.team.name if s.team else "—", "answer": s.answer_payload, "is_correct": s.is_correct, "elapsed_ms": s.elapsed_ms, "validation_status": s.validation_status} for s in answers]}


ALLOWED_MEDIA = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg"}


@router.post("/media")
async def upload_media(event_id: str = Form(...), file: UploadFile = File(...), account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    event = db.scalar(select(Event).where(Event.id == event_id, Event.owner_id == account.id))
    if not event: raise HTTPException(404, "Мероприятие не найдено")
    if file.content_type not in ALLOWED_MEDIA: raise HTTPException(415, "Поддерживаются JPG, PNG, WebP, MP3, M4A и OGG")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024: raise HTTPException(413, f"Файл больше {settings.max_upload_mb} МБ")
    enforce_account_usage(db, account, "media_bytes", len(content))
    name = f"{event_id}-{uuid4().hex}{ALLOWED_MEDIA[file.content_type]}"; path = settings.media_path / name
    path.write_bytes(content)
    url = f"/media/{name}"
    db.add(MediaAsset(owner_id=account.id, event_id=event.id, url=url, path=str(path), size_bytes=len(content), media_type="image" if file.content_type.startswith("image/") else "audio"))
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="media.uploaded", after={"event_id": event.id, "url": url, "size_bytes": len(content)}))
    db.commit()
    return {"url": url, "type": "image" if file.content_type.startswith("image/") else "audio", "size": len(content)}


@router.get("/media-assets")
def list_media_assets(account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(MediaAsset).where(MediaAsset.owner_id == account.id).order_by(MediaAsset.created_at.desc())).all()
    return [{
        "id": row.id,
        "event_id": row.event_id,
        "url": row.url,
        "size_bytes": row.size_bytes,
        "media_type": row.media_type,
        "created_at": row.created_at.isoformat(),
    } for row in rows]


@router.delete("/media-assets/{asset_id}")
def delete_media_asset(asset_id: str, account: Account = Depends(require_admin), db: Session = Depends(get_db)):
    asset = db.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.owner_id == account.id))
    if not asset:
        raise HTTPException(404, "Медиафайл не найден")
    db.execute(update(Event).where(Event.owner_id == account.id, Event.hero_photo_url == asset.url).values(hero_photo_url=None))
    owned_questions = select(Question.id).join(Round).join(Event).where(Event.owner_id == account.id, Question.media_url == asset.url)
    db.execute(update(Question).where(Question.id.in_(owned_questions)).values(media_url=None, media_type=None))
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="media.deleted", before={"asset_id": asset.id, "url": asset.url, "size_bytes": asset.size_bytes}))
    raw_path = Path(asset.path)
    db.delete(asset)
    db.commit()
    try:
        media_root = settings.media_path.resolve()
        safe_path = raw_path.resolve()
        safe_path.relative_to(media_root)
        if safe_path.is_file():
            safe_path.unlink()
    except (OSError, ValueError):
        pass
    return {"status": "deleted", "asset_id": asset_id}
