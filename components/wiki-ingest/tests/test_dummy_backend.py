"""V3-WIK-03: 既定 dummy 決定論バックエンドの pytest。

torch/onnxruntime 不要(repo 直下の `pytest -q` で常に緑)。DummyBackend は
Protocol(EmbeddingBackend)を満たし、resolve_backend() の既定選択であることを
検証する。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backends import RURI_DIM, DummyBackend, resolve_backend  # noqa: E402


def test_dummy_backend_is_deterministic_and_normalized() -> None:
    b = DummyBackend()
    v1 = b.embed_text("温度と成長速度の相関")
    v2 = b.embed_text("温度と成長速度の相関")
    assert np.array_equal(v1, v2)  # 同じ入力は常に同じベクトル(決定論)
    assert v1.shape == (RURI_DIM,)
    assert abs(float(np.linalg.norm(v1)) - 1.0) < 1e-5  # L2 正規化


def test_dummy_backend_distinguishes_different_texts() -> None:
    b = DummyBackend()
    v1 = b.embed_text("ヘラクレスオオカブト")
    v2 = b.embed_text("完全に無関係などうでもいい文字列")
    assert not np.array_equal(v1, v2)


def test_resolve_backend_defaults_to_dummy_without_env_or_heavy_deps() -> None:
    resolve_backend.cache_clear()
    b = resolve_backend(None)
    assert isinstance(b, DummyBackend)
    assert b.model_name == "dummy-hash-bow#v1"


def test_resolve_backend_explicit_dummy_and_off_aliases() -> None:
    resolve_backend.cache_clear()
    assert isinstance(resolve_backend("dummy"), DummyBackend)
    resolve_backend.cache_clear()
    assert isinstance(resolve_backend("off"), DummyBackend)


def test_resolve_backend_rejects_unknown_name() -> None:
    resolve_backend.cache_clear()
    try:
        resolve_backend("not-a-real-backend")
        raised = False
    except ValueError:
        raised = True
    assert raised
