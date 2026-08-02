from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def uid() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(160))
    event_format: Mapped[str] = mapped_column(String(20), default="celebration", server_default="celebration")
    topic: Mapped[str] = mapped_column(String(160), default="", server_default="")
    hero_name: Mapped[str] = mapped_column(String(100))
    event_date: Mapped[str] = mapped_column(String(20), default="")
    status: Mapped[str] = mapped_column(String(24), default="draft")
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    game_mode: Mapped[str] = mapped_column(String(16), default="individual")
    host_mode: Mapped[str] = mapped_column(String(16), default="auto", server_default="auto", nullable=False)
    auto_advance_seconds: Mapped[int] = mapped_column(Integer, default=5, server_default="5", nullable=False)
    tv_display_mode: Mapped[str] = mapped_column(String(16), default="classic", server_default="classic", nullable=False)
    tv_chart_style: Mapped[str] = mapped_column(String(16), default="both", server_default="both", nullable=False)
    theme: Mapped[dict] = mapped_column(JSON, default=lambda: {"accent": "#ff6b6b", "mode": "dark", "decor": "confetti"})
    hero_photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    allow_late_join: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    rounds: Mapped[list["Round"]] = relationship(back_populates="event", cascade="all, delete-orphan", order_by="Round.sort_order")
    questionnaire: Mapped["Questionnaire | None"] = relationship(back_populates="event", cascade="all, delete-orphan", uselist=False)
    sessions: Mapped[list["GameSession"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Questionnaire(Base):
    __tablename__ = "questionnaires"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), unique=True)
    public_token: Mapped[str] = mapped_column(String(80), unique=True, default=uid)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    event: Mapped[Event] = relationship(back_populates="questionnaire")
    items: Mapped[list["QuestionnaireItem"]] = relationship(back_populates="questionnaire", cascade="all, delete-orphan", order_by="QuestionnaireItem.sort_order")


class QuestionnaireItem(Base):
    __tablename__ = "questionnaire_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    questionnaire_id: Mapped[str] = mapped_column(ForeignKey("questionnaires.id"))
    text: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(24), default="text")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    questionnaire: Mapped[Questionnaire] = relationship(back_populates="items")
    response: Mapped["QuestionnaireResponse | None"] = relationship(back_populates="item", cascade="all, delete-orphan", uselist=False)


class QuestionnaireResponse(Base):
    __tablename__ = "questionnaire_responses"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    item_id: Mapped[str] = mapped_column(ForeignKey("questionnaire_items.id"), unique=True)
    value: Mapped[str] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    item: Mapped[QuestionnaireItem] = relationship(back_populates="response")


class Round(Base):
    __tablename__ = "rounds"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"))
    title: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    event: Mapped[Event] = relationship(back_populates="rounds")
    questions: Mapped[list["Question"]] = relationship(back_populates="round", cascade="all, delete-orphan", order_by="Question.sort_order")


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"))
    type: Mapped[str] = mapped_column(String(24), default="single")
    text: Mapped[str] = mapped_column(Text)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, default=30)
    correct_answer: Mapped[object | None] = mapped_column(JSON, nullable=True)
    accepted_answers: Mapped[list] = mapped_column(JSON, default=list)
    numeric_tolerance: Mapped[float | None] = mapped_column(Float, nullable=True)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=False)
    explanation: Mapped[str] = mapped_column(Text, default="")
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    media_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    audio_replays: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="ready")
    round: Mapped[Round] = relationship(back_populates="questions")
    options: Mapped[list["AnswerOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="AnswerOption.sort_order")


class AnswerOption(Base):
    __tablename__ = "answer_options"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id"))
    text: Mapped[str] = mapped_column(String(300))
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    question: Mapped[Question] = relationship(back_populates="options")


class GameSession(Base):
    __tablename__ = "game_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"))
    join_code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="lobby")
    current_question_id: Mapped[str | None] = mapped_column(ForeignKey("questions.id"), nullable=True)
    current_question_index: Mapped[int] = mapped_column(Integer, default=-1)
    state_version: Mapped[int] = mapped_column(Integer, default=1)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_remaining_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deployment_mode: Mapped[str] = mapped_column(String(16), default="lan")
    event: Mapped[Event] = relationship(back_populates="sessions")
    current_question: Mapped[Question | None] = relationship(foreign_keys=[current_question_id])
    participants: Mapped[list["Participant"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    teams: Mapped[list["Team"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    submissions: Mapped[list["Submission"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"))
    name: Mapped[str] = mapped_column(String(100))
    avatar: Mapped[str] = mapped_column(String(16), default="🎉")
    color: Mapped[str] = mapped_column(String(16), default="#ff6b6b")
    captain_participant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    session: Mapped[GameSession] = relationship(back_populates="teams")
    participants: Mapped[list["Participant"]] = relationship(back_populates="team")


class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"))
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(80))
    patronymic_initial: Mapped[str] = mapped_column(String(1), default="")
    avatar: Mapped[str] = mapped_column(String(16), default="🎈")
    role: Mapped[str] = mapped_column(String(16), default="guest")
    device_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    eligible_from_index: Mapped[int] = mapped_column(Integer, default=0)
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    media_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    sound_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    connection_status: Mapped[str] = mapped_column(String(16), default="online")
    session: Mapped[GameSession] = relationship(back_populates="participants")
    team: Mapped[Team | None] = relationship(back_populates="participants", foreign_keys=[team_id])

    @property
    def full_name(self) -> str:
        return f"{self.display_name} {self.patronymic_initial}." if self.patronymic_initial else self.display_name


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("request_id", name="uq_submission_request"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_id: Mapped[str] = mapped_column(String(80))
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"))
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id"))
    participant_id: Mapped[str | None] = mapped_column(ForeignKey("participants.id"), nullable=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    answer_payload: Mapped[object | None] = mapped_column(JSON, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    validation_status: Mapped[str] = mapped_column(String(24), default="automatic")
    session: Mapped[GameSession] = relationship(back_populates="submissions")
    participant: Mapped[Participant | None] = relationship(foreign_keys=[participant_id])
    team: Mapped[Team | None] = relationship(foreign_keys=[team_id])
    question: Mapped[Question] = relationship()


class DeviceTransfer(Base):
    __tablename__ = "device_transfers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id"))
    claim_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    participant: Mapped[Participant] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("game_sessions.id"), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
