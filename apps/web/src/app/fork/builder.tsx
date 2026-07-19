"use client";
// 本格ビルダー = Puck を丸ごと採用(3ペイン: 部品パレット/キャンバス/プロパティ)。
// 「軽い編集」⇄「本格ビルダー」の切替は入口のみ(中身仕様は裁定中・hq_note)。
// 保存は Puck 保存形 → puckToScreenDef で ScreenDef に写し POST /builder/canvas。
import { useState } from "react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { puckConfig } from "./puck.config";
import { puckToScreenDef, slugify, type PuckData } from "@/lib/puck-to-screendef";
import { saveCanvas } from "@/lib/fork-market";
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

  async function onSave() {
    if (!name.trim()) {
      setStatus({ msg: "テンプレート名を入れてください。", err: true });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const screenId = slugify(name);
      const def = puckToScreenDef(data as PuckData, { screenId, title: name.trim() });
      const res = await saveCanvas({
        name: name.trim(),
        level,
        social: author.trim() ? { author_name: author.trim() } : {},
        screen_overrides: { [screenId]: def },
      });
      setStatus({ msg: `保存しました(テンプレID: ${res.template_id})。` });
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
      <div className={cx("builder")}>
        <div className={cx("builder-bar")}>
          <span className={cx("bb-title")}>🧩 組み立て(ビルダー)</span>
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
            <Puck config={puckConfig} data={data} onChange={setData} overrides={{ header: () => <></> }} />
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

      <div className={cx("subhead")}>組んだ画面をテンプレートとして保存</div>
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
