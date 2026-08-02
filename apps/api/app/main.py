import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import settings
from .db import Base, SessionLocal, engine
from .game import advance_expired_session, session_snapshot, utcnow
from .models import Event, GameSession, Participant, Question, Round
from .rate_limit import RateLimitMiddleware
from .realtime import hub
from .routes import router, session_query
from .security import token_hash
from .seed import seed_demo
from .speech import router as speech_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_demo(db)
    async def watch_deadlines() -> None:
        while True:
            await asyncio.sleep(.5)
            with SessionLocal() as db:
                ids = db.scalars(select(GameSession.id).where(GameSession.deadline_at.is_not(None), GameSession.deadline_at <= utcnow())).all()
                for session_id in ids:
                    session = db.scalar(session_query().where(GameSession.id == session_id).execution_options(populate_existing=True))
                    if not session or not advance_expired_session(db, session):
                        continue
                    db.commit()
                    session = db.scalar(session_query().where(GameSession.id == session_id).execution_options(populate_existing=True))
                    await hub.broadcast(session.join_code, session_snapshot(db, session))
    deadline_task = asyncio.create_task(watch_deadlines())
    try:
        yield
    finally:
        deadline_task.cancel()
        with suppress(asyncio.CancelledError):
            await deadline_task


app = FastAPI(title="Quiz App API", version="1.0.0", lifespan=lifespan)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(speech_router)
app.mount("/media", StaticFiles(directory=settings.media_path), name="media")


@app.websocket("/ws/{code}")
async def websocket_room(websocket: WebSocket, code: str, token: str | None = Query(default=None)):
    code = code.upper()
    with SessionLocal() as db:
        session = db.scalar(session_query().where(GameSession.join_code == code))
        if not session:
            await websocket.close(code=4404, reason="Комната не найдена")
            return
        participant = None
        if token:
            participant = db.scalar(select(Participant).where(Participant.session_id == session.id, Participant.device_token_hash == token_hash(token)))
        await hub.connect(code, websocket)
        await websocket.send_json(session_snapshot(db, session, participant))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "sent_at": message.get("sent_at")})
            elif message.get("type") == "snapshot.request":
                with SessionLocal() as db:
                    session = db.scalar(session_query().where(GameSession.join_code == code))
                    participant = db.scalar(select(Participant).where(Participant.session_id == session.id, Participant.device_token_hash == token_hash(token))) if token else None
                    await websocket.send_json(session_snapshot(db, session, participant))
    except WebSocketDisconnect:
        hub.disconnect(code, websocket)
    except Exception:
        hub.disconnect(code, websocket)
        await websocket.close()
