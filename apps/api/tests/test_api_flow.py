import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_api_flow.db"

from fastapi.testclient import TestClient
from datetime import timedelta

from app.main import app
from app.db import SessionLocal, engine
from app.game import advance_expired_session, utcnow
from app.models import GameSession
from app.routes import session_query


def test_vertical_game_flow():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        assert login.status_code == 200
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}

        events = client.get("/api/events", headers=headers).json()
        assert events[0]["question_count"] == 3
        tv_mode = client.put(
            f"/api/events/{events[0]['id']}/tv-display",
            headers=headers,
            json={"tv_display_mode": "insights", "tv_chart_style": "both"},
        )
        assert tv_mode.status_code == 200
        assert tv_mode.json()["tv_display_mode"] == "insights"
        assert tv_mode.json()["tv_chart_style"] == "both"

        opened = client.post(f"/api/events/{events[0]['id']}/sessions", headers=headers)
        assert opened.status_code == 200
        code = opened.json()["session"]["join_code"]

        joined = client.post(f"/api/sessions/{code}/join", json={"display_name": "Анна", "avatar": "🎈"})
        assert joined.status_code == 200
        token = joined.json()["device_token"]
        second_joined = client.post(f"/api/sessions/{code}/join", json={"display_name": "Иван", "avatar": "🚀"})
        assert second_joined.status_code == 200
        second_token = second_joined.json()["device_token"]

        prepared = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "prepare"})
        assert prepared.json()["session"]["status"] == "countdown"
        assert prepared.json()["session"]["deadline_at"] is not None
        question = prepared.json()["question"]
        started = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "start"})
        assert started.json()["session"]["status"] == "answering"
        assert started.json()["session"]["answer_target_count"] == 2

        answer = client.post(f"/api/sessions/{code}/answer", json={"device_token": token, "request_id": "request-1", "answer": question["options"][1]["id"]})
        assert answer.status_code == 200
        assert answer.json()["question_closed"] is False
        in_progress = client.get(f"/api/sessions/{code}").json()
        assert in_progress["session"]["status"] == "answering"
        assert in_progress["session"]["answered_count"] == 1
        assert in_progress["event"]["tv_display_mode"] == "insights"
        assert in_progress["live_answers"] == [{
            "id": in_progress["live_answers"][0]["id"],
            "name": "Анна",
            "avatar": "🎈",
            "answer": question["options"][1]["text"],
            "submitted_at": in_progress["live_answers"][0]["submitted_at"],
        }]
        selected_breakdown = next(row for row in in_progress["answer_breakdown"] if row["label"] == question["options"][1]["text"])
        assert selected_breakdown["count"] == 1
        assert selected_breakdown["percent"] == 100.0
        second_answer = client.post(f"/api/sessions/{code}/answer", json={"device_token": second_token, "request_id": "request-2", "answer": question["options"][0]["id"]})
        assert second_answer.status_code == 200
        assert second_answer.json()["question_closed"] is True
        closed = client.get(f"/api/sessions/{code}").json()
        assert closed["session"]["status"] == "locked"
        assert closed["session"]["answered_count"] == 2
        assert closed["session"]["deadline_at"] is not None
        duplicate = client.post(f"/api/sessions/{code}/answer", json={"device_token": token, "request_id": "request-1", "answer": "changed"})
        assert duplicate.json()["duplicate"] is True

        reveal = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "reveal"})
        assert reveal.status_code == 200
        private = client.get(f"/api/sessions/{code}?device_token={token}").json()["private_result"]
        assert private["is_correct"] is True
        assert private["rank"] == 1

    engine.dispose()
    if database.exists():
        database.unlink()


def test_auto_host_mode_advances_and_manual_mode_stops_transition_deadlines():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        event = client.get("/api/events", headers=headers).json()[0]
        assert event["host_mode"] == "auto"
        assert event["auto_advance_seconds"] == 5
        opened = client.post(f"/api/events/{event['id']}/sessions", headers=headers).json()
        code = opened["session"]["join_code"]
        prepared = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "prepare"}).json()
        assert prepared["session"]["status"] == "countdown"

        with SessionLocal() as db:
            session = db.scalar(session_query().where(GameSession.join_code == code))
            session.deadline_at = utcnow() - timedelta(seconds=1)
            assert advance_expired_session(db, session)
            assert session.status == "answering"
            assert session.deadline_at is not None
            session.deadline_at = utcnow() - timedelta(seconds=1)
            assert advance_expired_session(db, session)
            assert session.status == "locked"
            assert session.deadline_at is not None
            session.deadline_at = utcnow() - timedelta(seconds=1)
            assert advance_expired_session(db, session)
            assert session.status == "reveal"
            assert session.deadline_at is not None
            db.commit()

        changed = client.put(
            f"/api/events/{event['id']}/host-control",
            headers=headers,
            json={"host_mode": "manual", "auto_advance_seconds": 8},
        )
        assert changed.status_code == 200
        assert changed.json()["host_mode"] == "manual"
        assert changed.json()["auto_advance_seconds"] == 8
        manual_snapshot = client.get(f"/api/sessions/{code}").json()
        assert manual_snapshot["event"]["host_mode"] == "manual"
        assert manual_snapshot["session"]["deadline_at"] is None

    engine.dispose()
    if database.exists():
        database.unlink()


