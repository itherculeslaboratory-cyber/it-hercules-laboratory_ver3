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


def write_manifest(rows: list[dict[str, Any]], path: str | Path) -> None:
    """Write `rows` as one Parquet manifest file (overwrites — the manifest is a
    regenerable projection, not Truth; Truth itself stays append-only elsewhere).
    """
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(rows).write_parquet(out)


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"embedding dim mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def search_manifest(
    path: str | Path,
    *,
    filters: dict[str, Any] | None = None,
    query_vector: list[float] | None = None,
    vector_column: str = "embedding",
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Read the Parquet manifest via DuckDB, apply equality `filters`, and (if
    `query_vector` is given) rank the filtered subset by cosine similarity —
    a plain Python subset scan (no FAISS/ANN), per should_use_subset_cosine().
    Returns rows as plain dicts, highest-similarity first when ranking.
    """
    p = Path(path)
    if not p.exists():
        return []

    where = ""
    params: list[Any] = []
    if filters:
        clauses = []
        for col, val in filters.items():
            clauses.append(f'"{col}" = ?')
            params.append(val)
        where = "WHERE " + " AND ".join(clauses)

    query = f"SELECT * FROM read_parquet(?) {where}"
    con = duckdb.connect()
    try:
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
