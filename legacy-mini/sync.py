"""Poll Plaud's official API for new recordings, archive audio locally,
transcribe (Plaud's free-tier transcript if present, else parakeet-mlx),
and upsert into Supabase for the Claude routine to process.

Usage:  uv run sync.py --once [--verbose] [--limit N]
launchd runs this every 10 minutes (see com.joetustin.plaud-sync.plist).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

from plaud_client import PlaudClient, Recording, plaud_transcript_from_detail
from transcribe import TranscriptionError, flatten, transcribe

log = logging.getLogger("plaud-sync")

MIN_DURATION_MS = int(os.environ.get("MIN_DURATION_MS", "4000"))  # skip pocket taps
MAX_STT_RETRIES = int(os.environ.get("MAX_STT_RETRIES", "5"))


class SupabaseStore:
    """Minimal PostgREST client — no SDK dependency."""

    def __init__(self) -> None:
        url = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self._http = httpx.Client(
            base_url=f"{url}/rest/v1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept-Profile": "plaud",
                "Content-Profile": "plaud",
            },
            timeout=30,
        )

    def sync_state(self) -> tuple[set[str], dict[str, int]]:
        """Returns (done_ids, retriable) where retriable maps id -> retry_count
        for errored rows still under the retry budget."""
        rows, offset = [], 0
        while True:
            r = self._http.get(
                "/recordings",
                params={"select": "id,status,retry_count", "order": "id.asc",
                        "limit": 1000, "offset": offset},
            )
            r.raise_for_status()
            batch = r.json()
            rows += batch
            if len(batch) < 1000:
                break
            offset += 1000
        done, retriable = set(), {}
        for row in rows:
            retries = row.get("retry_count") or 0
            if row.get("status") == "error" and retries < MAX_STT_RETRIES:
                retriable[row["id"]] = retries
            else:
                done.add(row["id"])
        return done, retriable

    def upsert(self, row: dict) -> None:
        r = self._http.post(
            "/recordings",
            params={"on_conflict": "id"},
            headers={"Prefer": "resolution=merge-duplicates"},
            json=row,
        )
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Supabase upsert failed {r.status_code}: {r.text[:300]}")


def process_recording(client: PlaudClient, store: SupabaseStore, rec: Recording,
                      archive_dir: Path, retry_count: int = 0) -> str:
    """Returns final status for logging."""
    detail = client.file_detail(rec.id)

    day = (rec.start_at or rec.created_at or "unknown")[:10]
    audio_path = archive_dir / day / f"{rec.id}.mp3"
    if not audio_path.exists():
        size = client.download_audio(detail, audio_path)
        log.info("  archived %s (%.1f MB)", audio_path.name, size / 1e6)

    base_row = {
        "id": rec.id,
        "name": rec.name,
        "serial_number": rec.serial_number,
        "started_at": rec.start_at,
        "created_at": rec.created_at,
        "duration_ms": rec.duration_ms,
        "audio_path": str(audio_path),
        "audio_bytes": audio_path.stat().st_size,
    }

    # Default: transcribe everything ourselves (Deepgram) for consistent
    # quality/format. Set USE_PLAUD_TRANSCRIPTS=true to prefer Plaud's own
    # free-tier transcripts when they exist.
    utts, source = None, None
    if os.environ.get("USE_PLAUD_TRANSCRIPTS", "false").lower() == "true":
        plaud_utts = plaud_transcript_from_detail(detail)
        if plaud_utts:
            utts, source = plaud_utts, "plaud"
    if utts is None:
        try:
            utts, source = transcribe(audio_path)
        except TranscriptionError as e:
            store.upsert({**base_row, "status": "error", "error": str(e)[:500],
                          "retry_count": retry_count + 1})
            return "error"

    if not utts:  # silence-only recording; mark processed so nothing sweeps it
        store.upsert({**base_row, "status": "processed",
                      "transcript_source": source, "transcript": [],
                      "transcript_text": "", "error": None})
        return "empty"

    store.upsert({
        **base_row,
        "status": "transcribed",
        "transcript_source": source,
        "transcript": utts,
        "transcript_text": flatten(utts),
        "error": None,
    })
    return f"transcribed ({source})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="run one sync cycle (default)")
    ap.add_argument("--limit", type=int, default=0, help="max new recordings to process")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    load_dotenv()
    archive_dir = Path(os.environ.get("ARCHIVE_DIR", "~/PlaudArchive")).expanduser()

    client = PlaudClient()
    store = SupabaseStore()

    done, retriable = store.sync_state()
    log.info("%d recordings already in Supabase (%d queued for retry)",
             len(done) + len(retriable), len(retriable))

    try:
        listed = list(client.iter_recordings())
    except Exception:
        log.exception("failed to list recordings from Plaud API")
        return 1
    new = [r for r in listed if r.id not in done]
    # oldest first so a partial run leaves a clean high-water mark
    new.sort(key=lambda r: r.start_at or r.created_at or "")
    skipped = [r for r in new if (r.duration_ms or 0) < MIN_DURATION_MS]
    new = [r for r in new if (r.duration_ms or 0) >= MIN_DURATION_MS]
    if skipped:
        log.info("skipping %d clips under %dms", len(skipped), MIN_DURATION_MS)
    if args.limit:
        new = new[: args.limit]
    log.info("%d new recordings to process", len(new))

    failures = 0
    for rec in new:
        log.info("processing %s — %s", rec.id[:12], rec.name)
        try:
            outcome = process_recording(client, store, rec, archive_dir,
                                        retry_count=retriable.get(rec.id, 0))
            log.info("  -> %s", outcome)
            if outcome == "error":
                failures += 1
        except Exception as e:  # network blip etc: log, continue, retry next cycle
            failures += 1
            log.exception("  failed: %s", e)

    log.info("done: %d processed, %d failures", len(new) - failures, failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
