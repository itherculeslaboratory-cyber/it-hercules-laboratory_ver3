"use client";
// 創る(FORK)ゾーン本体。承認予想図 fork-forecast.html の逐語採用 + 実データ配線。
// 2画面を1枚に: テンプレート市場(ランキング/fork/出品)/ UIテンプレ(Puck ビルダー
// + 保存 + わたしのテンプレ)+ 正直な宿題(still_shallow #5)。
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  listMarketTemplates,
  publishTemplate,
  forkTemplate,
  kindLabel,
  PUBLISH_KINDS,
  type RankedTemplate,
} from "@/lib/fork-market";
import styles from "./fork.module.css";

const cx = (...names: string[]) => names.map((n) => styles[n] ?? "").join(" ");

// Puck を含むビルダーはクライアント専用(SSR させない)。
const Builder = dynamic(() => import("./builder"), {
  ssr: false,
  loading: () => <div className={cx("light-edit")}>ビルダーを読み込み中…</div>,
});

// データが1件も無いときに見せる例示行(承認絵と同じ・すべて「(例)」明記)。
const EXAMPLE_ROWS = [
  { n: "1", title: "観測ダッシュボード「温度重視」(例)", kind: "UIスキン", sub: "作者: なお(例) ・ fork 42 / 使用 130(例)", score: "88" },
  { n: "2", title: "血統ラベル用テンプレ(例)", kind: "グラフ", sub: "作者: けん(例) ・ fork 30 / 使用 96(例)", score: "81" },
  { n: "3", title: "新聞要約プロンプト集(例)", kind: "プロンプト", sub: "作者: みき(例) ・ fork 21 / 使用 70(例)", score: "74" },
];