def test_thematic_battle_has_no_hero_features():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        seeded_event = client.get("/api/events", headers=headers).json()[0]

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
        assert event["is_selected"] is True
        saved = client.get("/api/events", headers=headers).json()
        assert {item["id"] for item in saved} >= {seeded_event["id"], event["id"]}
        assert next(item for item in saved if item["id"] == seeded_event["id"])["status"] != "archived"

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

        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        original = client.get("/api/events", headers=headers).json()[0]
        installed = client.post("/api/quiz-packs/marvel-universe/install", headers=headers, json={"replace_active": False})
        assert installed.status_code == 200
        event = installed.json()
        assert event["title"] == "Marvel Quiz Battle"
        assert event["topic"] == "Marvel: герои и мультивселенная"
        assert event["game_mode"] == "team"
        assert event["question_count"] == 20
        assert event["is_selected"] is True
        assert event["theme"]["logo_mark"] == "MV"
        assert all(question["correct_answer"] in {option["id"] for option in question["options"]} for question in event["rounds"][0]["questions"])

        events = client.get("/api/events", headers=headers).json()
        assert sum(item["is_selected"] for item in events) == 1
        assert next(item for item in events if item["id"] == original["id"])["status"] != "archived"
        assert next(item for item in events if item["id"] == original["id"])["is_selected"] is False
        opened = client.post(f"/api/events/{event['id']}/sessions", headers=headers)
        assert opened.status_code == 200
        assert opened.json()["session"]["question_count"] == 20
        first_code = opened.json()["session"]["join_code"]
        finished = client.post(f"/api/sessions/{first_code}/actions", headers=headers, json={"action": "finish"})
        assert finished.status_code == 200
        assert finished.json()["session"]["status"] == "finished"
        assert client.get(f"/api/events/{event['id']}", headers=headers).json()["status"] == "ready"
        replay = client.post(f"/api/events/{event['id']}/sessions", headers=headers)
        assert replay.status_code == 200
        assert replay.json()["session"]["join_code"] != first_code
        replay_event = client.get(f"/api/events/{event['id']}", headers=headers).json()
        assert replay_event["status"] == "ready"
        assert len(replay_event["sessions"]) == 2

        selected = client.post(f"/api/events/{original['id']}/select", headers=headers)
        assert selected.status_code == 200
        assert selected.json()["is_selected"] is True
        assert client.get("/api/branding").json()["brand_name"] == original["theme"]["brand_name"]

        archived = client.post(f"/api/events/{original['id']}/archive", headers=headers)
        assert archived.status_code == 200
        restored = client.post(f"/api/events/{original['id']}/restore", headers=headers)
        assert restored.status_code == 200
        assert restored.json()["status"] != "archived"
        assert restored.json()["is_selected"] is True
        assert restored.json()["question_count"] == original["question_count"]

    engine.dispose()
    if database.exists():
        database.unlink()


