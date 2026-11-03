"""BGE-M3 teacher wrapper: offline query/passage embeddings for distillation and evaluation.

BGE-M3 (XLM-RoBERTa, 1024-d) already covers 100+ languages including Arabic, so there is no
separate "Arabic BGE-M3": the same teacher serves both languages and the cross-lingual pairs.

Two caveats that matter for quality:

* Indexed passage vectors were produced by the **int8 ONNX** copy of this model (Xenova/bge-m3).
  Distillation targets come from the fp32 checkpoint (`BAAI/bge-m3`), which is slightly better.
  Always *evaluate* against the vectors stored in books.db (that is what chat compares against),
  which is what `eval.py` does.
* Query and passage embeddings are CLS pooled and L2 normalised. Changing either invalidates the
  contract with the index (see `divee_student.py`).
"""

from __future__ import annotations

import base64

import numpy as np

QUERY_MAX_LENGTH = 128
PASSAGE_MAX_LENGTH = 512


def encode_base64(vector: np.ndarray) -> str:
    return base64.b64encode(np.asarray(vector, dtype="<f4").tobytes()).decode("ascii")


def decode_base64(text: str) -> np.ndarray:
    raw = base64.b64decode(text)
    return np.frombuffer(raw, dtype="<f4").astype(np.float32)


class Teacher:
    def __init__(self, repo: str = "BAAI/bge-m3", device: str | None = None, dtype: str = "float32"):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = getattr(torch, dtype)
        self.tokenizer = AutoTokenizer.from_pretrained(repo)
        self.model = AutoModel.from_pretrained(repo, torch_dtype=self.dtype).to(self.device).eval()
        self.repo = repo

    @property
    def dims(self) -> int:
        return int(self.model.config.hidden_size)

    def embed(self, texts: list[str], batch_size: int = 16, max_length: int = QUERY_MAX_LENGTH) -> np.ndarray:
        """CLS pooled, L2 normalised float32 [len(texts), 1024]."""
        import torch

        chunks: list[np.ndarray] = []
        with torch.no_grad():
            for start in range(0, len(texts), batch_size):
                batch = texts[start : start + batch_size]
                encoded = self.tokenizer(
                    batch,
                    padding=True,
                    truncation=True,
                    max_length=max_length,
                    return_tensors="pt",
                ).to(self.device)
                hidden = self.model(**encoded).last_hidden_state[:, 0]
                hidden = torch.nn.functional.normalize(hidden.float(), dim=-1)
                chunks.append(hidden.cpu().numpy().astype(np.float32))
        if not chunks:
            return np.zeros((0, self.dims), dtype=np.float32)
        return np.concatenate(chunks, axis=0)
