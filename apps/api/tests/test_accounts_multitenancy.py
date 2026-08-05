import io
import os
from datetime import timedelta
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_api_flow.db"

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, engine
from app.game import utcnow
from app.main import app
from app.models import Account, Event, GameSession, Participant, Plan, QuizPackTemplate
from app.security import verify_password


def reset_database():
    engine.dispose()
    database = Path("test_api_flow.db")
    if database.exists():
        database.unlink()
    return database


def register(client: TestClient, phone: str, name: str = "Пользователь") -> dict:
    response = client.post("/api/auth/register", json={"phone": phone, "password": "password1", "display_name": name, "avatar": "🚀"})
    assert response.status_code == 201, response.text
    return response.json()


def event_payload(title: str) -> dict:
    return {"title": title, "event_format": "battle", "topic": "Тест", "hero_name": ""}


def test_registration_normalizes_phone_rejects_duplicates_and_hashes_password():
    database = reset_database()
    with TestClient(app) as client:
        response = client.post("/api/auth/register", json={"phone": "+7 700 000-00-08", "password": "password1", "display_name": "Телефон", "avatar": "🚀"})
        assert response.status_code == 201
        assert response.json()["account"]["phone"] == "+77000000008"
        duplicate = client.post("/api/auth/register", json={"phone": "+77000000008", "password": "password1", "display_name": "Дубль", "avatar": "🎈"})
        assert duplicate.status_code == 409
        with SessionLocal() as db:
            account = db.scalar(select(Account).where(Account.phone_e164 == "+77000000008"))
            assert account.password_hash.startswith("$argon2id$")
            assert verify_password(account.password_hash, "password1")
            assert "password1" not in account.password_hash
    engine.dispose()
    database.unlink(missing_ok=True)


def test_accounts_are_isolated_and_free_quiz_limit_is_enforced():
    database = reset_database()
    with TestClient(app) as client:
        first = register(client, "+77000000001", "Первый")
        headers = {"X-CSRF-Token": first["csrf_token"]}
        event = client.post("/api/events", headers=headers, json=event_payload("Первый квиз"))
        assert event.status_code == 200
        event_id = event.json()["id"]
        assert client.post("/api/events", headers=headers, json=event_payload("Второй квиз")).status_code == 200
        limited = client.post("/api/events", headers=headers, json=event_payload("Третий квиз"))
        assert limited.status_code == 403
        assert limited.json()["detail"]["code"] == "quota_exceeded"

        second = register(client, "+77000000002", "Второй")
        second_headers = {"X-CSRF-Token": second["csrf_token"]}
        assert client.get(f"/api/events/{event_id}").status_code == 404
        assert client.get("/api/events").json() == []
        assert client.post("/api/events", headers=second_headers, json=event_payload("Чужой отдельный квиз")).status_code == 200
    engine.dispose()
    database.unlink(missing_ok=True)


def test_guest_results_can_be_claimed_and_tv_link_can_be_rotated():
    database = reset_database()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"}).json()
        admin_headers = {"X-CSRF-Token": login["csrf_token"]}
        event = client.get("/api/events").json()[0]
        opened = client.post(f"/api/events/{event['id']}/sessions", headers=admin_headers).json()
        code = opened["session"]["join_code"]
        screen_token = opened["screen_url"].rsplit("/", 1)[-1]
        assert client.get(f"/api/screens/{screen_token}", headers={"X-Screen-Installation": "screen-device-a"}).status_code == 200

        rotated = client.post(f"/api/sessions/{code}/screen-access", headers=admin_headers).json()
        next_token = rotated["screen_url"].rsplit("/", 1)[-1]
        assert client.get(f"/api/screens/{screen_token}").status_code == 404
        assert client.get(f"/api/screens/{next_token}").status_code == 200

        guest_token = "guest-installation-secret"
        client.cookies.clear()
        joined = client.post(
            f"/api/sessions/{code}/join",
            headers={"X-Guest-Device-Token": guest_token},
            json={"display_name": "Гость", "avatar": "🎈"},
        )
        assert joined.status_code == 200

        account = register(client, "+77000000003", "Гость")
        claim_headers = {"X-CSRF-Token": account["csrf_token"], "X-Guest-Device-Token": guest_token}
        assert len(client.get("/api/account/unclaimed-results", headers={"X-Guest-Device-Token": guest_token}).json()) == 1
        claimed = client.post("/api/account/claim-results", headers=claim_headers)
        assert claimed.json()["count"] == 1
        assert len(client.get("/api/account/history").json()) == 1
    engine.dispose()
    database.unlink(missing_ok=True)


