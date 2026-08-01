"use client";

import { useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ScreenNode } from "../types";
import { ExecuteCtx } from "../core/context";
import { formatDateJa } from "../core/scope";
import { registerNode } from "../core/registry";

// home 完成予想図v2(承認済みmockup D:\claude\00-hq\dashboard\mockups\
// c9-home-forecast-v2.html・R112 90点採用)の verbatim 採用: list
// variant="home-dashboard" 専用ノード(KnowledgeHubNode と同じ in-scope トリック
// — schema node type enum は本タスクのスコープ外なので新種を起こさない)。
// mockup の markup/className を一字一句採用し(globals.css の `.home-dashboard `
// スコープCSS参照)、home-routes.ts/ledger-routes.ts の既存 GET 3本
// (/home/summary・/me/ledger・/home/civ-minimap)を KnowledgeHubNode と同じ
// 自前 useEffect+execute パターンで叩いて実データを流し込む。
//
// mockup から意図的に省いたもの(誇張ゼロ=実データの裏付けがない要素は出さない
// — KnowledgeThreadChatNode の ctx-chips 省略と同じ判断):
//  - ribbon(「完成予想図です」バナー)・footer の承認メタ文言・末尾の inline
//    テーマ切替 <script> — mockup限定の chrome。テーマはアプリ本体の
//    data-theme システム(AppShellNode の ThemeToggleButton・全画面共通)に乗る。
//  - ctx-line(「あなたの観測対象: …」種名タグ) — 対応する取得APIがない
//    (このタスクの実データ配線リストに含まれない)。
//  - primary-grid 4カードの pc-badge(「今日5件の予定」等) — 主な行き先は
//    "静的ナビ"として指示されており、4カードのうち今日の状態から正確に
//    導出できるのは observe だけで残り3枚(個体数/新着スレ/取引中)に対応する
//    APIが無い。不揃いな実装(1枚だけ実数字・3枚は無し)を避け、4枚とも
//    バッジ無しの静的カードに統一。
//  - 文明の状態タイル「信頼度の平均」 — R135-a裁定(round-18 V3-UIX-84)
//    「合成指標『信頼度』禁止・生の事実のみ」により丸ごと省略、残り2タイルの
//    grid を repeat(2,1fr) に変更(空欄を作らない)。
interface HomeScheduleLine {
  individual_id: string;
  days: number;
  overdue: boolean;
  deep_link: string;
}
interface HomeJudicialInboxItem {
  dispute_id: string;
  category: string;
  vote_deadline: string | null;
}
interface HomeSummary {
  overdue: unknown[];
  near: unknown[];
  today_lines: HomeScheduleLine[];
  judicial_inbox: HomeJudicialInboxItem[];
}
interface HomeLedgerView {
  karma_value: number;
  platinum_coins: number;
}
interface HomeCivMinimapView {
  observation_pace_7d: number;
  template_growth: number;
}

// 次の一手の日数バッジ文言(overdue=マイナス方向・near=0以上)。mockup の実例は
// 「3日遅れ」「明日」「2日後」— days===0(今日中)は mockup に例が無いが
// home-routes.ts の実データ上あり得るため素朴に「今日」で埋める(捏造ではなく
// 既存の日数フィールドをそのまま文言化しただけ)。
function dueDayBadge(line: HomeScheduleLine): string {
  if (line.overdue) return `${Math.abs(line.days)}日遅れ`;
  if (line.days === 0) return "今日";
  if (line.days === 1) return "明日";
  return `${line.days}日後`;
}

// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/home.jsonは
// node {type:"list", props:{variant:"home-dashboard"}} 1個のみでこの
// コンポーネントに委譲。動作影響なし):
//   次の一手スケジュール行(お世話/観測の期日バッジ)+主要ゾーンへの
//   ショートカットグリッド(pc-b等)+ドロワーナビ(DRAWER_NAV_ITEMS)への導線。
//   信頼度平均タイルは裁定により非実装(R135-a)。
function HomeDashboardNode({ node }: { node: ScreenNode }) {
  const execute = useContext(ExecuteCtx);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [ledger, setLedger] = useState<HomeLedgerView | null>(null);
  const [civ, setCiv] = useState<HomeCivMinimapView | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/home/summary" }))
      .then((v) => {
        if (alive) setSummary((v as HomeSummary | undefined) ?? null);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/ledger" }))
      .then((v) => {
        if (alive) setLedger((v as HomeLedgerView | undefined) ?? null);
      })
      .catch(() => {
        if (alive) setLedger(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/home/civ-minimap" }))
      .then((v) => {
        if (alive) setCiv((v as HomeCivMinimapView | undefined) ?? null);
      })
      .catch(() => {
        if (alive) setCiv(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overdueCount = summary?.overdue.length ?? 0;
  const nearCount = summary?.near.length ?? 0;
  const inboxCount = summary?.judicial_inbox.length ?? 0;
  const karma = ledger?.karma_value ?? 0;
  const karmaText = karma > 0 ? `+${karma}` : String(karma);
  const platinum = ledger?.platinum_coins ?? 0;
  const todayLines = summary?.today_lines ?? [];
  const inboxItems = summary?.judicial_inbox ?? [];
  const pace = civ?.observation_pace_7d ?? 0;
  const growth = civ?.template_growth ?? 0;

  return (
    <div className="home-dashboard" data-node-id={node.id}>
      <div className="wrap">
        <header className="top">
          <h1 className="wordmark">ホーム</h1>
        </header>
        <p className="lead">今日やることと、届いた出来事を10秒で把握して、次の場所へ飛ぶ司令塔。</p>

        {/* 1. 今日の状態 — mockup section1 (verbatim markup, real data wired) */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">📊 今日の状態</h2>
            <p className="section-caption">開いてまず見る数字。ここだけで今日やるべきことがあるか分かる。</p>
          </div>
          <div className="stat-row">
            <div className="stat-tile warn">
              <div className="st-icon">⏰</div>
              <div className="st-num">{overdueCount}</div>
              <div className="st-label">観測が遅れている</div>
            </div>
            <div className="stat-tile info">
              <div className="st-icon">🔔</div>
              <div className="st-num">{nearCount}</div>
              <div className="st-label">もうすぐ観測日</div>
            </div>
            <div className="stat-tile info">
              <div className="st-icon">✉️</div>
              <div className="st-num">{inboxCount}</div>
              <div className="st-label">届いた出来事</div>
            </div>
            <div className="stat-tile good">
              <div className="st-icon">🌟</div>
              <div className="st-num">{karmaText}</div>
              <div className="st-label">貢献度</div>
              <div className="st-sub">プラチナコイン {platinum}枚</div>
            </div>
          </div>
          <p className="source-note">これらの数字は自動でその日の最新に更新されます。</p>
        </section>

        {/* 2. 主な行き先(4主要動線・同列primary) — 静的ナビ */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">🧭 主な行き先</h2>
            <p className="section-caption">毎日いちばん使う4つの入口。ここから各エリアへ飛ぶ。</p>
          </div>
          <div className="primary-grid">
            <a className="primary-card obs" href="/s/obs-register">
              <div className="pc-icon">🔭</div>
              <div className="pc-title">観測を始める</div>
              <div className="pc-desc">目の前の個体の変化を記録する。すべての記録の出発点。</div>
            </a>
            <a className="primary-card ind" href="/finder/finder.html">
              <div className="pc-icon">🐛</div>
              <div className="pc-title">個体を探す</div>
              <div className="pc-desc">飼っている個体を一覧・血統・成長でたどる。理想の個体を見つける。</div>
            </a>
            <a className="primary-card knw" href="/s/knowledge-hub">
              <div className="pc-icon">💬</div>
              <div className="pc-title">知の広場</div>
              <div className="pc-desc">みんなの記録から答えを探し、困りごとを相談する。</div>
            </a>
            <a className="primary-card mkt" href="/s/market-trade">
              <div className="pc-icon">🛒</div>
              <div className="pc-title">マーケット</div>
              <div className="pc-desc">安心して買う・出す。進行中の取引を見失わない。</div>
            </a>
          </div>
        </section>

        {/* 3. 次の一手 — mockup section3 (verbatim markup, real data wired) */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">🔭 次の一手</h2>
            <p className="section-caption">観測が必要な個体を最大3件だけ。多く出しすぎない。</p>
          </div>
          <div className="card">
            {todayLines.length === 0 ? (
              <p className="civ-empty">今日観測が必要な個体はありません</p>
            ) : (
              <div className="today-list">
                {todayLines.map((line) => (
                  <div className="today-row" key={line.individual_id}>
                    <div>
                      <div className="today-id">{line.individual_id}</div>
                      <span className={cn("day-badge", line.overdue ? "overdue" : "near")}>
                        {dueDayBadge(line)}
                      </span>
                    </div>
                    <a className="link-btn" href={line.deep_link}>
                      記録する
                    </a>
                  </div>
                ))}
              </div>
            )}
            <p className="source-note">観測が必要な個体を最大3件だけ表示します(個体IDで並びます)。</p>
          </div>
        </section>

        {/* 4. 届いた出来事 — mockup section4 (verbatim markup, real data wired) */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">✉️ 届いた出来事</h2>
            <p className="section-caption">新しい話し合いを最大5件だけ。締切があるものから並ぶ。</p>
          </div>
          <div className="card">
            {inboxItems.length === 0 ? (
              <p className="civ-empty">新しく届いた話し合いはありません</p>
            ) : (
              <div className="inbox-list">
                {inboxItems.map((item) => (
                  <div className="inbox-row" key={item.dispute_id}>
                    <div className="inbox-deadline">
                      <span className="dl-label">締切</span>
                      {item.vote_deadline
                        ? `${formatDateJa(item.vote_deadline)} まで ・ ${item.category}`
                        : `未定 ・ ${item.category}`}
                    </div>
                    <a className="link-btn secondary" href={`/s/dispute?dispute_id=${item.dispute_id}`}>
                      話し合いを見る
                    </a>
                  </div>
                ))}
              </div>
            )}
            <p className="source-note">新しく届いた話し合いを最大5件、締切が近い順に表示します。</p>
          </div>
        </section>

        {/* 5. 文明の状態 — 信頼度タイルは丸ごと省略(R135-a)。残り2タイルを
            grid 2列で描画(空欄を作らない)。 */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">🌍 文明の状態</h2>
            <p className="section-caption">みんなの活動の集計。誰の値かは出ません。</p>
          </div>
          <div className="card">
            <div className="civ-row">
              <div className="civ-tile">
                <div className="ct-num">{pace}件</div>
                <div className="ct-label">直近7日の観測件数</div>
              </div>
              <div className="civ-tile">
                <div className="ct-num">{growth}件</div>
                <div className="ct-label">共有されたテンプレの数</div>
              </div>
            </div>
            <p className="civ-privacy-note">個人が特定できる値は含まれません(非PII集計)。</p>
          </div>
        </section>

        {/* 6. 作る・整える(二次項目をグルーピング) — 旧6番「観測対象を特定する」
            (obs-navigator の3モード・3枚のtool-card)はR157「ヘッダーにあるのに
            ホーム内にあるのはおかしい」でホームから撤去し、HeaderScopeSelector
            (AppShellNode・ロゴ隣)へ一本化した(c9-structure-canon.md §1・§1c)。
            obs-navigator画面自体は撤去していない(obs-entry「対象を特定する」
            リンクから引き続き到達可能・home.jsonのtransitions[]からは除去)。 */}
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">🛠 作る・整える</h2>
            <p className="section-caption">毎日は使わないけれど大事なもの。3つにまとめました。</p>
          </div>
          <div className="secondary-grid">
            <div className="sec-card builder">
              <a className="sc-head-link" href="/s/ui-templates">
                <div className="sc-head">
                  <span className="sc-icon">🧩</span>
                  <span className="sc-title">
                    記録画面を作る<span className="core-tag">中核・残します</span>
                  </span>
                </div>
                <p className="sc-desc">
                  飼っている生きものに合わせて、自分専用の記録画面を作る・人の作った画面を真似る。どんな観測対象にも対応するための中心機能です。
                </p>
              </a>
              <div className="sc-sub">
                <a className="sub-chip" href="/s/ui-templates">
                  かんたんに作る
                </a>
                <a className="sub-chip" href="/s/ui-templates">
                  細かく作り込む
                </a>
                <a className="sub-chip" href="/s/ui-templates">
                  人の画面を真似る
                </a>
                <a className="sub-chip" href="/s/theme-gallery">
                  🎨 色を変える(テーマ)
                </a>
              </div>
            </div>

            <div className="sec-card">
              <a className="sc-head-link" href="/s/settings">
                <div className="sc-head">
                  <span className="sc-icon">⚙️</span>
                  <span className="sc-title">設定</span>
                </div>
                <p className="sc-desc">アプリの調整はここにまとめました。ばらばらに置きません。</p>
              </a>
              <div className="sc-sub">
                <a className="sub-chip" href="/s/device">
                  📡 センサー機器
                </a>
                <a className="sub-chip" href="/s/costs">
                  💰 かかった費用
                </a>
                <a className="sub-chip" href="/s/ai-profile-settings">
                  🤖 AIの設定
                </a>
                <a className="sub-chip" href="/s/settings">
                  🌐 言語・国
                </a>
                <a className="sub-chip" href="/s/profile">
                  👤 プロフィール
                </a>
              </div>
            </div>

            <div className="sec-card">
              <a className="sc-head-link" href="/s/dispute">
                <div className="sc-head">
                  <span className="sc-icon">🤝</span>
                  <span className="sc-title">話し合いの場</span>
                </div>
                <p className="sc-desc">取引などのもめごとを当事者で解決する場所。アプリへの不満・こう直してほしいという要望もここから出せます。</p>
              </a>
              <div className="sc-sub">
                <a className="sub-chip" href="/s/dispute">
                  相手と話し合う
                </a>
                <a className="sub-chip" href="/s/dispute">
                  改善してほしいことを送る
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:home-dashboard", HomeDashboardNode);
