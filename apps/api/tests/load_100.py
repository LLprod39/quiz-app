"""Минимальный LAN smoke-load: 100 параллельных входов в открытую комнату."""
import asyncio
import sys
import time

import httpx


async def main(base_url: str, code: str, count: int = 100) -> None:
    started = time.perf_counter()
    async with httpx.AsyncClient(base_url=base_url, timeout=60, limits=httpx.Limits(max_connections=count, max_keepalive_connections=count)) as client:
        async def join(index: int) -> int:
            response = await client.post(f"/api/sessions/{code}/join", json={"display_name": f"Load {index:03}", "avatar": "🚀"})
            return response.status_code
        results = await asyncio.gather(*(join(index) for index in range(count)), return_exceptions=True)
        statuses = [result for result in results if isinstance(result, int)]
    elapsed = time.perf_counter() - started
    failures = [status for status in statuses if status != 200]
    failures.extend(0 for result in results if isinstance(result, Exception))
    print(f"connections={count} ok={count-len(failures)} failed={len(failures)} elapsed={elapsed:.2f}s")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000", sys.argv[2]))
