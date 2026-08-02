from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Small single-instance limiter for login, joining and answer submission."""

    rules = (
        ("/api/auth/login", 30),
        ("/join", 150),
        ("/answer", 600),
        ("/transfer-requests", 60),
    )

    def __init__(self, app, window_seconds: int = 60):
        super().__init__(app)
        self.window_seconds = window_seconds
        self.hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self.lock = Lock()

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST":
            return await call_next(request)
        rule = next(((suffix, limit) for suffix, limit in self.rules if request.url.path.endswith(suffix)), None)
        if not rule:
            return await call_next(request)
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        client = forwarded or (request.client.host if request.client else "unknown")
        key = (rule[0], client)
        now = monotonic()
        with self.lock:
            bucket = self.hits[key]
            while bucket and bucket[0] <= now - self.window_seconds:
                bucket.popleft()
            if len(bucket) >= rule[1]:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Слишком много запросов. Попробуйте через минуту."},
                    headers={"Retry-After": str(self.window_seconds)},
                )
            bucket.append(now)
        return await call_next(request)
