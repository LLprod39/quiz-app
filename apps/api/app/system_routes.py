from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .account_routes import account_payload, session_payload
from .config import settings
from .db import get_db
from .game import utcnow
from .models import (
    Account, AuditLog, AuthSession, Event, GameSession, Participant, PasswordResetToken, Plan, QuizPackTemplate,
    ScreenAccess, ScreenDevice, Submission, Subscription,
)
from .quotas import effective_subscription, serialize_plan, serialize_subscription
from .routes import broadcast_state, session_query
from .security import active_superadmin_count, new_device_token, require_superadmin, token_hash


router = APIRouter(prefix="/api/system")


class AccountAdminBody(BaseModel):
    role: str | None = None
    status: str | None = None
    transfer_to_id: str | None = None


class SubscriptionBody(BaseModel):
    plan_id: str
    current_period_end: datetime | None = None
    source: Literal["manual", "provider"] = "manual"
    provider_customer_id: str | None = Field(default=None, max_length=160)
    provider_subscription_id: str | None = Field(default=None, max_length=160)


class PlanBody(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9-]+$", min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    price_minor: int | None = Field(default=None, ge=0)
    currency: str = Field(default="KZT", min_length=3, max_length=3)
    is_public: bool = True
    is_active: bool = True
    sort_order: int = 0
    quotas: dict = Field(default_factory=dict)
    provider_price_id: str | None = None


class TransferBody(BaseModel):
    owner_id: str


def audit(db: Session, actor: Account, action: str, target_id: str | None = None, before: dict | None = None, after: dict | None = None) -> None:
    db.add(AuditLog(actor_account_id=actor.id, target_account_id=target_id, action=action, before=before, after=after))


def account_admin_payload(db: Session, account: Account) -> dict:
    plan, subscription = effective_subscription(db, account)
    return {
        **account_payload(account),
        "plan": serialize_plan(plan),
        "subscription": serialize_subscription(subscription) if subscription else None,
        "quiz_count": db.scalar(select(func.count()).select_from(Event).where(Event.owner_id == account.id)) or 0,
        "active_session_count": db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.account_id == account.id, AuthSession.revoked_at.is_(None))) or 0,
    }


@router.get("/dashboard")
def dashboard(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    return {
        "accounts": db.scalar(select(func.count()).select_from(Account)) or 0,
        "active_accounts": db.scalar(select(func.count()).select_from(Account).where(Account.status == "active")) or 0,
        "quizzes": db.scalar(select(func.count()).select_from(Event)) or 0,
        "active_rooms": db.scalar(select(func.count()).select_from(GameSession).where(GameSession.status.not_in(("finished", "archived")))) or 0,
        "active_devices": db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow())) or 0,
    }