def test_custom_quiz_pack_prompt_crud_and_install():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        seeded_event = client.get("/api/events", headers=headers).json()[0]

        prompt = client.post(
            "/api/quiz-packs/gpt-prompt",
            headers=headers,
            json={"topic": "Страны мира", "question_count": 20, "difficulty": "Средняя"},
        )
        assert prompt.status_code == 200
        assert "ровно 20" in prompt.json()["prompt"]
        assert "только один валидный JSON" in prompt.json()["prompt"]
        assert "Страны мира" in prompt.json()["prompt"]
        assert "Никогда не оформляй ссылку как Markdown" in prompt.json()["prompt"]
        assert '"confetti", "glow", "minimal" или "neon"' in prompt.json()["prompt"]
        assert "нельзя писать \\) или \\(" in prompt.json()["prompt"]

        source_url = "https://www.un.org/en/about-us/member-states"
        pack = {
            "schema_version": 1,
            "slug": "countries-world",
            "title": "Страны мира",
            "topic": "Страны и география",
            "icon": "🌍",
            "short_description": "Три проверочных вопроса о странах мира.",
            "description": "Готовый географический квиз о государствах, столицах и международных организациях.",
            "estimated_minutes": 10,
            "difficulty": "Средняя",
            "game_mode": "team",
            "round_title": "Вокруг света",
            "disclaimer": "Факты проверены по официальным открытым источникам.",
            "sources": [{
                "name": "United Nations",
                "url": "[[https://www.un.org/](https://www.un.org/)](https://www.un.org/)",
                "license": "UN Terms of Use. " + "Long but legitimate license description. " * 5,
                "license_url": "[UN Terms](https://www.un.org/en/about-us/terms-of-use)",
            }],
            "theme": {**seeded_event["theme"], "decor": "sigil-glow", "brand_name": "Страны мира", "logo_mark": "🌍", "theme_preset": "countries-world"},
            "questions": [
                {"text": "Какая страна входит в ООН?", "correct_answer": "Канада", "wrong_answers": ["Атлантида", "Нарния", "Ваканда"], "explanation": "Канада является государством — членом ООН.", "source_urls": [f"[[{source_url}]({source_url})]({source_url})"], "time_limit_seconds": 25},
                {"text": "Какая страна расположена в Южной Америке?", "correct_answer": "Бразилия", "wrong_answers": ["Норвегия", "Япония", "Египет"], "explanation": "Бразилия находится в Южной Америке.", "source_urls": [source_url], "time_limit_seconds": 30},
                {"text": "Столицей какой страны является Оттава?", "correct_answer": "Канада", "wrong_answers": ["Австралия", "Ирландия", "Австрия"], "explanation": "Оттава является столицей Канады.", "source_urls": [source_url], "time_limit_seconds": 35},
            ],
        }
        imported = client.post("/api/quiz-packs/import", headers=headers, json=pack)
        assert imported.status_code == 200
        assert imported.json()["is_custom"] is True
        assert imported.json()["question_count"] == 3
        assert any(item["slug"] == "countries-world" and item["is_custom"] for item in client.get("/api/quiz-packs").json())

        definition = client.get("/api/quiz-packs/countries-world/definition", headers=headers)
        assert definition.status_code == 200
        assert definition.json()["questions"][0]["correct_answer"] == "Канада"
        assert definition.json()["sources"][0]["url"] == "https://www.un.org/"
        assert definition.json()["sources"][0]["license_url"] == "https://www.un.org/en/about-us/terms-of-use"
        assert definition.json()["questions"][0]["source_urls"] == [source_url]
        assert definition.json()["theme"]["decor"] == "glow"

        pack["title"] = "Страны мира — обновлено"
        updated = client.put("/api/quiz-packs/countries-world/definition", headers=headers, json=pack)
        assert updated.status_code == 200
        assert updated.json()["title"] == "Страны мира — обновлено"

        installed = client.post("/api/quiz-packs/countries-world/install", headers=headers, json={"replace_active": False})
        assert installed.status_code == 200
        installed_event = installed.json()
        assert installed_event["title"] == "Страны мира — обновлено"
        assert installed_event["content_mode"] == "quiz"
        assert installed_event["question_count"] == 3
        assert installed_event["rounds"][0]["questions"][0]["time_limit_seconds"] == 25

        deleted = client.delete("/api/quiz-packs/countries-world", headers=headers)
        assert deleted.status_code == 200
        assert all(item["slug"] != "countries-world" for item in client.get("/api/quiz-packs").json())
        assert client.get(f"/api/events/{installed_event['id']}", headers=headers).status_code == 200
        assert client.delete("/api/quiz-packs/marvel-universe", headers=headers).status_code == 400

        pack["slug"] = "countries-invalid"
        pack["questions"][0]["wrong_answers"][0] = pack["questions"][0]["correct_answer"]
        invalid = client.post("/api/quiz-packs/import", headers=headers, json=pack)
        assert invalid.status_code == 422

    engine.dispose()
    if database.exists():
        database.unlink()


