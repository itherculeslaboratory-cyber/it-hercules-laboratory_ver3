"""V3-FND-03 — Parquet manifest write/search contract tests.

Covers: write_manifest -> search_manifest round trip, equality filters, cosine
ranking over query_vector (subset scan, no FAISS), and the
should_use_subset_cosine() threshold that documents the FAISS-promotion boundary.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from manifest import (  # noqa: E402
    SUBSET_COSINE_MAX_ROWS,
    search_manifest,
    should_use_subset_cosine,
    write_manifest,
)


def _rows() -> list[dict]:
    return [
        {"capture_id": "c1", "species": "hercules", "embedding": [1.0, 0.0, 0.0]},
        {"capture_id": "c2", "species": "hercules", "embedding": [0.0, 1.0, 0.0]},
        {"capture_id": "c3", "species": "atlas", "embedding": [0.9, 0.1, 0.0]},
    ]


def test_write_then_search_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    assert p.exists()

    got = search_manifest(p)
    assert {r["capture_id"] for r in got} == {"c1", "c2", "c3"}


def test_search_missing_manifest_returns_empty_not_error(tmp_path: Path) -> None:
    assert search_manifest(tmp_path / "does-not-exist.parquet") == []


def test_equality_filter(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    got = search_manifest(p, filters={"species": "hercules"})
    assert {r["capture_id"] for r in got} == {"c1", "c2"}


def test_query_vector_cosine_ranking_subset_scan(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    # Query close to c1's axis -> c1 should rank first, c3 (close to c1) second,
    # c2 (orthogonal) last.
    got = search_manifest(p, query_vector=[1.0, 0.0, 0.0], top_k=3)
    assert [r["capture_id"] for r in got] == ["c1", "c3", "c2"]
    assert got[0]["_cosine_similarity"] == 1.0


def test_query_vector_respects_top_k(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    got = search_manifest(p, query_vector=[1.0, 0.0, 0.0], top_k=1)
    assert len(got) == 1
    assert got[0]["capture_id"] == "c1"


def test_should_use_subset_cosine_threshold() -> None:
    assert SUBSET_COSINE_MAX_ROWS == 10_000
    assert should_use_subset_cosine(1_000) is True
    assert should_use_subset_cosine(10_000) is True
    assert should_use_subset_cosine(10_001) is False
