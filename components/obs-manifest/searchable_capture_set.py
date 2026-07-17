#!/usr/bin/env python3
"""searchable_capture_set.py — OBS-56 検索中核Parquet (design-k1 §2 / V3-OBS-56).

Materializes the searchable_capture_set — the Polars-joined batch of per-capture
rows in the FIXED column order — as snapshots/<snapshot_id>/
searchable_capture_set.parquet, then writes/updates a `latest.json` POINTER file
(append-only: a new snapshot is a NEW file, never an overwrite of an old one;
"latest" is a pointer, not the data — V3-OBS-56 "latestはpointer方式(上書き禁止)
・snapshot_idで版管理"). The actual JOIN of captures+thumbnail+embedding manifest
into these rows is the CALLER's job (a later wave, per-domain — this module owns
only the fixed column contract + snapshot/pointer discipline, mirroring
run.py's ITO manifest discipline for the embedding side).

COLUMNS below is a LOCAL, independent copy of run.py's
SEARCHABLE_CAPTURE_SET_COLUMNS (not imported — importing a sibling top-level
`run` module collides with components/collector-switchbot/run.py in the same
pytest session, see test_manifest.py's docstring). Kept honest by
test_searchable_capture_set.py asserting the two lists stay equal.

polars is an optional dependency (not stdlib, not installed by default on every
machine) — import-guarded the same way components/wiki-ingest guards torch/
onnxruntime, so a machine without polars still collects the rest of the pytest
suite; a caller without polars gets a clear ImportError naming the fix.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# OBS-56 fixed column order — kept identical to run.py's SEARCHABLE_CAPTURE_SET_COLUMNS.
COLUMNS = [
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


def _polars():
    try:
        import polars as pl
    except ImportError as exc:  # pragma: no cover - exercised only where polars is absent
        raise RuntimeError(
            "searchable_capture_set needs polars: pip install polars"
        ) from exc
    return pl


def build_searchable_capture_set(rows: list[dict[str, Any]]):
    """Join-result rows (already shaped by the caller, one dict per capture) ->
    a Polars DataFrame with EXACTLY the fixed column order. A row missing a
    column gets an explicit None for that column (Polars fills it) rather than
    silently reordering or dropping columns — the fixed order is the contract."""
    pl = _polars()
    normalized = [{col: row.get(col) for col in COLUMNS} for row in rows]
    return pl.DataFrame(normalized, schema=COLUMNS, orient="row")


def write_snapshot(
    rows: list[dict[str, Any]],
    out_root: str | Path,
    snapshot_id: str,
) -> dict[str, Any]:
    """Write snapshots/<snapshot_id>/searchable_capture_set.parquet (fails if the
    snapshot dir already exists — append-only, no overwrite, mirrors run.py's
    run_id discipline) and update latest.json to POINT at it (the pointer file
    itself IS allowed to be overwritten — it is a pointer, not Truth)."""
    out_root = Path(out_root)
    snap_dir = out_root / "snapshots" / snapshot_id
    if snap_dir.exists():
        raise FileExistsError(f"snapshot already exists: snapshot_id={snapshot_id!r}")
    snap_dir.mkdir(parents=True)

    df = build_searchable_capture_set(rows)
    parquet_path = snap_dir / "searchable_capture_set.parquet"
    df.write_parquet(parquet_path)

    pointer = {
        "snapshot_id": snapshot_id,
        "path": str(parquet_path.relative_to(out_root)),
        "row_count": len(rows),
        "columns": COLUMNS,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    (out_root / "latest.json").write_text(json.dumps(pointer, indent=2), encoding="utf-8")
    return pointer


def read_latest_pointer(out_root: str | Path) -> dict[str, Any] | None:
    """Read latest.json (None if no snapshot has been written yet)."""
    p = Path(out_root) / "latest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))
