"""Supertonic-3 TTS worker: JSON lines over stdio.

In:  {"type":"config","voice":"M1"}
     {"type":"synth","id":N,"text":"...","lang":"en"|"ar","speed":1.05,"steps":5}
     {"type":"cancel","id":N}
     {"type":"stop"}
Out: {"type":"ready","sample_rate":44100,"voice":...}
     {"type":"tts-meta","id":N,"sample_rate":...,"audio_s":...,"wall_s":...}
     {"type":"tts-audio","id":N,"seq":i,"b64":...}     (PCM16 LE slices)
     {"type":"tts-done","id":N,"rtf":...,"audio_s":...,"wall_s":...}
     {"type":"tts-cancelled","id":N}
     {"type":"error","message":...}

supertonic-3 synthesizes whole utterances (no native streaming), so the
gateway pipelines at the sentence level: this worker streams each result back
in slices and accepts the next sentence immediately after, while the browser
plays the previous one.
"""
import base64
import json
import os
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPERTONIC_CACHE_DIR", os.path.join(BASE, "models", "supertonic"))
os.environ.setdefault("SUPERTONIC_INTRA_OP_THREADS", "4")

import numpy as np  # noqa: E402
from supertonic import TTS  # noqa: E402

SLICE_BYTES = 8192  # 4096 int16 samples per frame


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class TtsWorker:
    def __init__(self, voice="M1"):
        self.tts = TTS(auto_download=True)
        self.style = self.tts.get_voice_style(voice)
        self.sample_rate = int(self.tts.sample_rate)
        self.cancelled = set()
        self.voice = voice

    def pcm16(self, wav):
        arr = np.asarray(wav)
        if arr.dtype.kind == "i":
            return arr.astype("<i2").tobytes()
        return (np.clip(arr, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()

    def synth(self, msg):
        cid = msg["id"]
        lang = msg.get("lang", "en")
        steps = int(msg.get("steps", 5))
        speed = float(msg.get("speed", 1.05))
        text = msg["text"]
        if cid in self.cancelled:
            self.cancelled.discard(cid)
            send({"type": "tts-cancelled", "id": cid})
            return
        t0 = time.time()
        wav, dur = self.tts.synthesize(text, self.style, lang=lang, total_steps=steps, speed=speed)
        wall = time.time() - t0
        audio_s = float(np.ravel(np.asarray(dur))[0]) if np.size(dur) else 0.0
        send({"type": "tts-meta", "id": cid, "sample_rate": self.sample_rate,
              "audio_s": round(audio_s, 3), "wall_s": round(wall, 3)})
        pcm = self.pcm16(wav)
        off = 0
        seq = 0
        while off < len(pcm):
            if cid in self.cancelled:
                self.cancelled.discard(cid)
                send({"type": "tts-cancelled", "id": cid})
                return
            piece = pcm[off:off + SLICE_BYTES]
            send({"type": "tts-audio", "id": cid, "seq": seq,
                  "b64": base64.b64encode(piece).decode()})
            off += SLICE_BYTES
            seq += 1
        send({"type": "tts-done", "id": cid, "rtf": round(wall / max(audio_s, 1e-6), 3),
              "audio_s": round(audio_s, 3), "wall_s": round(wall, 3)})


def main():
    worker = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            send({"type": "error", "message": "bad json"})
            continue
        try:
            mtype = msg.get("type")
            if mtype == "config":
                worker = TtsWorker(voice=msg.get("voice", "M1"))
                send({"type": "ready", "sample_rate": worker.sample_rate,
                      "voice": worker.voice})
            elif mtype == "synth":
                if worker is None:
                    send({"type": "error", "message": "synth before config"})
                else:
                    worker.synth(msg)
            elif mtype == "cancel":
                if worker is not None:
                    worker.cancelled.add(int(msg["id"]))
            elif mtype == "stop":
                break
        except Exception as exc:  # noqa: BLE001 — report and keep serving
            send({"type": "error", "message": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
