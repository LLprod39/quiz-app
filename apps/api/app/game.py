import re
import secrets
import string
import hashlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from .models import AnswerOption, Event, GameSession, Participant, Question, Submission, Team


ACTIVE_STATES = {"countdown", "answering", "locked", "review", "reveal", "between_questions", "paused"}
MAX_QUESTIONS = 50


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def generate_join_code(db: Session) -> str:
    alphabet = string.ascii_uppercase.replace("I", "").replace("O", "") + "23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not db.scalar(select(GameSession).where(GameSession.join_code == code)):
            return code


def bump_version(db: Session, session_id: str) -> int:
    return int(db.scalar(update(GameSession).where(GameSession.id == session_id).values(state_version=GameSession.state_version + 1).returning(GameSession.state_version)))


def ordered_questions(event: Event) -> list[Question]:
    return [q for rnd in sorted(event.rounds, key=lambda x: x.sort_order) for q in sorted(rnd.questions, key=lambda x: x.sort_order) if q.status != "disabled"][:MAX_QUESTIONS]


def normalize_text(value: Any) -> str:
    text = str(value or "").lower().replace("ё", "е").strip()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def check_answer(question: Question, answer: Any) -> bool:
    if answer is None:
        return False
    if question.type in {"single", "hero_choice"}:
        return str(answer) == str(question.correct_answer)
    if question.type == "multiple":
        expected = {str(x) for x in (question.correct_answer or [])}
        actual = {str(x) for x in (answer if isinstance(answer, list) else [answer])}
        return actual == expected
    if question.type == "text":
        variants = [question.correct_answer, *(question.accepted_answers or [])]
        return normalize_text(answer) in {normalize_text(x) for x in variants}
    if question.type == "number":
        try:
            return abs(float(answer) - float(question.correct_answer)) <= float(question.numeric_tolerance or 0)
        except (TypeError, ValueError):
            return False
    if question.type == "closest":
        return False  # определяется сравнением всех ответов при раскрытии
    return False


def recalculate_submissions(db: Session, session: GameSession, question: Question | None = None) -> None:
    questions = [question] if question else ordered_questions(session.event)
    for current in questions:
        rows = db.scalars(select(Submission).where(Submission.session_id == session.id, Submission.question_id == current.id)).all()
        if current.type == "closest":
            numeric = []
            for row in rows:
                try:
                    numeric.append((row, abs(float(row.answer_payload) - float(current.correct_answer))))
                except (TypeError, ValueError):
                    row.is_correct = False
            if numeric:
                best = min(error for _, error in numeric)
                for row, error in numeric:
                    row.is_correct = error == best
        else:
            for row in rows:
                row.is_correct = check_answer(current, row.answer_payload)
    db.flush()


def auto_transition_deadline(event: Event, status: str, question: Question | None = None, now: datetime | None = None) -> datetime | None:
    """Schedule a non-answer screen only when organizer auto mode permits it."""
    if event.host_mode != "auto" or status not in {"countdown", "locked", "review", "reveal", "cancelled"}:
        return None
    # The hero must make the decisive choice before the reveal can advance.
    if status in {"locked", "review"} and question and question.type == "hero_choice":
        return None
    return (now or utcnow()) + timedelta(seconds=event.auto_advance_seconds)


def advance_expired_session(db: Session, session: GameSession, now: datetime | None = None) -> bool:
    """Advance one expired session deadline and return whether state changed."""
    if not session.deadline_at:
        return False
    current_time = now or utcnow()
    deadline = session.deadline_at
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    if deadline > current_time:
        return False

    questions = ordered_questions(session.event)
    question = session.current_question
    if session.status == "answering":
        if question:
            recalculate_submissions(db, session, question)
        session.status = "review" if question and question.type in {"text", "hero_choice"} else "locked"
        session.deadline_at = auto_transition_deadline(session.event, session.status, question, current_time)
    elif session.event.host_mode != "auto":
        session.deadline_at = None
    elif session.status == "countdown":
        if not question:
            session.status = "finished"
            session.finished_at = current_time
            session.deadline_at = None
        else:
            session.status = "answering"
            session.deadline_at = current_time + timedelta(seconds=question.time_limit_seconds)
    elif session.status in {"locked", "review"}:
        if question:
            recalculate_submissions(db, session, question)
        session.status = "reveal"
        session.deadline_at = auto_transition_deadline(session.event, "reveal", question, current_time)
    elif session.status in {"reveal", "cancelled"}:
        next_index = session.current_question_index + 1
        if next_index >= len(questions):
            session.status = "finished"
            session.finished_at = current_time
            session.deadline_at = None
        else:
            session.current_question_index = next_index
            session.current_question_id = questions[next_index].id
            session.status = "countdown"
            session.deadline_at = auto_transition_deadline(session.event, "countdown", questions[next_index], current_time)
    else:
        session.deadline_at = None
    session.state_version += 1
    return True


