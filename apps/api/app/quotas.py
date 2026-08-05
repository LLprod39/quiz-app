from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .game import utcnow
from .models import Account, Event, GameSession, MediaAsset, Participant, Plan, Question, QuizPackTemplate, Round, Subscription


def lock_account_quota(db: Session, account: Account) -> None:
    """Serialize quota-changing operations for one account on PostgreSQL.

    SQLite ignores FOR UPDATE but serializes writes itself. Keeping the lock and
    the subsequent count in one transaction prevents two concurrent requests
    from both observing the same free slot on databases that support row locks.
    """
    db.execute(select(Account.id).where(Account.id == account.id).with_for_update())


def effective_subscription(db: Session, account: Account) -> tuple[Plan, Subscription | None]:
    current = utcnow()
    subscriptions = db.scalars(
        select(Subscription)
        .options(selectinload(Subscription.plan))
        .where(Subscription.account_id == account.id, Subscription.status.in_(("active", "trialing")))
        .order_by(Subscription.created_at.desc())
    ).all()
    for subscription in subscriptions:
        end = subscription.current_period_end
        if not end or (end if end.tzinfo else end.replace(tzinfo=timezone.utc)) > current:
            return subscription.plan, subscription
        subscription.status = "expired"
    fallback = db.scalar(select(Plan).where(Plan.code == "free"))
    if not fallback:
        raise RuntimeError("Free plan is not configured")
    return fallback, None


def account_usage(db: Session, account: Account) -> dict:
    now = utcnow()
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    active_quizzes = db.scalar(select(func.count()).select_from(Event).where(Event.owner_id == account.id, Event.status != "archived")) or 0
    concurrent_rooms = db.scalar(
        select(func.count()).select_from(GameSession).join(Event).where(Event.owner_id == account.id, GameSession.status.not_in(("finished", "archived")))
    ) or 0
    media_bytes = db.scalar(select(func.coalesce(func.sum(MediaAsset.size_bytes), 0)).where(MediaAsset.owner_id == account.id)) or 0
    private_templates = db.scalar(
        select(func.count()).select_from(QuizPackTemplate).where(QuizPackTemplate.owner_id == account.id, QuizPackTemplate.visibility == "private")
    ) or 0
    games_per_month = db.scalar(
        select(func.count()).select_from(GameSession).join(Event).where(Event.owner_id == account.id, GameSession.created_at >= month_start)
    ) or 0
    return {
        "active_quizzes": active_quizzes,
        "concurrent_rooms": concurrent_rooms,
        "media_bytes": int(media_bytes),
        "private_templates": private_templates,
        "games_per_month": games_per_month,
    }


def plan_payload(db: Session, account: Account) -> dict:
    plan, subscription = effective_subscription(db, account)
    usage = account_usage(db, account)
    return {
        "plan": serialize_plan(plan),
        "subscription": serialize_subscription(subscription) if subscription else None,
        "usage": {key: {"current": value, "limit": plan.quotas.get(key)} for key, value in usage.items()},
    }


def serialize_plan(plan: Plan) -> dict:
    return {
        "id": plan.id,
        "code": plan.code,
        "name": plan.name,
        "description": plan.description,
        "price_minor": plan.price_minor,
        "currency": plan.currency,
        "is_public": plan.is_public,
        "is_active": plan.is_active,
        "sort_order": plan.sort_order,
        "quotas": plan.quotas or {},
        "provider_price_id": plan.provider_price_id,
    }


def serialize_subscription(subscription: Subscription) -> dict:
    return {
        "id": subscription.id,
        "plan_id": subscription.plan_id,
        "status": subscription.status,
        "source": subscription.source,
        "starts_at": subscription.starts_at.isoformat() if subscription.starts_at else None,
        "current_period_end": subscription.current_period_end.isoformat() if subscription.current_period_end else None,
        "provider_customer_id": subscription.provider_customer_id,
        "provider_subscription_id": subscription.provider_subscription_id,
    }


def quota_limit(db: Session, account: Account, key: str) -> int | None:
    plan, _ = effective_subscription(db, account)
    value = (plan.quotas or {}).get(key)
    return int(value) if value is not None else None


def enforce_quota(db: Session, account: Account, key: str, current: int, increment: int = 1) -> None:
    limit = quota_limit(db, account, key)
    if limit is not None and current + increment > limit:
        raise HTTPException(
            403,
            detail={
                "code": "quota_exceeded",
                "limit": key,
                "current": current,
                "maximum": limit,
                "upgrade_url": "/account?tab=plan",
            },
        )


def enforce_account_usage(db: Session, account: Account, key: str, increment: int = 1) -> None:
    lock_account_quota(db, account)
    enforce_quota(db, account, key, account_usage(db, account)[key], increment)


def enforce_new_quiz(db: Session, account: Account) -> None:
    enforce_account_usage(db, account, "active_quizzes")


def enforce_new_room(db: Session, account: Account) -> None:
    lock_account_quota(db, account)
    usage = account_usage(db, account)
    enforce_quota(db, account, "concurrent_rooms", usage["concurrent_rooms"])
    enforce_quota(db, account, "games_per_month", usage["games_per_month"])


def enforce_question_count(db: Session, account: Account, event: Event, increment: int = 1) -> None:
    lock_account_quota(db, account)
    current = db.scalar(
        select(func.count()).select_from(Question).join(Round).where(Round.event_id == event.id)
    ) or 0
    enforce_quota(db, account, "questions_per_quiz", current, increment)


def enforce_participants(db: Session, account: Account, session: GameSession) -> None:
    lock_account_quota(db, account)
    current = db.scalar(select(func.count()).select_from(Participant).where(Participant.session_id == session.id)) or 0
    enforce_quota(db, account, "participants_per_game", current)
