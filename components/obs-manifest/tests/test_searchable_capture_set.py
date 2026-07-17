"""V3-OBS-56 検索中核Parquet TC (design-k1 §2). polars is import-guarded — this
whole module SKIPS cleanly on a machine without polars installed (same
convention as components/wiki-ingest's torch/onnxruntime import-guard TC)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

pytest.importorskip("polars")

import polars as pl  # noqa: E402 — after importorskip, guaranteed present

_spec = importlib.util.spec_from_file_location(
    "obs_manifest_searchable_capture_set",
    Path(__file__).resolve().parent.parent / "searchable_capture_set.py",
)
scs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scs)

_run_spec = importlib.util.spec_from_file_location(
    "obs_manifest_run_for_scs_test", Path(__file__).resolve().parent.parent / "run.py"
)
run = importlib.util.module_from_spec(_run_spec)
_run_spec.loader.exec_module(run)


def test_columns_stay_in_sync_with_run_py():
    # scs.COLUMNS is a deliberate LOCAL copy (see module docstring) — this test
    # is the honesty check that the two never silently drift apart.
    assert scs.COLUMNS == list(run.SEARCHABLE_CAPTURE_SET_COLUMNS)


def test_build_dataframe_has_fixed_column_order_and_fills_missing_as_none():
    rows = [{"capture": "cap-1", "individual": "ind-1"}, {"capture": "cap-2", "color": {"L": 50}}]
    df = scs.build_searchable_capture_set(rows)
    assert df.columns == scs.COLUMNS
    assert df.height == 2
    assert df["capture"].to_list() == ["cap-1", "cap-2"]
    assert df["individual"].to_list() == ["ind-1", None]  # row 2 never mentioned it
    assert df["measurement"].to_list() == [None, None]


def test_write_snapshot_writes_parquet_and_pointer(tmp_path):
    rows = [{"capture": "cap-1"}, {"capture": "cap-2"}]
    pointer = scs.write_snapshot(rows, tmp_path, "snap-1")
    assert pointer["snapshot_id"] == "snap-1"
    assert pointer["row_count"] == 2
    assert pointer["columns"] == scs.COLUMNS

    parquet_path = tmp_path / pointer["path"]
    assert parquet_path.exists()
    reloaded = pl.read_parquet(parquet_path)
    assert reloaded.columns == scs.COLUMNS
    assert reloaded.height == 2

    latest = scs.read_latest_pointer(tmp_path)
    assert latest == pointer


def test_write_snapshot_same_id_twice_fails_no_overwrite(tmp_path):
    scs.write_snapshot([{"capture": "cap-1"}], tmp_path, "dup-snap")
    with pytest.raises(FileExistsError):
        scs.write_snapshot([{"capture": "cap-1"}], tmp_path, "dup-snap")


def test_latest_pointer_moves_to_the_newest_snapshot_without_deleting_the_old_one(tmp_path):
    p1 = scs.write_snapshot([{"capture": "cap-1"}], tmp_path, "snap-a")
    p2 = scs.write_snapshot([{"capture": "cap-1"}, {"capture": "cap-2"}], tmp_path, "snap-b")
    assert scs.read_latest_pointer(tmp_path) == p2  # pointer now points at snap-b
    # snap-a's own parquet file is untouched (append-only — no deletion).
    assert (tmp_path / p1["path"]).exists()


def test_read_latest_pointer_returns_none_before_any_snapshot(tmp_path):
    assert scs.read_latest_pointer(tmp_path) is None
