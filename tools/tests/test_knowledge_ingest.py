"""V3-WIK-04: 決定論 ingest CLI (tools/knowledge_ingest.py) の pytest。

CLI はモデルを呼ばない(scan/ingest はどちらも純粋なファイル差分操作)。実 Truth
(Cloudflare R2)には触れず、tmp_path に R2 キー配置を模した最小フィクスチャを
作って検証する。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))

import knowledge_ingest as ki  # noqa: E402


def _write_envelope(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"data": data}), encoding="utf-8")


def _seed_thread(truth_dir: Path, thread_id: str, topic: str, *, post_id: str | None = None) -> None:
    pid = post_id or thread_id
    _write_envelope(
        truth_dir / ki.PLAZA_PREFIX / "knowledge-board" / thread_id / f"{pid}.json",
        {"thread_id": thread_id, "post_id": pid, "topic": topic},
    )


def _seed_content(truth_dir: Path, content_id: str, title: str) -> None:
    _write_envelope(
        truth_dir / ki.CONTENT_PREFIX / f"{content_id}.json",
        {"content_id": content_id, "title": title},
    )


def _seed_knowledge_dir(knowledge_dir: Path) -> None:
    sources_dir = knowledge_dir / "sources"
    sources_dir.mkdir(parents=True)
    (sources_dir / "index.md").write_text(
        "# sources — インデックス\n\n"
        f"{ki._EMPTY_SENTENCE}\n\n"
        f"{ki._SOURCES_TABLE_HEADER}\n"
        "|---|---|---|---|\n"
        f"{ki._EMPTY_ROW}\n",
        encoding="utf-8",
    )


def test_discover_keeps_only_root_posts_and_sorts_by_key(tmp_path: Path) -> None:
    truth_dir = tmp_path / "truth-mirror"
    _seed_thread(truth_dir, "th2", "二番目の話題")
    _seed_thread(truth_dir, "th1", "一番目の話題")
    _seed_thread(truth_dir, "th1", "返信(スタブ化しない)", post_id="reply-1")  # 返信は除外
    events = ki.discover(truth_dir)
    assert {e.source_id for e in events} == {"th1", "th2"}
    assert all(e.kind == "thread" for e in events)
    # key 昇順の決定論(truth_dir 相対パス文字列比較): th1/th1.json < th2/th2.json。
    assert [e.source_id for e in events] == sorted(e.source_id for e in events)


def test_scan_is_pure_and_ingest_creates_stub_plus_index_row(tmp_path: Path) -> None:
    truth_dir = tmp_path / "truth-mirror"
    knowledge_dir = tmp_path / "knowledge"
    _seed_knowledge_dir(knowledge_dir)
    _seed_thread(truth_dir, "th1", "初令の脱皮不全")
    _seed_content(truth_dir, "c1", "温度と成長速度の相関ノート")

    pending = ki.scan(truth_dir, knowledge_dir)
    assert {e.source_id for e in pending} == {"th1", "c1"}
    # scan は副作用を持たない(ポインタもファイルも変化しない・sources/ は index.md のみ)。
    assert not (knowledge_dir / ki.POINTER_NAME).exists()
    assert [p.name for p in (knowledge_dir / "sources").glob("*.md")] == ["index.md"]

    written = ki.ingest(truth_dir, knowledge_dir)
    assert len(written) == 2
    for p in written:
        text = p.read_text(encoding="utf-8")
        assert "type: Source" in text
        assert "<!-- DISTILL: pending -->" in text
        assert "# Citations" in text

    index_text = (knowledge_dir / "sources" / "index.md").read_text(encoding="utf-8")
    assert ki._EMPTY_ROW not in index_text  # プレースホルダ行は除去される
    assert "初令の脱皮不全" in index_text
    assert "温度と成長速度の相関ノート" in index_text

    pointer = json.loads((knowledge_dir / ki.POINTER_NAME).read_text(encoding="utf-8"))
    assert len(pointer["processed"]) == 2


def test_ingest_is_idempotent_across_repeat_runs(tmp_path: Path) -> None:
    truth_dir = tmp_path / "truth-mirror"
    knowledge_dir = tmp_path / "knowledge"
    _seed_knowledge_dir(knowledge_dir)
    _seed_thread(truth_dir, "th1", "同じスレを2回 ingest しても増えない")

    first = ki.ingest(truth_dir, knowledge_dir)
    assert len(first) == 1
    second = ki.ingest(truth_dir, knowledge_dir)
    assert second == []  # 2 回目は新規 source なし(ポインタで差分ゼロ)

    stub_files = list((knowledge_dir / "sources").glob("thread-*.md"))
    assert len(stub_files) == 1  # 重複生成されない


def test_ingest_only_processes_new_sources_added_after_a_previous_run(tmp_path: Path) -> None:
    truth_dir = tmp_path / "truth-mirror"
    knowledge_dir = tmp_path / "knowledge"
    _seed_knowledge_dir(knowledge_dir)
    _seed_thread(truth_dir, "th1", "第1弾")
    ki.ingest(truth_dir, knowledge_dir)

    _seed_thread(truth_dir, "th2", "第2弾(あとから追加)")
    second_run = ki.ingest(truth_dir, knowledge_dir)
    assert len(second_run) == 1
    assert "第2弾" in second_run[0].read_text(encoding="utf-8")


def test_missing_truth_dir_yields_zero_events_without_crashing(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed_knowledge_dir(knowledge_dir)
    assert ki.scan(tmp_path / "does-not-exist", knowledge_dir) == []
    assert ki.ingest(tmp_path / "does-not-exist", knowledge_dir) == []


def test_cli_main_scan_and_ingest_smoke(tmp_path: Path, capsys) -> None:
    truth_dir = tmp_path / "truth-mirror"
    knowledge_dir = tmp_path / "knowledge"
    _seed_knowledge_dir(knowledge_dir)
    _seed_content(truth_dir, "c9", "CLI 経由の smoke test")

    rc = ki.main(["scan", "--truth-dir", str(truth_dir), "--knowledge-dir", str(knowledge_dir)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "c9" in out

    rc = ki.main(["ingest", "--truth-dir", str(truth_dir), "--knowledge-dir", str(knowledge_dir)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "stub:" in out