def test_session_security_reset_link_and_last_superadmin_are_enforced():
    database = reset_database()
    with TestClient(app) as client:
        registered = register(client, "+77000000004", "Безопасность")
        account_id = registered["account"]["id"]
        second = client.post("/api/auth/login", json={"phone": "+77000000004", "password": "password1"}).json()
        second_headers = {"X-CSRF-Token": second["csrf_token"]}

        assert client.put("/api/auth/password", json={"current_password": "password1", "new_password": "password2"}).status_code == 403
        sessions = client.get("/api/account/sessions").json()
        assert len(sessions) == 2
        other = next(row for row in sessions if not row["is_current"])
        renamed = client.put(f"/api/account/sessions/{other['id']}", headers=second_headers, json={"device_name": "Домашний ноутбук"})
        assert renamed.json()["device_name"] == "Домашний ноутбук"
        assert client.put("/api/auth/password", headers=second_headers, json={"current_password": "password1", "new_password": "password2"}).status_code == 200
        assert sum(row["revoked_at"] is None for row in client.get("/api/account/sessions").json()) == 1

        client.cookies.clear()
        assert client.post("/api/auth/login", json={"phone": "+77000000004", "password": "password1"}).status_code == 401
        assert client.post("/api/auth/login", json={"phone": "+77000000004", "password": "password2"}).status_code == 200

        client.cookies.clear()
        admin = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"}).json()
        admin_headers = {"X-CSRF-Token": admin["csrf_token"]}
        admin_id = admin["account"]["id"]
        assert client.patch(f"/api/system/accounts/{admin_id}", headers=admin_headers, json={"role": "user"}).status_code == 409
        reset = client.post(f"/api/system/accounts/{account_id}/reset-link", headers=admin_headers).json()
        raw_reset = reset["reset_url"].rsplit("/", 1)[-1]

        client.cookies.clear()
        assert client.post("/api/auth/reset-password", json={"token": raw_reset, "new_password": "password3"}).status_code == 200
        assert client.post("/api/auth/reset-password", json={"token": raw_reset, "new_password": "password4"}).status_code == 404
        assert client.post("/api/auth/login", json={"phone": "+77000000004", "password": "password3"}).status_code == 200
    engine.dispose()
    database.unlink(missing_ok=True)


def test_avatar_is_normalized_and_old_history_reappears_on_pro():
    database = reset_database()
    avatar_path = None
    with TestClient(app) as client:
        registered = register(client, "+77000000005", "История")
        account_id = registered["account"]["id"]
        headers = {"X-CSRF-Token": registered["csrf_token"]}

        source = io.BytesIO()
        Image.new("RGB", (900, 300), "#ff6699").save(source, "PNG")
        uploaded = client.post("/api/account/avatar", headers=headers, files={"file": ("avatar.png", source.getvalue(), "image/png")})
        assert uploaded.status_code == 200
        avatar_path = settings.media_path / "avatars" / f"{account_id}.webp"
        with Image.open(avatar_path) as normalized:
            assert normalized.format == "WEBP"
            assert normalized.size == (512, 512)
        animated = io.BytesIO()
        Image.new("RGB", (30, 30), "red").save(animated, "GIF")
        assert client.post("/api/account/avatar", headers=headers, files={"file": ("avatar.gif", animated.getvalue(), "image/gif")}).status_code == 400

        with SessionLocal() as db:
            event = Event(owner_id=account_id, title="Старая игра", event_format="battle", topic="История", hero_name="", event_date="", status="ready")
            db.add(event); db.flush()
            session = GameSession(event_id=event.id, join_code="OLD123", status="finished", finished_at=utcnow() - timedelta(days=45))
            db.add(session); db.flush()
            db.add(Participant(session_id=session.id, account_id=account_id, display_name="История", avatar="🚀", device_token_hash="old-history-device"))
            db.commit()
        assert client.get("/api/account/history").json() == []

        client.cookies.clear()
        admin = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"}).json()
        admin_headers = {"X-CSRF-Token": admin["csrf_token"]}
        with SessionLocal() as db:
            pro_id = db.scalar(select(Plan.id).where(Plan.code == "pro"))
        assert client.post(f"/api/system/accounts/{account_id}/subscription", headers=admin_headers, json={"plan_id": pro_id, "source": "manual"}).status_code == 200

        client.cookies.clear()
        assert client.post("/api/auth/login", json={"phone": "+77000000005", "password": "password1"}).status_code == 200
        history = client.get("/api/account/history").json()
        assert len(history) == 1 and history[0]["join_code"] == "OLD123"
    if avatar_path:
        avatar_path.unlink(missing_ok=True)
    engine.dispose()
    database.unlink(missing_ok=True)


def test_private_template_slug_namespace_is_isolated_per_owner():
    database = reset_database()
    with TestClient(app) as client:
        first = register(client, "+77000000006", "Первый шаблон")["account"]["id"]
        second = register(client, "+77000000007", "Второй шаблон")["account"]["id"]
        with SessionLocal() as db:
            db.add_all([
                QuizPackTemplate(owner_id=first, slug="my-private-pack", definition={"title": "Первый"}, visibility="private"),
                QuizPackTemplate(owner_id=second, slug="my-private-pack", definition={"title": "Второй"}, visibility="private"),
            ])
            db.commit()
            rows = db.scalars(select(QuizPackTemplate).where(QuizPackTemplate.slug == "my-private-pack")).all()
            assert {row.owner_id for row in rows} == {first, second}
    engine.dispose()
    database.unlink(missing_ok=True)
