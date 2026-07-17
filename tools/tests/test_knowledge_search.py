"""V3-WIK-03: 決定論の梯子・第1段(index.md スコアリング)の pytest。

キーワード抽出→index.md スコアリングだけでファイルを開かず候補を絞れることを
検証する(実際のトピック/ソース本文ファイルは knowledge_search.py から一切
読まれない — このテストでは本文ファイルを作らずダミー index.md だけで足りる
ことがそれ自体の証明になる)。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))

import knowledge_search as ks  # noqa: E402


def _seed(knowledge_dir: Path) -> None:
    (knowledge_dir).mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "index.md").write_text(
        "# index\n\n"
        "## topics\n\n"
        "| name | link | 一文説明 |\n"
        "|---|---|---|\n"
        "| 飼育環境の知識 | [topics/breeding-environment.md](./topics/breeding-environment.md) | 温度・湿度・照度の取得規約 |\n"
        "| 観測パイプライン | [topics/observation-pipeline.md](./topics/observation-pipeline.md) | capture→埋め込み→類似検索梯子 |\n",
        encoding="utf-8",
    )
    sources_dir = knowledge_dir / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)
    (sources_dir / "index.md").write_text(
        "# sources\n\n"
        "| name | link | 出典 | 一文説明 |\n"
        "|---|---|---|---|\n"
        "| （なし） | – | – | K2 ingest 待ち |\n"
        "| 温度実験ノート | [../topics/temp-note.md](../topics/temp-note.md) | thread | 温度と成長速度 |\n",
        encoding="utf-8",
    )


def test_rank_index_never_opens_topic_files_only_scores_index_rows(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed(knowledge_dir)
    # 実体ファイル(topics/breeding-environment.md 等)は一切作らない — それでも
    # index.md の行だけでスコアリングできることを確認する。
    ranked = ks.rank_index("温度", knowledge_dir)
    assert ranked, "温度 は breeding-environment 行の説明文に含まれるはずヒットする"
    top_links = {s.row.link for s in ranked}
    assert "./topics/breeding-environment.md" in top_links


def test_placeholder_rows_without_a_real_link_are_excluded(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed(knowledge_dir)
    ranked = ks.rank_index("K2", knowledge_dir)  # 「K2 ingest 待ち」はプレースホルダ行にしか出てこない
    assert all(s.row.link != "–" for s in ranked)
    assert ranked == []  # プレースホルダ行(リンク無し)は候補化されない


def test_scores_rank_by_keyword_hit_count_then_link_deterministically(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed(knowledge_dir)
    ranked = ks.rank_index("温度 成長", knowledge_dir)
    assert [s.row.link for s in ranked][0] in {
        "../topics/temp-note.md",
        "./topics/breeding-environment.md",
    }
    # 決定論: スコア降順、同点は link 昇順(2 回叩いても同じ順序)。
    assert ks.rank_index("温度 成長", knowledge_dir) == ranked


def test_best_file_resolves_relative_to_the_owning_index_md(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed(knowledge_dir)
    best = ks.best_file("観測パイプライン", knowledge_dir)
    assert best == (knowledge_dir / "topics" / "observation-pipeline.md").resolve()


def test_no_keywords_or_no_hits_returns_empty(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    _seed(knowledge_dir)
    assert ks.rank_index("", knowledge_dir) == []
    assert ks.rank_index("該当しない単語xyz", knowledge_dir) == []
    assert ks.best_file("該当しない単語xyz", knowledge_dir) is None


def test_against_the_real_docs_knowledge_index(tmp_path: Path) -> None:
    """回帰ガード: 実リポジトリの docs/knowledge/index.md 自体が壊れておらず、
    実クエリで実在ページがヒットすることを確認する(index との乖離検出)。"""
    ranked = ks.rank_index("温度", ks.DEFAULT_KNOWLEDGE_DIR)
    links = {s.row.link for s in ranked}
    assert "./topics/breeding-environment.md" in links
