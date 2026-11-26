"""Identity-bound latest-frame JPEG transport; importing this module opens nothing.

FastAPI/uvicorn and OpenCV are imported only when their respective services start.
The inference/preview loop never waits for JPEG encoding or a network consumer.
"""
from __future__ import annotations

import hmac
import ipaddress
import socket
import threading
import time


class StreamUnavailable(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _encode_jpeg(frame, quality):
    import cv2

    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("Could not encode camera frame")
    return encoded.tobytes()


class StreamHub:
    """One encoder thread, one pending frame, and one identity-bound JPEG."""

    def __init__(self, jpeg_quality=80, max_fps=15, max_frame_age=2.0,
                 clock=time.monotonic, encoder=None):
        if not 1 <= jpeg_quality <= 100 or max_fps <= 0 or max_frame_age <= 0:
            raise ValueError("Invalid stream quality, frame rate or freshness limit")
        self.jpeg_quality = jpeg_quality
        self.max_fps = max_fps
        self.max_frame_age = max_frame_age
        self._clock = clock
        self._encoder = encoder or _encode_jpeg
        self._condition = threading.Condition()
        self._identity = None
        self._revision = 0
        self._pending = None
        self._jpeg = None
        self._published_at = None
        self._sequence = 0
        self._closed = False
        self._thread = threading.Thread(target=self._encode_loop, name="ai-jpeg-encoder", daemon=True)
        self._thread.start()

    def set_identity(self, driver_id, name, session_id):
        if not isinstance(driver_id, str) or not driver_id or len(driver_id) > 64:
            raise ValueError("A valid driver ID is required")
        if not isinstance(session_id, str) or not session_id or len(session_id) > 128:
            raise ValueError("A valid QR session ID is required")
        with self._condition:
            if self._closed:
                return
            identity = (driver_id, str(name or driver_id), session_id)
            if self._identity is None or (self._identity[0], self._identity[2]) != (driver_id, session_id):
                self._revision += 1
                self._pending = self._jpeg = self._published_at = None
            self._identity = identity
            self._condition.notify_all()

    def clear(self):
        with self._condition:
            self._revision += 1
            self._identity = self._pending = self._jpeg = self._published_at = None
            self._condition.notify_all()

    def publish(self, frame, driver_id, session_id):
        # Copy before returning: the preview renderer may immediately mutate its
        # frame. Only the latest pending copy survives while encoding is busy.
        with self._condition:
            if not self._matches(driver_id, session_id):
                return False
            revision = self._revision
        copied = frame.copy()
        captured_at = self._clock()
        with self._condition:
            if revision != self._revision or not self._matches(driver_id, session_id):
                return False
            self._pending = (revision, captured_at, copied)
            self._condition.notify_all()
        return True

    def _matches(self, driver_id, session_id):
        return (not self._closed and self._identity is not None
                and self._identity[0] == driver_id and self._identity[2] == session_id)

    def _encode_loop(self):
        next_encode = 0.0
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._closed or self._pending is not None)
                if self._closed:
                    return
                delay = next_encode - time.monotonic()
                if delay > 0:
                    self._condition.wait(timeout=delay)
                    continue
                revision, timestamp, frame = self._pending
                self._pending = None
            try:
                jpeg = self._encoder(frame, self.jpeg_quality)
            except Exception:
                jpeg = None
            next_encode = time.monotonic() + 1.0 / self.max_fps
            with self._condition:
                # Encoding may finish after QR changes, reset, shutdown or age-out.
                if (jpeg is not None and not self._closed and self._identity is not None
                        and revision == self._revision
                        and self._clock() - timestamp <= self.max_frame_age):
                    self._jpeg = jpeg
                    self._published_at = timestamp
                    self._sequence += 1
                    self._condition.notify_all()

    def status(self):
        with self._condition:
            age = None if self._published_at is None else max(0.0, self._clock() - self._published_at)
            identity = self._identity
            return {
                "driver_id": identity[0] if identity else None,
                "driver_name": identity[1] if identity else None,
                "session_id": identity[2] if identity else None,
                "ready": bool(identity and self._jpeg and age is not None
                              and age <= self.max_frame_age and not self._closed),
                "frame_age_seconds": age,
            }

    def frame(self, driver_id, session_id):
        """Return immutable bytes and sequence only for the live QR session."""
        with self._condition:
            if not self._matches(driver_id, session_id):
                raise StreamUnavailable(409, "QR session does not match this driver")
            if (self._jpeg is None or self._published_at is None
                    or self._clock() - self._published_at > self.max_frame_age):
                raise StreamUnavailable(503, "No fresh AI frame available")
            return self._jpeg, self._sequence

    def close(self):
        with self._condition:
            self._closed = True
            self._identity = self._pending = self._jpeg = self._published_at = None
            self._condition.notify_all()
        self._thread.join(timeout=5)
        if self._thread.is_alive():
            raise RuntimeError("JPEG encoder did not stop within five seconds")


