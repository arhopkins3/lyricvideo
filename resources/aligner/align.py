#!/usr/bin/env python3
"""
Automatic word-level alignment of Farsi lyrics to a song.

Strategy
--------
1. (optional) Separate vocals with demucs so the recogniser hears less instrumentation.
2. Transcribe with faster-whisper (language=fa, word timestamps).
3. Align the known lyric words to the recognised words with a global sequence alignment
   (Needleman-Wunsch on normalised Farsi strings) and transfer the timestamps.
4. Interpolate words that were not matched between their nearest matched neighbours.

Usage: align.py --audio song.mp3 --lyrics lyrics.json --out result.json [--model large-v3-turbo] [--separate]
lyrics.json: {"lines": [{"id": "...", "words": [{"id": "...", "fa": "..."}]}]}
Progress is reported as JSON lines on stdout: {"progress": 0.4, "message": "..."}.
"""
from __future__ import annotations

import faulthandler

faulthandler.enable()  # a native crash (segfault in the model library) then still prints a traceback

import argparse
import difflib
import json
import os
import re
import sys

import warnings

warnings.filterwarnings("ignore")  # library warnings go to the app log and only confuse users
import logging

logging.getLogger("huggingface_hub").setLevel(logging.ERROR)  # e.g. the "unauthenticated requests" notice

# Two OpenMP runtimes (CTranslate2 + torch) abort the process on macOS unless this is set.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", str(max(1, (os.cpu_count() or 4) // 2)))
import tempfile
import unicodedata
from dataclasses import dataclass
from typing import List, Optional


LAST_STAGE = "starting"


def report(progress: float, message: str) -> None:
    global LAST_STAGE
    LAST_STAGE = message
    print(json.dumps({"progress": progress, "message": message}, ensure_ascii=False), flush=True)


# ----------------------------------------------------------------------------- normalisation

_DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭـ]")
_PUNCT = re.compile(r"[^\w]+|_", re.UNICODE)
_CHAR_MAP = str.maketrans(
    {
        "ي": "ی",
        "ك": "ک",
        "ة": "ه",
        "ؤ": "و",
        "إ": "ا",
        "أ": "ا",
        "آ": "ا",
        "ئ": "ی",
        "ء": "",
        "‌": "",  # ZWNJ
        "‍": "",
        "‏": "",
        "‎": "",
    }
)


def normalise(word: str) -> str:
    w = unicodedata.normalize("NFC", word).translate(_CHAR_MAP)
    w = _DIACRITICS.sub("", w)
    w = _PUNCT.sub("", w)
    return w.strip().lower()


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


# ----------------------------------------------------------------------------- data

@dataclass
class Token:
    text: str
    start: float
    end: float


@dataclass
class LyricWord:
    line_index: int
    word_index: int
    id: str
    fa: str
    norm: str
    start: Optional[float] = None
    end: Optional[float] = None
    matched: bool = False


# ----------------------------------------------------------------------------- transcription

def separate_vocals(audio: str, workdir: str) -> str:
    """Return a path to the vocals stem, or the original audio when demucs is unavailable."""
    try:
        import demucs.separate  # type: ignore
    except Exception:
        report(0.05, "demucs not installed; aligning against the full mix")
        return audio
    report(0.05, "Separating vocals with demucs (this can take a few minutes)…")
    out = os.path.join(workdir, "demucs")
    demucs.separate.main(["--two-stems=vocals", "-n", "htdemucs", "-o", out, audio])
    base = os.path.splitext(os.path.basename(audio))[0]
    vocals = os.path.join(out, "htdemucs", base, "vocals.wav")
    if os.path.exists(vocals):
        return vocals
    report(0.2, "demucs produced no vocals stem; using the full mix")
    return audio