export default function ForkZone() {
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [tpls, setTpls] = useState<RankedTemplate[] | null>(null);
  const [busyFork, setBusyFork] = useState<string | null>(null);
  const [showPub, setShowPub] = useState(false);
  const [pubTitle, setPubTitle] = useState("");
  const [pubKind, setPubKind] = useState("ui_skin");
  const [pubBusy, setPubBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const refetch = useCallback(() => {
    listMarketTemplates()
      .then(setTpls)
      .catch(() => setTpls([]));
  }, []);

  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    if (cur === "light" || cur === "dark") setThemeState(cur);
    refetch();
  }, [refetch]);

  function setTheme(t: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("hqTheme", t);
    } catch {
      /* storage blocked — attribute already applied */
    }
    setThemeState(t);
  }

  async function onFork(id: string) {
    setBusyFork(id);
    setMsg(null);
    try {
      await forkTemplate(id);
      setMsg({ text: "fork しました(自分用の複製を作りました)。" });
      refetch();
    } catch (e) {
      setMsg({ text: `fork できませんでした(${(e as Error).message})。`, err: true });
    } finally {
      setBusyFork(null);
    }
  }

  async function onPublish() {
    if (!pubTitle.trim()) {
      setMsg({ text: "出品するテンプレートの名前を入れてください。", err: true });
      return;
    }
    setPubBusy(true);
    setMsg(null);
    try {
      await publishTemplate(pubKind, pubTitle.trim());
      setMsg({ text: "出品しました。" });
      setPubTitle("");
      setShowPub(false);
      refetch();
    } catch (e) {
      setMsg({ text: `出品できませんでした(${(e as Error).message})。`, err: true });
    } finally {
      setPubBusy(false);
    }
  }

  const hasReal = Array.isArray(tpls) && tpls.length > 0;

  return (
    <div className={cx("fork-root")}>
      {/* ===== shared chrome (IA v2) ===== */}
      <div className={cx("chrome")}>
        <div className={cx("chrome-inner")}>
          <div className={cx("brand")}>創る</div>
          <div className={cx("obs-selector")}>
            <span className={cx("os-label")}>観測対象</span> ヘラクレスオオカブト <span className={cx("os-caret")}>▼</span>
          </div>
          <nav className={cx("chrome-nav")} aria-label="主要ナビゲーション">
            <a href="/s/obs-register">観測</a>
            <a href="/s/species">個体</a>
            <a href="/s/market-trade">市場</a>
            <a href="/s/knowledge-hub">知の広場</a>
          </nav>
          <div className={cx("chrome-icons")}>
            <span title="届いた出来事">🔔</span>
            <a className={cx("me-pill")} href="/s/profile">👤 マイページ</a>
            <div className={cx("theme-toggle")}>
              <button className={theme === "light" ? cx("active") : ""} onClick={() => setTheme("light")} aria-label="明るい">☀</button>
              <button className={theme === "dark" ? cx("active") : ""} onClick={() => setTheme("dark")} aria-label="暗い">🌙</button>
            </div>
          </div>
        </div>
        <div className={cx("chrome-note")}>
          「創る」はトップの4ゾーンには置きません。ホームのカードと、マイページの中から開きます(2026-07-19 承認の情報設計)。
        </div>
      </div>

      <div className={cx("wrap")}>
        <div className={cx("page-head")}>
          <h1 className={cx("page-title")}>創る(テンプレートで得をする)</h1>
          <p className={cx("page-lead")}>良いテンプレートを真似て・作って・共有する場所。コピーされた方が得をする文化です(fork文化)。</p>
        </div>

        <div className={cx("place-note")}>
          ⓘ <b>この画面の入口:</b> ホームの「創る」カード と マイページの中から開きます(トップナビの4ゾーンには置きません=2026-07-19 承認の情報設計)。
        </div>

        <div className={cx("arc-row")}>
          <div className={cx("arc", "find")}>
            <div className={cx("arc-k")}>真似る・探す</div>
            <div className={cx("arc-t")}>良いテンプレを見つけて真似る</div>
            <div className={cx("arc-d")}>みんなのテンプレをランキングで探し、1タップで fork(自分用に複製)。真似られた作者が得をします。</div>
          </div>
          <div className={cx("arc", "tell")}>
            <div className={cx("arc-k")}>作る・共有する</div>
            <div className={cx("arc-t")}>自分の画面を組んで共有する</div>
            <div className={cx("arc-d")}>ドラッグ&ドロップで観測画面やOSテンプレを組み立て、テンプレートとして保存・共有します。</div>
          </div>
        </div>

        {msg && (
          <div className={cx("save-status", msg.err ? "err" : "")} style={{ marginBottom: 14 }}>
            {msg.text}
          </div>
        )}

        {/* ============ 1. テンプレート市場 ============ */}
        <section className={cx("block")} id="template-market">
          <div className={cx("section-head")}>
            <span className={cx("screen-tag")}>真似る・探す ・ 画面: テンプレート市場</span>
            <h2 className={cx("section-title")}>🏪 テンプレをランキングで探す・出す</h2>
            <p className={cx("section-why")}>
              <b>なぜここに来る?</b> 「良い観測画面・良いプロンプト・良いテーマ」を探したい時、自分の作ったものを出品したい時。良いものは真似られるほど作者の得になります。
            </p>
          </div>
          <div className={cx("card")}>
            <div className={cx("subhead")}>ランキング</div>
            <div className={cx("rank-list")}>
              {tpls === null && <div className={cx("rk-sub")}>読み込み中…</div>}
              {hasReal &&
                tpls!.map((t, i) => (
                  <div className={cx("rank-row")} key={t.template_id}>
                    <span className={cx("rank-num", i === 0 ? "n1" : "")}>{i + 1}</span>
                    <div className={cx("rank-main")}>
                      <div className={cx("rk-title")}>{t.title}</div>
                      <div className={cx("rk-sub")}>
                        <span className={cx("kind-chip")}>{kindLabel(t.kind)}</span>
                        fork {t.fork_count}
                        {t.forked_from ? " ・ 🍴 派生" : ""}
                      </div>
                    </div>
                    <div className={cx("rank-score")}>
                      <div className={cx("rs-num")}>{t.score}</div>
                      <div className={cx("rs-label")}>スコア</div>
                    </div>
                    <button className={cx("fork-btn")} onClick={() => onFork(t.template_id)} disabled={busyFork === t.template_id}>
                      {busyFork === t.template_id ? "…" : "🍴 fork"}
                    </button>
                  </div>
                ))}
              {tpls !== null && !hasReal &&
                EXAMPLE_ROWS.map((r) => (
                  <div className={cx("rank-row")} key={r.n}>
                    <span className={cx("rank-num", r.n === "1" ? "n1" : "")}>{r.n}</span>
                    <div className={cx("rank-main")}>
                      <div className={cx("rk-title")}>{r.title}</div>
                      <div className={cx("rk-sub")}>
                        <span className={cx("kind-chip")}>{r.kind}</span>
                        {r.sub}
                      </div>
                    </div>
                    <div className={cx("rank-score")}>
                      <div className={cx("rs-num")}>{r.score}</div>
                      <div className={cx("rs-label")}>スコア(例)</div>
                    </div>
                    <span className={cx("fork-btn")} style={{ opacity: 0.55 }}>🍴 fork</span>
                  </div>
                ))}
            </div>

            <div className={cx("weight-note")}>
              スコアの重み(設計値): <span className={cx("wchip")}>使用 40</span>
              <span className={cx("wchip")}>継続 20</span>
              <span className={cx("wchip")}>評価 20</span>
              <span className={cx("wchip")}>fork 10</span>
              <span className={cx("wchip")}>改善 10</span>
            </div>

            <div className={cx("publish-row")}>
              <button className={cx("btn", "primary")} onClick={() => setShowPub((v) => !v)}>
                ＋ テンプレートを出品する
              </button>
            </div>
            {showPub && (
              <div className={cx("publish-form")}>
                <div className={cx("field")}>
                  <span className={cx("f-label")}>出品するテンプレート名</span>
                  <input className={cx("f-input")} placeholder="例: 温度重視ダッシュ" value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} />
                </div>
                <div className={cx("field")}>
                  <span className={cx("f-label")}>種別</span>
                  <select className={cx("f-input")} value={pubKind} onChange={(e) => setPubKind(e.target.value)}>
                    {PUBLISH_KINDS.map((k) => (
                      <option key={k} value={k}>{kindLabel(k)}</option>
                    ))}
                  </select>
                </div>
                <button className={cx("btn", "primary")} onClick={onPublish} disabled={pubBusy}>
                  {pubBusy ? "出品中…" : "出品する"}
                </button>
              </div>
            )}

            <p className={cx("source-note")}>
              API=<code>GET /api/v1/market/templates</code>(一覧: <code>title</code>/<code>kind</code>種別[論文/UIスキン/グラフ/重み/AIパック/プロンプト]/<code>score</code>)+ <code>POST /market/templates</code>(出品)+ <code>POST /market/templates/{"{id}"}/fork</code>(fork)。ランキング重み=使用40/継続20/評価20/fork10/改善10(MKT-22)。
              <b> 正直な現況:</b> <span className={cx("prep-tag")}>ランキングの重み付けは設計中</span> 現状の実データはfork数が中心で、継続・改善などの指標はまだ着地していません(still_shallow #5①・後の波)。表示スコアは設計値どおりに揃えた時の見え方です。
            </p>
          </div>
        </section>

        {/* ============ 2. UIテンプレート + ビルダー ============ */}
        <section className={cx("block")} id="ui-templates">
          <div className={cx("section-head")}>
            <span className={cx("screen-tag")}>作る・共有する ・ 画面: UIテンプレート(組み立てビルダー)</span>
            <h2 className={cx("section-title")}>🧩 画面をドラッグ&ドロップで組む</h2>
            <p className={cx("section-why")}>
              <b>なぜここに来る?</b> 良い既存画面を<b>fork(コピー)して自分用に微調整</b>したい時、または部品を並べて画面を組み立てたい時。組んだものはテンプレートとして保存し、みんなに共有できます(全観測対象・全員が対象)。
            </p>
          </div>
          <div className={cx("card")}>
            <div className={cx("adopt")}>
              <div className={cx("a-t")}>✅ この組み立て機能は「完成品」を丸ごと採用します(自作最小)</div>
              3ペインの組み立て画面は、実績のある無料の完成OSS(<b>Puck</b>・MITライセンス・約1.3万★・活発に更新)を丸ごと採用しています。理由=このアプリと同じReact製で、保存の形が<b>JSONの部品ツリー</b>=我々の画面定義(ScreenDef)に最も近く、読み取り専用の表示機能も内蔵しているためです。自作したのは「Puckの保存形 → 我々のScreenDef」への変換部分だけ(最小)。一から作っていません。
            </div>
            <div className={cx("place-note")}>
              <b>いま開放している実動部品(実際に動く物だけ):</b> ① 既存の画面を <b>fork(コピー)して微調整</b>(組み立て画面の選択欄に、fork できる画面の枚数を出しています) ② パレットの <b>検索2種</b>(個体をしぼり込む／観測対象をたどる・どちらも実データ接続済み) ③ <b>ボタンに動作</b>を紐付け(画面へ移動 / データを送る・取得する)。例:ボタンの動作を「検索(個体をしぼり込む)へ移動」にすると、押した時に本物の検索画面へ進みます。<br />
              <b>後の波(まだ):</b> グラフ/表への実データ結線、残りの部品(入力フォーム・一覧・タブ等)を1つずつパレットへ、保存したテンプレを画面として直接開く導線。ここに無い物は「まだ」です(正直表示)。
            </div>

            <Builder />

            <div className={cx("subhead")}>わたしのテンプレート</div>
            <div className={cx("tpl-grid")}>
              <div className={cx("tpl-card")}>
                <div className={cx("tpl-prev")}>🧩</div>
                <div className={cx("tpl-meta")}>
                  <div className={cx("tpl-name")}>温度重視ダッシュ(例)</div>
                  <div className={cx("tpl-stats")}><span>👍 12</span><span>💎 9</span><span>使用 24</span></div>
                  <span className={cx("adopt-badge")}>★ 採用候補</span>
                </div>
              </div>
              <div className={cx("tpl-card")}>
                <div className={cx("tpl-prev", "blue")}>🧩</div>
                <div className={cx("tpl-meta")}>
                  <div className={cx("tpl-name")}>血統ラベル用(例)</div>
                  <div className={cx("tpl-stats")}><span>👍 5</span><span>💎 2</span><span>使用 8</span></div>
                  <span className={cx("lineage-badge")}>🍴 標準から派生</span>
                </div>
              </div>
              <div className={cx("tpl-card")}>
                <div className={cx("tpl-prev", "warm")}>➕</div>
                <div className={cx("tpl-meta")}>
                  <div className={cx("tpl-name")}>新しく作る</div>
                  <div className={cx("tpl-stats")}><span>ビルダーで組む</span></div>
                </div>
              </div>
            </div>

            <p className={cx("source-note")}>
              API=<code>POST /api/v1/builder/canvas</code>(<code>ihl.ui.template.v1</code>: <code>name</code>名前 / <code>level</code>推奨度[標準/おすすめ/カスタム] / <code>social.author_name</code>作者名 / 組んだ画面ツリーを <code>screen_overrides</code> に格納)。投票集計=<code>projectTemplateVotes</code>(<code>likes</code>👍 / <code>platinum</code>💎 / <code>usage_count</code>使用者数 / <code>adoption_candidate</code>採用候補)。採用候補=💎が8票 または 使用者が21人 に到達で自動的に「★採用候補」。テーマのforkは <code>POST /theme-packs</code>+系譜(<code>lineage[]</code>)。
              <b> 正直な現況:</b> テンプレ一覧と投票数を返すGET route はまだ採番されていないため、上の「わたしのテンプレート」は「(例)」表示です(投票数の配線はクライアント側=<code>lib</code>で行います)。テンプレの<b>公開・公開解除は人間ゲート</b>です。
            </p>
          </div>
        </section>

        {/* ============ 正直な宿題 ============ */}
        <section className={cx("block")} id="homework">
          <div className={cx("section-head")}>
            <span className={cx("screen-tag")}>正直な宿題 ・ 創るゾーンで詰め切れていない点</span>
            <h2 className={cx("section-title")}>⚠ まだ詰め切れていない点(設計中/裁定待ち)</h2>
            <p className={cx("section-why")}>この画面で「作りと並び」は決められますが、以下は仕組みとして未確定です。正直に出します。</p>
          </div>
          <div className={cx("card")}>
            <div className={cx("homework")}>
              <div className={cx("hw-t")}>創るゾーンの宿題(仕組みとして未確定な3点)</div>
              <ul>
                <li><b>ランキングの指標</b>: 「fork(合流)が1票としてランキングを押し上げる」一方で、使用/継続/評価/改善という重みはまだ実データに着地していません(今はfork数が中心)。重みの本実装は後の波です。</li>
                <li><b>色が見えにくい人への先回り提案</b>: 「この配色は読みにくい」を先回りで直す提案は、単純な差分マッチでは閉じません(読みやすさは複数の色の組み合わせに跨るため)。仕組みは検討中(後の波)。</li>
                <li><b>各画面の「これをテンプレ化」ボタン</b>: 既存画面の fork 自体は組み立て画面上の選択欄で<b>できます</b>(既存画面から選んで開く)。ただし観測登録・個体詳細などの<b>各画面側</b>に「この画面をテンプレ化」ボタンを置く横断作業は、まだ着手していません(各画面への追加作業待ち)。</li>
              </ul>
            </div>
            <p className={cx("source-note")}>
              出典=<code>usecase-driven-design.md</code> の still_shallow クラスタ #5(fork-template-culture)。ここに挙げた3点は「作り・並び」の承認とは別に、仕組みとして後続ラウンドで詰めます。
            </p>
          </div>
        </section>

        <footer className={cx("foot")}>
          創る(FORK)ゾーン。組み立て機能は完成OSS(Puck)を丸ごと採用し、保存を我々の画面定義へ変換するアダプタだけ自作しています。見た目・並びは承認予想図の逐語採用です。
        </footer>
      </div>
    </div>
  );
}
