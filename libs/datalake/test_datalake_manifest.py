"""V3-FND-03 — Parquet manifest write/search contract tests.

Covers: write_manifest -> search_manifest round trip, equality filters, cosine
ranking over query_vector (subset scan, no FAISS), and the
should_use_subset_cosine() threshold that documents the FAISS-promotion boundary.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import json  # noqa: E402

from manifest import (  # noqa: E402
    ALL_INDEX_ENTRY_COLUMNS,
    DEFAULT_MANIFEST_COLUMNS,
    RESEARCH_QUERY_COLUMNS,
    SUBSET_COSINE_MAX_ROWS,
    GenerationExistsError,
    WhitelistViolationError,
    generate_manifest_from_index_entries,
    load_index_entries,
    project_columns,
    read_latest_generation,
    search_manifest,
    should_use_subset_cosine,
    update_latest_pointer,
    write_generation_manifest,
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


# V3-FND-06 — generation-N immutable manifest + latest.json pointer-only update.
def test_write_generation_manifest_creates_generation_dir(tmp_path: Path) -> None:
    out = write_generation_manifest(_rows(), tmp_path, 1)
    assert out.exists()
    assert out.parent.name == "generation-1"


def test_write_generation_manifest_rejects_overwrite_of_existing_generation(tmp_path: Path) -> None:
    write_generation_manifest(_rows(), tmp_path, 1)
    try:
        write_generation_manifest(_rows(), tmp_path, 1)
        assert False, "expected GenerationExistsError"
    except GenerationExistsError:
        pass


def test_latest_pointer_updates_without_touching_generation_files(tmp_path: Path) -> None:
    write_generation_manifest(_rows(), tmp_path, 1)
    write_generation_manifest(_rows(), tmp_path, 2)
    update_latest_pointer(tmp_path, 1)
    assert read_latest_generation(tmp_path) == 1
    # pointer が古い世代を指したまま — generation-2 の中身には触れていない(履歴保持)
    update_latest_pointer(tmp_path, 2)
    assert read_latest_generation(tmp_path) == 2
    # generation-1 のファイルは無傷のまま参照可能(過去 worldSnapshot 再現性)
    got = search_manifest(tmp_path / "generation-1" / "manifest.parquet")
    assert {r["capture_id"] for r in got} == {"c1", "c2", "c3"}


def test_read_latest_generation_returns_none_when_unset(tmp_path: Path) -> None:
    assert read_latest_generation(tmp_path) is None


# --- F1(g79-f1manifest): search_manifest() 列ホワイトリスト是正 -----------------------


def test_search_allows_filter_on_column_that_actually_exists_in_manifest(tmp_path: Path) -> None:
    # allowed_columns 省略時は manifest ファイルの実スキーマから動的に許可集合を作る
    # (write_manifest() の汎用呼び出し元 — IndexEntry と無関係な任意スキーマ — を壊さない)。
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    got = search_manifest(p, filters={"species": "hercules"})
    assert {r["capture_id"] for r in got} == {"c1", "c2"}


def test_search_rejects_filter_on_column_absent_from_manifest_schema(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)
    try:
        search_manifest(p, filters={"actor_id": "not-a-real-column"})
        assert False, "expected WhitelistViolationError"
    except WhitelistViolationError as e:
        assert "WHITELIST_VIOLATION" in str(e)


def test_search_rejects_filter_outside_explicit_allowed_columns(tmp_path: Path) -> None:
    # RESEARCH_QUERY_COLUMNS(F2 研究者モードが渡す想定の固定集合)を明示すると、
    # manifest に実在する列であってもホワイトリスト外なら拒否される。
    p = tmp_path / "manifest.parquet"
    write_manifest(_rows(), p)  # capture_id/species/embedding — RESEARCH_QUERY_COLUMNS に無い
    try:
        search_manifest(p, filters={"species": "hercules"}, allowed_columns=RESEARCH_QUERY_COLUMNS)
        assert False, "expected WhitelistViolationError"
    except WhitelistViolationError as e:
        assert "WHITELIST_VIOLATION" in str(e)


def test_search_allows_filter_within_explicit_allowed_columns(tmp_path: Path) -> None:
    p = tmp_path / "manifest.parquet"
    write_manifest([{"type": "obs.capture", "subject": "s1"}, {"type": "obs.capture", "subject": "s2"}], p)
    got = search_manifest(p, filters={"type": "obs.capture"}, allowed_columns=RESEARCH_QUERY_COLUMNS)
    assert {r["subject"] for r in got} == {"s1", "s2"}


# --- F1(g79-f1manifest): IndexEntry -> manifest.parquet 生成器 ------------------------


def _index_entry(event_id: str, actor_id: str | None, text_repr: str | None) -> dict:
    # packages/truth/src/index-entry.ts IndexEntry の全フィールド(2026-08-01時点)。
    return {
        "event_id": event_id,
        "type": "ihl.obs.capture.v1",
        "subject": f"subj-{event_id}",
        "actor_id": actor_id,
        "payload_key": f"truth/ihl.obs.capture.v1/{event_id}.json",
        "payload_bytes": 1234,
        "event_hash": f"hash-{event_id}",
        "received_at": "2026-08-01T00:00:00.000Z",
        "claimed_at": None,
        "sig_alg": None,
        "key_id": None,
        "sig": None,
        "signed_bytes_sha256": None,
        "sig_verified": None,
        "text_repr": text_repr,
        "text_repr_v": 1,
    }


def _write_index_receipt_fixture(root: Path) -> None:
    # index/receipt/<date>/<received_at_ms>-<event_id>.json のローカルミラー
    # (index-entry.ts indexKeyFor() と同じレイアウト。実 R2 には接続していない)。
    day_dir = root / "index" / "receipt" / "2026-08-01"
    day_dir.mkdir(parents=True)
    for i, (actor, text) in enumerate([("user-1", "[capture] type=x subject=s1"), ("user-2", None)]):
        entry = _index_entry(f"evt-{i}", actor, text)
        (day_dir / f"175400000{i}-evt-{i}.json").write_text(json.dumps(entry), encoding="utf-8")


def test_load_index_entries_reads_nested_date_dirs(tmp_path: Path) -> None:
    _write_index_receipt_fixture(tmp_path)
    entries = load_index_entries(tmp_path / "index" / "receipt")
    assert {e["event_id"] for e in entries} == {"evt-0", "evt-1"}


def test_load_index_entries_returns_empty_for_missing_dir(tmp_path: Path) -> None:
    assert load_index_entries(tmp_path / "does-not-exist") == []


def test_project_columns_defaults_exclude_actor_id() -> None:
    # 既定は保守側(カード B3-A 未裁定の間は人物系フィールドを含めない)。
    assert "actor_id" not in DEFAULT_MANIFEST_COLUMNS
    assert DEFAULT_MANIFEST_COLUMNS == ALL_INDEX_ENTRY_COLUMNS - {"actor_id"}
    projected = project_columns([_index_entry("evt-0", "user-1", None)])
    assert "actor_id" not in projected[0]
    assert projected[0]["event_id"] == "evt-0"


def test_project_columns_can_include_actor_id_when_explicitly_requested() -> None:
    projected = project_columns([_index_entry("evt-0", "user-1", None)], columns=ALL_INDEX_ENTRY_COLUMNS)
    assert projected[0]["actor_id"] == "user-1"


def test_project_columns_rejects_unknown_column() -> None:
    try:
        project_columns([_index_entry("evt-0", "user-1", None)], columns={"not_a_real_field"})
        assert False, "expected ValueError"
    except ValueError as e:
        assert "not_a_real_field" in str(e)


def test_generate_manifest_from_index_entries_round_trip(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _write_index_receipt_fixture(src)
    base_dir = tmp_path / "manifests" / "ihl-index"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)

    assert out.exists()
    assert out.parent.name == "generation-1"
    assert read_latest_generation(base_dir) == 1

    got = search_manifest(out)
    assert {r["event_id"] for r in got} == {"evt-0", "evt-1"}
    # 既定は actor_id を落とす(保守側の既定)。
    assert all("actor_id" not in r for r in got)


def test_generate_manifest_from_index_entries_rejects_regenerating_same_generation(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _write_index_receipt_fixture(src)
    base_dir = tmp_path / "manifests" / "ihl-index"

    generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    try:
        generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
        assert False, "expected GenerationExistsError"
    except GenerationExistsError:
        pass


def test_generate_manifest_from_index_entries_can_include_actor_id_when_requested(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _write_index_receipt_fixture(src)
    base_dir = tmp_path / "manifests" / "ihl-index"

    out = generate_manifest_from_index_entries(
        src / "index" / "receipt", base_dir, 1, columns=ALL_INDEX_ENTRY_COLUMNS
    )
    got = search_manifest(out)
    assert {r["actor_id"] for r in got} == {"user-1", "user-2"}
