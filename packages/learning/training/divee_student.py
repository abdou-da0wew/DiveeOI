"""Divee query student: the lightweight encoder that replaces BGE-M3 at chat time.

Contract — every part of it is fixed because it must stay compatible with the vectors that
already live in books.db (BGE-M3, CLS pooled, L2 normalised, 1024 dimensions):

  * input ids are the **original BGE-M3/XLM-R ids**; the graph maps them to a pruned vocabulary
    through a `vocab_map` gather, so the runtime tokenizer is unchanged,
  * the graph outputs `last_hidden_state` [batch, sequence, 1024]; transformers.js applies CLS
    pooling and L2 normalisation exactly as it does for the teacher,
  * queries only (max 128 tokens). Passages are always embedded by the teacher during indexing.

Run `python smoke_test.py` for a CPU sanity check of this file, the export and the metrics.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F

# XLM-R special ids. Kept identical in the compact vocabulary so `vocab_map` never remaps them.
CLS_ID, PAD_ID, SEP_ID, UNK_ID = 0, 1, 2, 3
SPECIAL_IDS = (CLS_ID, PAD_ID, SEP_ID, UNK_ID)
OUT_DIM = 1024
MAX_LEN = 128


@dataclass
class StudentConfig:
    """Everything needed to rebuild the module. Serialised next to the checkpoint."""

    hidden: int = 512
    layers: int = 6
    heads: int = 8
    ffn: int = 2048
    max_len: int = MAX_LEN
    dropout: float = 0.1
    vocab_size: int = 0  # compact vocabulary size, filled from vocab.json

    def to_dict(self) -> dict:
        return asdict(self)


class QueryStudent(nn.Module):
    def __init__(self, vocab_map: torch.Tensor, config: StudentConfig):
        super().__init__()
        self.config = config
        self.register_buffer("vocab_map", vocab_map.to(torch.int64), persistent=True)
        self.tok = nn.Embedding(config.vocab_size, config.hidden, padding_idx=PAD_ID)
        self.pos = nn.Embedding(config.max_len, config.hidden)
        self.norm_in = nn.LayerNorm(config.hidden)
        layer = nn.TransformerEncoderLayer(
            config.hidden,
            config.heads,
            config.ffn,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, config.layers, enable_nested_tensor=False)
        self.norm_out = nn.LayerNorm(config.hidden)
        self.proj = nn.Linear(config.hidden, OUT_DIM)

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        ids = self.vocab_map[input_ids]
        # Queries longer than the trained window reuse the last position instead of failing.
        positions = torch.arange(ids.shape[1], device=ids.device).clamp(max=self.config.max_len - 1)
        x = self.norm_in(self.tok(ids) + self.pos(positions)[None, :, :])
        x = self.encoder(x, src_key_padding_mask=(attention_mask == 0))
        return self.proj(self.norm_out(x))

    def embed(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        """CLS pooling + L2 normalisation: the exact post-processing transformers.js applies.

        No `@torch.no_grad()` here: the training loop backpropagates through this method.
        Inference callers wrap it in `torch.no_grad()` themselves (train.py/eval.py do).
        """
        return F.normalize(self.forward(input_ids, attention_mask)[:, 0], dim=-1)


def distill_loss(
    student_q: torch.Tensor,
    teacher_q: torch.Tensor,
    candidates: torch.Tensor,
    positive_index: torch.Tensor,
    candidate_ids: torch.Tensor,
    positive_ids: torch.Tensor,
    temperature: float = 0.05,
    w_cos: float = 1.0,
    w_nce: float = 1.0,
    w_kl: float = 0.5,
) -> tuple[torch.Tensor, dict[str, float]]:
    """Vector imitation + ranking distillation.

    `student_q`/`teacher_q` are [B, D] L2-normalised; `candidates` is [C, D] of teacher passage
    vectors (positives, hard negatives, in-batch positives). `candidate_ids`/`positive_ids` identify
    chunks so another query's positive is not mistaken for a negative of this one.
    """
    cosine = (1.0 - (student_q * teacher_q).sum(-1)).mean()
    student_logits = student_q @ candidates.T / temperature
    teacher_logits = teacher_q @ candidates.T / temperature

    same_chunk = candidate_ids[None, :] == positive_ids[:, None]
    keep_positive = F.one_hot(positive_index, candidates.shape[0]).bool()
    masked = same_chunk & ~keep_positive
    student_logits = student_logits.masked_fill(masked, float("-inf"))
    teacher_logits = teacher_logits.masked_fill(masked, float("-inf"))

    nce = F.cross_entropy(student_logits, positive_index)
    kl = F.kl_div(
        F.log_softmax(student_logits, dim=-1),
        F.softmax(teacher_logits, dim=-1),
        reduction="batchmean",
    )
    loss = w_cos * cosine + w_nce * nce + w_kl * kl
    return loss, {"cos": float(cosine.detach()), "nce": float(nce.detach()), "kl": float(kl.detach())}


def build_vocab_map(kept_ids: list[int], original_vocab: int) -> torch.Tensor:
    """original id -> compact id. Anything pruned maps to <unk> (id 3)."""
    mapping = torch.full((original_vocab,), UNK_ID, dtype=torch.int64)
    for special in SPECIAL_IDS:
        mapping[special] = special
    next_id = len(SPECIAL_IDS)
    for token_id in kept_ids:
        if token_id in SPECIAL_IDS:
            continue
        mapping[token_id] = next_id
        next_id += 1
    return mapping


def export_onnx(model: QueryStudent, path: str, opset: int = 17) -> None:
    """Export with dynamic batch/sequence axes and the exact input names transformers.js feeds."""
    model.eval()
    ids = torch.tensor([[CLS_ID, 10, 11, SEP_ID, PAD_ID], [CLS_ID, 20, SEP_ID, PAD_ID, PAD_ID]])
    mask = (ids != PAD_ID).to(torch.int64)
    torch.onnx.export(
        model,
        (ids, mask),
        path,
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "last_hidden_state": {0: "batch", 1: "sequence"},
        },
        opset_version=opset,
        dynamo=False,
    )


def quantize_int8(source: str, destination: str) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(source, destination, weight_type=QuantType.QInt8)


def parameter_counts(model: QueryStudent) -> dict[str, int]:
    total = sum(p.numel() for p in model.parameters())
    embedding = model.tok.weight.numel() + model.pos.weight.numel()
    return {"total": total, "embedding": embedding, "non_embedding": total - embedding}
