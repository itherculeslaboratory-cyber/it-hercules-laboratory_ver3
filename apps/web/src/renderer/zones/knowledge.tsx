"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ExecuteCtx, HeaderScopeCtx, NavigateCtx } from "../core/context";
import { appendHeaderScope, formatDateJa } from "../core/scope";
import { registerNode } from "../core/registry";
import { props } from "../core/node-view";
import type { ScreenNode } from "../types";

// zones/knowledge.tsx へ切り出し(renderer分割Phase 2a・Z6)。props()は
// Phase 2b裁定でcore/node-view.tsxへ一本化済み。

// 板 kind → 日本語ラベルの共有ルックアップ(guide=説明 / complaint=愚痴 / improvement=改善)。
// 旧 V3-BBS-03 の全画面フッター板(ScreenBoardsFooter)は STRIP-1(R95・共有chrome剥がし)で
// 撤去済み。この辞書だけは KNW wave1 の BoardThreadsNode/boardLabel が板ラベル表示に再利用する
// ため残す(新規辞書を作らない=同じ3板の訳を二重定義しない)。板分類の3分類軸への移行は F-2
// (round-18)で schema 側を改訂する。
const FILE_BOARD_KINDS = [
  { kind: "guide", label: "説明" },
  { kind: "complaint", label: "愚痴" },
  { kind: "improvement", label: "改善" },
] as const;

// c9 wave1 KNW Slice1(公式掲示板を探せる板にする): board-threads 専用ノード —
// 旧実装(汎用 list の item_text: "{{topic}}（{{board_kind}} / {{post_count}}）"
// + 常に空の thread_id へ飛ぶ「スレッドを開く」リンク)を置き換える。生の
// English board_kind・区切り無しの件数・デッドリンクの3点がバグだった。
// ThreadPostsNode(6719行)と同じ自前 fetch/reload パターン(useSource は使わ
// ない — 板フィルタはこのノードだけのローカル state で、他ノードと共有する
// 必要が無い)。板ラベルは共有の FILE_BOARD_KINDS(直上に定義)を
// そのまま再利用(新規辞書を作らない — 同じ3板の日本語訳をここで再定義する
// 理由が無い)。
interface KnwBoardThread {
  thread_id: string;
  topic: string;
  board_kind: string;
  post_count: number;
  latest_at?: string;
}
interface KnwBoardThreadsView {
  channel: string;
  threads: KnwBoardThread[];
}

function boardLabel(kind: string): string {
  return FILE_BOARD_KINDS.find((b) => b.kind === kind)?.label ?? kind;
}

function BoardThreadsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const execute = useContext(ExecuteCtx);
  const headerScope = useContext(HeaderScopeCtx);
  // HDR-1第2スライス(A1#4): GET /plaza/channels/:channel/threads は root投稿の
  // species_id をスレ代表値として絞る(SW-1)。
  const path = appendHeaderScope(
    String(p.source_path ?? "/api/v1/plaza/channels/knowledge-board/threads"),
    headerScope,
  );
  const [view, setView] = useState<KnwBoardThreadsView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeBoard, setActiveBoard] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path }))
      .then((v) => {
        if (alive) setView((v ?? null) as KnwBoardThreadsView | null);
      })
      .catch(() => {
        if (alive) setView(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  const threads = view?.threads ?? [];
  const filtered = activeBoard === "all" ? threads : threads.filter((t) => t.board_kind === activeBoard);

  return (
    <div className="civ-board-threads">
      <div className="civ-chip-row">
        <button
          type="button"
          className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
          data-active={activeBoard === "all" || undefined}
          aria-pressed={activeBoard === "all"}
          onClick={() => setActiveBoard("all")}
        >
          すべて
        </button>
        {FILE_BOARD_KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
            data-active={activeBoard === kind || undefined}
            aria-pressed={activeBoard === kind}
            onClick={() => setActiveBoard(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="civ-empty">この板にはまだスレッドがありません。</p>
      ) : (
        <ul className="civ-list">
          {filtered.map((t) => (
            <li key={t.thread_id}>
              <a
                className={cn("civ-card", "civ-interactive", "civ-board-thread-row")}
                href={`/s/knowledge-thread?thread_id=${t.thread_id}`}
              >
                <span className="civ-board-thread-topic">{t.topic}</span>
                <span className="civ-board-thread-meta">
                  <span className="civ-board-tag">{boardLabel(t.board_kind)}</span>
                  <span>{t.post_count}件の投稿</span>
                  <span>最終更新 {formatDateJa(t.latest_at)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// T-70 KNW wave1(知の広場ハブ — 承認モックアップの verbatim 採用): list
// variant="knowledge-hub" 専用ノード。オーナー30点評価(汎用レンダラで再解釈し
// 見た目を損なった)の是正として、承認済みモックアップ section0(ヘッダー3タブ)+
// section1(まず探す)の markup/className を寸分違わず採用し(globals.css の
// `.knw-hub `スコープCSS参照)、実データだけを流し込む(caseB7 と同じ実物採用
// パターン)。section2-5(dup-confirm/chat/summary/tree)は次波のため未着手。
// 検索は既存 GET /plaza/search + rankThreadSearch(決定論・embedding/LLM不使用)
// を200msデバウンスで叩く(旧 ThreadSearchNode と同じ fetch パターン)。
interface KnwHubMatch {
  thread_id: string;
  topic: string;
  post_count: number;
  latest_at: string;
  score: number;
  resolved?: boolean;
}
interface KnwHubSearchView {
  query: string;
  matches: KnwHubMatch[];
}
type KnwHubTab = "komatta" | "hanashitai" | "ronbun" | "honbook";

// T-72 KNW wave1(新規スレ重複確認 — 承認モックアップ section2 の verbatim 採用)。
// 一致度%は決定論の文字bigram Dice係数(= 2・|共通bigram(多重集合)| /
// (|bigram(a)|+|bigram(b)|))。plaza-routes.ts の rankThreadSearch に追加した
// ファジー加点と「同じ定義」を使う(元は文字集合オーバーラップ係数だったが、
// バックエンドを bigram Dice に統一した後に両者の数値が食い違い-- 例:
// 「コバエがわいた時どうする」対「コバエが大量発生した — 対策まとめ」で
// バックエンドは一致扱い(dice=0.2308)なのにフロント側の別指標が70%未満で
// バナー不発、という実バグを本番相当のE2Eで検出したため、単一の定義に統一した
// (コメント参照: plaza-routes.ts の diceCoefficient と同一アルゴリズム)。
// normalizeSearchText(plaza-routes.ts)と同じ空白除去のみの正規化を踏襲
// (embedding/LLM不使用・不変条項①)。
function knwBigrams(s: string): string[] {
  if (s.length < 2) return s.length ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.trim().replace(/\s+/g, "");
  const A = knwBigrams(norm(a));
  const B = knwBigrams(norm(b));
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of B) counts.set(g, (counts.get(g) ?? 0) + 1);
  let intersect = 0;
  for (const g of A) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      intersect++;
      counts.set(g, c - 1);
    }
  }
  return Math.round((2 * intersect) / (A.length + B.length) * 100);
}
// バックエンドの検索対象フロア(KNW_FUZZY_FLOOR=0.15=単なる検索結果への採用)より
// 高く設定(「重複の確認でユーザーの手を止める」には弱い偶然一致より強い確信が
// 要る)。実測 dice=0.2308(「コバエがわいた時どうする」対 seed トピック)を安全
// マージン込みで超える 20 に設定(plaza-search.test.ts の実測値と揃える)。
const KNW_DUP_THRESHOLD = 20;
// channel/board_kind は knowledge-board 板の既定値(KnowledgeThreadChatNode の
// 返信 POST と同じ組=既存スレの実データが channel:"knowledge-board"・
// board_kind:"guide" で運用されている前提を踏襲・renderer-knw-thread-chat.test.tsx
// 参照)。「困った」相談は board_kind enum(guide/complaint/improvement/engagement)の
// どれとも完全一致しないが、既存 knowledge-board 板の実運用値と揃えるのが最小の
// 選択(新しい enum 値は schemas/ 側の変更が要り本タスクのスコープ外)。
const KNW_COMPOSE_CHANNEL = "knowledge-board";
const KNW_COMPOSE_BOARD_KIND = "guide";

// wave1 KNW「種族の本」(R133=○○90点 採用・承認mockup D:\claude\00-hq\dashboard\
// mockups\knw-species-book.html)の verbatim 採用: list variant="species-book"
// 専用ノード(KnowledgeHubNode と同じ in-scope トリック — 新ノード種を起こさず、
// knowledge-hub の4本目のタブ「この種族の本」として mount する)。バックエンドは
// 実装済み(plaza-routes.ts projectSpeciesBook・GET /plaza/species/:species_id/book・
// LLM/embedding不使用の決定論投影)。
//
// mockup から意図的に省いた/差し替えたもの(誇張ゼロ・HomeDashboardNode の
// ribbon/footer承認メタ文言の省略と同じ判断基準):
//  - ribbon(「完成予想図(まだ動きません)」バナー) — これは実物なので出さない。
//  - section0 の header(ワードマーク+観測対象チップ+3タブ) — 知の広場の
//    ヘッダー/タブは既に KnowledgeHubNode 側にあり(この本はその4本目のタブの
//    中身)、観測対象チップ自体は AppShellNode の HeaderScopeSelector が画面
//    全体で常時表示済み(二重表示を避ける)。obs-note の文言だけ「今わかって
//    いる文脈」として残す。
//  - footer(正直な線引き)は残す — 「後から任意で足すAI」「この本に必要な
//    土台」は今も本当に手つかず(species_id をスレ作成フォームへ自動で
//    添える配線は本タスクのスコープ外・下記コメント参照)なので、誇張なく
//    そのまま当てはまる。文言だけ「予想図」→実画面の言い回しへ直す。
interface SpeciesBookHistoryView {
  diff: string;
  at: string;
}
interface SpeciesBookChapterView {
  topic: string;
  thread_count: number;
  post_count: number;
  latest_at: string;
  status: "verified" | "refuted" | "unresolved" | "open";
  cite_count: number;
  retry_reproduced: number;
  retry_not_reproduced: number;
  stance_total: number;
  answer: string;
  answer_verified: boolean;
  history: SpeciesBookHistoryView[];
}
interface SpeciesBookView {
  species_id: string;
  species_name: string;
  chapter_count: number;
  thread_count: number;
  verified_count: number;
  chapters: SpeciesBookChapterView[];
}

// status→(badgeクラス・バッジ文言・章要約の見出し語)。plaza-routes.ts
// classifyPromotion の4値と mockup の4バッジ(verified/unverified/open/refuted)
// を一意に対応させる(brief 指定の対応表そのまま)。
function speciesBookBadge(ch: SpeciesBookChapterView): { cls: string; label: string; extract: string } {
  if (ch.status === "verified") {
    return { cls: "verified", label: `✔ 裏取り済み(実観測${ch.cite_count}・追試${ch.retry_reproduced})`, extract: "今わかっていること" };
  }
  if (ch.status === "refuted") {
    return { cls: "refuted", label: "⚠ 反証あり", extract: "今わかっていること" };
  }
  if (ch.status === "unresolved") {
    return { cls: "open", label: "まだ話し合い中", extract: "まだ答えが割れています" };
  }
  return { cls: "unverified", label: "△ まだ未検証", extract: "今のところ多い意見" };
}

function SpeciesBookNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const execute = useContext(ExecuteCtx);
  const scope = useContext(HeaderScopeCtx);
  // KnowledgeHubNode mounts this component reusing its OWN node (props.variant
  // "knowledge-hub", source_path "/api/v1/plaza/search") for its 4本目のタブ —
  // only trust node.props.source_path when this node's own variant really is
  // "species-book" (the standalone list-node mount), never borrow a foreign
  // node's source_path (bug found by the e2e below: it fetched .../search/.../book).
  const basePath = p.variant === "species-book" ? String(p.source_path ?? "/api/v1/plaza/species") : "/api/v1/plaza/species";
  const speciesId = scope.species.trim();
  const [book, setBook] = useState<SpeciesBookView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!speciesId) {
      setBook(null);
      setLoaded(true);
      return;
    }
    let alive = true;
    setLoaded(false);
    Promise.resolve(execute({ kind: "api", method: "GET", path: `${basePath}/${encodeURIComponent(speciesId)}/book` }))
      .then((v) => {
        if (alive) setBook((v as SpeciesBookView | undefined) ?? null);
      })
      .catch(() => {
        if (alive) setBook(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [speciesId, basePath, execute]);

  // 正直な空状態(a): 観測対象が未選択。この本自体を出さない(誇張ゼロ)。
  if (!speciesId) {
    return (
      <div className="knw-book" data-node-id={node.id}>
        <div className="wrap">
          <p className="empty-note">上のヘッダーで観測対象(種族)を選ぶと、その種族の本が開きます。</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="knw-book" data-node-id={node.id} />;
  }

  // 正直な空状態(b): 種族は選ばれているが、まだこの種族のスレッドが1件も無い。
  if (!book || book.chapters.length === 0) {
    return (
      <div className="knw-book" data-node-id={node.id}>
        <div className="wrap">
          <p className="empty-note">まだこの種族のスレッドがありません。困った/話したい で相談すると、ここに章が集まります。</p>
        </div>
      </div>
    );
  }

  // 「章をひらくと」の実例(mockup section4型)は常設デモではなく、この本の
  // 中で一番裏取りが進んだ章(無ければ先頭章)をそのまま実例として使う。
  const featured = book.chapters.find((ch) => ch.answer_verified) ?? book.chapters[0];
  const featuredBadge = speciesBookBadge(featured);

  const conclusionCard = (
    <div className="card">
      <h3 className="summary-title">📌 今わかっていること</h3>
      <div className="conclusion">
        <div className="cl-text">{featured.answer || "まだ答えの元になる投稿がありません。"}</div>
        {featured.answer_verified && (
          <span className="verified-badge">
            ✔ 裏取り済み(実観測{featured.cite_count}・追試{featured.retry_reproduced})
          </span>
        )}
      </div>
      {featured.status === "refuted" && (
        <div className="caution-item">
          <span className="ci-tag">⚠</span>
          反証(追試不成立)の報告が{featured.retry_not_reproduced}件あります
        </div>
      )}
      <div className="ai-note">
        ✨ この一文は、AIを使わなくても「一番裏取りされた投稿」をそのまま出せます。読みやすく整える磨きは、開いた時だけ・後から任意で足します(継続課金なし)。
      </div>
    </div>
  );

  return (
    <div className="knw-book" data-node-id={node.id}>
      <div className="wrap">
        <p className="obs-note">
          上で選んでいる「観測対象」ごとに1冊。種族を切り替えると、その種族の本に変わります。
        </p>

        {/* 1. book cover — mockup section1 (verbatim markup, real data wired) */}
        <section className="block">
          <div className="book-cover">
            <h1 className="book-title">📖 {book.species_name}の本</h1>
            <p className="book-purpose">
              この種族について、みんなのスレッドから分かったことを1冊にまとめた総合ページ。全部読まなくても「今わかっていること」に最初からたどり着けます。
            </p>
            <div className="book-stats">
              <span className="stat-chip">
                <span className="n">{book.chapter_count}</span> 章
              </span>
              <span className="stat-chip">
                束ねたスレ <span className="n">{book.thread_count}</span> 件
              </span>
              <span className="stat-chip verify">
                ✔ 裏取り済みの答え <span className="n">{book.verified_count}</span> 件
              </span>
            </div>
            <p className="honest-line">
              ✨ まとめ文は、その章に新しい話が増えた時だけ、開いた瞬間に静かに整えます(ふだんは動かない=継続課金なし)。
            </p>
          </div>
        </section>

        {/* 2. 目次 = 章一覧 — mockup section2 (verbatim markup, real data wired) */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">📑 目次(この種族の悩みごと)</h2>
            <p className="section-caption">
              章 = トピック。各章に「今わかっていること」と、それが ✔裏取り済み か △まだ未検証 かを付けます。数が多い＝正しい、で騙されないように。
            </p>
          </div>
          <div className="chapter-list">
            {book.chapters.map((ch) => {
              const badge = speciesBookBadge(ch);
              return (
                <div className="chapter-row" key={ch.topic}>
                  <div className="ch-body">
                    <div className="ch-top">
                      <span className="ch-name">{ch.topic}</span>
                      <span className={cn("badge", badge.cls)}>{badge.label}</span>
                    </div>
                    <p className="ch-answer">
                      <span className="extract">{badge.extract}</span>
                      {ch.answer || "まだ答えの元になる投稿がありません。"}
                    </p>
                    <div className="ch-meta">
                      束ねたスレ {ch.thread_count}件 ・ 最終更新 {formatDateJa(ch.latest_at)}
                    </div>
                  </div>
                  <div className="ch-go">›</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. 章をひらくと(section4型) — mockup section3 (verbatim markup, real
            data wired). 歴史が空の章は timeline カードごと出さない(正直表示)。 */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">📖 章をひらくと(例: {featured.topic})</h2>
            <p className="section-caption">
              左に「今の有力な答え」+裏取り、右に「移り変わり(歴史)」。この章に束ねた{featured.thread_count}スレを全部読まなくてよくなります。
            </p>
          </div>
          {featured.history.length > 0 ? (
            <div className="two-col">
              {conclusionCard}
              <div className="card">
                <h4 className="timeline-title">移り変わり(歴史)</h4>
                <div className="timeline">
                  {featured.history.map((h, i) => {
                    const isLast = i === featured.history.length - 1;
                    return (
                      <div className={cn("tl-item", isLast && "now")} key={`${h.at}-${i}`}>
                        <div className="tl-dot-col">
                          <div className="tl-dot" />
                          {!isLast && <div className="tl-line" />}
                        </div>
                        <div className="tl-content">
                          <span className="tl-date">{isLast ? "今" : formatDateJa(h.at)}</span>
                          {h.diff}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            conclusionCard
          )}
        </section>

        {/* 4. 本は自然に厚くなる(section5型) — mockup section4 (verbatim markup,
            real data wired). */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">🌳 本は自然に厚くなる</h2>
            <p className="section-caption">
              新しいスレが増えると、その悩みが章になり、この1冊に束ねられていく。スレ→章→種族の本、の順で積み上がります。
            </p>
          </div>
          <div className="card">
            <div className="tree-wrap">
              <div className="tree-parent">📖 {book.species_name}の本</div>
              <div className="tree-arrow">⬆</div>
              <div className="tree-children">
                {book.chapters.map((ch) => (
                  <div className="tree-chip" key={ch.topic}>
                    {ch.topic}
                  </div>
                ))}
                <div className="tree-chip">＋ 新しい章…</div>
              </div>
            </div>
            <p className="grow-note">章が増えるほど、この種族の本が自然に厚くなっていく</p>
          </div>
        </section>

        <footer className="foot">
          <b>この画面の正直な線引き</b>
          <ul>
            <li>
              <b>いま無料・AIなしで作れる部分</b>: 本・章の束ね・✔裏取り/△未検証バッジ・章数/スレ数・歴史の日付と骨格・樹形・「今わかっていること=一番裏取りされた投稿をそのまま」。全部、既にある計算(classifyPromotion・projectSummary)の水平展開です。
            </li>
            <li>
              <b>後から任意で足すAI</b>: まとめ文を1〜2行に読みやすく整えるところ「だけ」。開いた時だけ・新しい話が増えた章だけ・結果は保存して再利用。実際にAI鍵をつなぐのは人間の判断(ゲート)を待ちます。
            </li>
            <li>
              <b>章の増え方</b>: ヘッダーで観測対象(種族)を選んでいる時に「困った」で始めた相談は、その種族の本に自動でひもづきます(種族を選ばずに始めた相談は全体のスレになります)。まとめ文を読みやすく整えるAIの磨きは、開いた時だけ・後から任意で足します(継続課金なし・実際にAIをつなぐのは人の判断待ち)。
            </li>
            <li>
              <b>この画面に含めていないこと</b>: 論文系の画面(paper系)は別ラウンドで扱います。ここは「困った」から育つ種族の本の話です。
            </li>
          </ul>
        </footer>
      </div>
    </div>
  );
}

// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/knowledge-hub.json
// はnode {type:"list", props:{variant:"knowledge-hub"}} 1個のみでこの
// コンポーネントに委譲。動作影響なし):
//   4タブ構成(掲示板/記事/ブログ+種族の本=SpeciesBookNode)。「困った」相談から
//   スレが育ち、ヘッダーで種族を選んでいれば自動でその種の本に紐づく。
//   AI要約は開いた時だけ・後から任意(既定は無料・AIなしの集計のみ)。
function KnowledgeHubNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  // 種族の本の配線を閉じる: ヘッダーで観測対象(種族)を選んでいれば、ここで
  // 作る相談スレに species_id を添える(plaza-post.schema.json SW-1 の意図
  // 「ヘッダー『観測対象』の選択から付与」どおり)。未選択なら付けない=全体スレ。
  const headerScope = useContext(HeaderScopeCtx);
  const path = String(p.source_path ?? "/api/v1/plaza/search");
  const [tab, setTab] = useState<KnwHubTab>("komatta");
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<KnwHubMatch[]>([]);
  const [searched, setSearched] = useState(false);
  // section2 dup-confirm(新しく相談する → タイトル入力 → 一致度確認)。
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [topMatch, setTopMatch] = useState<KnwHubMatch | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setMatches([]);
      setSearched(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      // HDR-1第2スライス(A1#4): GET /plaza/search をヘッダー観測対象で絞る
      // (appendHeaderScope が既存の ?q= と衝突しない & 連結を行う)。
      Promise.resolve(
        execute({
          kind: "api",
          method: "GET",
          path: appendHeaderScope(`${path}?q=${encodeURIComponent(query)}`, headerScope),
        }),
      )
        .then((v) => {
          if (alive) setMatches(((v as KnwHubSearchView | undefined)?.matches ?? []).slice(0, 3));
        })
        .catch(() => {
          if (alive) setMatches([]);
        })
        .finally(() => {
          if (alive) setSearched(true);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, path, execute, headerScope.species, headerScope.lineageId]);

  // section2 dup-confirm — 同じ 200ms デバウンス+同じ GET /plaza/search を、
  // compose のタイトル入力に対してだけ再利用する(section1 の検索ボックスとは
  // 独立した state・上位1件だけ使う)。
  useEffect(() => {
    if (!composeOpen) return;
    const query = title.trim();
    if (!query) {
      setTopMatch(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      Promise.resolve(
        execute({
          kind: "api",
          method: "GET",
          path: appendHeaderScope(`${path}?q=${encodeURIComponent(query)}`, headerScope),
        }),
      )
        .then((v) => {
          if (alive) setTopMatch(((v as KnwHubSearchView | undefined)?.matches ?? [])[0] ?? null);
        })
        .catch(() => {
          if (alive) setTopMatch(null);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [title, composeOpen, path, execute, headerScope.species, headerScope.lineageId]);

  const similarity = topMatch ? titleSimilarity(title, topMatch.topic) : 0;
  const dupMatch = topMatch && similarity >= KNW_DUP_THRESHOLD ? topMatch : null;

  const createThread = useCallback(async () => {
    const topic = title.trim();
    if (!topic || creating) return;
    setCreating(true);
    try {
      // HDR-1第2bスライス(slice2b・批評家blocking是正)+ KNW stage4 種族の本の一本化:
      // ヘッダー観測対象(chrome由来のproducer・C9管轄)を新規スレの species_id へ自動付与
      // (SW-1の設計意図="選択から付与・ユーザー再入力なし")。空scope(すべて)は何も付けない。
      // ※KNW branch も同値(headerScope.species)を付与していた=統合時に本HEAD版へ一本化(二重付与なし)。
      const body: Record<string, unknown> = { channel: KNW_COMPOSE_CHANNEL, board_kind: KNW_COMPOSE_BOARD_KIND, topic, body: topic };
      if (headerScope.species) body.species_id = headerScope.species;
      const res = await execute({ kind: "api", method: "POST", path: "/api/v1/plaza/posts" }, body);
      const threadId = (res as { thread_id?: string } | undefined)?.thread_id;
      if (threadId) navigate("knowledge-thread", { thread_id: threadId });
    } finally {
      setCreating(false);
    }
  }, [execute, navigate, title, creating, headerScope.species]);

  return (
    <div className="knw-hub">
      <div className="wrap">
        {/* 0. header — mockup section0 (verbatim markup) */}
        <header className="top">
          <div className="wordmark">知の広場</div>
          <nav className="tabs">
            <button
              type="button"
              className={cn("tab", tab === "hanashitai" && "active")}
              aria-pressed={tab === "hanashitai"}
              onClick={() => setTab("hanashitai")}
            >
              話したい
            </button>
            <button
              type="button"
              className={cn("tab", tab === "komatta" && "active")}
              aria-pressed={tab === "komatta"}
              onClick={() => setTab("komatta")}
            >
              困った
            </button>
            <button
              type="button"
              className={cn("tab", tab === "ronbun" && "active")}
              aria-pressed={tab === "ronbun"}
              onClick={() => setTab("ronbun")}
            >
              論文
            </button>
            {/* wave1 KNW「種族の本」(R133) — 4本目のタブ。話したい/困った/論文の
                3タブは変更しない(既存動作維持)。 */}
            <button
              type="button"
              className={cn("tab", tab === "honbook" && "active")}
              aria-pressed={tab === "honbook"}
              onClick={() => setTab("honbook")}
            >
              この種族の本
            </button>
          </nav>
        </header>
        <p className="lead">みんなの記録から答えを探して、いっしょに解決する場所。</p>

        {/* 1. search first — mockup section1 (verbatim markup, real data wired) */}
        {tab === "komatta" && (
          <section className="block">
            <div className="section-head">
              <h2 className="section-title">🔍 まず探す</h2>
              <p className="section-caption">打っている途中から「これ?」を3件出す。同じ悩みのスレがばらけない。</p>
            </div>
            <div className="card">
              <div className="search-box">
                <span className="icon">🔍</span>
                <input
                  type="search"
                  placeholder="何に困ってる?"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="困りごとを検索"
                />
              </div>
              {searched && matches.length > 0 && (
                <div className="suggest">
                  {matches.map((m) => (
                    <a key={m.thread_id} className="suggest-row" href={`/s/knowledge-thread?thread_id=${m.thread_id}`}>
                      <div>
                        <div className="st-title">{m.topic}</div>
                        <div className="st-meta">
                          {m.post_count}件のやりとり ・ 最終更新 {formatDateJa(m.latest_at)}
                          {m.resolved && (
                            <>
                              {" "}
                              ・ <span className="badge-solved">✔解決済みの答えあり</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="go">›</div>
                    </a>
                  ))}
                </div>
              )}
              {searched && matches.length === 0 ? (
                <p className="helper-note">まだ近いスレはありません。新しく相談できます。</p>
              ) : (
                <p className="helper-note">当てはまるものがあれば、そこへ流れ着く → 情報が1か所に集まる</p>
              )}
            </div>
            {!composeOpen ? (
              <p className="lead" style={{ marginTop: 12, marginBottom: 0 }}>
                <button
                  type="button"
                  className="civ-link"
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}
                  onClick={() => setComposeOpen(true)}
                >
                  新しく相談する
                </button>
              </p>
            ) : (
              // 2. dup confirm on create — mockup section2 (verbatim markup, real data wired)
              <div className="card" style={{ marginTop: 12 }}>
                <input
                  type="text"
                  className="compose-title-field"
                  placeholder="相談したいことを入力"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="新しい相談のタイトル"
                />
                {dupMatch ? (
                  <div className="dup-banner">
                    <div className="dt">これに近い相談があります — これですか?</div>
                    <div className="dm">
                      「<b>{dupMatch.topic}</b>」
                    </div>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => navigate("knowledge-thread", { thread_id: dupMatch.thread_id })}
                      >
                        これだ・開く
                      </button>
                      <button type="button" className="btn ghost" disabled={creating} onClick={createThread}>
                        全然違う・新規で作る
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row">
                    <button type="button" className="btn primary" disabled={!title.trim() || creating} onClick={createThread}>
                      この内容で相談を始める
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {tab === "hanashitai" && (
          <section className="block">
            <p className="lead">同じ趣味の人と交流する。</p>
            <a className="card" href="/s/knowledge-board">
              <h2 className="section-title">公式掲示板</h2>
              <p className="section-caption">説明・愚痴・改善の3板でチャネルごとに集約します。</p>
            </a>
          </section>
        )}

        {tab === "ronbun" && (
          <section className="block">
            <p className="lead">論文を読む・書く・議論する。</p>
            <a className="card" href="/s/knowledge-paper">
              <h2 className="section-title">論文</h2>
              <p className="section-caption">論文の照合と引用の正本です。</p>
            </a>
          </section>
        )}

        {/* wave1 KNW「種族の本」— DRY: SpeciesBookNode 自体が list
            variant="species-book" として単独 mount も可能な自己完結コンポーネント
            (list dispatch 参照)。ここでは同じコンポーネントをタブの中身として
            そのまま埋め込む。 */}
        {tab === "honbook" && <SpeciesBookNode node={node} />}
      </div>
    </div>
  );
}

registerNode("list:threads", BoardThreadsNode);
registerNode("list:species-book", SpeciesBookNode);
registerNode("list:knowledge-hub", KnowledgeHubNode);