def leaderboard(db: Session, session: GameSession) -> list[dict]:
    submissions = db.scalars(select(Submission).where(Submission.session_id == session.id, Submission.is_correct.is_(True))).all()
    if session.event.game_mode == "team":
        entities = session.teams
        key_name = "team_id"
    else:
        entities = [p for p in session.participants if p.role != "hero"] + [p for p in session.participants if p.role == "hero"]
        key_name = "participant_id"
    totals: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))
    for row in submissions:
        key = getattr(row, key_name)
        if key:
            count, elapsed = totals[key]
            totals[key] = (count + 1, elapsed + row.elapsed_ms)
    raw = []
    for entity in entities:
        correct, elapsed = totals[entity.id]
        raw.append({
            "id": entity.id,
            "name": entity.full_name if isinstance(entity, Participant) else entity.name,
            "avatar": entity.avatar,
            "color": getattr(entity, "color", None),
            "correct_count": correct,
            "correct_time_ms": elapsed,
        })
    raw.sort(key=lambda item: (-item["correct_count"], item["correct_time_ms"], item["name"].lower()))
    last_pair = None
    last_rank = 0
    for index, item in enumerate(raw, 1):
        pair = (item["correct_count"], item["correct_time_ms"])
        if pair != last_pair:
            last_rank = index
            last_pair = pair
        item["rank"] = last_rank
    return raw


def public_question(question: Question | None, reveal: bool = False) -> dict | None:
    if not question:
        return None
    options = list(question.options)
    if question.shuffle_options:
        options.sort(key=lambda option: hashlib.sha256(f"{question.id}:{option.id}".encode()).hexdigest())
    data = {
        "id": question.id,
        "type": question.type,
        "text": question.text,
        "time_limit_seconds": question.time_limit_seconds,
        "explanation": question.explanation if reveal else "",
        "media_url": question.media_url,
        "media_type": question.media_type,
        "round_title": question.round.title,
        "options": [{"id": option.id, "text": option.text} for option in options],
    }
    if reveal:
        data["correct_answer"] = question.correct_answer
    return data


def answer_target_count(session: GameSession) -> int:
    eligible = [
        participant for participant in session.participants
        if participant.role != "hero" and participant.eligible_from_index <= session.current_question_index
    ]
    if session.event.game_mode == "team":
        return len({participant.team_id for participant in eligible if participant.team_id})
    return len(eligible)


