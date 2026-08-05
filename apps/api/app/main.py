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
from .models import Account, AuthSession, Event, GameSession, Participant, Question, Round, ScreenAccess
from .rate_limit import RateLimitMiddleware
from .realtime import hub
from .routes import broadcast_state, find_screen_access, participant_snapshot, router, session_query
from .security import token_hash
from .seed import seed_demo
from .bootstrap import bootstrap_database
from .speech import router as speech_router
from .account_routes import router as account_router
from .system_routes import router as system_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        bootstrap_account = bootstrap_database(db)
        seed_demo(db, bootstrap_account.id)
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
                    await broadcast_state(db, session)
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
app.include_router(account_router)
app.include_router(system_router)
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
        organizer = None
        if token:
            participant = db.scalar(select(Participant).where(Participant.session_id == session.id, Participant.device_token_hash == token_hash(token)))
        else:
            raw_session = websocket.cookies.get(settings.auth_cookie_name)
            if raw_session:
                auth = db.scalar(select(AuthSession).where(
                    AuthSession.token_hash == token_hash(raw_session),
                    AuthSession.revoked_at.is_(None),
                    AuthSession.expires_at > utcnow(),
                ))
                organizer = db.get(Account, auth.account_id) if auth else None
                if not organizer or organizer.status != "active" or session.event.owner_id != organizer.id:
                    organizer = None
        if not participant and not organizer:
            await websocket.close(code=4401, reason="Требуется доступ к комнате")
            return
        channel = f"organizer:{code}" if organizer else code
        await hub.connect(channel, websocket)
        payload = session_snapshot(db, session, participant)
        await websocket.send_json(payload if organizer else participant_snapshot(payload))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "sent_at": message.get("sent_at")})
            elif message.get("type") == "snapshot.request":
                with SessionLocal() as db:
                    session = db.scalar(session_query().where(GameSession.join_code == code))
                    participant = db.scalar(select(Participant).where(Participant.session_id == session.id, Participant.device_token_hash == token_hash(token))) if token else None
                    payload = session_snapshot(db, session, participant)
                    await websocket.send_json(payload if organizer else participant_snapshot(payload))
    except WebSocketDisconnect:
        hub.disconnect(channel, websocket)
    except Exception:
        hub.disconnect(channel, websocket)
        await websocket.close()


@app.websocket("/ws/screens/{screen_token}")
async def websocket_screen(websocket: WebSocket, screen_token: str):
    with SessionLocal() as db:
        try:
            access = find_screen_access(db, screen_token)
        except Exception:
            await websocket.close(code=4404, reason="Ссылка экрана недействительна")
            return
        session = db.scalar(session_query().where(GameSession.id == access.session_id))
        channel = f"screen:{session.join_code}"
        await hub.connect(channel, websocket)
        await websocket.send_json(session_snapshot(db, session))
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "sent_at": message.get("sent_at")})
    except WebSocketDisconnect:
        hub.disconnect(channel, websocket)
    except Exception:
        hub.disconnect(channel, websocket)
        await websocket.close()