def create_app(hub, api_key=None, end_session=None):
    import asyncio
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import Response, StreamingResponse

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "X-Accel-Buffering": "no"}

    def authorize(request):
        supplied = request.headers.get("X-AI-Stream-Key", "")
        if api_key and not hmac.compare_digest(str(api_key).encode("utf-8"), supplied.encode("utf-8")):
            raise HTTPException(status_code=401, detail="Invalid stream service key")

    def get_frame(driver_id, session_id):
        try:
            return hub.frame(driver_id, session_id)
        except StreamUnavailable as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # With postponed annotations, FastAPI resolves names in module globals;
    # attach the concrete Request type explicitly without eager framework imports.
    async def status(request):
        authorize(request)
        return hub.status()
    status.__annotations__["request"] = Request
    app.get("/status")(status)

    async def stop_session(request, session_id: str):
        authorize(request)
        if end_session is None:
            raise HTTPException(status_code=503, detail="Session control unavailable")
        if not end_session(session_id):
            raise HTTPException(status_code=409, detail="Session no longer active")
        return {"stopped": True}
    stop_session.__annotations__["request"] = Request
    app.post("/session/end")(stop_session)

    async def frame(driver_id: str, request, session_id: str):
        authorize(request)
        jpeg, _ = get_frame(driver_id, session_id)
        return Response(jpeg, media_type="image/jpeg", headers=no_cache)
    frame.__annotations__["request"] = Request
    app.get("/frame/{driver_id}")(frame)

    async def stream(driver_id: str, request, session_id: str):
        authorize(request)
        get_frame(driver_id, session_id)

        async def chunks():
            sequence = -1
            while not await request.is_disconnected():
                try:
                    jpeg, current = hub.frame(driver_id, session_id)
                except StreamUnavailable:
                    return
                if current != sequence:
                    sequence = current
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(jpeg)).encode("ascii") + b"\r\n\r\n" + jpeg + b"\r\n")
                await asyncio.sleep(1.0 / hub.max_fps)

        return StreamingResponse(chunks(), media_type="multipart/x-mixed-replace; boundary=frame", headers=no_cache)
    stream.__annotations__["request"] = Request
    app.get("/stream/{driver_id}")(stream)
    return app


class StreamServer:
    def __init__(self, hub, host="127.0.0.1", port=8001, api_key=None, end_session=None):
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = host.lower() == "localhost"
        if not loopback and not api_key:
            raise ValueError("A stream service key is required for a non-loopback bind")
        self.hub, self.host, self.port, self.api_key = hub, host, port, api_key
        self.end_session = end_session
        self._server = self._thread = self._socket = None
        self._error = None

    def start(self):
        import uvicorn

        if self._thread is not None:
            raise RuntimeError("Stream server already started")
        app = create_app(self.hub, self.api_key, self.end_session)
        config = uvicorn.Config(app, host=self.host, port=self.port, log_level="warning",
                                access_log=False, timeout_graceful_shutdown=2)
        self._server = uvicorn.Server(config)
        family = socket.AF_INET6 if ":" in self.host else socket.AF_INET
        self._socket = socket.socket(family, socket.SOCK_STREAM)
        try:
            self._socket.bind((self.host, self.port))
            self._socket.listen(128)
            self.port = self._socket.getsockname()[1]
            def serve():
                try:
                    self._server.run(sockets=[self._socket])
                except BaseException as exc:
                    self._error = exc
            self._thread = threading.Thread(target=serve, name="ai-stream-http", daemon=True)
            self._thread.start()
            deadline = time.monotonic() + 5
            while not self._server.started:
                if self._error is not None or not self._thread.is_alive():
                    raise RuntimeError("AI stream HTTP server failed to start") from self._error
                if time.monotonic() >= deadline:
                    raise RuntimeError("AI stream HTTP server startup timed out")
                time.sleep(0.01)
        except BaseException:
            self.close()
            raise
        return self

    def close(self):
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)
            if self._thread.is_alive():
                self._server.force_exit = True
                self._thread.join(timeout=2)
        if self._socket is not None:
            self._socket.close()
        if self._thread is not None and self._thread.is_alive():
            raise RuntimeError("AI stream HTTP server did not stop")
