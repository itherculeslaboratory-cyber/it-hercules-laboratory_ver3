"use client";
// 本格ビルダー = Puck を丸ごと採用(3ペイン: 部品パレット/キャンバス/プロパティ)。
// 代替A+B(R174): 主役は「既存の画面を fork(コピー)して微調整」。上の picker で既存画面
// (navigation.json を除く全 ScreenDef)から1枚を選ぶと、Puck に読み込んで開く((あ))。パレットには
// 検索2種など既に動く部品を置く((い)・puck.config.tsx)。
// 保存は Puck 保存形 → puckToScreenDef で ScreenDef に写し POST /builder/canvas。
// fork の時は screen_overrides を元の screen_id で上書き(系譜)して保存する。
import { useEffect, useState } from "react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { puckConfig } from "./puck.config";
import { puckToScreenDef, screenDefToPuck, slugify, type PuckData } from "@/lib/puck-to-screendef";
import type { ScreenDef } from "@/renderer/types";
import {
  saveCanvas,
  listForkableScreens,
  getScreenDef,
  type ForkableScreen,
} from "@/lib/fork-market";
import styles from "./fork.module.css";

const cx = (...names: string[]) => names.map((n) => styles[n] ?? "").join(" ");
const EMPTY: Data = { content: [], root: { props: {} } };

