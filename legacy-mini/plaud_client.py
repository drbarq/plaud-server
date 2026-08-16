"""Client for Plaud's official third-party API (the one behind @plaud-ai/cli).

Auth: run `plaud login` once (official CLI, browser OAuth). Tokens land in
~/.plaud/tokens.json as {access_token, refresh_token, expires_at}. This client
reads that file and refreshes through the same official endpoint the CLI uses,
writing the rotated tokens back so the CLI and this service stay in sync.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import httpx

API_BASE = "https://platform.plaud.ai/developer/api"
REFRESH_URL = f"{API_BASE}/oauth/third-party/access-token/refresh"
TOKENS_PATH = Path.home() / ".plaud" / "tokens.json"


class PlaudAuthError(RuntimeError):
    pass


@dataclass
class Recording:
    id: str
    name: str
    created_at: str | None
    start_at: str | None
    duration_ms: int | None
    serial_number: str | None
    raw: dict[str, Any]

    @classmethod
    def from_api(cls, d: dict[str, Any]) -> "Recording":
        return cls(
            id=d["id"],
            name=d.get("name", ""),
            created_at=d.get("created_at"),
            start_at=d.get("start_at"),
            duration_ms=d.get("duration"),
            serial_number=d.get("serial_number"),
            raw=d,
        )


class PlaudClient:
    def __init__(self, tokens_path: Path = TOKENS_PATH):
        self.tokens_path = tokens_path
        self._tokens: dict[str, Any] | None = None
        self._http = httpx.Client(timeout=60)

    # -- auth ---------------------------------------------------------------
    def _load_tokens(self) -> dict[str, Any]:
        if not self.tokens_path.exists():
            raise PlaudAuthError(
                f"No Plaud tokens at {self.tokens_path}. Run `plaud login` first."
            )
        return json.loads(self.tokens_path.read_text())

    def _access_token(self) -> str:
        if self._tokens is None:
            self._tokens = self._load_tokens()
        expires_at = self._tokens.get("expires_at") or 0
        # expires_at may be epoch seconds or ms; normalize to seconds
        if expires_at > 1e12:
            expires_at /= 1000
        if expires_at and expires_at < time.time() + 120:
            self._refresh()
        return self._tokens["access_token"]

    def _refresh(self) -> None:
        assert self._tokens is not None
        resp = self._http.post(
            REFRESH_URL, json={"refresh_token": self._tokens["refresh_token"]}
        )
        if resp.status_code != 200:
            raise PlaudAuthError(
                f"Token refresh failed ({resp.status_code}): {resp.text[:200]}. "
                "Re-run `plaud login`."
            )
        data = resp.json()
        payload = data.get("data", data)  # tolerate {data:{...}} envelopes
        self._tokens.update(
            {k: payload[k] for k in ("access_token", "refresh_token") if k in payload}
        )
        if "expires_at" in payload:
            self._tokens["expires_at"] = payload["expires_at"]
        elif "expires_in" in payload:
            self._tokens["expires_at"] = time.time() + payload["expires_in"]
        self.tokens_path.write_text(json.dumps(self._tokens, indent=2))

    def _request(self, path: str) -> Any:
        for attempt in (1, 2):
            resp = self._http.get(
                f"{API_BASE}{path}",
                headers={"Authorization": f"Bearer {self._access_token()}"},
            )
            if resp.status_code == 401 and attempt == 1:
                self._refresh()
                continue
            if resp.status_code != 200:
                raise RuntimeError(f"Plaud API {resp.status_code} on {path}: {resp.text[:200]}")
            data = resp.json()
            return data.get("data", data)
        raise AssertionError("unreachable")

    # -- API ----------------------------------------------------------------
    def current_user(self) -> dict[str, Any]:
        return self._request("/open/third-party/users/current")

    def list_recordings(self, page: int = 1, page_size: int = 50) -> list[Recording]:
        data = self._request(f"/open/third-party/files/?page={page}&page_size={page_size}")
        items = data["data"] if isinstance(data, dict) and "data" in data else data
        return [Recording.from_api(d) for d in items]

    def iter_recordings(self, max_pages: int = 20, page_size: int = 50) -> Iterator[Recording]:
        for page in range(1, max_pages + 1):
            batch = self.list_recordings(page=page, page_size=page_size)
            if not batch:
                return
            yield from batch
            if len(batch) < page_size:
                return

    def file_detail(self, file_id: str) -> dict[str, Any]:
        """Full detail: presigned_url (24h MP3), source_list (Plaud transcript
        blocks, present only if Plaud's AI ran), note_list (Plaud AI notes)."""
        return self._request(f"/open/third-party/files/{file_id}")

    def download_audio(self, detail: dict[str, Any], dest: Path) -> int:
        url = detail.get("presigned_url")
        if not url:
            raise RuntimeError(f"No presigned_url on file {detail.get('id')}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with self._http.stream("GET", url) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 16):
                    f.write(chunk)
        tmp.rename(dest)
        return dest.stat().st_size


def plaud_transcript_from_detail(detail: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Extract Plaud's own transcript utterances from a file detail, if their
    AI processed this recording (free tier covers 300 min/month)."""
    for src in detail.get("source_list") or []:
        if src.get("data_type") == "transaction" and src.get("data_content"):
            try:
                utts = json.loads(src["data_content"])
            except (json.JSONDecodeError, TypeError):
                continue
            return [
                {
                    "speaker": u.get("speaker"),
                    "start_ms": u.get("start_time"),
                    "end_ms": u.get("end_time"),
                    "text": (u.get("content") or "").strip(),
                }
                for u in utts
                if (u.get("content") or "").strip()
            ] or None
    return None
