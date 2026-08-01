#!/usr/bin/env python3
"""libs/datalake/manifest.py — Parquet manifest search (V3-FND-03).

V3-FND-03: "individual masterの一生と再解析可能性を守るファイルベース研究データ
レイク" として設計する。R2 はディレクトリ構造だけでは検索できないため Parquet
manifest を整理表として置き、検索は manifest を DuckDB/Polars で読む。件数が
1000〜1万で強く絞れる間は FAISS を使わず subset への cosine 計算で済ませる
(FAISS は高速化部品であり基盤思想ではない)。低レイテンシは非要求で再解析可能性を
優先する(design table: 投影層は Truth から純関数で再生成可能・正本ではない)。

このモジュールは薄い2関数の契約:
  write_manifest(rows, path)   — 行(dict)の列を1つの Parquet ファイルに書く。
                                  Truth(R2)本体は書き換えない(投影・再生成可)。
  search_manifest(path, ...)   — DuckDB で Parquet を読み、等値フィルタ + 任意の
                                  query_vector cosine ランキングを返す。

依存は libs/datalake/requirements.txt(duckdb/polars)のみ。常駐 DB ではなく都度
プロセス内で開いて閉じるファイル読み取り(invariant ①: R2/Truth のみが永続正本)。
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

# V3-FND-03: 「件数が1000〜1万で強く絞れる間はFAISSを使わずsubsetへのcosine計算で
# 済ませる」の閾値をコードとして固定する(超過時は ANN index への昇格を検討する、
# という設計判断の分岐点を machine-readable にする)。
SUBSET_COSINE_MAX_ROWS = 10_000


def should_use_subset_cosine(n_rows: int) -> bool:
    """True while a full subset cosine scan is still appropriate (<= 10,000 rows).

    Above this, FAISS/ANN 昇格は「高速化部品」であり基盤思想ではない(V3-FND-03) —
    この関数はその閾値をコードとして固定するだけで、ANN 実装そのものは対象外
    (超過時に何をすべきかは design 判断であり本関数はその境界を testable にする)。
    """
    return n_rows <= SUBSET_COSINE_MAX_ROWS


# F1(g79-f1manifest, design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §2-1/§4-3):
# Truth の受領索引 index/receipt/<date>/<received_at_ms>-<event_id>.json(IndexEntry —
# packages/truth/src/index-entry.ts と同じフィールド名を1対1で保つ。ここを書き直すと
# 案1(E1横断検索)→案2(この生成器)が「置き換え」ではなく「別物」になってしまう)を
# 読み、manifest.parquet の行として書き出すための列定義。
ALL_INDEX_ENTRY_COLUMNS: frozenset[str] = frozenset(
    {
        "event_id",
        "type",
        "subject",
        "actor_id",
        "payload_key",
        "payload_bytes",
        "event_hash",
        "received_at",
        "claimed_at",
        "sig_alg",
        "key_id",
        "sig",
        "signed_bytes_sha256",
        "sig_verified",
        "text_repr",
        "text_repr_v",
    }
)

# カード B3-A(生データ配布の線引き)は未裁定(2026-08-01時点)。裁定が出るまでの既定は
# 保守側に倒す — actor_id(誰が投稿したかを一意特定できる人物系フィールド)を manifest
# から除外する。B3-A が「含めてよい」と裁定したら、呼び出し側で columns=ALL_INDEX_ENTRY_COLUMNS
# (またはactor_idを含む明示集合)を渡せば足り、この生成器自体の変更は不要。
DEFAULT_MANIFEST_COLUMNS: frozenset[str] = ALL_INDEX_ENTRY_COLUMNS - {"actor_id"}

# 研究者モード(F2)の JSON→SQL 生成器が使う列ホワイトリスト(design §4-3
# 「RESEARCH_QUERY_COLUMNS: ReadonlySet<string> — manifest の列名の固定集合」)。
# F1 manifest の列と同じ集合を土台にする(生成側で絞った列だけが検索側でも触れる —
# 生成しなかった列を検索フィルタに使われても実害は無いが、意図を一致させておく)。
RESEARCH_QUERY_COLUMNS: frozenset[str] = DEFAULT_MANIFEST_COLUMNS


class WhitelistViolationError(ValueError):
    """search_manifest() の filters に許可外の列名が渡された(WHITELIST_VIOLATION)。

    apps/api/src/sandbox-routes.ts の SANDBOX_WHITELIST + エラーコード
    "WHITELIST_VIOLATION" と同じ流儀(新しいエラーコード体系を増やさない)。
    """


def load_index_entries(index_root: str | Path) -> list[dict[str, Any]]:
    """index/receipt/<date>/<received_at_ms>-<event_id>.json のローカルミラーを読む。

    実 R2 には接続しない(このモジュールは Cloudflare Workers から呼べない ——
    b3think §4-2 実測。生成器は R2 からのエクスポート、またはローカル dev
    ストレージ/テスト用 JSON 群を入力として受け取る前提)。index_root 配下を
    再帰的に走査し、見つかった *.json をそのまま dict として返す(ファイル名の
    日付ディレクトリ構造は問わない — 呼び出し側が index/receipt/ の実レイアウトを
    ミラーしていれば自然に日付単位で読める)。
    """
    root = Path(index_root)
    if not root.exists():
        return []
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(root.rglob("*.json"))]


def project_columns(
    rows: list[dict[str, Any]], columns: frozenset[str] | set[str] | None = None
) -> list[dict[str, Any]]:
    """rows(IndexEntry dict の列)を columns(既定 = DEFAULT_MANIFEST_COLUMNS)だけに絞る。

    未知の列名(ALL_INDEX_ENTRY_COLUMNS に無いもの)が指定されたら ValueError —
    IndexEntry のフィールド名からのタイプミス・将来のフィールド名変更漏れを早期に落とす。
    """
    cols = frozenset(columns) if columns is not None else DEFAULT_MANIFEST_COLUMNS
    unknown = cols - ALL_INDEX_ENTRY_COLUMNS
    if unknown:
        raise ValueError(f"unknown manifest column(s) requested: {sorted(unknown)}")
    return [{col: row.get(col) for col in cols} for row in rows]


def generate_manifest_from_index_entries(
    index_root: str | Path,
    base_dir: str | Path,
    generation: int,
    *,
    columns: frozenset[str] | set[str] | None = None,
) -> Path:
    """index_root 配下の IndexEntry JSON 群 → manifest.parquet(generation-N, 上書き禁止)。

    新機構は発明しない: 読み込みは load_index_entries、列の絞り込みは
    project_columns、書き込みと世代管理・latest pointer 更新は既存の
    write_generation_manifest / update_latest_pointer をそのまま呼ぶだけ
    (V3-FND-06 — generation-N は immutable、これらの関数はテスト済みの
    既存契約であり本関数はその薄い合成)。
    """
    rows = load_index_entries(index_root)
    projected = project_columns(rows, columns)
    out = write_generation_manifest(projected, base_dir, generation)
    update_latest_pointer(base_dir, generation)
    return out


def write_manifest(rows: list[dict[str, Any]], path: str | Path) -> None:
    """Write `rows` as one Parquet manifest file (overwrites — the manifest is a
    regenerable projection, not Truth; Truth itself stays append-only elsewhere).
    """
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(rows).write_parquet(out)


# V3-FND-06(制約): embedding等の派生層は generation-N/immutable manifest で世代管理し、
# latest は pointer 更新のみとする。write_manifest() 自体は投影(regenerable)なので
# 常に上書き可能だが、embedding 世代のように「過去の worldSnapshot を対応 embedding で
# 再現可能にする」必要がある層はこの2関数を使う: 既存 generation ディレクトリは決して
# 上書きせず(ValueError)、latest.json だけが pointer 更新される。
class GenerationExistsError(ValueError):
    """既存の generation-N manifest を上書きしようとした(immutable違反)。"""


def write_generation_manifest(
    rows: list[dict[str, Any]], base_dir: str | Path, generation: int
) -> Path:
    """generation-N/manifest.parquet を新規作成する。同じ generation が既に存在する
    場合は書かず GenerationExistsError を投げる(上書き禁止=V3-FND-06 の中核)。
    Truth 本体を書き換えないのと同じ規約(このファイルも投影の一種だが、世代番号が
    バージョンを兼ねるため generation 単位では immutable にする)。
    """
    gen_dir = Path(base_dir) / f"generation-{generation}"
    out = gen_dir / "manifest.parquet"
    if out.exists():
        raise GenerationExistsError(f"generation-{generation} already exists at {out}")
    gen_dir.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(rows).write_parquet(out)
    return out


def update_latest_pointer(base_dir: str | Path, generation: int) -> Path:
    """latest.json を { "generation": N } で pointer 更新する(既存 generation manifest
    ファイル自体は一切書き換えない — pointer のみが変わる)。
    """
    import json

    base = Path(base_dir)
    base.mkdir(parents=True, exist_ok=True)
    latest_path = base / "latest.json"
    latest_path.write_text(json.dumps({"generation": generation}), encoding="utf-8")
    return latest_path


def read_latest_generation(base_dir: str | Path) -> int | None:
    """latest.json が指す generation 番号を返す(未作成なら None)。"""
    import json

    latest_path = Path(base_dir) / "latest.json"
    if not latest_path.exists():
        return None
    return json.loads(latest_path.read_text(encoding="utf-8"))["generation"]


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"embedding dim mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _manifest_columns(con: "duckdb.DuckDBPyConnection", path: Path) -> set[str]:
    """DESCRIBE 相当 — 実際にこの manifest ファイルへ書かれている列名の集合を返す。"""
    described = con.execute("SELECT * FROM read_parquet(?) LIMIT 0", [str(path)])
    return {name for name, *_ in described.description}


def search_manifest(
    path: str | Path,
    *,
    filters: dict[str, Any] | None = None,
    query_vector: list[float] | None = None,
    vector_column: str = "embedding",
    top_k: int = 10,
    allowed_columns: frozenset[str] | set[str] | None = None,
) -> list[dict[str, Any]]:
    """Read the Parquet manifest via DuckDB, apply equality `filters`, and (if
    `query_vector` is given) rank the filtered subset by cosine similarity —
    a plain Python subset scan (no FAISS/ANN), per should_use_subset_cosine().
    Returns rows as plain dicts, highest-similarity first when ranking.

    ★列ホワイトリスト是正(design §4-1・§4-3): `filters` の列名は以前 f-string で
    そのまま SQL へ補間されており(呼び出し元が0件=実害無しだったが、HTTP に繋いだ
    瞬間にインジェクション面になると設計側が指摘した)、ここで検証してから補間する。
    - `allowed_columns` を明示したら(研究者モード等)、filters の各列がその集合の
      メンバであることを要求する(design が名指しした RESEARCH_QUERY_COLUMNS の想定用途)。
    - 省略時は、この manifest ファイルに実在する列名だけを許可する(DuckDB の
      DESCRIBE 相当で動的に取得 — 汎用の write_manifest() 呼び出し元(埋め込み検索の
      テスト等、IndexEntry と無関係な任意スキーマ)を壊さない後方互換の既定)。
      いずれの経路でも、列名は「あらかじめ確定した集合のメンバかどうか」でしか
      判定されないため、任意文字列がそのまま SQL へは絶対に渡らない。
    違反したら WhitelistViolationError(WHITELIST_VIOLATION と同じ流儀)。
    """
    p = Path(path)
    if not p.exists():
        return []

    where = ""
    params: list[Any] = []
    con = duckdb.connect()
    try:
        if filters:
            permitted = (
                frozenset(allowed_columns)
                if allowed_columns is not None
                else _manifest_columns(con, p)
            )
            clauses = []
            for col, val in filters.items():
                if col not in permitted:
                    raise WhitelistViolationError(
                        f"WHITELIST_VIOLATION: column {col!r} is not whitelisted "
                        f"for search_manifest() filters"
                    )
                clauses.append(f'"{col}" = ?')
                params.append(val)
            where = "WHERE " + " AND ".join(clauses)

        query = f"SELECT * FROM read_parquet(?) {where}"
        result = con.execute(query, [str(p), *params]).pl()
    finally:
        con.close()
    rows: list[dict[str, Any]] = result.to_dicts()

    if query_vector is None:
        return rows[:top_k] if top_k else rows

    scored = [
        (row, _cosine(query_vector, list(row[vector_column])))
        for row in rows
        if row.get(vector_column) is not None
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [{**row, "_cosine_similarity": sim} for row, sim in scored[:top_k]]
