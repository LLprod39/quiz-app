"""Add reusable quiz library selection.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "is_selected" not in columns:
        op.add_column("events", sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.false()))

    connection = op.get_bind()
    events = sa.table(
        "events",
        sa.column("id", sa.String()),
        sa.column("status", sa.String()),
        sa.column("is_selected", sa.Boolean()),
        sa.column("updated_at", sa.DateTime()),
    )
    connection.execute(sa.update(events).where(events.c.status == "finished").values(status="ready"))
    connection.execute(sa.update(events).values(is_selected=False))
    selected_id = connection.execute(
        sa.select(events.c.id).where(events.c.status != "archived").order_by(events.c.updated_at.desc()).limit(1)
    ).scalar()
    if selected_id:
        connection.execute(sa.update(events).where(events.c.id == selected_id).values(is_selected=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("events")}
    if "is_selected" in columns:
        op.drop_column("events", "is_selected")