def load_audio(path: str, ffmpeg: str) -> "np.ndarray":
    """Decode any audio/video file to 16 kHz mono float32 with ffmpeg.

    faster-whisper's own decoder depends on PyAV, whose API keeps changing; ffmpeg is already a
    requirement of the app, so use it directly and hand the samples to the model.
    """
    import subprocess

    import numpy as np

    cmd = [ffmpeg, "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not decode the audio: {proc.stderr.decode('utf-8', 'replace')[-400:]}")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def transcribe(audio: str, model_name: str, initial_prompt: Optional[str], ffmpeg: str) -> List[Token]:
    from faster_whisper import WhisperModel  # type: ignore

    report(0.22, "Decoding audio…")
    samples = load_audio(audio, ffmpeg)
    audio_duration = len(samples) / 16000.0

    report(0.25, f"Loading whisper model '{model_name}' (downloads on first use, ~1.5 GB for large models)…")
    # CPU + int8 is the configuration that works everywhere (macOS has no CUDA; Apple Silicon runs int8 well).
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=int(os.environ.get("OMP_NUM_THREADS", "4")))
    report(0.35, "Transcribing vocals…")

    def run(vad: bool):
        return model.transcribe(
            samples,
            language="fa",
            task="transcribe",
            beam_size=5,
            word_timestamps=True,
            vad_filter=vad,
            vad_parameters={"min_silence_duration_ms": 300} if vad else None,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt,
        )

    try:
        segments, info = run(True)
    except Exception as exc:  # the VAD model (onnxruntime) is the most platform-sensitive piece; fall back without it
        report(0.35, f"VAD unavailable ({exc.__class__.__name__}); transcribing without it")
        segments, info = run(False)
    tokens: List[Token] = []
    duration = float(getattr(info, "duration", 0.0) or 0.0) or audio_duration
    for seg in segments:
        if seg.end and duration:
            report(0.35 + 0.45 * min(1.0, seg.end / duration), f"Transcribing… {int(seg.end)}s / {int(duration)}s")
        for w in seg.words or []:
            text = (w.word or "").strip()
            if not text:
                continue
            tokens.append(Token(text=text, start=float(w.start), end=float(w.end)))
    return tokens


# ----------------------------------------------------------------------------- alignment

