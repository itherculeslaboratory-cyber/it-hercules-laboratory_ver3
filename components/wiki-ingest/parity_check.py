"""Prove ruri-v3-70m PyTorch and ONNX backends agree (C3 §4 acceptance ii).

Embeds >=5 inputs on both paths and reports per-input cosine similarity. Passes
when every cosine >= 0.999. Prints a verbatim, copy-pasteable log for
docs/planning/c3/ruri-parity-evidence.md.

Run (inside component venv, after requirements-parity.txt):
    components/wiki-ingest/.venv/Scripts/python.exe components/wiki-ingest/parity_check.py
"""

from __future__ import annotations

import platform
import sys
import time

import numpy as np

from backends import RuriOnnxBackend, RuriPytorchBackend

# >=5 inputs: JA wiki-ish sentences + one EN + one short, exercising the tokenizer.
INPUTS = [
    "ニホンミツバチの巣箱は夏場に温度が上がりやすいため風通しを確保する。",
    "石英は六方晶系の鉱物で、モース硬度は7である。",
    "個体識別のためのQRトークンは現物ラベルとして印刷して使う。",
    "The observation ladder runs whitelist, then subset, then embedding.",
    "苔",
    "堆肥の切り返しは発酵温度が60度を超えたら行うと良い。",
]

THRESHOLD = 0.999


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = a.reshape(-1)
    b = b.reshape(-1)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def main() -> int:
    # Windows console defaults to cp932; force UTF-8 so JA inputs print.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    print("# ruri-v3-70m PyTorch vs ONNX parity — verbatim run log")
    print(f"# timestamp: {time.strftime('%Y-%m-%dT%H:%M:%S%z')}")
    print(f"# python: {sys.version.split()[0]} / {platform.platform()}")
    for mod in ("torch", "onnxruntime", "transformers", "sentence_transformers", "numpy"):
        try:
            v = __import__(mod).__version__
        except Exception as exc:  # noqa: BLE001
            v = f"<import failed: {exc}>"
        print(f"# {mod}: {v}")

    print("\n## loading backends")
    t0 = time.time()
    pt = RuriPytorchBackend()
    print(f"pytorch backend loaded in {time.time() - t0:.1f}s -> {pt.model_name} dim={pt.embedding_dim}")
    t0 = time.time()
    ox = RuriOnnxBackend()
    print(f"onnx    backend loaded in {time.time() - t0:.1f}s -> {ox.model_name} dim={ox.embedding_dim}")

    print("\n## per-input cosine (pytorch vs onnx)")
    cosines: list[float] = []
    for i, text in enumerate(INPUTS):
        vp = pt.embed_text(text)
        vo = ox.embed_text(text)
        assert vp.shape == (pt.embedding_dim,) == vo.shape, (vp.shape, vo.shape)
        c = cosine(vp, vo)
        cosines.append(c)
        print(f"[{i}] cos={c:.6f}  norm_pt={np.linalg.norm(vp):.4f} norm_onnx={np.linalg.norm(vo):.4f}  | {text[:40]}")

    worst = min(cosines)
    mean = sum(cosines) / len(cosines)
    ok = worst >= THRESHOLD
    print(f"\n## result: n={len(cosines)} worst={worst:.6f} mean={mean:.6f} threshold={THRESHOLD}")
    print("VERDICT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
