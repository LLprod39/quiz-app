import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Depends, Header, HTTPException

from .config import settings


def _sign(payload: str) -> str:
    return hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_admin_token(email: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"sub": email, "exp": int(time.time()) + 86400}).encode()).decode().rstrip("=")
    return f"{payload}.{_sign(payload)}"


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


def verify_admin_token(token: str) -> bool:
    data = _decode_signed_payload(token)
    return bool(data and data.get("sub") == settings.organizer_email and data.get("exp", 0) > time.time())


def require_admin(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer ") or not verify_admin_token(authorization[7:]):
        raise HTTPException(status_code=401, detail="Требуется вход организатора")
    return settings.organizer_email


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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