INSIGHT_COLORS = ["#ff6b6b", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc"]


def answer_label(question: Question, payload: Any) -> str:
    if payload is None or payload == "":
        return "Пропуск"
    options = {str(option.id): option.text for option in question.options}
    if isinstance(payload, list):
        labels = [options.get(str(value), str(value)) for value in payload]
        return ", ".join(labels) if labels else "Пропуск"
    return options.get(str(payload), str(payload)).strip()[:120] or "Пропуск"


def tv_answer_insights(session: GameSession, submissions: list[Submission]) -> tuple[list[dict], list[dict]]:
    question = session.current_question
    if session.event.tv_display_mode != "insights" or not question:
        return [], []
    participants = {participant.id: participant for participant in session.participants}
    teams = {team.id: team for team in session.teams}
    live_answers = []
    for row in sorted(submissions, key=lambda item: item.submitted_at):
        entity = teams.get(row.team_id) if row.team_id else participants.get(row.participant_id)
        live_answers.append({
            "id": row.id,
            "name": entity.name if isinstance(entity, Team) else entity.full_name if isinstance(entity, Participant) else "Участник",
            "avatar": getattr(entity, "avatar", "🎯"),
            "answer": answer_label(question, row.answer_payload),
            "submitted_at": iso_utc(row.submitted_at),
        })

    counts: dict[str, dict] = {}
    if question.options:
        for option in question.options:
            counts[str(option.id)] = {"label": option.text, "count": 0}
        for row in submissions:
            values = row.answer_payload if isinstance(row.answer_payload, list) else [row.answer_payload]
            for value in values:
                key = str(value) if value is not None and value != "" else "__skip__"
                if key not in counts:
                    counts[key] = {"label": "Пропуск" if key == "__skip__" else str(value), "count": 0}
                counts[key]["count"] += 1
    else:
        for row in submissions:
            label = answer_label(question, row.answer_payload)
            key = normalize_text(label) or "__skip__"
            if key not in counts:
                counts[key] = {"label": label, "count": 0}
            counts[key]["count"] += 1

    ordered = sorted(counts.values(), key=lambda item: (-item["count"], item["label"].casefold()))
    total = sum(item["count"] for item in ordered)
    breakdown = [{
        "label": item["label"],
        "count": item["count"],
        "percent": round((item["count"] / total) * 100, 1) if total else 0,
        "color": INSIGHT_COLORS[index % len(INSIGHT_COLORS)],
    } for index, item in enumerate(ordered[:8])]
    return live_answers, breakdown


def session_snapshot(db: Session, session: GameSession, participant: Participant | None = None) -> dict:
    question_count = len(ordered_questions(session.event))
    submissions = []
    if session.current_question_id:
        query = select(Submission).where(Submission.session_id == session.id, Submission.question_id == session.current_question_id)
        submissions = list(db.scalars(query).all())
    answered_count = len(submissions)
    live_answers, answer_breakdown = tv_answer_insights(session, submissions)
    reveal = session.status in {"reveal", "finished", "archived"}
    ranking = leaderboard(db, session)
    private = None
    if participant:
        rank_entity = participant.team_id if session.event.game_mode == "team" else participant.id
        private = next((row for row in ranking if row["id"] == rank_entity), None)
        if session.current_question_id:
            own = db.scalar(select(Submission).where(
                Submission.session_id == session.id,
                Submission.question_id == session.current_question_id,
                (Submission.team_id == rank_entity) if session.event.game_mode == "team" else (Submission.participant_id == rank_entity),
            ))
            if own:
                private = {**(private or {}), "answer": own.answer_payload, "elapsed_ms": own.elapsed_ms, "is_correct": own.is_correct if reveal else None}
    return {
        "type": "session.snapshot",
        "version": session.state_version,
        "server_time": iso_utc(utcnow()),
        "session": {
            "id": session.id,
            "join_code": session.join_code,
            "status": session.status,
            "deployment_mode": session.deployment_mode,
            "current_question_index": session.current_question_index,
            "question_count": question_count,
            "deadline_at": iso_utc(session.deadline_at),
            "answered_count": answered_count,
            "answer_target_count": answer_target_count(session),
        },
        "event": {
            "id": session.event.id,
            "title": session.event.title,
            "event_format": session.event.event_format,
            "topic": session.event.topic,
            "hero_name": session.event.hero_name,
            "hero_photo_url": session.event.hero_photo_url,
            "game_mode": session.event.game_mode,
            "host_mode": session.event.host_mode,
            "auto_advance_seconds": session.event.auto_advance_seconds,
            "tv_display_mode": session.event.tv_display_mode,
            "tv_chart_style": session.event.tv_chart_style,
            "theme": session.event.theme,
        },
        "question": public_question(session.current_question, reveal),
        "live_answers": live_answers,
        "answer_breakdown": answer_breakdown,
        "participants": [{
            "id": p.id,
            "name": p.full_name,
            "avatar": p.avatar,
            "role": p.role,
            "team_id": p.team_id,
            "ready": p.ready,
            "connection_status": p.connection_status,
            "latency_ms": p.latency_ms,
            "eligible": session.status == "lobby" or p.eligible_from_index <= session.current_question_index,
        } for p in session.participants],
        "teams": [{"id": t.id, "name": t.name, "avatar": t.avatar, "color": t.color, "captain_participant_id": t.captain_participant_id} for t in session.teams],
        "private_result": private,
        "leaderboard": ranking if session.status in {"finished", "archived"} else [],
    }
