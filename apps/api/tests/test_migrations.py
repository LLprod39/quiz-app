from alembic import command
from alembic.config import Config
import sqlalchemy as sa
from app.config import settings


def test_event_control_migrations_round_trip(tmp_path, monkeypatch):
    database = tmp_path / "host-control.sqlite"
    database_url = f"sqlite:///{database.as_posix()}"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "migrations")
    monkeypatch.setattr(settings, "database_url", database_url)

    command.upgrade(config, "head")
    command.downgrade(config, "0003")
    command.upgrade(config, "head")

    engine = sa.create_engine(database_url)
    columns = {column["name"]: column for column in sa.inspect(engine).get_columns("events")}
    assert columns["host_mode"]["nullable"] is False
    assert columns["auto_advance_seconds"]["nullable"] is False
    assert columns["tv_display_mode"]["nullable"] is False
    assert columns["tv_chart_style"]["nullable"] is False
    assert columns["speech_settings"]["nullable"] is False
    assert "quiz_pack_templates" in sa.inspect(engine).get_table_names()
    template_columns = {column["name"] for column in sa.inspect(engine).get_columns("quiz_pack_templates")}
    assert template_columns >= {"id", "slug", "definition", "created_at", "updated_at"}
    speech_columns = {column["name"] for column in sa.inspect(engine).get_columns("question_speech_versions")}
    assert speech_columns >= {
        "id", "question_id", "version_number", "status", "file_url", "mime_type",
        "source_hash", "voice_id", "settings_json", "automation_nonce_hash",
    }
    question_columns = {column["name"] for column in sa.inspect(engine).get_columns("questions")}
    assert "speech_settings_override" in question_columns


def test_legacy_speech_settings_column_is_repaired(tmp_path, monkeypatch):
    database = tmp_path / "legacy-speech.sqlite"
    database_url = f"sqlite:///{database.as_posix()}"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "migrations")
    monkeypatch.setattr(settings, "database_url", database_url)

    command.upgrade(config, "0007")
    engine = sa.create_engine(database_url)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "ALTER TABLE question_speech_versions RENAME COLUMN settings_json TO settings"
        )

    command.upgrade(config, "head")
    speech_columns = {column["name"] for column in sa.inspect(engine).get_columns("question_speech_versions")}
    assert "settings_json" in speech_columns
    assert "settings" not in speech_columns
