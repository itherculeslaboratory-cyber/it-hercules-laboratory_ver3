#!/usr/bin/env python3
"""obs-manifest — ITO embedding manifest runner (design-k1 §2 / V3-OBS-08/09/56).

Contract slice, not the heavy pipeline. It takes a list of image inputs and runs
the Input->Transform->Output (ITO) manifest discipline:

  * input_manifest.json  — every input row (image_id + sha256 + size)
  * output_manifest.json — REQUIRED, always written: the embedding rows produced
  * run_info.json        — run_id / backend / dim / counts / timestamp
  * errors.jsonl         — one JSON line per FAILED row (a bad row does NOT abort
                           the run — it is logged and the loop continues)
  * a same run_id whose output dir already exists FAILS (no overwrite — mirrors
    the append-only / INSERT-ONLY invariant)

Embedding backend (OBS-09) is pluggable via IHL_EMBEDDING_BACKEND, unified behind
the SAME EmbeddingBackend Protocol shape as components/wiki-ingest/backends.py
(model_name / embedding_dim / embed_*·2ローディングパスの資産を画像側にも展開):
  * "dummy" (default): sha256(image_bytes) -> seeds a normal RNG -> 384-dim vector
    -> L2-normalized. Deterministic (same bytes -> same vector), no NaN, no network,
    no torch. This is the default so CI and the 10-year-cost floor hold (invariant ①).
  * "dinov2": real DINOv2 (dinov2_vits14 / 384 / L2) on torch/GPU — a LATER WAVE,
    OFF by default (V3-CST-01 従量課金回避). Selecting it here raises until wired.

Each derived artifact (an output row) carries run_id/schema_version/input_hash/
provenance (design-k1 §2 ITO contract) so a downstream consumer can trace which
run/backend produced it without re-deriving from the embedding blob alone.

色ヒスト/透明感/黒割合(OBS-09 "併算") ride alongside the embedding vector via
analyze_color(). ponytail: like embed_dummy, the DEFAULT path derives these
deterministically from the raw byte hash — NOT real pixel decoding (that needs
Pillow/numpy image decode, a later wave; real values come from the client-side
capture-time analysis, V3-OBS-47/V3-AIP-104 — the server accepts those via the
existing measurements value_origin="image_derived" contract). This keeps the
placeholder/real distinction as honest here as it already is for embed_dummy vs.
_embed_dinov2 — same ceiling, same upgrade path.

The searchable_capture_set fixed column order (OBS-56) is defined as a constant
here; the real Polars join batch is implemented in searchable_capture_set.py.

ponytail: embeddings are written as one JSON file per image, not a packed .bin —
the bin packing + Polars join is the batch wave; a JSON locator is enough for the
contract. Add bin packing when the row count makes per-file JSON measurably slow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

EMBEDDING_DIM = 384  # frozen (OBS-09/10 · mirrors observation-constants.ts)
MANIFEST_SCHEMA_VERSION = 1  # OBS-08: derived-artifact schema_version (this ITO contract shape)

# OBS-56: the searchable_capture_set fixed column order. The real Polars join
# batch that materializes these columns is a later wave (design §5). Keeping the
# order here as the single constant means the batch wave can't silently reorder.
SEARCHABLE_CAPTURE_SET_COLUMNS = [
    "capture",
    "individual",
    "measurement",  # 縦持ち (long form)
    "lineage",
    "life_event",
    "environment_timeseries",
    "embedding_manifest",
    "embedding_locator",
    "thumbnail",
    "qc",
    "color",
    "shape",
]


# ── embedding backends (OBS-09) ──────────────────────────────────────────────
def embed_dummy(image_bytes: bytes, dim: int = EMBEDDING_DIM) -> list[float]:
    """Deterministic dummy embedding: sha256 -> normal RNG -> L2-normalized vector.

    Same bytes always yield the same vector (seed = first 8 bytes of the digest).
    Guaranteed no NaN/Inf and unit L2 norm (the zero-norm case — astronomically
    unlikely from a Gaussian draw — is guarded to a valid unit vector).
    """
    seed = int.from_bytes(hashlib.sha256(image_bytes).digest()[:8], "big")
    rng = random.Random(seed)
    vec = [rng.gauss(0.0, 1.0) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0.0 or not math.isfinite(norm):
        vec = [0.0] * dim
        vec[0] = 1.0
        norm = 1.0
    return [x / norm for x in vec]


def _embed_dinov2(image_bytes: bytes, dim: int = EMBEDDING_DIM) -> list[float]:
    # Later wave (design §5 費用 defer): torch/GPU DINOv2 dinov2_vits14. OFF by
    # default so the cost floor holds; wiring it is a deliberate promote.
    raise RuntimeError(
        "dinov2 backend is a later wave (torch/GPU, OFF by default). "
        "Set IHL_EMBEDDING_BACKEND=dummy for the deterministic contract slice."
    )


def get_backend(name: str | None = None) -> Callable[[bytes, int], list[float]]:
    name = name or os.environ.get("IHL_EMBEDDING_BACKEND", "dummy")
    if name == "dummy":
        return embed_dummy
    if name == "dinov2":
        return _embed_dinov2
    raise ValueError(f"unknown embedding backend: {name!r}")


# ── OBS-09 EmbeddingBackend Protocol (一本化) ─────────────────────────────────
# Same shape as components/wiki-ingest/backends.py's EmbeddingBackend Protocol
# (model_name / embedding_dim / embed_*), so the image side and the text side
# read as one convention rather than two ad-hoc ones. embed_dummy/_embed_dinov2
# above stay the raw functions (existing TC calls them directly); these classes
# are a thin, additive wrapper for callers that want the typed Protocol shape.
class EmbeddingBackend(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def embedding_dim(self) -> int: ...

    def embed_image(self, image_bytes: bytes) -> list[float]: ...


class DummyImageBackend:
    """Wraps embed_dummy — deterministic, no network, no torch (default)."""

    def __init__(self, dim: int = EMBEDDING_DIM) -> None:
        self._dim = dim

    @property
    def model_name(self) -> str:
        return "dummy-sha256-rng"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    def embed_image(self, image_bytes: bytes) -> list[float]:
        return embed_dummy(image_bytes, self._dim)


class Dinov2ImageBackend:
    """Wraps _embed_dinov2 — later wave (torch/GPU), OFF by default."""

    def __init__(self, dim: int = EMBEDDING_DIM) -> None:
        self._dim = dim

    @property
    def model_name(self) -> str:
        return "dinov2_vits14"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    def embed_image(self, image_bytes: bytes) -> list[float]:
        return _embed_dinov2(image_bytes, self._dim)


def resolve_image_backend(name: str | None = None, dim: int = EMBEDDING_DIM) -> EmbeddingBackend:
    """Select an EmbeddingBackend instance (Protocol-typed). Default OFF-by-torch:
    unset/unknown falls back to the dummy contract slice, never silently to a
    heavy backend (invariant ① — LLM/Vision/embedding heavy paths default OFF)."""
    name = (name or os.environ.get("IHL_EMBEDDING_BACKEND", "dummy")).strip().lower()
    if name == "dinov2":
        return Dinov2ImageBackend(dim)
    return DummyImageBackend(dim)


# ── OBS-09 併算: 色ヒスト/透明感/黒割合 ───────────────────────────────────────
def analyze_color(image_bytes: bytes) -> dict[str, Any]:
    """Deterministic placeholder color analysis riding alongside the embedding
    (OBS-09 "併算"). Same honesty contract as embed_dummy: derives from the raw
    byte hash, NOT real pixel decoding (that needs a Pillow/numpy image-decode
    backend — a later wave, same upgrade path as _embed_dinov2). Real per-pixel
    values come from the client-side capture-time analysis (V3-OBS-47/
    V3-AIP-104); the server accepts those separately via the existing
    measurements value_origin="image_derived" contract — this function only
    guarantees the CI-safe default shape is always populated.

    Returns a fixed 8-bucket histogram (fractions summing to 1.0) + transparency
    + black_ratio, all in [0, 1].
    """
    digest = hashlib.sha256(image_bytes).digest()
    buckets = [b / 255.0 for b in digest[:8]]
    total = sum(buckets) or 1.0
    histogram = [b / total for b in buckets]
    transparency = digest[8] / 255.0
    black_ratio = digest[9] / 255.0
    return {"histogram": histogram, "transparency": transparency, "black_ratio": black_ratio}


# ── input loading ────────────────────────────────────────────────────────────
def _load_bytes(item: dict[str, Any]) -> bytes:
    b = item.get("bytes")
    if b is not None:
        return b if isinstance(b, bytes) else bytes(b)
    path = item.get("path")
    if path:
        return Path(path).read_bytes()
    raise ValueError("input item has neither 'bytes' nor 'path'")


# ── ITO run ──────────────────────────────────────────────────────────────────
def run_manifest(
    inputs: Iterable[dict[str, Any]],
    out_root: str | Path,
    run_id: str,
    *,
    backend: str | Callable[[bytes, int], list[float]] | None = None,
    dim: int = EMBEDDING_DIM,
) -> dict[str, Any]:
    """Run the ITO manifest over `inputs`, writing artifacts under out_root/run_id.

    A row that fails to load/embed is appended to errors.jsonl and skipped (the
    run continues). output_manifest.json is ALWAYS written. Re-running with a
    run_id whose output dir already exists raises FileExistsError (no overwrite).
    """
    out_dir = Path(out_root) / run_id
    if out_dir.exists():
        raise FileExistsError(f"output dir already exists for run_id={run_id!r}: {out_dir}")
    emb_dir = out_dir / "embeddings"
    emb_dir.mkdir(parents=True)

    embed = backend if callable(backend) else get_backend(backend)
    inputs = list(inputs)

    input_rows: list[dict[str, Any]] = []
    output_rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for idx, item in enumerate(inputs):
        image_id = str(item.get("image_id", f"row-{idx}"))
        try:
            data = _load_bytes(item)
            sha = hashlib.sha256(data).hexdigest()
            input_rows.append({"index": idx, "image_id": image_id, "sha256": sha, "size_bytes": len(data)})
            vec = embed(data, dim)
            if len(vec) != dim or any(not math.isfinite(x) for x in vec):
                raise ValueError(f"backend returned invalid vector (len={len(vec)})")
            color = analyze_color(data)  # OBS-09 併算: 色ヒスト/透明感/黒割合
            emb_file = f"embeddings/{image_id}.json"
            (out_dir / emb_file).write_text(
                json.dumps({"image_id": image_id, "embedding_dim": dim, "vector": vec, "color": color}),
                encoding="utf-8",
            )
            # OBS-08: every derived artifact carries run_id/schema_version/
            # input_hash/provenance (design-k1 §2 ITO contract).
            output_rows.append({
                "image_id": image_id,
                "embedding_dim": dim,
                "embedding_file": emb_file,
                "sha256": sha,
                "run_id": run_id,
                "schema_version": MANIFEST_SCHEMA_VERSION,
                "input_hash": sha,
                "provenance": {"generator_kind": "agent", "agent_name": "obs-manifest"},
                "color": color,
            })
        except Exception as exc:  # noqa: BLE001 — a bad row must not abort the run
            errors.append({"index": idx, "image_id": image_id, "error": f"{type(exc).__name__}: {exc}"})

    backend_name = backend if isinstance(backend, str) else (
        "callable" if callable(backend) else os.environ.get("IHL_EMBEDDING_BACKEND", "dummy")
    )
    (out_dir / "input_manifest.json").write_text(json.dumps(input_rows, indent=2), encoding="utf-8")
    # output_manifest is REQUIRED — always emitted, even when every row failed.
    output_manifest = {"run_id": run_id, "embedding_dim": dim, "count": len(output_rows), "rows": output_rows}
    (out_dir / "output_manifest.json").write_text(json.dumps(output_manifest, indent=2), encoding="utf-8")
    # run-level input_hash: aggregate of every input row's sha256 (order-stable —
    # sorted so row processing order never changes the run's own fingerprint).
    run_input_hash = hashlib.sha256("".join(sorted(r["sha256"] for r in input_rows)).encode("ascii")).hexdigest()
    run_info = {
        "run_id": run_id,
        "backend": backend_name,
        "embedding_dim": dim,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "input_hash": run_input_hash,
        "n_input": len(inputs),
        "n_ok": len(output_rows),
        "n_error": len(errors),
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    (out_dir / "run_info.json").write_text(json.dumps(run_info, indent=2), encoding="utf-8")
    with (out_dir / "errors.jsonl").open("w", encoding="utf-8") as fh:
        for e in errors:
            fh.write(json.dumps(e) + "\n")

    return {"out_dir": str(out_dir), "run_info": run_info, "output_manifest": output_manifest}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="obs-manifest ITO embedding runner (contract slice)")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--out-root", default="out")
    ap.add_argument("--inputs", required=True, help="JSON file: list of {image_id, path}")
    ap.add_argument("--backend", default=None, help="dummy (default) | dinov2 (later wave)")
    args = ap.parse_args(argv)

    inputs = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    result = run_manifest(inputs, args.out_root, args.run_id, backend=args.backend)
    info = result["run_info"]
    print(f"[obs-manifest] run_id={info['run_id']} ok={info['n_ok']} error={info['n_error']} -> {result['out_dir']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