@router.get("/accounts")
def accounts(q: str = "", status: str = "", role: str = "", plan: str = "", _: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    query = select(Account).order_by(Account.created_at.desc())
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where((Account.display_name.ilike(pattern)) | (Account.phone_e164.ilike(pattern)))
    if status:
        query = query.where(Account.status == status)
    if role:
        query = query.where(Account.role == role)
    payloads = [account_admin_payload(db, account) for account in db.scalars(query).all()]
    return [row for row in payloads if not plan or row["plan"]["code"] == plan]


@router.get("/accounts/{account_id}")
def get_account(account_id: str, _: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Аккаунт не найден")
    devices = db.scalars(select(AuthSession).where(AuthSession.account_id == account.id).order_by(AuthSession.last_seen_at.desc())).all()
    quizzes = db.scalars(select(Event).where(Event.owner_id == account.id).order_by(Event.updated_at.desc())).all()
    audit_rows = db.scalars(
        select(AuditLog)
        .where((AuditLog.target_account_id == account.id) | (AuditLog.actor_account_id == account.id))
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ).all()
    history_rows = db.scalars(
        select(Participant)
        .options(selectinload(Participant.session).selectinload(GameSession.event))
        .where(Participant.account_id == account.id)
        .order_by(Participant.joined_at.desc())
    ).unique().all()
    return {
        **account_admin_payload(db, account),
        "devices": [session_payload(row) for row in devices],
        "quizzes": [{
            "id": row.id,
            "title": row.title,
            "status": row.status,
            "updated_at": row.updated_at.isoformat(),
            "active_rooms": [{"id": session.id, "join_code": session.join_code, "status": session.status} for session in row.sessions if session.status not in {"finished", "archived"}],
        } for row in quizzes],
        "audit": [{"id": row.id, "action": row.action, "before": row.before, "after": row.after, "created_at": row.created_at.isoformat()} for row in audit_rows],
        "history": [{
            "participant_id": row.id,
            "event_title": row.session.event.title,
            "join_code": row.session.join_code,
            "played_at": (row.session.finished_at or row.joined_at).isoformat(),
            "correct_count": db.scalar(select(func.count()).select_from(Submission).where(Submission.participant_id == row.id, Submission.is_correct.is_(True))) or 0,
        } for row in history_rows],
    }


@router.patch("/accounts/{account_id}")
def update_account(account_id: str, body: AccountAdminBody, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Аккаунт не найден")
    before = {"role": account.role, "status": account.status}
    next_role = body.role or account.role
    next_status = body.status or account.status
    if next_role not in {"user", "superadmin"} or next_status not in {"active", "blocked", "deleted"}:
        raise HTTPException(400, "Недопустимая роль или статус")
    if account.role == "superadmin" and account.status == "active" and (next_role != "superadmin" or next_status != "active") and active_superadmin_count(db) <= 1:
        raise HTTPException(409, "Нельзя отключить последнего суперадминистратора")
    if next_status == "deleted":
        owned = db.scalar(select(func.count()).select_from(Event).where(Event.owner_id == account.id)) or 0
        templates = db.scalar(select(func.count()).select_from(QuizPackTemplate).where(QuizPackTemplate.owner_id == account.id)) or 0
        if owned or templates:
            target = db.get(Account, body.transfer_to_id) if body.transfer_to_id else None
            if not target or target.id == account.id or target.status != "active":
                raise HTTPException(409, "Перед удалением выберите активного владельца для квизов")
            active_room = db.scalar(
                select(GameSession.id).join(Event).where(
                    Event.owner_id == account.id,
                    GameSession.status.not_in(("finished", "archived")),
                )
            )
            if active_room:
                raise HTTPException(409, "Перед удалением завершите активные комнаты аккаунта")
            db.execute(update(Event).where(Event.owner_id == account.id).values(owner_id=target.id, is_selected=False))
            db.execute(update(QuizPackTemplate).where(QuizPackTemplate.owner_id == account.id).values(owner_id=target.id))
    account.role = next_role
    account.status = next_status
    if next_status != "active":
        db.execute(update(AuthSession).where(AuthSession.account_id == account.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    audit(db, actor, "account.updated", account.id, before, {"role": next_role, "status": next_status})
    db.commit()
    return account_admin_payload(db, account)


@router.post("/accounts/{account_id}/reset-link")
def create_reset_link(account_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Аккаунт не найден")
    raw = new_device_token()
    db.add(PasswordResetToken(account_id=account.id, token_hash=token_hash(raw), created_by_id=actor.id, expires_at=utcnow().replace(microsecond=0) + timedelta(minutes=15)))
    audit(db, actor, "account.password_reset.created", account.id)
    db.commit()
    return {"reset_url": f"{settings.public_base_url.rstrip('/')}/reset-password/{raw}", "expires_in_seconds": 900}


@router.post("/accounts/{account_id}/sessions/{session_id}/revoke")
def revoke_account_session(account_id: str, session_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    row = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.account_id == account_id))
    if not row:
        raise HTTPException(404, "Устройство не найдено")
    row.revoked_at = utcnow()
    audit(db, actor, "account.session.revoked", account_id, after={"session_id": session_id})
    db.commit()
    return {"status": "revoked"}


@router.post("/accounts/{account_id}/subscription")
def assign_subscription(account_id: str, body: SubscriptionBody, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    account = db.get(Account, account_id)
    plan = db.get(Plan, body.plan_id)
    if not account or not plan:
        raise HTTPException(404, "Аккаунт или тариф не найден")
    db.execute(update(Subscription).where(Subscription.account_id == account.id, Subscription.status.in_(("active", "trialing"))).values(status="canceled"))
    subscription = Subscription(
        account_id=account.id,
        plan_id=plan.id,
        status="active",
        source=body.source,
        current_period_end=body.current_period_end,
        provider_customer_id=body.provider_customer_id,
        provider_subscription_id=body.provider_subscription_id,
    )
    db.add(subscription)
    audit(db, actor, "subscription.assigned", account.id, after={"plan": plan.code, "period_end": body.current_period_end.isoformat() if body.current_period_end else None})
    db.commit()
    db.refresh(subscription)
    return serialize_subscription(subscription)


@router.get("/plans")
def list_plans(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    return [serialize_plan(plan) for plan in db.scalars(select(Plan).order_by(Plan.sort_order)).all()]


@router.post("/plans")
def create_plan(body: PlanBody, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    if db.scalar(select(Plan).where(Plan.code == body.code)):
        raise HTTPException(409, "Код тарифа уже занят")
    plan = Plan(**body.model_dump())
    db.add(plan)
    audit(db, actor, "plan.created", after={"code": plan.code})
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan)


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, body: PlanBody, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Тариф не найден")
    if body.code != plan.code:
        raise HTTPException(409, "Стабильный код существующего тарифа нельзя изменить")
    before = serialize_plan(plan)
    for key, value in body.model_dump().items():
        setattr(plan, key, value)
    audit(db, actor, "plan.updated", before=before, after={"code": plan.code})
    db.commit()
    return serialize_plan(plan)


@router.get("/quizzes")
def list_quizzes(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    rows = db.execute(select(Event, Account).join(Account, Event.owner_id == Account.id).order_by(Event.updated_at.desc())).all()
    return [{
        "id": event.id,
        "title": event.title,
        "status": event.status,
        "owner": {"id": owner.id, "name": owner.display_name, "phone": owner.phone_e164},
        "updated_at": event.updated_at.isoformat(),
        "active_rooms": [{"id": session.id, "join_code": session.join_code, "status": session.status} for session in event.sessions if session.status not in {"finished", "archived"}],
    } for event, owner in rows]


@router.post("/sessions/{session_id}/stop")
async def stop_session(session_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    session = db.scalar(session_query().where(GameSession.id == session_id))
    if not session:
        raise HTTPException(404, "Комната не найдена")
    if session.status in {"finished", "archived"}:
        return {"status": session.status, "join_code": session.join_code}
    before = {"status": session.status, "join_code": session.join_code}
    session.status = "finished"
    session.finished_at = utcnow()
    session.deadline_at = None
    session.state_version += 1
    audit(db, actor, "game_session.stopped", session.event.owner_id, before, {"session_id": session.id, "status": "finished"})
    db.commit()
    session = db.scalar(session_query().where(GameSession.id == session.id))
    await broadcast_state(db, session)
    return {"status": "finished", "join_code": session.join_code}


@router.post("/quizzes/{event_id}/transfer")
def transfer_quiz(event_id: str, body: TransferBody, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    owner = db.get(Account, body.owner_id)
    if not event or not owner or owner.status != "active":
        raise HTTPException(404, "Квиз или новый владелец не найден")
    active = db.scalar(select(GameSession.id).where(GameSession.event_id == event.id, GameSession.status.not_in(("finished", "archived"))))
    if active:
        raise HTTPException(409, "Сначала завершите активную комнату")
    before = event.owner_id
    event.owner_id = owner.id
    event.is_selected = False
    audit(db, actor, "quiz.transferred", owner.id, {"owner_id": before}, {"event_id": event.id, "owner_id": owner.id})
    db.commit()
    return {"status": "transferred", "event_id": event.id, "owner_id": owner.id}


@router.post("/quizzes/{event_id}/archive")
def archive_quiz(event_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Квиз не найден")
    active = db.scalar(select(GameSession.id).where(GameSession.event_id == event.id, GameSession.status.not_in(("finished", "archived"))))
    if active:
        raise HTTPException(409, "Сначала завершите активную комнату")
    event.status = "archived"; event.is_selected = False
    audit(db, actor, "quiz.archived", event.owner_id, after={"event_id": event.id})
    db.commit()
    return {"status": "archived"}


@router.post("/quiz-packs/{template_id}/publish")
def publish_template(template_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    source = db.get(QuizPackTemplate, template_id)
    if not source or source.visibility != "private":
        raise HTTPException(404, "Личный шаблон не найден")
    existing_publication = db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.published_from_id == source.id, QuizPackTemplate.visibility == "public"))
    if existing_publication:
        return {"id": existing_publication.id, "slug": existing_publication.slug, "visibility": existing_publication.visibility}
    slug = source.slug
    if db.scalar(select(QuizPackTemplate).where(QuizPackTemplate.slug == slug, QuizPackTemplate.id != source.id)):
        slug = f"{slug}-{source.id[:6]}"
    published = QuizPackTemplate(owner_id=None, slug=slug, definition=dict(source.definition), visibility="public", published_from_id=source.id)
    db.add(published)
    audit(db, actor, "quiz_pack.published", source.owner_id, after={"source_id": source.id, "slug": slug})
    db.commit()
    return {"id": published.id, "slug": published.slug, "visibility": published.visibility}


@router.delete("/quiz-packs/{template_id}/publication")
def unpublish_template(template_id: str, actor: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    template = db.get(QuizPackTemplate, template_id)
    if not template or template.visibility != "public":
        raise HTTPException(404, "Публикация не найдена")
    audit(db, actor, "quiz_pack.unpublished", after={"template_id": template.id, "slug": template.slug})
    db.delete(template); db.commit()
    return {"status": "unpublished"}


@router.get("/quiz-packs")
def list_templates(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    rows = db.scalars(select(QuizPackTemplate).order_by(QuizPackTemplate.updated_at.desc())).all()
    owners = {owner.id: owner for owner in db.scalars(select(Account)).all()}
    publications = {row.published_from_id: row for row in rows if row.visibility == "public" and row.published_from_id}
    return [{
        "id": row.id,
        "slug": row.slug,
        "title": row.definition.get("title", row.slug),
        "visibility": row.visibility,
        "owner": ({"id": owners[row.owner_id].id, "name": owners[row.owner_id].display_name, "phone": owners[row.owner_id].phone_e164} if row.owner_id in owners else None),
        "published_from_id": row.published_from_id,
        "publication_id": publications[row.id].id if row.id in publications else None,
        "updated_at": row.updated_at.isoformat(),
    } for row in rows]


@router.get("/devices")
def devices(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    auth_rows = db.execute(select(AuthSession, Account).join(Account).order_by(AuthSession.last_seen_at.desc()).limit(500)).all()
    screen_rows = db.scalars(select(ScreenDevice).options(selectinload(ScreenDevice.access).selectinload(ScreenAccess.session)).order_by(ScreenDevice.last_seen_at.desc()).limit(500)).all()
    return {
        "accounts": [{**session_payload(row), "account": {"id": account.id, "name": account.display_name, "phone": account.phone_e164}} for row, account in auth_rows],
        "screens": [{"id": row.id, "room": row.access.session.join_code, "browser": row.browser, "os": row.os, "ip_address": row.ip_address, "last_seen_at": row.last_seen_at.isoformat()} for row in screen_rows],
    }


@router.get("/audit")
def audit_log(_: Account = Depends(require_superadmin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(500)).all()
    return [{"id": row.id, "action": row.action, "actor_account_id": row.actor_account_id, "target_account_id": row.target_account_id, "before": row.before, "after": row.after, "created_at": row.created_at.isoformat()} for row in rows]
