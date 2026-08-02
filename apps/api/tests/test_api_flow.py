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

        presets = client.post(f"/api/events/{event['id']}/question-presets", headers=headers)
        assert presets.status_code == 200
        preset_event = presets.json()
        assert preset_event["question_count"] == 5
        questions = preset_event["rounds"][0]["questions"]
        assert {question["type"] for question in questions} == {"single", "multiple", "number", "text", "closest"}
        single = next(question for question in questions if question["type"] == "single")
        assert single["correct_answer"] in {option["id"] for option in single["options"]}

    engine.dispose()
    if database.exists():
        database.unlink()


def test_quiz_pack_catalog_and_install():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        packs = client.get("/api/quiz-packs")
        assert packs.status_code == 200
        assert {pack["slug"] for pack in packs.json()} == {"marvel-universe", "space-explorers", "world-cinema"}
        marvel = client.get("/api/quiz-packs/marvel-universe").json()
        assert marvel["question_count"] == 20
        assert marvel["theme"]["brand_name"] == "Marvel Quiz Battle"
        assert len(marvel["sample_questions"]) == 5

        login = client.post("/api/auth/login", json={"email": "organizer@example.local", "password": "celebrate"})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        conflict = client.post("/api/quiz-packs/marvel-universe/install", headers=headers, json={"replace_active": False})
        assert conflict.status_code == 409

        installed = client.post("/api/quiz-packs/marvel-universe/install", headers=headers, json={"replace_active": True})
        assert installed.status_code == 200
        event = installed.json()
        assert event["title"] == "Marvel Quiz Battle"
        assert event["topic"] == "Marvel: герои и мультивселенная"
        assert event["game_mode"] == "team"
        assert event["question_count"] == 20
        assert event["theme"]["logo_mark"] == "MV"
        assert all(question["correct_answer"] in {option["id"] for option in question["options"]} for question in event["rounds"][0]["questions"])

        events = client.get("/api/events", headers=headers).json()
        assert sum(item["status"] == "archived" for item in events) >= 1
        opened = client.post(f"/api/events/{event['id']}/sessions", headers=headers)
        assert opened.status_code == 200
        assert opened.json()["session"]["question_count"] == 20

    engine.dispose()
    if database.exists():
        database.unlink()


def test_public_branding_follows_active_event():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        defaults = client.get("/api/branding")
        assert defaults.status_code == 200
        assert defaults.json()["brand_name"] == "Quiz App"
        assert defaults.json()["landing_title"] == "Создайте квиз,"

        login = client.post("/api/auth/login", json={"email": "organizer@example.local", "password": "celebrate"})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        event = client.get("/api/events", headers=headers).json()[0]
        updated = client.put(
            f"/api/events/{event['id']}",
            headers=headers,
            json={
                "title": event["title"],
                "event_format": event["event_format"],
                "topic": event["topic"],
                "hero_name": event["hero_name"],
                "event_date": event["event_date"],
                "game_mode": event["game_mode"],
                "allow_late_join": event["allow_late_join"],
                "hero_photo_url": event["hero_photo_url"],
                "theme": {**event["theme"], "brand_name": "Свои знают", "logo_mark": "СЗ", "accent": "#34d399"},
            },
        )
        assert updated.status_code == 200

        branding = client.get("/api/branding")
        assert branding.status_code == 200
        assert branding.json()["brand_name"] == "Свои знают"
        assert branding.json()["logo_mark"] == "СЗ"
        assert branding.json()["accent"] == "#34d399"

    engine.dispose()
    if database.exists():
        database.unlink()