def needleman_wunsch(lyric: List[LyricWord], tokens: List[Token]) -> List[Optional[int]]:
    """Return, for every lyric word, the index of the matched token or None."""
    n, m = len(lyric), len(tokens)
    if n == 0 or m == 0:
        return [None] * n
    gap = -0.4
    tok_norm = [normalise(t.text) for t in tokens]
    # score matrix (n+1) x (m+1)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    trace = [[0] * (m + 1) for _ in range(n + 1)]  # 0 diag, 1 up (skip lyric), 2 left (skip token)
    for i in range(1, n + 1):
        score[i][0] = i * gap
        trace[i][0] = 1
    for j in range(1, m + 1):
        score[0][j] = j * gap
        trace[0][j] = 2
    for i in range(1, n + 1):
        ln = lyric[i - 1].norm
        row = score[i]
        prev = score[i - 1]
        for j in range(1, m + 1):
            sim = similarity(ln, tok_norm[j - 1])
            match = prev[j - 1] + (2.0 * sim - 1.0)
            up = prev[j] + gap
            left = row[j - 1] + gap
            best = match
            t = 0
            if up > best:
                best, t = up, 1
            if left > best:
                best, t = left, 2
            row[j] = best
            trace[i][j] = t
    result: List[Optional[int]] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        t = trace[i][j]
        if t == 0:
            if similarity(lyric[i - 1].norm, tok_norm[j - 1]) >= 0.5:
                result[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif t == 1:
            i -= 1
        else:
            j -= 1
    return result


def interpolate(words: List[LyricWord], total_duration: float) -> None:
    """Fill timestamps for unmatched words by spreading them between matched neighbours."""
    n = len(words)
    if n == 0:
        return
    matched_idx = [i for i, w in enumerate(words) if w.matched]
    if not matched_idx:
        # Nothing matched: spread evenly over the song, weighting by word length.
        weights = [max(1, len(w.norm)) for w in words]
        total = sum(weights)
        t = 0.0
        for w, wt in zip(words, weights):
            d = total_duration * wt / total
            w.start, w.end = t, t + d
            t += d
        return

    def fill(lo: int, hi: int, t0: float, t1: float) -> None:
        """Assign words lo..hi (inclusive) evenly between t0 and t1."""
        count = hi - lo + 1
        if count <= 0:
            return
        if t1 <= t0:
            t1 = t0 + 0.25 * count
        weights = [max(1, len(words[k].norm)) for k in range(lo, hi + 1)]
        total = sum(weights)
        t = t0
        for k, wt in zip(range(lo, hi + 1), weights):
            d = (t1 - t0) * wt / total
            words[k].start, words[k].end = t, t + d
            t += d

    first, last = matched_idx[0], matched_idx[-1]
    # Leading run
    if first > 0:
        est = 0.35 * first
        t1 = words[first].start or 0.0
        fill(0, first - 1, max(0.0, t1 - est), t1)
    # Gaps between matches
    for a, b in zip(matched_idx, matched_idx[1:]):
        if b - a > 1:
            fill(a + 1, b - 1, words[a].end or 0.0, words[b].start or 0.0)
    # Trailing run
    if last < n - 1:
        t0 = words[last].end or 0.0
        fill(last + 1, n - 1, t0, min(total_duration, t0 + 0.35 * (n - 1 - last)))
    # Enforce monotonic ordering.
    prev_end = 0.0
    for w in words:
        if w.start is None or w.end is None:
            continue
        if w.start < prev_end:
            w.start = prev_end
        if w.end < w.start + 0.05:
            w.end = w.start + 0.05
        prev_end = w.end


# ----------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--lyrics", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--separate", action="store_true", help="Run demucs vocal separation first when available")
    ap.add_argument("--duration", type=float, default=0.0)
    ap.add_argument("--tokens-cache", default=None, help="Reuse a previous transcription JSON if present")
    ap.add_argument("--ffmpeg", default="ffmpeg", help="Path to the ffmpeg binary used to decode the audio")
    args = ap.parse_args()

    with open(args.lyrics, "r", encoding="utf-8") as fh:
        lyrics = json.load(fh)

    words: List[LyricWord] = []
    for li, line in enumerate(lyrics.get("lines", [])):
        for wi, w in enumerate(line.get("words", [])):
            words.append(LyricWord(li, wi, w["id"], w["fa"], normalise(w["fa"])))

    tokens: List[Token] = []
    if args.tokens_cache and os.path.exists(args.tokens_cache):
        with open(args.tokens_cache, "r", encoding="utf-8") as fh:
            tokens = [Token(**t) for t in json.load(fh)]
        report(0.8, f"Reusing cached transcription ({len(tokens)} words)")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            audio = separate_vocals(args.audio, tmp) if args.separate else args.audio
            first_lines = " ".join(l.get("fa", "") or " ".join(w["fa"] for w in l.get("words", [])) for l in lyrics.get("lines", [])[:4])
            tokens = transcribe(audio, args.model, first_lines[:200] or None, args.ffmpeg)
        if args.tokens_cache:
            with open(args.tokens_cache, "w", encoding="utf-8") as fh:
                json.dump([t.__dict__ for t in tokens], fh, ensure_ascii=False)

    report(0.85, f"Matching {len(words)} lyric words to {len(tokens)} recognised words…")
    mapping = needleman_wunsch(words, tokens)
    for w, tidx in zip(words, mapping):
        if tidx is not None:
            w.start, w.end = tokens[tidx].start, tokens[tidx].end
            w.matched = True

    duration = args.duration or (tokens[-1].end + 1.0 if tokens else 0.0)
    interpolate(words, duration)

    # Build the result grouped by line.
    out_lines = []
    for li, line in enumerate(lyrics.get("lines", [])):
        lw = [w for w in words if w.line_index == li]
        starts = [w.start for w in lw if w.start is not None]
        ends = [w.end for w in lw if w.end is not None]
        out_lines.append(
            {
                "id": line["id"],
                "start": min(starts) if starts else None,
                "end": max(ends) if ends else None,
                "words": [{"id": w.id, "start": w.start, "end": w.end, "matched": w.matched} for w in lw],
            }
        )
    matched = sum(1 for w in words if w.matched)
    result = {
        "engine": f"faster-whisper:{args.model}" + (" +demucs" if args.separate else ""),
        "lines": out_lines,
        "notes": f"{matched} of {len(words)} words matched directly; the rest were interpolated.",
        "matchedFraction": (matched / len(words)) if words else 0.0,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    report(1.0, result["notes"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # surface the error to the app
        import traceback

        print(json.dumps({"error": f"{exc.__class__.__name__}: {exc} (while: {LAST_STAGE})"}, ensure_ascii=False), flush=True)
        traceback.print_exc()
        sys.exit(1)
