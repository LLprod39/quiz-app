from collections import defaultdict
from fastapi import WebSocket


class ConnectionHub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, room: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms[room].add(websocket)

    def disconnect(self, room: str, websocket: WebSocket) -> None:
        self.rooms[room].discard(websocket)
        if not self.rooms[room]:
            self.rooms.pop(room, None)

    def has_connections(self, room: str) -> bool:
        return bool(self.rooms.get(room))

    async def broadcast(self, room: str, payload: dict) -> None:
        stale = []
        for socket in tuple(self.rooms.get(room, set())):
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)
        for socket in stale:
            self.disconnect(room, socket)

    async def close_room(self, room: str, code: int = 4401, reason: str = "Доступ отозван") -> None:
        sockets = tuple(self.rooms.get(room, set()))
        self.rooms.pop(room, None)
        for socket in sockets:
            try:
                await socket.close(code=code, reason=reason)
            except Exception:
                pass


hub = ConnectionHub()
