"""Repair the legacy speech settings column name.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "question_speech_versions" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("question_speech_versions")}
    if "settings" in columns and "settings_json" not in columns:
        op.alter_column(
            "question_speech_versions",
            "settings",
            new_column_name="settings_json",
            existing_type=sa.JSON(),
            existing_nullable=bool(columns["settings"]["nullable"]),
        )


def downgrade() -> None:
    # This is a compatibility repair. Revision 0009 already defines the
    # canonical settings_json name, so downgrading must keep that schema.
    pass
