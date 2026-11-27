"""Vosk STT worker (engine "local"): JSON lines over stdio.

In:  {"type":"config","models":{"en":path,"ar":path}}
     {"type":"audio","b64":...,"lang":"en"|"ar"|"auto"}   (16 kHz mono PCM16)
     {"type":"flush"}   -> force final for the current utterance
     {"type":"reset"}   -> new utterance (recreates recognizers, keeps models)
Out: {"type":"ready","models":[...]}
     {"type":"loaded","lang":...}
     {"type":"partial","lang":...,"text":...}
     {"type":"final","lang":...,"text":...,"confidence":...}
     {"type":"error","message":...}

Models are loaded lazily on the first audio frame of that language, so the
1.5 GB MSA Arabic model only occupies RAM when the student actually speaks
Arabic (memory guard on 8 GB machines). In "auto" mode both configured
recognizers run on the same frames; the final with the higher confidence wins.
"""
import base64
import json
import sys
import time

from vosk import KaldiRecognizer, Model, SetLogLevel

SAMPLE_RATE = 16000
SetLogLevel(-1)


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def result_confidence(res):
    conf = res.get("confidence")
    if isinstance(conf, (int, float)):
        return float(conf)
    words = res.get("result") or []
    vals = [w.get("conf") for w in words if isinstance(w.get("conf"), (int, float))]
    return sum(vals) / len(vals) if vals else 0.6


class SttWorker:
    def __init__(self):
        self.paths = {}
        self.models = {}   # lang -> Model (lazy)
        self.recs = {}     # lang -> KaldiRecognizer
        self.auto = False
        self.pending_finals = {}

    def load(self, lang):
        if lang in self.models:
            return self.models[lang]
        path = self.paths.get(lang)
        if not path:
            raise RuntimeError(f"no model path configured for lang={lang}")
        t0 = time.time()
        model = Model(path)
        self.models[lang] = model
        send({"type": "loaded", "lang": lang, "load_s": round(time.time() - t0, 2)})
        return model

    def ensure_rec(self, lang):
        if lang not in self.recs:
            model = self.load(lang)
            self.recs[lang] = KaldiRecognizer(model, SAMPLE_RATE)
        return self.recs[lang]

    def active_langs(self, lang):
        if lang == "auto":
            self.auto = True
            return [l for l in ("en", "ar") if l in self.paths]
        return [lang]

    def feed(self, b64, lang):
        data = base64.b64decode(b64)
        for l in self.active_langs(lang):
            rec = self.ensure_rec(l)
            if rec.AcceptWaveform(data):
                res = json.loads(rec.Result())
                text = (res.get("text") or "").strip()
                if text:
                    self.emit_final(l, text, result_confidence(res))
            else:
                partial = (json.loads(rec.PartialResult()).get("partial") or "").strip()
                if partial:
                    send({"type": "partial", "lang": l, "text": partial})

    def flush(self):
        for l in list(self.recs.keys()):
            rec = self.recs[l]
            res = json.loads(rec.FinalResult())
            text = (res.get("text") or "").strip()
            if text:
                self.emit_final(l, text, result_confidence(res))
        self.reset()

    def emit_final(self, lang, text, conf):
        if self.auto and len(self.paths) > 1:
            # Auto mode: collect finals from every configured recognizer, then
            # emit the confidence winner (ties keep the previous winner).
            self.pending_finals[lang] = (text, conf)
            expected = set(self.paths.keys()) & set(self.models.keys())
            if set(self.pending_finals.keys()) >= expected:
                winner = max(expected,
                             key=lambda l: self.pending_finals.get(l, ("", -1))[1])
                wtext, wconf = self.pending_finals[winner]
                self.pending_finals = {}
                send({"type": "final", "lang": winner, "text": wtext,
                      "confidence": round(wconf, 3)})
        else:
            send({"type": "final", "lang": lang, "text": text,
                  "confidence": round(conf, 3)})

    def reset(self):
        self.recs = {}
        self.pending_finals = {}


def main():
    worker = SttWorker()
    send({"type": "ready", "models": []})
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
                worker.paths = msg.get("models") or {}
                send({"type": "ready", "models": sorted(worker.paths.keys())})
            elif mtype == "audio":
                worker.feed(msg["b64"], msg.get("lang", "en"))
            elif mtype == "flush":
                worker.flush()
            elif mtype == "reset":
                worker.reset()
            elif mtype == "stop":
                break
        except Exception as exc:  # noqa: BLE001 — worker must never die mid-utterance
            send({"type": "error", "message": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
