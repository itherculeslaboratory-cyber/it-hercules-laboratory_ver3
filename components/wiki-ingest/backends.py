"""Text embedding backends for wiki-ingest — ruri-v3-70m (384-dim, local, API cost zero).

Design ref: C3 §4 (design-c3.md) + b2/research-wiki-integration-v1.md §1-1.
Two loading paths for the SAME model, so parity can be proven byte-for-byte:

  * ``RuriPytorchBackend``  — sentence-transformers (PyTorch) reference.
  * ``RuriOnnxBackend``     — onnxruntime, Python-optional runtime (Node/Rust/browser
                              can run the same .onnx).

Both implement the ver2 ``EmbeddingBackend`` shape (embed_text -> L2-normalized
float32 vector of ``embedding_dim``). Neither is imported at CI time: torch /
onnxruntime live only in the component venv (see requirements-parity.txt). The
router keeps the model OFF by default (5 不変条項① — LLM/Vision/FAISS default OFF).

Prefix: ruri-v3 requires a 1+3 prefix ("検索文書: " for documents, "検索クエリ: "
for queries). Applied identically on both paths so parity measures the model, not
the prefix. See research §5 risk 2.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Protocol

import numpy as np

RURI_MODEL_ID = "cl-nagoya/ruri-v3-70m"
RURI_ONNX_REPO = "sirasagi62/ruri-v3-70m-ONNX"
RURI_DIM = 384
# ruri-v3 document prefix (research §1-1 / model card). Query side = "検索クエリ: ".
DOC_PREFIX = "検索文書: "


class EmbeddingBackend(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def embedding_dim(self) -> int: ...

    def embed_text(self, text: str) -> np.ndarray: ...


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    vec = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    return vec.astype(np.float32)


def _mean_pool(last_hidden: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    """Attention-masked mean pooling — matches sentence-transformers default Pooling."""
    mask = attention_mask.astype(np.float32)[..., None]  # (batch, seq, 1)
    summed = (last_hidden * mask).sum(axis=1)
    counts = np.clip(mask.sum(axis=1), 1e-9, None)
    return summed / counts


class RuriPytorchBackend:
    """sentence-transformers reference. Needs ``pip install -r requirements-parity.txt``."""

    def __init__(self, *, model_id: str = RURI_MODEL_ID, prefix: str = DOC_PREFIX) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover - exercised when parity deps missing
            raise RuntimeError(
                "ruri pytorch backend needs: pip install -r requirements-parity.txt"
            ) from exc
        self._prefix = prefix
        self._model = SentenceTransformer(model_id, device="cpu")

    @property
    def model_name(self) -> str:
        return f"{RURI_MODEL_ID}#pytorch"

    @property
    def embedding_dim(self) -> int:
        return RURI_DIM

    def embed_text(self, text: str) -> np.ndarray:
        # sentence-transformers applies its own mean pooling + normalize.
        vec = self._model.encode(
            self._prefix + text, normalize_embeddings=True, convert_to_numpy=True
        )
        return _l2_normalize(vec)


class RuriOnnxBackend:
    """onnxruntime path. Needs onnxruntime + transformers tokenizer (parity reqs)."""

    def __init__(
        self,
        *,
        model_id: str = RURI_MODEL_ID,
        onnx_repo: str = RURI_ONNX_REPO,
        onnx_file: str = "onnx/model.onnx",
        prefix: str = DOC_PREFIX,
    ) -> None:
        try:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download
            from transformers import AutoTokenizer
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "ruri onnx backend needs: pip install -r requirements-parity.txt"
            ) from exc
        self._prefix = prefix
        # Tokenizer comes from the original repo (SentencePiece, no fugashi).
        self._tok = AutoTokenizer.from_pretrained(model_id)
        model_path = hf_hub_download(repo_id=onnx_repo, filename=onnx_file)
        self._sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self._input_names = {i.name for i in self._sess.get_inputs()}

    @property
    def model_name(self) -> str:
        return f"{RURI_MODEL_ID}#onnx"

    @property
    def embedding_dim(self) -> int:
        return RURI_DIM

    def embed_text(self, text: str) -> np.ndarray:
        enc = self._tok(
            self._prefix + text, return_tensors="np", padding=True, truncation=True
        )
        feeds = {k: v for k, v in enc.items() if k in self._input_names}
        outputs = self._sess.run(None, feeds)
        arr = np.asarray(outputs[0], dtype=np.float32)
        if arr.ndim == 3:  # (batch, seq, dim) -> mean pool with mask
            arr = _mean_pool(arr, np.asarray(enc["attention_mask"]))
        # arr now (batch, dim); single input -> row 0.
        return _l2_normalize(arr[0])


@lru_cache(maxsize=2)
def resolve_backend(name: str | None = None) -> EmbeddingBackend:
    """Select backend. Default OFF: raises unless explicitly asked (不変条項①)."""
    name = (name or os.environ.get("IHL_WIKI_BACKEND", "")).strip().lower()
    if name in ("ruri-onnx", "onnx"):
        return RuriOnnxBackend()
    if name in ("ruri-pytorch", "pytorch", "torch"):
        return RuriPytorchBackend()
    raise ValueError(
        f"wiki embedding backend is OFF by default; set one of ruri-onnx|ruri-pytorch (got {name!r})"
    )
