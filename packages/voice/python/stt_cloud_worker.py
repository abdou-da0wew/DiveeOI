"""Cloud STT worker (engine "cloud"): JSON lines over stdio.

Same protocol as stt_worker.py so the gateway treats engines interchangeably:

In:  {"type":"config","provider":"groq"|"mock"|...,"baseUrl":...,
       "model":...,"apiKeyEnv":"VOICE_CLOUD_STT_API_KEY","hasKey":true}
     {"type":"audio","b64":...,"lang":"en"|"ar"|"auto"}  (16 kHz mono PCM16)
     {"type":"flush"} / {"type":"reset"} / {"type":"stop"}
Out: {"type":"ready","engine":"cloud","provider":...,"model":...,"hasKey":...}
     {"type":"final","lang":...,"text":...,"confidence":null,"engine":"cloud"}
     {"type":"error","message":...,"kind":"cloud-fallback"|...}

Behaviour:
- audio frames are buffered per utterance; on flush the whole utterance is
  sent as a 16 kHz WAV to an OpenAI-compatible /audio/transcriptions endpoint
  (multipart/form-data). Batch cloud APIs do not stream partials — finals only.
- provider "mock" returns canned EN/AR transcripts with no network (CI/tests).
- the API key is read from the configured env var NAME at call time; it is
  never written to disk, logs, or responses.
- any failure emits kind:"cloud-fallback" so the gateway can drop back to the
  local vosk engine for the session.
"""
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

SAMPLE_RATE = 16000
MOCK_TEXTS = {
    "en": "What is photosynthesis and why is it important?",
    "ar": "ما هو البناء الضوئي ولماذا هو مهم؟",
}


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def pcm16_to_wav(pcm: bytes) -> bytes:
    import struct
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16,
        1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16, b"data", len(pcm),
    )
    return header + pcm


class CloudSttWorker:
    def __init__(self):
        self.cfg = {}
        self.buffer = bytearray()
        self.lang = "en"

    def ready(self):
        send({"type": "ready", "engine": "cloud",
              "provider": self.cfg.get("provider"),
              "model": self.cfg.get("model"),
              "hasKey": bool(self.cfg.get("hasKey"))})

    def transcribe_mock(self):
        text = MOCK_TEXTS.get(self.lang, MOCK_TEXTS["en"])
        time.sleep(0.05)  # simulate a small RTT so HUD metrics look real
        return text

    def transcribe_openai_compatible(self):
        base_url = self.cfg["baseUrl"]
        model = self.cfg.get("model", "whisper-large-v3")
        api_key_env = self.cfg.get("apiKeyEnv", "VOICE_CLOUD_STT_API_KEY")
        key = os.environ.get(api_key_env, "")
        if not key:
            raise RuntimeError(f"no API key in env {api_key_env}")

        boundary = uuid.uuid4().hex
        wav = pcm16_to_wav(bytes(self.buffer))
        parts = []

        def field(name, value):
            parts.append(
                (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode()
            )

        def filefield(name, filename, content):
            parts.append(
                (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; "
                 f"filename=\"{filename}\"\r\nContent-Type: audio/wav\r\n\r\n").encode()
                + content + b"\r\n"
            )

        field("model", model)
        field("language", "ar" if self.lang == "ar" else "en")
        field("response_format", "json")
        field("temperature", "0")
        filefield("file", "utterance.wav", wav)
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)

        req = urllib.request.Request(
            base_url,
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {key}",
            },
            method="POST",
        )
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        send({"type": "info", "rtt_ms": round((time.time() - t0) * 1000)})
        return (result.get("text") or "").strip()

    def flush(self):
        if not self.buffer:
            return
        provider = self.cfg.get("provider", "groq")
        try:
            if provider == "mock":
                text = self.transcribe_mock()
            else:
                text = self.transcribe_openai_compatible()
            if text:
                send({"type": "final", "lang": self.lang, "text": text,
                      "confidence": None, "engine": "cloud"})
        except urllib.error.HTTPError as exc:
            body = exc.read(200).decode(errors="replace")
            send({"type": "error", "kind": "cloud-fallback",
                  "message": f"HTTP {exc.code}: {body}"})
        except Exception as exc:  # noqa: BLE001
            send({"type": "error", "kind": "cloud-fallback",
                  "message": f"{type(exc).__name__}: {exc}"})
        finally:
            self.buffer = bytearray()


def main():
    worker = CloudSttWorker()
    send({"type": "ready", "engine": "cloud", "provider": None, "model": None,
          "hasKey": False})
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
                worker.cfg = msg
                worker.ready()
            elif mtype == "audio":
                worker.lang = msg.get("lang", "en")
                worker.buffer += base64.b64decode(msg["b64"])
            elif mtype == "flush":
                worker.flush()
            elif mtype == "reset":
                worker.buffer = bytearray()
            elif mtype == "stop":
                break
        except Exception as exc:  # noqa: BLE001
            send({"type": "error", "kind": "cloud-fallback",
                  "message": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
