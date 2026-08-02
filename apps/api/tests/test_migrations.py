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
    assert "quiz_pack_templates" in sa.inspect(engine).get_table_names()
    template_columns = {column["name"] for column in sa.inspect(engine).get_columns("quiz_pack_templates")}
    assert template_columns >= {"id", "slug", "definition", "created_at", "updated_at"}
