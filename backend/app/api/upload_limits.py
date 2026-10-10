"""Reject oversized upload bodies before multipart files can exhaust temporary disk."""

from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class UploadBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_mb: int):
        self.app = app
        self.maximum = max_body_mb * 1024 * 1024
        self.message = (
            f"The upload batch exceeds the {max_body_mb} MB request limit. Upload fewer or smaller images."
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/images/upload":
            await self.app(scope, receive, send)
            return

        response = self.check_content_length(scope.get("headers", []))
        if response is not None:
            await response(scope, receive, send)
            return

        received = 0
        exceeded = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.maximum:
                    exceeded = True
                    # Multipart's own error path closes every partially spooled file.
                    raise MultiPartException(self.message)
            return message

        async def limited_send(message: Message):
            if message["type"] == "http.response.start" and exceeded:
                message = dict(message, status=413)
            await send(message)

        await self.app(scope, limited_receive, limited_send)

    def check_content_length(self, headers: list[tuple[bytes, bytes]]) -> JSONResponse | None:
        for key, value in headers:
            if key.lower() != b"content-length":
                continue
            try:
                length = int(value)
            except ValueError:
                return JSONResponse(
                    {"detail": "The upload has an invalid Content-Length header."}, status_code=400
                )
            if length > self.maximum:
                return JSONResponse({"detail": self.message}, status_code=413)
        return None
