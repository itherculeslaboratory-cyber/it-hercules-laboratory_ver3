#!/usr/bin/env python3
"""tools/knowledge_search.py — V3-WIK-03 決定論の梯子・第1段(index.md スコアリング)。

検索は決定論の梯子(キーワード抽出 → index.md スコアリングでファイルを開かない →
最良1ファイルだけ開く → 該当節だけ読む → 最後にモデル1回)を用い、モデル呼び出しを
蒸留の1回に寄せる(docs/knowledge/CLAUDE.md の運用規約)。この CLI は梯子の第1段
だけを担う: docs/knowledge 配下の全 index.md(root + サブディレクトリ)が持つ表の
行だけを読み、実際のトピック/ソースページ本文は一切開かずにキーワード一致数で
スコア付けする。呼び手(エージェント)は最上位1件だけを開く。

第2段(テキスト埋め込み)は components/wiki-ingest/backends.py が担い、既定は
DummyBackend(決定論・軽量・実運用バックエンドは後日人間が選定 — 同じ要求文の
別半分)。

Usage:
    python tools/knowledge_search.py "温度 成長"  [--knowledge-dir DIR] [--top N]
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KNOWLEDGE_DIR = REPO_ROOT / "docs" / "knowledge"

_ROW_RE = re.compile(r"^\|(.+)\|\s*$")
_SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")
_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")


@dataclass(frozen=True)
class IndexRow:
    text: str  # 全セル結合(リンク記法を剥がした平文) — スコアリング対象
    link: str  # 表内で最初に見つかった markdown リンクの相対パス
    index_file: Path  # この行が載っている index.md(スコアリングだけがここを開く)


def _parse_index_rows(index_path: Path) -> list[IndexRow]:
    rows: list[IndexRow] = []
    try:
        lines = index_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return rows
    for line in lines:
        m = _ROW_RE.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if not cells or all(_SEPARATOR_CELL_RE.match(c) for c in cells if c):
            continue  # `|---|---|` セパレータ行
        if cells[0].lower() in ("name", "id"):
            continue  # ヘッダ行
        link = None
        for c in cells:
            lm = _LINK_RE.search(c)
            if lm:
                link = lm.group(2)
                break
        if not link or link in ("–", "-", ""):
            continue  # プレースホルダ行(リンク無し)は候補にしない
        text = " ".join(_LINK_RE.sub(r"\1", c) for c in cells)
        rows.append(IndexRow(text=text, link=link, index_file=index_path))
    return rows


def _keywords(query: str) -> list[str]:
    return [t for t in re.findall(r"\w+", query.lower()) if len(t) >= 2]


@dataclass(frozen=True)
class ScoredRow:
    row: IndexRow
    score: int


def rank_index(query: str, knowledge_dir: Path) -> list[ScoredRow]:
    """クエリのキーワードと index.md 行(name+説明文などのセル結合)の一致数で
    スコア付けする。トピック/ソース本体ファイルは一切開かない(index.md だけ scan)。
    決定論: スコア降順、同点は link 昇順。
    """
    kws = _keywords(query)
    if not kws:
        return []
    rows: list[IndexRow] = []
    if knowledge_dir.is_dir():
        for idx_path in sorted(knowledge_dir.rglob("index.md")):
            rows.extend(_parse_index_rows(idx_path))
    scored = []
    for row in rows:
        text_l = row.text.lower()
        score = sum(text_l.count(k) for k in kws)
        if score > 0:
            scored.append(ScoredRow(row=row, score=score))
    scored.sort(key=lambda s: (-s.score, s.row.link))
    return scored


def best_file(query: str, knowledge_dir: Path) -> Path | None:
    """梯子の「最良1ファイルだけ開く」ステップ: 最上位ヒットの実ファイルパスを
    index.md の場所からの相対リンクで解決して返す(呼び手はこれだけを開く)。
    """
    ranked = rank_index(query, knowledge_dir)
    if not ranked:
        return None
    top = ranked[0]
    return (top.row.index_file.parent / top.row.link).resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query")
    parser.add_argument("--knowledge-dir", type=Path, default=DEFAULT_KNOWLEDGE_DIR)
    parser.add_argument("--top", type=int, default=5)
    args = parser.parse_args(argv)

    ranked = rank_index(args.query, args.knowledge_dir)
    if not ranked:
        print("該当なし(index.md に一致するキーワードなし)。")
        return 0
    for i, s in enumerate(ranked[: args.top]):
        marker = "OPEN THIS FILE ONLY" if i == 0 else ""
        print(f"{s.score}\t{s.row.link}\t{s.row.text}\t{marker}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
