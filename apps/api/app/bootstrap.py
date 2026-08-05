from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import Account, Event, MediaAsset, Plan, QuizPackTemplate, Subscription
from .security import hash_password, normalize_phone


FREE_QUOTAS = {
    "active_quizzes": 2,
    "participants_per_game": 30,
    "concurrent_rooms": 1,
    "media_bytes": 100 * 1024 * 1024,
    "questions_per_quiz": 20,
    "private_templates": 1,
    "games_per_month": 5,
    "history_days": 30,
}
PRO_QUOTAS = {
    "active_quizzes": None,
    "participants_per_game": None,
    "concurrent_rooms": None,
    "media_bytes": None,
    "questions_per_quiz": None,
    "private_templates": None,
    "games_per_month": None,
    "history_days": None,
}


def bootstrap_database(db: Session) -> Account:
    plans = {}
    for code, name, description, quotas, order in (
        ("free", "Free", "Для небольших домашних квизов", FREE_QUOTAS, 0),
        ("pro", "Pro", "Без тарифных ограничений", PRO_QUOTAS, 1),
    ):
        plan = db.scalar(select(Plan).where(Plan.code == code))
        if not plan:
            plan = Plan(code=code, name=name, description=description, quotas=quotas, sort_order=order)
            db.add(plan)
            db.flush()
        plans[code] = plan

    account = db.scalar(select(Account).where(Account.role == "superadmin").order_by(Account.created_at))
    if not account:
        if settings.deployment_mode == "cloud" and (
            not settings.bootstrap_admin_phone.strip()
            or not settings.bootstrap_admin_password
            or not settings.bootstrap_admin_name.strip()
            or not settings.bootstrap_admin_avatar.strip()
            or settings.bootstrap_admin_phone == "+77000000000"
            or settings.bootstrap_admin_password == "celebrate"
        ):
            raise RuntimeError(
                "Set BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD, "
                "BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_AVATAR before the first cloud start"
            )
        account = Account(
            phone_e164=normalize_phone(settings.bootstrap_admin_phone),
            display_name=settings.bootstrap_admin_name,
            avatar=settings.bootstrap_admin_avatar,
            avatar_kind="preset",
            password_hash=hash_password(settings.bootstrap_admin_password),
            role="superadmin",
            status="active",
        )
        db.add(account)
        db.flush()
        db.add(Subscription(account_id=account.id, plan_id=plans["pro"].id, status="active", source="manual"))

    db.query(Event).filter(Event.owner_id.is_(None)).update({Event.owner_id: account.id}, synchronize_session=False)
    db.query(QuizPackTemplate).filter(QuizPackTemplate.owner_id.is_(None), QuizPackTemplate.visibility == "private").update({QuizPackTemplate.owner_id: account.id}, synchronize_session=False)
    db.commit()
    reconcile_media_assets(db)
    db.refresh(account)
    return account


def reconcile_media_assets(db: Session) -> None:
    known = set(db.scalars(select(MediaAsset.url)).all())
    for event in db.scalars(select(Event)).all():
        urls = [event.hero_photo_url]
        urls.extend(question.media_url for round_ in event.rounds for question in round_.questions)
        for url in {value for value in urls if value and value.startswith("/media/") and not value.startswith("/media/avatars/")}:
            if url in known:
                continue
            path = settings.media_path / url.removeprefix("/media/")
            if not path.is_file():
                continue
            media_type = "audio" if path.suffix.lower() in {".mp3", ".m4a", ".ogg"} else "image"
            db.add(MediaAsset(owner_id=event.owner_id, event_id=event.id, url=url, path=str(path), size_bytes=path.stat().st_size, media_type=media_type))
            known.add(url)
    db.commit()
