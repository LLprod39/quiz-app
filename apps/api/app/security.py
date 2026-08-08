import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta

import phonenumbers
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .game import utcnow
from .models import Account, AuthSession


password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _sign(payload: str) -> str:
    return hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _encode_signed_payload(data: dict) -> str:
    payload = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{payload}.{_sign(payload)}"


def _decode_signed_payload(token: str) -> dict | None:
    try:
        payload, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, _sign(payload)):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return data if isinstance(data, dict) else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None




def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def normalize_phone(value: str) -> str:
    try:
        parsed = phonenumbers.parse(value.strip(), None)
    except phonenumbers.NumberParseException as exc:
        raise ValueError("Введите номер в международном формате, например +77001234567") from exc
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError("Некорректный номер телефона")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "")


def parse_user_agent(value: str) -> tuple[str, str, str]:
    source = value or ""
    browser = next((name for marker, name in (("Edg/", "Edge"), ("Chrome/", "Chrome"), ("Firefox/", "Firefox"), ("Safari/", "Safari")) if marker in source), "Браузер")
    os_name = next((name for marker, name in (("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Mac OS", "macOS"), ("Linux", "Linux")) if marker in source), "Неизвестная ОС")
    device = "Телефон" if any(marker in source for marker in ("Mobile", "Android", "iPhone")) else "Компьютер"
    return browser, os_name, f"{device} · {browser}"


def create_auth_session(db: Session, account: Account, request: Request) -> tuple[AuthSession, str]:
    raw_token = new_device_token()
    csrf = new_device_token()
    user_agent = request.headers.get("user-agent", "")[:500]
    browser, os_name, device_name = parse_user_agent(user_agent)
    current = utcnow()
    row = AuthSession(
        account_id=account.id,
        token_hash=token_hash(raw_token),
        csrf_token=csrf,
        device_name=device_name,
        browser=browser,
        os=os_name,
        user_agent=user_agent,
        ip_address=request_ip(request),
        created_at=current,
        last_seen_at=current,
        expires_at=current + timedelta(days=settings.auth_session_idle_days),
    )
    db.add(row)
    account.last_login_at = current
    db.commit()
    db.refresh(row)
    return row, raw_token


def set_auth_cookies(response, session: AuthSession, raw_token: str) -> None:
    secure = settings.deployment_mode == "cloud" or settings.public_base_url.startswith("https://")
    max_age = settings.auth_session_idle_days * 86400
    response.set_cookie(settings.auth_cookie_name, raw_token, max_age=max_age, httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie("quiz_csrf", session.csrf_token, max_age=max_age, httponly=False, secure=secure, samesite="lax", path="/")


def clear_auth_cookies(response) -> None:
    response.delete_cookie(settings.auth_cookie_name, path="/")
    response.delete_cookie("quiz_csrf", path="/")


def current_session(request: Request, db: Session, validate_csrf: bool = True, response: Response | None = None) -> AuthSession | None:
    raw = request.cookies.get(settings.auth_cookie_name)
    if not raw:
        return None
    row = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(raw)))
    if not row or row.revoked_at is not None:
        return None
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=utcnow().tzinfo)
    if expires <= utcnow():
        return None
    account = db.get(Account, row.account_id)
    if not account or account.status != "active":
        return None
    if validate_csrf and request.method not in SAFE_METHODS:
        csrf_cookie = request.cookies.get("quiz_csrf")
        csrf_header = request.headers.get("x-csrf-token")
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, row.csrf_token) or not secrets.compare_digest(csrf_header, row.csrf_token):
            raise HTTPException(403, "Недействительный CSRF-токен")
    current = utcnow()
    if (current - (row.last_seen_at if row.last_seen_at.tzinfo else row.last_seen_at.replace(tzinfo=current.tzinfo))).total_seconds() > 60:
        row.last_seen_at = current
        row.expires_at = current + timedelta(days=settings.auth_session_idle_days)
        row.ip_address = request_ip(request)
        db.commit()
    if response is not None:
        # The database and browser cookie both slide with activity, so the
        # lifetime is truly based on inactivity rather than the login date.
        set_auth_cookies(response, row, raw)
    return row


def require_account(request: Request, response: Response, db: Session = Depends(get_db)) -> Account:
    row = current_session(request, db, response=response)
    if not row:
        raise HTTPException(401, "Требуется вход в аккаунт")
    return db.get(Account, row.account_id)


def optional_account(request: Request, response: Response, db: Session = Depends(get_db)) -> Account | None:
    row = current_session(request, db, validate_csrf=False, response=response)
    return db.get(Account, row.account_id) if row else None


def require_superadmin(account: Account = Depends(require_account)) -> Account:
    if account.role != "superadmin":
        raise HTTPException(403, "Требуются права суперадминистратора")
    return account


# Compatibility name used by existing organizer routes. It now means any active account.
require_admin = require_account


def active_superadmin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Account).where(Account.role == "superadmin", Account.status == "active")) or 0


def create_speech_upload_ticket(
    *, question_id: str, source_hash: str, voice_id: str, voice_presentation: str,
    settings_payload: dict, settings_context_hash: str, prompt_version: int, ttl_seconds: int = 600,
) -> tuple[str, str]:
    nonce = secrets.token_urlsafe(24)
    token = _encode_signed_payload({
        "kind": "speech-upload",
        "question_id": question_id,
        "source_hash": source_hash,
        "voice_id": voice_id,
        "voice_presentation": voice_presentation,
        "settings": settings_payload,
        "settings_context_hash": settings_context_hash,
        "prompt_version": prompt_version,
        "nonce": nonce,
        "exp": int(time.time()) + ttl_seconds,
    })
    return token, nonce


def verify_speech_upload_ticket(token: str) -> dict | None:
    if not token or len(token) > 8192:
        return None
    data = _decode_signed_payload(token)
    if not data or data.get("kind") != "speech-upload" or data.get("exp", 0) <= time.time():
        return None
    required = {"question_id", "source_hash", "voice_id", "voice_presentation", "settings", "settings_context_hash", "prompt_version", "nonce"}
    return data if required.issubset(data) else None
