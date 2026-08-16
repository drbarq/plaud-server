"""Speech-to-text engines, selected via STT_ENGINE env:

- deepgram  — Nova-3 API with diarization; ~zero RAM, right choice for a
              memory-constrained Mac mini (~$0.005/min, only for overflow
              past Plaud's free 300 min/month)
- parakeet  — parakeet-mlx locally (Apple Silicon, ~60x realtime, ~1.7% WER,
              needs ~2GB free RAM while running)
- whisper   — openai-whisper CLI fallback
- auto      — deepgram if DEEPGRAM_API_KEY is set, else parakeet, else whisper

Local engines are invoked as CLIs so no ML deps live in this venv."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx


class TranscriptionError(RuntimeError):
    pass


def _run(cmd: list[str], timeout: int) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise TranscriptionError(
            f"{cmd[0]} failed ({proc.returncode}): {proc.stderr[-500:]}"
        )


def transcribe(audio: Path, timeout: int = 3600) -> tuple[list[dict], str]:
    """Returns (utterances, engine). Utterances: [{speaker,start_ms,end_ms,text}].

    Every failure mode (subprocess timeout, network error, bad JSON, ...)
    surfaces as TranscriptionError so callers have a single error path."""
    engine = os.environ.get("STT_ENGINE", "auto").lower()
    try:
        if engine == "deepgram" or (engine == "auto" and os.environ.get("DEEPGRAM_API_KEY")):
            return _deepgram(audio, timeout), "deepgram"
        if engine in ("parakeet", "auto") and shutil.which("parakeet-mlx"):
            return _parakeet(audio, timeout), "parakeet"
        if engine in ("whisper", "auto") and shutil.which("whisper"):
            return _whisper(audio, timeout), "whisper"
    except TranscriptionError:
        raise
    except Exception as e:
        raise TranscriptionError(f"{type(e).__name__}: {e}") from e
    raise TranscriptionError(
        f"No usable STT engine (STT_ENGINE={engine}). Set DEEPGRAM_API_KEY, "
        "or install one: `uv tool install parakeet-mlx` / `pip install openai-whisper`."
    )


def _deepgram(audio: Path, timeout: int) -> list[dict]:
    key = os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        raise TranscriptionError("STT_ENGINE=deepgram but DEEPGRAM_API_KEY is unset")
    resp = httpx.post(
        "https://api.deepgram.com/v1/listen",
        params={
            "model": "nova-3",
            "smart_format": "true",
            "diarize": "true",
            "utterances": "true",
        },
        headers={"Authorization": f"Token {key}", "Content-Type": "audio/mpeg"},
        content=audio.read_bytes(),
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise TranscriptionError(f"Deepgram {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    utts = body.get("results", {}).get("utterances") or []
    out = [
        {
            "speaker": f"Speaker {u['speaker']}" if u.get("speaker") is not None else None,
            "start_ms": int(u["start"] * 1000),
            "end_ms": int(u["end"] * 1000),
            "text": (u.get("transcript") or "").strip(),
        }
        for u in utts
        if (u.get("transcript") or "").strip()
    ]
    if out:
        return out
    # utterances can be empty on very short clips; fall back to the flat transcript
    try:
        alt = body["results"]["channels"][0]["alternatives"][0]
        text = (alt.get("transcript") or "").strip()
    except (KeyError, IndexError):
        text = ""
    return [{"speaker": None, "start_ms": 0, "end_ms": 0, "text": text}] if text else []


def _parakeet(audio: Path, timeout: int) -> list[dict]:
    with tempfile.TemporaryDirectory() as td:
        _run(
            ["parakeet-mlx", str(audio), "--output-format", "json", "--output-dir", td],
            timeout,
        )
        out = next(Path(td).glob("*.json"), None)
        if out is None:
            raise TranscriptionError("parakeet-mlx produced no JSON output")
        data = json.loads(out.read_text())
    sentences = data.get("sentences") or data.get("segments") or []
    utts = [
        {
            "speaker": None,
            "start_ms": int(float(s.get("start", 0)) * 1000),
            "end_ms": int(float(s.get("end", 0)) * 1000),
            "text": (s.get("text") or "").strip(),
        }
        for s in sentences
        if (s.get("text") or "").strip()
    ]
    if not utts and (data.get("text") or "").strip():
        utts = [{"speaker": None, "start_ms": 0, "end_ms": 0, "text": data["text"].strip()}]
    return utts


def _whisper(audio: Path, timeout: int) -> list[dict]:
    with tempfile.TemporaryDirectory() as td:
        _run(
            ["whisper", str(audio), "--model", "turbo", "--output_format", "json",
             "--output_dir", td, "--fp16", "False"],
            timeout,
        )
        out = next(Path(td).glob("*.json"), None)
        if out is None:
            raise TranscriptionError("whisper produced no JSON output")
        data = json.loads(out.read_text())
    return [
        {
            "speaker": None,
            "start_ms": int(seg["start"] * 1000),
            "end_ms": int(seg["end"] * 1000),
            "text": seg["text"].strip(),
        }
        for seg in data.get("segments", [])
        if seg.get("text", "").strip()
    ]


def flatten(utterances: list[dict]) -> str:
    return "\n".join(u["text"] for u in utterances)
