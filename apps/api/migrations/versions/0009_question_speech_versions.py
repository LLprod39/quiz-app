"""Add persistent versioned question speech assets.

Revision ID: 0009
Revises: 0008
"""
import json

import sqlalchemy as sa
from alembic import op


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    event_columns = {column["name"] for column in inspector.get_columns("events")}
    if "speech_settings" not in event_columns:
        op.add_column(
            "events",
            sa.Column("speech_settings", sa.JSON(), nullable=False, server_default=json.dumps({})),
        )

    question_columns = {column["name"] for column in inspector.get_columns("questions")}
    if "speech_settings_override" not in question_columns:
        op.add_column("questions", sa.Column("speech_settings_override", sa.JSON(), nullable=True))

    inspector = sa.inspect(op.get_bind())
    if "question_speech_versions" not in inspector.get_table_names():
        op.create_table(
            "question_speech_versions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("question_id", sa.String(length=36), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("file_url", sa.String(length=500), nullable=False),
            sa.Column("mime_type", sa.String(length=40), nullable=False),
            sa.Column("source_text", sa.Text(), nullable=False),
            sa.Column("source_hash", sa.String(length=64), nullable=False),
            sa.Column("voice_id", sa.String(length=80), nullable=False),
            sa.Column("voice_presentation", sa.String(length=16), nullable=False),
            sa.Column("settings_json", sa.JSON(), nullable=False),
            sa.Column("prompt_version", sa.Integer(), nullable=False),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("automation_nonce_hash", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("automation_nonce_hash", name="uq_question_speech_automation_nonce"),
            sa.UniqueConstraint("question_id", "version_number", name="uq_question_speech_version"),
        )
        op.create_index("ix_question_speech_versions_question_id", "question_speech_versions", ["question_id"])
        op.create_index("ix_question_speech_versions_source_hash", "question_speech_versions", ["source_hash"])
        op.create_index("ix_question_speech_versions_status", "question_speech_versions", ["status"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "question_speech_versions" in inspector.get_table_names():
        op.drop_index("ix_question_speech_versions_status", table_name="question_speech_versions")
        op.drop_index("ix_question_speech_versions_source_hash", table_name="question_speech_versions")
        op.drop_index("ix_question_speech_versions_question_id", table_name="question_speech_versions")
        op.drop_table("question_speech_versions")

    inspector = sa.inspect(op.get_bind())
    event_columns = {column["name"] for column in inspector.get_columns("events")}
    if "speech_settings" in event_columns:
        op.drop_column("events", "speech_settings")

    inspector = sa.inspect(op.get_bind())
    question_columns = {column["name"] for column in inspector.get_columns("questions")}
    if "speech_settings_override" in question_columns:
        op.drop_column("questions", "speech_settings_override")
