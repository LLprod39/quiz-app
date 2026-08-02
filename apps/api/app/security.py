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


def verify_admin_token(token: str) -> bool:
    try:
        payload, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, _sign(payload)):
            return False
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return data.get("sub") == settings.organizer_email and data.get("exp", 0) > time.time()
    except (ValueError, TypeError, json.JSONDecodeError):
        return False


def require_admin(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer ") or not verify_admin_token(authorization[7:]):
        raise HTTPException(status_code=401, detail="Требуется вход организатора")
    return settings.organizer_email


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
