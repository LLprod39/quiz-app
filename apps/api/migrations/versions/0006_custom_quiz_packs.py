"""Add persistent custom quiz pack templates.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "quiz_pack_templates" not in inspector.get_table_names():
        op.create_table(
            "quiz_pack_templates",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("definition", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("slug"),
        )
        op.create_index("ix_quiz_pack_templates_slug", "quiz_pack_templates", ["slug"], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "quiz_pack_templates" in inspector.get_table_names():
        op.drop_index("ix_quiz_pack_templates_slug", table_name="quiz_pack_templates")
        op.drop_table("quiz_pack_templates")
