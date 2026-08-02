import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_api_flow.db"

from fastapi.testclient import TestClient

from app.main import app
from app.db import engine


def test_vertical_game_flow():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": "organizer@example.local", "password": "celebrate"})
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        events = client.get("/api/events", headers=headers).json()
        assert events[0]["question_count"] == 3

        opened = client.post(f"/api/events/{events[0]['id']}/sessions", headers=headers)
        assert opened.status_code == 200
        code = opened.json()["session"]["join_code"]

        joined = client.post(f"/api/sessions/{code}/join", json={"display_name": "Анна", "avatar": "🎈"})
        assert joined.status_code == 200
        token = joined.json()["device_token"]

        prepared = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "prepare"})
        assert prepared.json()["session"]["status"] == "countdown"
        question = prepared.json()["question"]
        started = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "start"})
        assert started.json()["session"]["status"] == "answering"

        answer = client.post(f"/api/sessions/{code}/answer", json={"device_token": token, "request_id": "request-1", "answer": question["options"][1]["id"]})
        assert answer.status_code == 200
        duplicate = client.post(f"/api/sessions/{code}/answer", json={"device_token": token, "request_id": "request-1", "answer": "changed"})
        assert duplicate.json()["duplicate"] is True

        client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "lock"})
        reveal = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "reveal"})
        assert reveal.status_code == 200
        private = client.get(f"/api/sessions/{code}?device_token={token}").json()["private_result"]
        assert private["is_correct"] is True
        assert private["rank"] == 1

    engine.dispose()
    if database.exists():
        database.unlink()


def test_thematic_battle_has_no_hero_features():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": "organizer@example.local", "password": "celebrate"})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        seeded_event = client.get("/api/events", headers=headers).json()[0]
        assert client.post(f"/api/events/{seeded_event['id']}/archive", headers=headers).status_code == 200

        created = client.post(
            "/api/events",
            headers=headers,
            json={"title": "Битва киноманов", "event_format": "battle", "topic": "Кино 1990-х", "game_mode": "team"},
        )
        assert created.status_code == 200
        event = created.json()
        assert event["event_format"] == "battle"
        assert event["topic"] == "Кино 1990-х"
        assert event["hero_name"] == ""
        assert event["questionnaire"] is None

        hero_question = client.post(
            f"/api/events/{event['id']}/questions",
            headers=headers,
            json={
                "round_id": event["rounds"][0]["id"],
                "type": "hero_choice",
                "text": "Какой фильм выбирает герой?",
                "options": [{"id": "a", "text": "Один дома"}, {"id": "b", "text": "Матрица"}],
            },
        )
        assert hero_question.status_code == 400
        questionnaire_item = client.post(
            f"/api/events/{event['id']}/questionnaire/items",
            headers=headers,
            json={"text": "Личный вопрос"},
        )
        assert questionnaire_item.status_code == 400

    engine.dispose()
    if database.exists():
        database.unlink()