export default function Builder() {
  const [mode, setMode] = useState<"light" | "full">("full");
  const [data, setData] = useState<Data>(EMPTY);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"default" | "recommended" | "custom">("recommended");
  const [author, setAuthor] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; err?: boolean } | null>(null);

  // (あ) 既存画面の fork。
  const [screens, setScreens] = useState<ForkableScreen[] | null>(null);
  const [pick, setPick] = useState("");
  const [forking, setForking] = useState(false);
  const [forkedFrom, setForkedFrom] = useState<ForkableScreen | null>(null);
  // Puck は data を初期値として扱い、マウント後の data 差し替えを反映しない。fork/白紙で
  // 中身を丸ごと入れ替える時は key を変えて Puck を作り直す(その時の data で初期化される)。
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    listForkableScreens()
      .then(setScreens)
      .catch(() => setScreens([]));
  }, []);

  async function onFork() {
    if (!pick) return;
    setForking(true);
    setStatus(null);
    try {
      const def = (await getScreenDef(pick)) as unknown as ScreenDef;
      setData(screenDefToPuck(def) as Data);
      setSeq((s) => s + 1);
      const src = screens?.find((s) => s.id === pick) ?? { id: pick, title: pick };
      setForkedFrom(src);
      setName(`${src.title} のコピー`);
    } catch (e) {
      setStatus({ msg: `この画面を開けませんでした(${(e as Error).message})。`, err: true });
    } finally {
      setForking(false);
    }
  }

  function onNewBlank() {
    setForkedFrom(null);
    setData(EMPTY);
    setSeq((s) => s + 1);
    setName("");
    setPick("");
    setStatus(null);
  }

  async function onSave() {
    if (!name.trim()) {
      setStatus({ msg: "テンプレート名を入れてください。", err: true });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      // fork の時は元の screen_id を上書きキーにして系譜をつなぐ。新規は名前からスラグ。
      const screenId = forkedFrom ? forkedFrom.id : slugify(name);
      const def = puckToScreenDef(data as PuckData, { screenId, title: name.trim() });
      const res = await saveCanvas({
        name: name.trim(),
        level,
        social: author.trim() ? { author_name: author.trim() } : {},
        screen_overrides: { [screenId]: def },
      });
      setStatus({
        msg: forkedFrom
          ? `保存しました(「${forkedFrom.title}」から fork ・テンプレID: ${res.template_id})。`
          : `保存しました(テンプレID: ${res.template_id})。`,
      });
    } catch (e) {
      setStatus({
        msg: `保存できませんでした(${(e as Error).message})。ログインが必要な場合があります。`,
        err: true,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* (あ) 主役: 既存の画面を fork(コピー)して直す */}
      <div className={cx("fork-picker")}>
        <div className={cx("subhead")}>① 既存の画面を fork(コピー)して直す</div>
        <p className={cx("picker-lead")}>
          中身の詰まった既存の画面をまるごと複製して、見出し・ボタン・並びだけ直せます。ゼロから作るより速く、確実です。
        </p>
        <div className={cx("save-grid")}>
          <div className={cx("field", "full")}>
            <span className={cx("f-label")}>fork する画面を選ぶ</span>
            <select
              className={cx("f-input")}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={screens === null}
            >
              <option value="">
                {screens === null ? "読み込み中…" : `画面を選んでください(${screens.length}枚)`}
              </option>
              {(screens ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button type="button" className={cx("btn", "purple")} onClick={onFork} disabled={!pick || forking}>
            {forking ? "開いています…" : "🍴 この画面を fork して開く"}
          </button>
          <button type="button" className={cx("btn")} style={{ marginLeft: 8 }} onClick={onNewBlank}>
            ＋ 白紙から作る
          </button>
        </div>
        {forkedFrom && (
          <div className={cx("fork-banner")}>
            🍴 <b>「{forkedFrom.title}」</b> を fork して編集中です。直したら下の「テンプレートとして保存する」で保存します。
          </div>
        )}
      </div>

      <div className={cx("builder")}>
        <div className={cx("builder-bar")}>
          <span className={cx("bb-title")}>🧩 ② 組み立て・微調整(ビルダー)</span>
          <span className={cx("mode-toggle")}>
            <button type="button" className={cx("m", mode === "light" ? "on" : "")} onClick={() => setMode("light")}>
              軽い編集
            </button>
            <button type="button" className={cx("m", mode === "full" ? "on" : "")} onClick={() => setMode("full")}>
              本格ビルダー
            </button>
          </span>
        </div>
        {mode === "full" ? (
          <div className={cx("puck-host")}>
            {/* iframe を無効化: 埋め込み3ペインでは同一ドキュメントの方が軽く、テーマ変数
                (--civ-*)もそのまま効く(iframe 越しの style 注入が不要になる)。 */}
            <Puck
              key={seq}
              config={puckConfig}
              data={data}
              onChange={setData}
              iframe={{ enabled: false }}
              overrides={{ header: () => <></> }}
            />
          </div>
        ) : (
          <div className={cx("light-edit")}>
            「軽い編集」は、本格ビルダーで組んだ画面を数か所だけ手直しするための簡易モードです。中身の仕様は現在裁定中のため、ここでは切替の入口だけを置いています。今は「本格ビルダー」で組み立ててください。
          </div>
        )}
      </div>
      <div className={cx("mode-note")}>
        「軽い編集」⇄「本格ビルダー」の切替<b>入口</b>だけ置いています。切替の中身の仕様は裁定中のため、この画面では確定として描いていません。
      </div>

      <div className={cx("subhead")}>③ 組んだ画面をテンプレートとして保存</div>
      <div className={cx("save-grid")}>
        <div className={cx("field")}>
          <span className={cx("f-label")}>テンプレート名</span>
          <input
            className={cx("f-input")}
            placeholder="例: 観測ダッシュボード"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={cx("field")}>
          <span className={cx("f-label")}>推奨度</span>
          <select
            className={cx("f-input")}
            value={level}
            onChange={(e) => setLevel(e.target.value as "default" | "recommended" | "custom")}
          >
            <option value="default">標準</option>
            <option value="recommended">おすすめ</option>
            <option value="custom">カスタム</option>
          </select>
        </div>
        <div className={cx("field", "full")}>
          <span className={cx("f-label")}>作者名(任意)</span>
          <input
            className={cx("f-input")}
            placeholder="表示名"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="button" className={cx("btn", "primary")} onClick={onSave} disabled={saving}>
          {saving ? "保存中…" : "テンプレートとして保存する"}
        </button>
        <a href="#template-market" className={cx("btn", "purple")} style={{ marginLeft: 8, textDecoration: "none" }}>
          🍴 誰かのを真似て作る
        </a>
      </div>
      {status && <div className={cx("save-status", status.err ? "err" : "")}>{status.msg}</div>}
    </>
  );
}
