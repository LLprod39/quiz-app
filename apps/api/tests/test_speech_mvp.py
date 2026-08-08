import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_api_flow.db"

from fastapi.testclient import TestClient

from app.config import settings
from app.db import engine
from app.main import app
from app.routes import local_speech_file
from app.security import create_speech_upload_ticket, verify_speech_upload_ticket


WAV_BYTES = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"\x00" * 32


def admin_headers(client: TestClient) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"email": "organizer@example.local", "password": "celebrate"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_question_speech_version_lifecycle_and_ticket_safety(tmp_path, monkeypatch):
    database = Path("test_api_flow.db")
    engine.dispose()
    database.unlink(missing_ok=True)
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))

    with TestClient(app) as client:
        headers = admin_headers(client)
        event = client.get("/api/events", headers=headers).json()[0]
        question = event["rounds"][0]["questions"][0]
        defaults = {
            "voice_id": "Kore",
            "settings": {
                "preset": "classic-host", "pace": 50, "energy": 70, "pitch": 50,
                "expression": 60, "clarity": 90, "pause_ms": 300, "effects": ["warm-smile"],
            },
        }

        ticket = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json=defaults,
        )
        assert ticket.status_code == 200
        ticket_body = ticket.json()
        assert client.post(f"/api/questions/{question['id']}/speech/automation-ticket", json=defaults).status_code == 401
        other_question = event["rounds"][0]["questions"][1]
        wrong_question = client.post(
            f"/api/questions/{other_question['id']}/speech/upload",
            headers={"X-Speech-Automation-Ticket": ticket_body["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert wrong_question.status_code == 401
        invalid_audio = client.post(
            ticket_body["upload_path"],
            headers={"X-Speech-Automation-Ticket": ticket_body["ticket"]},
            files={"file": ("speech.wav", b"not an audio file", "audio/wav")},
        )
        assert invalid_audio.status_code == 415
        upload = client.post(
            ticket_body["upload_path"],
            headers={"X-Speech-Automation-Ticket": ticket_body["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert upload.status_code == 200
        assert upload.json()["active"]["voice_id"] == "Kore"
        assert upload.json()["candidate"] is None
        stored = settings.media_path / upload.json()["active"]["file_url"].removeprefix("/media/")
        assert stored.read_bytes() == WAV_BYTES

        replay = client.post(
            ticket_body["upload_path"],
            headers={"X-Speech-Automation-Ticket": ticket_body["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert replay.status_code == 409

        duplicate = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json=defaults,
        )
        assert duplicate.json()["status"] == "already_ready"

        forced = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json={**defaults, "force": True},
        ).json()
        candidate_upload = client.post(
            forced["upload_path"],
            headers={"X-Speech-Automation-Ticket": forced["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert candidate_upload.status_code == 200
        candidate = candidate_upload.json()["candidate"]
        old_active = candidate_upload.json()["active"]
        assert candidate and old_active

        activated = client.post(
            f"/api/questions/{question['id']}/speech/versions/{candidate['id']}/activate",
            headers=headers,
        )
        assert activated.status_code == 200
        assert activated.json()["active"]["id"] == candidate["id"]
        assert activated.json()["previous"]["id"] == old_active["id"]

        third_ticket = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json={**defaults, "force": True},
        ).json()
        third_upload = client.post(
            third_ticket["upload_path"],
            headers={"X-Speech-Automation-Ticket": third_ticket["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        ).json()
        discarded_candidate_path = settings.media_path / third_upload["candidate"]["file_url"].removeprefix("/media/")
        assert discarded_candidate_path.exists()

        restored = client.post(
            f"/api/questions/{question['id']}/speech/versions/{old_active['id']}/restore",
            headers=headers,
        )
        assert restored.status_code == 200
        assert restored.json()["active"]["id"] == old_active["id"]
        assert restored.json()["candidate"]["id"] == candidate["id"]
        assert not discarded_candidate_path.exists()

        override = client.put(
            f"/api/questions/{question['id']}/speech-settings",
            headers=headers,
            json={**defaults, "voice_id": "Puck", "use_event_defaults": False},
        )
        assert override.status_code == 200
        assert override.json()["uses_event_defaults"] is False
        assert override.json()["effective_settings"]["voice_id"] == "Puck"
        assert override.json()["stale"] is True
        reset_defaults = client.put(
            f"/api/questions/{question['id']}/speech-settings",
            headers=headers,
            json={**defaults, "use_event_defaults": True},
        )
        assert reset_defaults.json()["uses_event_defaults"] is True
        assert reset_defaults.json()["stale"] is False

        settings_stale_ticket = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json={**defaults, "force": True},
        ).json()
        client.put(
            f"/api/questions/{question['id']}/speech-settings",
            headers=headers,
            json={**defaults, "voice_id": "Puck", "use_event_defaults": False},
        )
        settings_rejected = client.post(
            settings_stale_ticket["upload_path"],
            headers={"X-Speech-Automation-Ticket": settings_stale_ticket["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert settings_rejected.status_code == 409
        client.put(
            f"/api/questions/{question['id']}/speech-settings",
            headers=headers,
            json={**defaults, "use_event_defaults": True},
        )

        stale_ticket = client.post(
            f"/api/questions/{question['id']}/speech/automation-ticket",
            headers=headers,
            json={**defaults, "force": True},
        ).json()
        question_payload = {**question, "text": question["text"] + " Изменение."}
        updated = client.put(f"/api/questions/{question['id']}", headers=headers, json=question_payload)
        assert updated.status_code == 200
        rejected = client.post(
            stale_ticket["upload_path"],
            headers={"X-Speech-Automation-Ticket": stale_ticket["ticket"]},
            files={"file": ("speech.wav", WAV_BYTES, "audio/wav")},
        )
        assert rejected.status_code == 409

        public_event = client.get(f"/api/events/{event['id']}", headers=headers).json()
        public_question = public_event["rounds"][0]["questions"][0]
        assert public_question["speech_audio_url"] == restored.json()["active"]["file_url"]
        assert public_question["media_url"] == question["media_url"]

        candidate_file = settings.media_path / restored.json()["candidate"]["file_url"].removeprefix("/media/")
        assert candidate_file.exists()
        deleted_candidate = client.delete(
            f"/api/questions/{question['id']}/speech/versions/{restored.json()['candidate']['id']}",
            headers=headers,
        )
        assert deleted_candidate.status_code == 200
        assert deleted_candidate.json()["candidate"] is None
        assert not candidate_file.exists()

        active_file = settings.media_path / restored.json()["active"]["file_url"].removeprefix("/media/")
        refused_active = client.delete(
            f"/api/questions/{question['id']}/speech/versions/{restored.json()['active']['id']}",
            headers=headers,
        )
        assert refused_active.status_code == 409
        assert active_file.exists()
        deleted_active = client.delete(
            f"/api/questions/{question['id']}/speech/versions/{restored.json()['active']['id']}?confirm_active=true",
            headers=headers,
        )
        assert deleted_active.status_code == 200
        assert deleted_active.json()["active"] is None
        assert not active_file.exists()

    engine.dispose()
    database.unlink(missing_ok=True)


def test_expired_ticket_and_speech_path_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))
    ticket, _ = create_speech_upload_ticket(
        question_id="00000000-0000-0000-0000-000000000001",
        source_hash="a" * 64,
        voice_id="Kore",
        voice_presentation="female",
        settings_payload={"preset": "classic-host"},
        settings_context_hash="b" * 64,
        prompt_version=1,
        ttl_seconds=-1,
    )
    assert verify_speech_upload_ticket(ticket) is None
    assert local_speech_file("/media/../secret.wav") is None
    assert local_speech_file("/media/speech/../../secret.wav") is None
