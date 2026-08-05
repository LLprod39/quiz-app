import io
from datetime import timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .config import settings
from .db import get_db
from .game import utcnow
from .models import Account, AuditLog, AuthSession, GameSession, GuestDevice, Participant, PasswordResetToken, Plan, Submission, Subscription
from .quotas import effective_subscription, plan_payload, serialize_plan
from .security import (
    clear_auth_cookies,
    create_auth_session,
    hash_password,
    new_device_token,
    normalize_phone,
    parse_user_agent,
    request_ip,
    require_account,
    set_auth_cookies,
    token_hash,
    verify_password,
)


router = APIRouter(prefix="/api")
PRESET_AVATARS = {"🎈", "🚀", "🎉", "✨", "🧠", "🎮", "🌟", "🦊", "🐼", "👑", "🎤", "🏆"}


class RegisterBody(BaseModel):
    phone: str
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)
    avatar: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("avatar")
    @classmethod
    def validate_avatar(cls, value: str) -> str:
        if value not in PRESET_AVATARS:
            raise ValueError("Выберите аватар из списка")
        return value


class LoginBody(BaseModel):
    phone: str
    password: str


class ProfileBody(BaseModel):
    display_name: str = Field(min_length=2, max_length=80)
    avatar: str | None = None


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ResetCompleteBody(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class DeviceRenameBody(BaseModel):
    device_name: str = Field(min_length=2, max_length=120)


def account_payload(account: Account) -> dict:
    return {
        "id": account.id,
        "phone": account.phone_e164,
        "display_name": account.display_name,
        "avatar": account.avatar,
        "avatar_kind": account.avatar_kind,
        "role": account.role,
        "status": account.status,
        "created_at": account.created_at.isoformat(),
        "last_login_at": account.last_login_at.isoformat() if account.last_login_at else None,
    }


def auth_response(db: Session, account: Account, request: Request, status_code: int = 200) -> JSONResponse:
    session, raw = create_auth_session(db, account, request)
    response = JSONResponse({"account": account_payload(account), "csrf_token": session.csrf_token}, status_code=status_code)
    set_auth_cookies(response, session, raw)
    return response


@router.post("/auth/register")
def register(body: RegisterBody, request: Request, db: Session = Depends(get_db)):
    if db.scalar(select(Account).where(Account.phone_e164 == body.phone)):
        raise HTTPException(409, "Аккаунт с таким номером уже существует")
    free = db.scalar(select(Plan).where(Plan.code == "free"))
    if not free:
        raise HTTPException(503, "Тариф Free не настроен")
    account = Account(
        phone_e164=body.phone,
        display_name=body.display_name.strip(),
        avatar=body.avatar,
        avatar_kind="preset",
        password_hash=hash_password(body.password),
    )
    db.add(account)
    db.flush()
    db.add(Subscription(account_id=account.id, plan_id=free.id, status="active", source="manual"))
    db.commit()
    db.refresh(account)
    return auth_response(db, account, request, 201)


@router.post("/auth/login")
def login(body: LoginBody, request: Request, db: Session = Depends(get_db)):
    try:
        phone = normalize_phone(body.phone)
    except ValueError:
        raise HTTPException(401, "Неверный номер телефона или пароль")
    account = db.scalar(select(Account).where(Account.phone_e164 == phone))
    if not account or not verify_password(account.password_hash, body.password):
        raise HTTPException(401, "Неверный номер телефона или пароль")
    if account.status != "active":
        raise HTTPException(403, "Аккаунт заблокирован")
    return auth_response(db, account, request)


@router.get("/auth/me")
def me(account: Account = Depends(require_account)):
    return account_payload(account)


@router.post("/auth/logout")
def logout(request: Request, response: Response, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    raw = request.cookies.get(settings.auth_cookie_name, "")
    row = db.scalar(select(AuthSession).where(AuthSession.account_id == account.id, AuthSession.token_hash == token_hash(raw)))
    if row:
        row.revoked_at = utcnow()
        db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.session.revoked", after={"session_id": row.id, "scope": "current"}))
        db.commit()
    clear_auth_cookies(response)
    return {"status": "logged_out"}


@router.post("/auth/logout-all")
def logout_all(response: Response, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    db.execute(update(AuthSession).where(AuthSession.account_id == account.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.sessions.revoked_all"))
    db.commit()
    clear_auth_cookies(response)
    return {"status": "logged_out"}


@router.put("/auth/password")
def change_password(body: PasswordChangeBody, request: Request, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    if not verify_password(account.password_hash, body.current_password):
        raise HTTPException(400, "Текущий пароль неверен")
    account.password_hash = hash_password(body.new_password)
    current_hash = token_hash(request.cookies.get(settings.auth_cookie_name, ""))
    db.execute(update(AuthSession).where(AuthSession.account_id == account.id, AuthSession.token_hash != current_hash).values(revoked_at=utcnow()))
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.password.changed"))
    db.commit()
    return {"status": "password_changed"}


@router.post("/auth/reset-password")
def complete_reset(body: ResetCompleteBody, db: Session = Depends(get_db)):
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash(body.token)))
    if not row or row.used_at is not None:
        raise HTTPException(404, "Ссылка сброса недействительна")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires <= utcnow():
        raise HTTPException(410, "Ссылка сброса истекла")
    account = db.get(Account, row.account_id)
    account.password_hash = hash_password(body.new_password)
    row.used_at = utcnow()
    db.execute(update(AuthSession).where(AuthSession.account_id == account.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    db.add(AuditLog(target_account_id=account.id, action="account.password.reset.completed"))
    db.commit()
    return {"status": "password_changed"}


@router.put("/account/profile")
def update_profile(body: ProfileBody, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    account.display_name = body.display_name.strip()
    if body.avatar is not None:
        if body.avatar not in PRESET_AVATARS:
            raise HTTPException(400, "Выберите аватар из списка")
        account.avatar = body.avatar
        account.avatar_kind = "preset"
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.profile.updated", after={"display_name": account.display_name, "avatar_kind": account.avatar_kind}))
    db.commit()
    return account_payload(account)


@router.post("/account/avatar")
async def upload_avatar(file: UploadFile = File(...), account: Account = Depends(require_account), db: Session = Depends(get_db)):
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Аватар должен быть не больше 5 МБ")
    try:
        image = Image.open(io.BytesIO(content))
        if image.format not in {"JPEG", "PNG", "WEBP"}:
            raise ValueError("unsupported avatar format")
        image = ImageOps.fit(image.convert("RGB"), (512, 512), method=Image.Resampling.LANCZOS)
    except Exception as exc:
        raise HTTPException(400, "Поддерживаются JPEG, PNG и WebP") from exc
    avatar_dir = settings.media_path / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{account.id}.webp"
    image.save(avatar_dir / filename, "WEBP", quality=88)
    account.avatar = f"/media/avatars/{filename}"
    account.avatar_kind = "upload"
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.avatar.updated", after={"avatar_kind": "upload"}))
    db.commit()
    return account_payload(account)


def session_payload(row: AuthSession, current_hash: str = "") -> dict:
    return {
        "id": row.id,
        "device_name": row.device_name,
        "browser": row.browser,
        "os": row.os,
        "ip_address": row.ip_address,
        "created_at": row.created_at.isoformat(),
        "last_seen_at": row.last_seen_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "is_current": row.token_hash == current_hash,
    }


@router.get("/account/sessions")
def list_sessions(request: Request, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    current_hash = token_hash(request.cookies.get(settings.auth_cookie_name, ""))
    rows = db.scalars(select(AuthSession).where(AuthSession.account_id == account.id).order_by(AuthSession.last_seen_at.desc())).all()
    return [session_payload(row, current_hash) for row in rows]


@router.put("/account/sessions/{session_id}")
def rename_session(session_id: str, body: DeviceRenameBody, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    row = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.account_id == account.id))
    if not row:
        raise HTTPException(404, "Устройство не найдено")
    row.device_name = body.device_name.strip()
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.session.renamed", after={"session_id": row.id, "device_name": row.device_name}))
    db.commit()
    return session_payload(row)


@router.delete("/account/sessions/{session_id}")
def revoke_session(session_id: str, response: Response, request: Request, account: Account = Depends(require_account), db: Session = Depends(get_db)):
    row = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.account_id == account.id))
    if not row:
        raise HTTPException(404, "Устройство не найдено")
    row.revoked_at = utcnow()
    db.add(AuditLog(actor_account_id=account.id, target_account_id=account.id, action="account.session.revoked", after={"session_id": row.id, "scope": "single"}))
    db.commit()
    if row.token_hash == token_hash(request.cookies.get(settings.auth_cookie_name, "")):
        clear_auth_cookies(response)
    return {"status": "revoked"}


@router.get("/plans")
def public_plans(db: Session = Depends(get_db)):
    return [serialize_plan(plan) for plan in db.scalars(select(Plan).where(Plan.is_public.is_(True), Plan.is_active.is_(True)).order_by(Plan.sort_order)).all()]


@router.get("/account/usage")
def usage(account: Account = Depends(require_account), db: Session = Depends(get_db)):
    return plan_payload(db, account)


@router.get("/account/history")
def history(account: Account = Depends(require_account), db: Session = Depends(get_db)):
    plan, _ = effective_subscription(db, account)
    query = select(Participant).options(selectinload(Participant.session).selectinload(GameSession.event)).where(Participant.account_id == account.id)
    days = (plan.quotas or {}).get("history_days")
    if days is not None:
        query = query.join(GameSession).where(GameSession.finished_at.is_(None) | (GameSession.finished_at >= utcnow() - timedelta(days=int(days))))
    rows = db.scalars(query.order_by(Participant.joined_at.desc())).unique().all()
    return [{
        "participant_id": row.id,
        "event_title": row.session.event.title,
        "join_code": row.session.join_code,
        "status": row.session.status,
        "played_at": (row.session.finished_at or row.joined_at).isoformat(),
        "correct_count": db.scalar(select(func.count()).select_from(Submission).where(Submission.participant_id == row.id, Submission.is_correct.is_(True))) or 0,
    } for row in rows]


def guest_device(db: Session, raw_token: str | None) -> GuestDevice | None:
    return db.scalar(select(GuestDevice).where(GuestDevice.token_hash == token_hash(raw_token))) if raw_token else None


@router.get("/account/unclaimed-results")
def unclaimed_results(x_guest_device_token: str | None = Header(default=None), account: Account = Depends(require_account), db: Session = Depends(get_db)):
    device = guest_device(db, x_guest_device_token)
    if not device:
        return []
    rows = db.scalars(select(Participant).options(selectinload(Participant.session).selectinload(GameSession.event)).where(Participant.guest_device_id == device.id, Participant.account_id.is_(None))).unique().all()
    return [{"participant_id": row.id, "event_title": row.session.event.title, "join_code": row.session.join_code, "played_at": row.joined_at.isoformat()} for row in rows]


@router.post("/account/claim-results")
def claim_results(x_guest_device_token: str | None = Header(default=None), account: Account = Depends(require_account), db: Session = Depends(get_db)):
    device = guest_device(db, x_guest_device_token)
    if not device:
        raise HTTPException(404, "Гостевое устройство не найдено")
    result = db.execute(update(Participant).where(Participant.guest_device_id == device.id, Participant.account_id.is_(None)).values(account_id=account.id))
    db.commit()
    return {"status": "claimed", "count": result.rowcount}