def test_content_modes_and_gpt_generated_survey_flow():
    database = Path("test_api_flow.db")
    engine.dispose()
    if database.exists():
        database.unlink()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
        seeded_event = client.get("/api/events", headers=headers).json()[0]

        legacy_quiz = client.post(
            "/api/events",
            headers=headers,
            json={"title": "Обычный квиз", "event_format": "battle", "topic": "Общие знания", "game_mode": "individual"},
        )
        assert legacy_quiz.status_code == 200
        assert legacy_quiz.json()["content_mode"] == "quiz"

        test_event = client.post(
            "/api/events",
            headers=headers,
            json={"title": "Личный тест", "event_format": "battle", "content_mode": "test", "topic": "Навыки", "game_mode": "individual"},
        )
        assert test_event.status_code == 200
        assert test_event.json()["content_mode"] == "test"
        invalid_team_test = client.post(
            "/api/events",
            headers=headers,
            json={"title": "Командный тест", "event_format": "battle", "content_mode": "test", "topic": "Навыки", "game_mode": "team"},
        )
        assert invalid_team_test.status_code == 422

        prompt = client.post(
            "/api/quiz-packs/gpt-prompt",
            headers=headers,
            json={"topic": "Обратная связь", "question_count": 3, "difficulty": "Средняя", "content_mode": "survey"},
        )
        assert prompt.status_code == 200
        assert prompt.json()["content_mode"] == "survey"
        assert '"content_mode": "survey"' in prompt.json()["prompt"]
        assert "нет правильных ответов" in prompt.json()["prompt"]

        survey_pack = {
            "schema_version": 1,
            "content_mode": "survey",
            "slug": "event-feedback-survey",
            "title": "Опрос после события",
            "topic": "Обратная связь",
            "icon": "💬",
            "short_description": "Короткий опрос участников после мероприятия.",
            "description": "Опрос помогает собрать впечатления участников и предложения для следующего события.",
            "estimated_minutes": 8,
            "difficulty": "Средняя",
            "game_mode": "individual",
            "round_title": "Ваше мнение",
            "disclaimer": "В опросе нет правильных ответов.",
            "sources": [],
            "theme": {**seeded_event["theme"], "brand_name": "Ваше мнение", "logo_mark": "💬", "theme_preset": "feedback"},
            "questions": [
                {"type": "single", "text": "Как вам общая атмосфера события?", "options": ["Отлично", "Хорошо", "Можно лучше"], "time_limit_seconds": 30},
                {"type": "text", "text": "Что вам понравилось больше всего?", "time_limit_seconds": 45},
                {"type": "number", "text": "Какую оценку от 1 до 10 вы поставите?", "time_limit_seconds": 30},
            ],
        }
        imported = client.post("/api/quiz-packs/import", headers=headers, json=survey_pack)
        assert imported.status_code == 200
        assert imported.json()["content_mode"] == "survey"

        installed = client.post("/api/quiz-packs/event-feedback-survey/install", headers=headers, json={"replace_active": False})
        assert installed.status_code == 200
        survey_event = installed.json()
        assert survey_event["content_mode"] == "survey"
        assert survey_event["game_mode"] == "individual"
        assert survey_event["rounds"][0]["questions"][0]["correct_answer"] is None
        assert not any(option["is_correct"] for option in survey_event["rounds"][0]["questions"][0]["options"])

        invalid_scored_question = client.post(
            f"/api/events/{survey_event['id']}/questions",
            headers=headers,
            json={"round_id": survey_event["rounds"][0]["id"], "type": "single", "text": "Какой ответ правильный?", "correct_answer": "a", "options": [{"id": "a", "text": "Первый", "is_correct": True}, {"id": "b", "text": "Второй"}]},
        )
        assert invalid_scored_question.status_code == 400

        opened = client.post(f"/api/events/{survey_event['id']}/sessions", headers=headers).json()
        code = opened["session"]["join_code"]
        joined = client.post(f"/api/sessions/{code}/join", json={"display_name": "Анна", "avatar": "🌻"}).json()
        client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "prepare"})
        started = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "start"}).json()
        answer_id = started["question"]["options"][0]["id"]
        submitted = client.post(f"/api/sessions/{code}/answer", json={"device_token": joined["device_token"], "request_id": "survey-answer-1", "answer": answer_id})
        assert submitted.status_code == 200
        revealed = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "reveal"})
        assert revealed.status_code == 200
        private = client.get(f"/api/sessions/{code}?device_token={joined['device_token']}").json()
        assert "correct_answer" not in private["question"]
        assert private["private_result"]["is_correct"] is None
        finished = client.post(f"/api/sessions/{code}/actions", headers=headers, json={"action": "finish"}).json()
        assert finished["leaderboard"] == []

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

        login = client.post("/api/auth/login", json={"phone": "+77000000000", "password": "celebrate"})
        headers = {"X-CSRF-Token": login.json()["csrf_token"]}
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
