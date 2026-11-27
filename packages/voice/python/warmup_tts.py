"""First-run bootstrap for supertonic-3: downloads ~400 MB of ONNX weights into
packages/voice/models/supertonic (SUPERTONIC_CACHE_DIR) and verifies EN + AR
synthesis end-to-end with RTF numbers printed.

Run: .venv/bin/python python/warmup_tts.py
"""
import os
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPERTONIC_CACHE_DIR", os.path.join(BASE, "models", "supertonic"))
os.environ.setdefault("SUPERTONIC_INTRA_OP_THREADS", "4")

import numpy as np  # noqa: E402
from supertonic import TTS  # noqa: E402


def as_scalar(v) -> float:
    arr = np.ravel(np.asarray(v))
    return float(arr[0]) if arr.size else 0.0


def main() -> int:
    t0 = time.time()
    tts = TTS(auto_download=True)
    style = tts.get_voice_style("M1")
    sr = tts.sample_rate
    print(f"MODEL-READY sample_rate={sr} load_s={time.time()-t0:.1f}", flush=True)

    cases = [
        ("en", "Photosynthesis is how plants turn sunlight into food."),
        ("ar", "البناء الضوئي هو كيفية تحويل النبات لأشعة الشمس إلى غذاء."),
    ]
    for lang, text in cases:
        t1 = time.time()
        wav, dur = tts.synthesize(text, style, lang=lang)
        wall = time.time() - t1
        audio_s = as_scalar(dur)
        rtf = wall / max(audio_s, 1e-6)
        print(
            f"SYNTH lang={lang} chars={len(text)} audio_s={audio_s:.2f} "
            f"wall_s={wall:.2f} rtf={rtf:.3f} sample_rate={sr}",
            flush=True,
        )
        tts.save_audio(wav, os.path.join("/tmp", f"tts-warmup-{lang}.wav"))
    print("TTS-WARMUP-OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
