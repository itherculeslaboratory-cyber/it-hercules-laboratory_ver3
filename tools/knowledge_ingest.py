#!/usr/bin/env python3
"""tools/knowledge_ingest.py — 決定論 ingest CLI (V3-WIK-04)。

docs/knowledge/CLAUDE.md の K2 ingest 契約: 「board/board_event」「research/v1」
Truth イベントストリームをリプレイし、前回処理ポインタとの差分から source スタブを
生成する。**この CLI 自体はモデルを呼ばない** — スタブの蒸留(description記述・
topics更新・相互リンクとCitations付与・マーカー削除・log記録)は別途 Sonnet エージェント
手順(CLAUDE.md 記載のプロンプト)で行う。

本番 Truth(Cloudflare R2)を都度ライブフェッチしない(不変条項①・§5 人間ゲート)。
--truth-dir は人間が別途エクスポートしたローカルミラー(R2 キー配置そのままの
ディレクトリ木: <truth-dir>/truth/ihl.plaza.post.v1/... 等)を指す前提。ミラーが
無い/空でも 0 件で正常終了する(壊れない)。

Usage:
    python tools/knowledge_ingest.py scan   [--truth-dir DIR]
    python tools/knowledge_ingest.py ingest [--truth-dir DIR]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KNOWLEDGE_DIR = REPO_ROOT / "docs" / "knowledge"
DEFAULT_TRUTH_DIR = REPO_ROOT / "docs" / "knowledge" / ".truth-mirror"

# Truth key prefixes this CLI replays (design-c5 K5/K6 の実キー命名。CLAUDE.md の
# 「board/board_event」「research/v1」は ver2 期の仮称のため、現行スキーマの正式
# type 名にここで対応させる)。
PLAZA_PREFIX = "truth/ihl.plaza.post.v1"
CONTENT_PREFIX = "truth/ihl.research.content.v1"

POINTER_NAME = ".ingest-pointer.json"
SOURCES_SUBDIR = "sources"
SOURCES_INDEX_NAME = "index.md"

_SOURCES_TABLE_HEADER = "| name | link | 出典 | 一文説明 |"
_EMPTY_ROW = "| （なし） | – | – | K2 ingest 待ち |"
_EMPTY_SENTENCE = "現在は空（骨格のみ）。ページを追加したら本表とルート [`../index.md`](../index.md) の両方に 1 行を追加する。"
_HAS_ENTRIES_SENTENCE = "ページを追加したら本表とルート [`../index.md`](../index.md) の両方に 1 行を追加する。"


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "untitled"


@dataclass(frozen=True)
class SourceEvent:
    key: str  # truth-dir 相対キー(そのまま処理済みポインタの一意識別子)
    kind: str  # "thread" | "content"
    title: str
    source_id: str


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def discover(truth_dir: Path) -> list[SourceEvent]:
    """truth_dir を prefix scan し、source 候補を決定論順(key 昇順)で列挙する。"""
    events: list[SourceEvent] = []

    plaza_root = truth_dir / PLAZA_PREFIX
    if plaza_root.is_dir():
        for path in plaza_root.rglob("*.json"):
            env = _read_json(path)
            if env is None:
                continue
            data = env.get("data", {}) if isinstance(env, dict) else {}
            thread_id = str(data.get("thread_id", ""))
            post_id = str(data.get("post_id", ""))
            # root post(thread_id と post_id が一致)だけを 1 スレ = 1 情報源として扱う。
            # 返信は蒸留時にスレ全体(GET /plaza/threads/{id})を読んで同じ source に畳む。
            if not thread_id or thread_id != post_id:
                continue
            key = str(path.relative_to(truth_dir)).replace("\\", "/")
            events.append(SourceEvent(key, "thread", str(data.get("topic") or thread_id), thread_id))

    content_root = truth_dir / CONTENT_PREFIX
    if content_root.is_dir():
        for path in content_root.glob("*.json"):
            env = _read_json(path)
            if env is None:
                continue
            data = env.get("data", {}) if isinstance(env, dict) else {}
            content_id = str(data.get("content_id", ""))
            if not content_id:
                continue
            key = str(path.relative_to(truth_dir)).replace("\\", "/")
            events.append(SourceEvent(key, "content", str(data.get("title") or content_id), content_id))

    events.sort(key=lambda e: e.key)
    return events


def _pointer_path(knowledge_dir: Path) -> Path:
    return knowledge_dir / POINTER_NAME


def load_pointer(knowledge_dir: Path) -> set[str]:
    p = _pointer_path(knowledge_dir)
    if not p.exists():
        return set()
    doc = _read_json(p) or {}
    return set(doc.get("processed", []))


def save_pointer(knowledge_dir: Path, processed: set[str]) -> None:
    _pointer_path(knowledge_dir).write_text(
        json.dumps({"processed": sorted(processed)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def scan(truth_dir: Path, knowledge_dir: Path) -> list[SourceEvent]:
    """前回処理ポインタとの差分(未処理の source)を返す。副作用なし。"""
    processed = load_pointer(knowledge_dir)
    return [e for e in discover(truth_dir) if e.key not in processed]


def _stub_slug(ev: SourceEvent) -> str:
    return f"{ev.kind}-{_slug(ev.title)}-{_slug(ev.source_id)}"


def _stub_markdown(ev: SourceEvent, now: str) -> str:
    kind_label = "スレッド" if ev.kind == "thread" else "研究コンテンツ"
    return (
        "---\n"
        "type: Source\n"
        f'title: "{ev.title}"\n'
        f'description: "(pending distillation — {kind_label} {ev.source_id} の要約は未記述)"\n'
        "tags: []\n"
        f'timestamp: "{now}"\n'
        "---\n\n"
        f"# {ev.title}\n\n"
        f"- kind: {ev.kind}\n"
        f"- source_id: {ev.source_id}\n"
        f"- truth_key: {ev.key}\n\n"
        "# Citations\n\n"
        "(pending distillation)\n\n"
        "<!-- DISTILL: pending -->\n"
    )


def _append_sources_index_rows(knowledge_dir: Path, rows: list[tuple[str, str, str, str]]) -> None:
    """sources/index.md の表へ新規行を追記する(保存とインデックスは不可分・機械的な
    行追加のみ — description の作文は蒸留(Sonnetエージェント手順)の仕事)。"""
    if not rows:
        return
    idx_path = knowledge_dir / SOURCES_SUBDIR / SOURCES_INDEX_NAME
    text = idx_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    out: list[str] = []
    for line in lines:
        if line.strip() == _EMPTY_ROW:
            continue  # プレースホルダ行は実データが入ったら除去
        if _EMPTY_SENTENCE in line:
            line = line.replace(_EMPTY_SENTENCE, _HAS_ENTRIES_SENTENCE)
        out.append(line)
    new_rows = [f"| {name} | {link} | {kind} | {desc} |" for name, link, kind, desc in rows]
    out.extend(new_rows)
    idx_path.write_text("\n".join(out) + "\n", encoding="utf-8")


def ingest(truth_dir: Path, knowledge_dir: Path) -> list[Path]:
    """未処理の source を検出し、docs/knowledge/sources/*.md スタブを生成する。
    生成済みスタブと sources/index.md の行追加のみ行い、topics 更新・Citations 本文・
    log.md 記録はしない(それは蒸留(Sonnetエージェント手順)の仕事・CLI はモデルを呼ばない)。
    """
    pending = scan(truth_dir, knowledge_dir)
    if not pending:
        return []
    sources_dir = knowledge_dir / SOURCES_SUBDIR
    sources_dir.mkdir(parents=True, exist_ok=True)
    processed = load_pointer(knowledge_dir)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written: list[Path] = []
    index_rows: list[tuple[str, str, str, str]] = []
    for ev in pending:
        stub_path = sources_dir / f"{_stub_slug(ev)}.md"
        if not stub_path.exists():
            stub_path.write_text(_stub_markdown(ev, now), encoding="utf-8")
            written.append(stub_path)
            kind_label = "スレッド" if ev.kind == "thread" else "研究コンテンツ"
            index_rows.append((ev.title, f"./{stub_path.name}", kind_label, "(pending distillation)"))
        processed.add(ev.key)
    save_pointer(knowledge_dir, processed)
    _append_sources_index_rows(knowledge_dir, index_rows)
    return written


def _print_events(events: list[SourceEvent], empty_msg: str) -> None:
    if not events:
        print(empty_msg)
        return
    for e in events:
        print(f"{e.kind}\t{e.source_id}\t{e.title}\t{e.key}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["scan", "ingest"])
    parser.add_argument("--truth-dir", type=Path, default=DEFAULT_TRUTH_DIR)
    parser.add_argument("--knowledge-dir", type=Path, default=DEFAULT_KNOWLEDGE_DIR)
    args = parser.parse_args(argv)

    if args.command == "scan":
        _print_events(scan(args.truth_dir, args.knowledge_dir), "新規 source なし。")
        return 0

    written = ingest(args.truth_dir, args.knowledge_dir)
    if not written:
        print("新規 source なし。")
    else:
        for p in written:
            print(f"stub: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
