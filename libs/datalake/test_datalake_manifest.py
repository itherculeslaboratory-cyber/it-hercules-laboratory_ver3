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
from typing import Any  # noqa: E402

from manifest import (  # noqa: E402
    ALL_INDEX_ENTRY_COLUMNS,
    DEFAULT_MANIFEST_COLUMNS,
    RESEARCH_QUERY_COLUMNS,
    SUBSET_COSINE_MAX_ROWS,
    GenerationExistsError,
    WhitelistViolationError,
    filter_publicly_consented_rows,
    generate_manifest_from_index_entries,
    is_publicly_consented_row,
    load_index_entries,
    project_columns,
    read_latest_generation,
    read_latest_manifest_info,
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


def _index_entry(
    event_id: str,
    actor_id: str | None,
    text_repr: str | None,
    *,
    visibility: str | None = None,
    consent_l3: bool | None = None,
) -> dict:
    # packages/truth/src/index-entry.ts IndexEntry の全フィールド(2026-08-01時点)。
    # visibility/consent_l3 は g80-vis2(design R0801-7b17da §2-3隻1)で IndexEntry に
    # 追加される判定用の2列 — 省略時(None)はキー自体を持たない旧形式行を再現する
    # (隻1デプロイ前に書かれた索引エントリ。既定拒否フィルタが除外することを検証する)。
    entry: dict[str, Any] = {
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
    if visibility is not None:
        entry["visibility"] = visibility
    if consent_l3 is not None:
        entry["consent_l3"] = consent_l3
    return entry


def _write_index_receipt_fixture(root: Path) -> None:
    # index/receipt/<date>/<received_at_ms>-<event_id>.json のローカルミラー
    # (index-entry.ts indexKeyFor() と同じレイアウト。実 R2 には接続していない)。
    # visibility="public"/consent_l3=True を明示する — g80-vis2 の既定拒否フィルタ導入後も
    # この共有フィクスチャを使う既存の往復テストが引き続き行を通す(公開・許諾済み)ことを
    # 意図しているため。フィルタそのものの単体テストは別フィクスチャ(_write_entries)で行う。
    day_dir = root / "index" / "receipt" / "2026-08-01"
    day_dir.mkdir(parents=True)
    for i, (actor, text) in enumerate([("user-1", "[capture] type=x subject=s1"), ("user-2", None)]):
        entry = _index_entry(f"evt-{i}", actor, text, visibility="public", consent_l3=True)
        (day_dir / f"175400000{i}-evt-{i}.json").write_text(json.dumps(entry), encoding="utf-8")


def _write_entries(root: Path, entries: list[dict]) -> Path:
    # 任意の IndexEntry dict 群を index/receipt/<date>/ 配下に書く(g80-vis2 のフィルタ
    # テスト用 — visibility/consent_l3 の組み合わせを行ごとに変えたい時に使う)。
    day_dir = root / "index" / "receipt" / "2026-08-01"
    day_dir.mkdir(parents=True, exist_ok=True)
    for i, entry in enumerate(entries):
        (day_dir / f"175400000{i}-{entry['event_id']}.json").write_text(
            json.dumps(entry), encoding="utf-8"
        )
    return root / "index" / "receipt"


def test_load_index_entries_reads_nested_date_dirs(tmp_path: Path) -> None:
    _write_index_receipt_fixture(tmp_path)
    entries = load_index_entries(tmp_path / "index" / "receipt")
    assert {e["event_id"] for e in entries} == {"evt-0", "evt-1"}


def test_load_index_entries_returns_empty_for_missing_dir(tmp_path: Path) -> None:
    assert load_index_entries(tmp_path / "does-not-exist") == []


def test_project_columns_defaults_exclude_actor_id() -> None:
    # 既定は保守側(カード B3-A 未裁定の間は人物系フィールドを含めない)。
    # g80-vis2: visibility/consent_l3(判定用フラグ)も既定から除外(配布はしない)。
    assert "actor_id" not in DEFAULT_MANIFEST_COLUMNS
    assert DEFAULT_MANIFEST_COLUMNS == ALL_INDEX_ENTRY_COLUMNS - {
        "actor_id",
        "visibility",
        "consent_l3",
    }
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


def test_update_latest_pointer_stamps_generated_at_when_omitted(tmp_path: Path) -> None:
    base_dir = tmp_path / "manifests"
    update_latest_pointer(base_dir, 1)
    info = read_latest_manifest_info(base_dir)
    assert info is not None
    assert info["generation"] == 1
    assert isinstance(info["generated_at"], str) and info["generated_at"]  # non-empty ISO8601


def test_update_latest_pointer_accepts_explicit_generated_at(tmp_path: Path) -> None:
    base_dir = tmp_path / "manifests"
    update_latest_pointer(base_dir, 2, generated_at="2026-08-01T00:00:00+00:00")
    info = read_latest_manifest_info(base_dir)
    assert info == {"generation": 2, "generated_at": "2026-08-01T00:00:00+00:00"}


def test_read_latest_generation_unaffected_by_generated_at_addition(tmp_path: Path) -> None:
    # 既存契約(read_latest_generation は int だけを返す)を壊していないことの回帰確認。
    base_dir = tmp_path / "manifests"
    update_latest_pointer(base_dir, 5, generated_at="2026-08-01T00:00:00+00:00")
    assert read_latest_generation(base_dir) == 5


def test_read_latest_manifest_info_returns_none_when_unset(tmp_path: Path) -> None:
    assert read_latest_manifest_info(tmp_path / "manifests") is None


def test_read_latest_manifest_info_handles_legacy_pointer_without_generated_at(tmp_path: Path) -> None:
    # generated_at 追加前に書かれた latest.json(generation のみ)を読んでも壊れないこと。
    import json

    base_dir = tmp_path / "manifests"
    base_dir.mkdir(parents=True)
    (base_dir / "latest.json").write_text(json.dumps({"generation": 7}), encoding="utf-8")
    info = read_latest_manifest_info(base_dir)
    assert info == {"generation": 7, "generated_at": None}


def test_generate_manifest_from_index_entries_accepts_explicit_generated_at(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _write_index_receipt_fixture(src)
    base_dir = tmp_path / "manifests" / "ihl-index"

    generate_manifest_from_index_entries(
        src / "index" / "receipt", base_dir, 1, generated_at="2026-08-01T09:00:00+09:00"
    )
    info = read_latest_manifest_info(base_dir)
    assert info == {"generation": 1, "generated_at": "2026-08-01T09:00:00+09:00"}


# --- g80-vis2(design R0801-7b17da-REPORT-2026-08-01-g80-visibilitythink.md §2-3 案C'・
# §3-1隻2): manifest既定拒否フィルタ(B3-A約束「非公開設定・第三者提供未許諾のものを
# 除いた上で配ります」の履行)。visibility=="public" かつ consent_l3 is True の行だけ
# manifest に通す。列が無い旧形式行は既定で除外(遡及書き換えなしで安全側に倒れる)。
# -----------------------------------------------------------------------------------


def test_default_manifest_columns_excludes_visibility_and_consent_l3() -> None:
    # フラグ列は判定にのみ使い配布はしない(design「フラグ列自体は配布物からは落とす」)。
    assert "visibility" not in DEFAULT_MANIFEST_COLUMNS
    assert "consent_l3" not in DEFAULT_MANIFEST_COLUMNS
    assert {"visibility", "consent_l3"} <= ALL_INDEX_ENTRY_COLUMNS


def test_is_publicly_consented_row_true_only_for_public_and_consented() -> None:
    assert is_publicly_consented_row({"visibility": "public", "consent_l3": True}) is True
    assert is_publicly_consented_row({"visibility": "private", "consent_l3": True}) is False
    assert is_publicly_consented_row({"visibility": "public", "consent_l3": False}) is False
    assert is_publicly_consented_row({"visibility": "public"}) is False
    assert is_publicly_consented_row({}) is False


def test_filter_publicly_consented_rows_keeps_only_matching_rows() -> None:
    rows = [
        {"event_id": "e-pub", "visibility": "public", "consent_l3": True},
        {"event_id": "e-priv", "visibility": "private", "consent_l3": True},
    ]
    got = filter_publicly_consented_rows(rows)
    assert [r["event_id"] for r in got] == ["e-pub"]


# ①-1: private行がmanifestに入らない
def test_generate_manifest_excludes_private_row(tmp_path: Path) -> None:
    src = tmp_path / "src"
    entry = _index_entry("evt-priv", "user-1", "text", visibility="private", consent_l3=True)
    _write_entries(src, [entry])
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    got = search_manifest(out)
    assert got == []


# ①-2: consent_l3欠落行がmanifestに入らない
def test_generate_manifest_excludes_row_missing_consent_l3(tmp_path: Path) -> None:
    src = tmp_path / "src"
    entry = _index_entry("evt-noconsent", "user-1", "text", visibility="public")
    _write_entries(src, [entry])
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    got = search_manifest(out)
    assert got == []


# ①-3: consent_l3=false行がmanifestに入らない
def test_generate_manifest_excludes_row_with_consent_l3_false(tmp_path: Path) -> None:
    src = tmp_path / "src"
    entry = _index_entry("evt-refused", "user-1", "text", visibility="public", consent_l3=False)
    _write_entries(src, [entry])
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    got = search_manifest(out)
    assert got == []


# ②: visibility/consent_l3列が無い旧形式行が既定で除外される
def test_generate_manifest_excludes_legacy_rows_without_visibility_columns(tmp_path: Path) -> None:
    src = tmp_path / "src"
    legacy_entry = _index_entry("evt-legacy", "user-1", "text")  # visibility/consent_l3キー無し
    assert "visibility" not in legacy_entry
    assert "consent_l3" not in legacy_entry
    _write_entries(src, [legacy_entry])
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    got = search_manifest(out)
    assert got == []


def test_generate_manifest_includes_public_consented_row(tmp_path: Path) -> None:
    src = tmp_path / "src"
    entries = [
        _index_entry("evt-pub", "user-1", "text", visibility="public", consent_l3=True),
        _index_entry("evt-priv", "user-2", "text", visibility="private", consent_l3=True),
        _index_entry("evt-legacy", "user-3", "text"),
    ]
    _write_entries(src, entries)
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(src / "index" / "receipt", base_dir, 1)
    got = search_manifest(out)
    assert {r["event_id"] for r in got} == {"evt-pub"}


def test_generate_manifest_never_includes_flag_columns_even_when_explicitly_requested(
    tmp_path: Path,
) -> None:
    # columns=ALL_INDEX_ENTRY_COLUMNS を明示指定しても、visibility/consent_l3は判定にのみ
    # 使い配布物には残らない(design「フラグ列自体は配布物からは落とす」)。
    src = tmp_path / "src"
    entry = _index_entry("evt-pub", "user-1", "text", visibility="public", consent_l3=True)
    _write_entries(src, [entry])
    base_dir = tmp_path / "manifests"

    out = generate_manifest_from_index_entries(
        src / "index" / "receipt", base_dir, 1, columns=ALL_INDEX_ENTRY_COLUMNS
    )
    got = search_manifest(out)
    assert len(got) == 1
    assert "visibility" not in got[0]
    assert "consent_l3" not in got[0]
    assert got[0]["actor_id"] == "user-1"
