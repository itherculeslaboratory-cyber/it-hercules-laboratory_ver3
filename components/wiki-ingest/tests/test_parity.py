"""CI-safe parity guard for the ruri-v3-70m backends.

`pytest -q` at repo root must stay green WITHOUT torch/onnxruntime (they live only
in the component venv). So this skips cleanly when the parity deps or models are
absent, and only asserts the real PyTorch==ONNX cosine>=0.999 when they are present
(i.e. when run inside components/wiki-ingest/.venv). The verbatim evidence run is
parity_check.py -> docs/planning/c3/ruri-parity-evidence.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

pytest.importorskip("onnxruntime", reason="parity deps not installed (component venv only)")
pytest.importorskip("sentence_transformers", reason="parity deps not installed (component venv only)")

from backends import RURI_DIM, RuriOnnxBackend, RuriPytorchBackend  # noqa: E402

INPUTS = [
    "ニホンミツバチの巣箱は夏場に温度が上がりやすい。",
    "石英はモース硬度7の鉱物である。",
    "個体識別のQRトークンは現物ラベルに使う。",
    "The observation ladder runs whitelist then subset then embedding.",
    "苔",
]


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


@pytest.fixture(scope="module")
def backends():
    try:
        return RuriPytorchBackend(), RuriOnnxBackend()
    except Exception as exc:  # model download blocked / offline -> skip, don't fail CI
        pytest.skip(f"ruri models unavailable: {exc}")


def test_dim_is_384(backends):
    pt, ox = backends
    assert pt.embedding_dim == ox.embedding_dim == RURI_DIM


def test_pytorch_onnx_cosine_agree(backends):
    pt, ox = backends
    for text in INPUTS:
        vp, vo = pt.embed_text(text), ox.embed_text(text)
        assert vp.shape == (RURI_DIM,) == vo.shape
        assert _cos(vp, vo) >= 0.999, f"cosine below threshold for {text!r}"
