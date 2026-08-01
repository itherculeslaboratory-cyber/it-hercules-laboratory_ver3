"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/cn";
import type { ScreenNode } from "../types";
import {
  DEFAULT_HEADER_SCOPE,
  ExecuteCtx,
  HeaderScopeCtx,
  LayoutCtx,
  NavigateCtx,
  ScreenIdCtx,
  type HeaderScope,
} from "../core/context";
import { registerNode, lookupNode } from "../core/registry";
import type { TargetCandidate } from "./search";
// renderer分割Phase 2b裁定(g85-split2a-ruling §3 #7)で解消: Z5→Z2の
// zone→zone importだったTargetNavigatorNodeはlookupNode("target-navigator")に
// 置換した(下記TargetNavigatorSlot)。props/Childrenはcore/node-view.tsxから
// import可能になったのでプレースホルダではなくなった。
import { Children, props } from "../core/node-view";

function TargetNavigatorSlot(p: { confirmLabel?: string; onConfirm?: (c: TargetCandidate) => void }) {
  const Comp = lookupNode("target-navigator") as
    | ((props: { confirmLabel?: string; onConfirm?: (c: TargetCandidate) => void }) => ReactElement | null)
    | undefined;
  return Comp ? <Comp confirmLabel={p.confirmLabel} onConfirm={p.onConfirm} /> : null;
}

// V3-UIX-28 全画面共通ブランドクロム + V3-AUT-12 ログイン/登録/ログアウトの
// 常時ナビ。app-shell は47全screen-defに1個ずつ既にあるため、ここ1箇所に
// 実装すれば全画面へ横展開される(per-screen改修不要)。
//
// ロゴは画像アセットパイプライン(apps/web にはまだ public/ が無い)を新設
// せず、差し替え容易なテキストワードマークで表す(ponytail: 画像ロゴが要る
// ようになったら public/ を新設してこの1箇所を <img> に差し替える)。
//
// 認証状態は既存の公開 GET /api/v1/auth/session(401を返さない)で判定。未
// ログイン中は knowledge-board 等の保護ルートへの死にリンクを見せないよう
// フッター(愚痴/投票/Builder)とヘッダーの深い導線を隠し、ブランド+ログイン/
// 新規登録の最小ヘッダーだけを出す。「新規登録」はこのアプリがマジックリンク
// 一本化方針(専用サインアップ画面なし)のため /s/login と同じ遷移先だが、
// V3-AUT-12 が要求する3リンク(ログイン/登録/ログアウト)を文言として満たす。
function ChromeAuthLinks({
  authenticated,
  loggingOut,
  onLogout,
}: {
  authenticated: boolean;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  if (!authenticated) {
    return (
      <>
        <a className="civ-link civ-chrome-link" href="/s/login">
          ログイン
        </a>
        <a className="civ-link civ-chrome-link" href="/s/login">
          新規登録
        </a>
      </>
    );
  }
  return (
    <button
      type="button"
      className={cn("civ-interactive", "civ-button", "civ-chrome-link")}
      data-variant="ghost"
      aria-busy={loggingOut || undefined}
      onClick={onLogout}
    >
      ログアウト
    </button>
  );
}

// design-home-round.md §③: theme.js (public/assets/theme.js) auto-injects a
// #hqThemeToggle.hdtoggle button as the last child of the first ".headbar" it
// finds — that pattern works on the static caseB7 HTML pages, but on this
// React app it races the framework's hydration: theme.js's DOMContentLoaded
// listener frequently fires before/while React hydrates the header, and a
// DOM node appearing inside a React-managed subtree that React didn't render
// itself trips a hard "Hydration failed" error in `next dev` (verified via
// e2e — 55/175 screen-sweep failures). theme.js's own contract already
// documents the escape hatch: `injectToggleButton()` no-ops immediately if an
// element with id="hqThemeToggle" already exists. So this renders that same
// button as ordinary React output (present identically in the SSR HTML and
// the client's first render — no diff, no race) and replicates the ~10 lines
// of toggle behaviour theme.js itself uses. theme.js is unmodified; its
// auto-injection simply never fires on this app because the id is already
// taken care of.
//
// suppressHydrationWarning on the button: theme.js's own top-level
// `applyTheme(currentTheme())` call (the same synchronous, pre-hydration call
// that sets <html data-theme>) ALSO does `document.getElementById(
// 'hqThemeToggle').setAttribute('aria-pressed', ...)` if the button already
// exists — which, once this button is SSR-rendered, it does. So aria-pressed
// gets the same "real value written before React hydrates" treatment as
// data-theme (verified via e2e: SSR always renders aria-pressed=false since
// useState starts null, but theme.js overwrites it to the real value
// pre-hydration — an intentional attribute mismatch, not a bug, same pattern
// the <html> tag already carries).
function ThemeToggleButton() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme"));
  }, []);
  const onClick = useCallback(() => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    try {
      localStorage.setItem("hqTheme", next);
    } catch {
      // file:// or blocked storage — same tolerance as theme.js.
    }
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  }, []);
  return (
    <button
      type="button"
      id="hqThemeToggle"
      className="hdtoggle"
      title="ライト/ダーク切替"
      aria-label="ライト/ダーク切替"
      aria-pressed={theme === "light"}
      suppressHydrationWarning
      onClick={onClick}
    >
      🌓
    </button>
  );
}

// HDR-1(c9-structure-canon.md §1/§1b/§1c・R112/R115採用)ヘッダー常駐「観測対象」
// セレクタ。ロゴ隣に現在の選択(層1=種・層2=血統ブランド)をチップ表示し、開く
// と target-navigator(既存の3モード=名前で探す/はい・いいえ/分類からたどる)
// を「確定=preferences保存」に差し替えて流用する(TargetNavigatorNodeの
// onConfirm差し替え・obs-navigator画面側は無変更)。血統ブランド(層2)は
// taxonomy検索の対象外の自由タグ(V3-IND-34)なので別枠のテキスト入力。
// ネイティブ<dialog>(showModal)を使う(rung4: モーダルライブラリを増やさない)。
function HeaderScopeSelector({
  scope,
  onSaved,
}: {
  scope: HeaderScope;
  onSaved: (next: HeaderScope) => void;
}) {
  const execute = useContext(ExecuteCtx);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [lineageDraft, setLineageDraft] = useState(scope.lineageId);
  const [saving, setSaving] = useState(false);
  // screen-sweep.spec.ts(e2e)の "最初の.civ-heading" 契約(全55画面共通)を
  // 壊さないための必須ガード: <dialog>は閉じていてもDOM上に残る(UAが
  // display:noneにするだけ)ため、中身を無条件に描画すると隠れたh2.civ-heading
  // がDOM順で本文の見出しより先に来て `.first()` を奪う。ドロワーが開いている
  // 間だけ中身を描画する(TargetNavigatorNodeの初回taxonomy fetchも未使用時に
  // 走らせない副次効果あり=不変条項①)。
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onNativeClose = () => setIsOpen(false);
    el.addEventListener("close", onNativeClose);
    return () => el.removeEventListener("close", onNativeClose);
  }, []);

  // showModal/close は jsdom(単体テスト環境)に実装が無いため feature-detect
  // し、無い環境では素の open 属性トグルへ退化させる(トップレイヤー/背景幕/
  // フォーカストラップは失うが、コンテンツ自体は非モーダル<dialog>として
  // 引き続き可視・操作可能 — 実ブラウザは常にshowModal/closeを持つので通常
  // 経路は変わらない)。close() は isOpen を直接falseにする(ESCキー等ネイティブ
  // 経路は上のuseEffectの'close'イベント購読が担当・二重にfalseを立てても無害)。
  const open = useCallback(() => {
    setLineageDraft(scope.lineageId);
    setIsOpen(true);
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, [scope.lineageId]);
  const close = useCallback(() => {
    setIsOpen(false);
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  }, []);

  const patchScope = useCallback(
    async (partial: Partial<HeaderScope>) => {
      setSaving(true);
      try {
        const body: Record<string, string> = {};
        if (partial.species !== undefined) body.scope_species = partial.species;
        if (partial.lineageId !== undefined) body.scope_lineage_id = partial.lineageId;
        await execute({ kind: "api", method: "PATCH", path: "/api/v1/me/preferences" }, body);
        onSaved({ ...scope, ...partial });
        close();
      } finally {
        setSaving(false);
      }
    },
    [execute, scope, onSaved, close],
  );

  const chipText =
    scope.species && scope.lineageId
      ? `${scope.species} / ${scope.lineageId}`
      : scope.species || scope.lineageId || "すべて";

  return (
    <div className="civ-scope-selector">
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="secondary"
        aria-haspopup="dialog"
        onClick={open}
      >
        観測対象: {chipText}
      </button>
      <dialog ref={dialogRef} className="civ-scope-dialog" aria-label="観測対象を選ぶ">
        {isOpen && (
          <div className="civ-scope-dialog-body">
            <h2 className="civ-heading">観測対象を選ぶ</h2>
            <p className="civ-text" data-muted="true">
              今この対象を見ています。選ぶと、個体一覧・個体ファインダー・検索がこの対象だけに絞られます(市場・知の広場・研究は次のスライスまで対象外)。
            </p>
            {(scope.species || scope.lineageId) && (
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                disabled={saving}
                onClick={() => void patchScope({ species: "", lineageId: "" })}
              >
                すべてに戻す
              </button>
            )}
            <TargetNavigatorSlot
              confirmLabel="この対象を観測対象にする"
              onConfirm={(c) => void patchScope({ species: c.scientific_name })}
            />
            <div className="civ-field">
              <label className="civ-text" htmlFor="civ-scope-lineage">
                系統(血統ブランド)
              </label>
              <input
                id="civ-scope-lineage"
                className="civ-input"
                value={lineageDraft}
                onChange={(e) => setLineageDraft(e.target.value)}
                placeholder="例: 王シリーズ"
              />
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="primary"
                disabled={saving || !lineageDraft.trim()}
                onClick={() => void patchScope({ lineageId: lineageDraft.trim() })}
              >
                この系統にする
              </button>
            </div>
            <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" onClick={close}>
              閉じる
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}

// V3-UIX-39(第21回裁定 2026-07-31・hold解除): ドロワー集約ナビ・最大2段・
// 大分類7区分(観測登録/マーケット/検索/知の広場/変換/OS/プロフィール — 第19回裁定で
// 「観測」→「観測登録」「掲示板」→「知の広場」に改称済み)。既存の civ-chrome-nav
// (4リンク)とは別の独立したナビ面として追加する(既存リンクの置換ではない=回帰防止)。
// ★判断が要った箇所(報告書R0731-bf8032参照): 「変換」「OS」の2区分は screen-defs/*.json
// 58画面・navigation.json・srs.md のいずれにも対応する画面が存在せず、リンク先を
// 推測で埋めなかった(リンク先未定義として非活性表示)。残り5区分は既存route実績値を使用。
// maxDepth=2 は上限であり下限ではないため、サブカテゴリ未定義のこの段では1段のみで
// 要件を満たす(将来サブカテゴリが定義され次第、ここへtreeを継ぎ足す)。
const DRAWER_NAV_ITEMS: Array<{ label: string; href: string | null }> = [
  { label: "観測登録", href: "/s/obs-register" },
  { label: "マーケット", href: "/s/market-trade" },
  { label: "検索", href: "/s/obs-search" },
  { label: "知の広場", href: "/s/knowledge-hub" },
  { label: "変換", href: null },
  { label: "OS", href: null },
  { label: "プロフィール", href: "/me/me.html" },
];

function DrawerNav() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onNativeClose = () => setIsOpen(false);
    el.addEventListener("close", onNativeClose);
    return () => el.removeEventListener("close", onNativeClose);
  }, []);
  const open = useCallback(() => {
    setIsOpen(true);
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  }, []);
  return (
    <div className="civ-drawer-nav">
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="ghost"
        aria-haspopup="dialog"
        aria-label="メニュー"
        onClick={open}
      >
        ☰
      </button>
      <dialog ref={dialogRef} className="civ-drawer-dialog" aria-label="大分類メニュー">
        {isOpen && (
          <nav className="civ-drawer-dialog-body" aria-label="大分類ナビゲーション">
            <h2 className="civ-heading">メニュー</h2>
            <ul className="civ-drawer-list">
              {DRAWER_NAV_ITEMS.map((item) =>
                item.href ? (
                  <li key={item.label}>
                    <a className="civ-link civ-drawer-link" href={item.href} onClick={close}>
                      {item.label}
                    </a>
                  </li>
                ) : (
                  <li key={item.label}>
                    <span className="civ-text civ-drawer-link" data-muted="true" aria-disabled="true">
                      {item.label}(リンク先未定義)
                    </span>
                  </li>
                ),
              )}
            </ul>
            <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" onClick={close}>
              閉じる
            </button>
          </nav>
        )}
      </dialog>
    </div>
  );
}

// g79-bundleA(V3-UIX-59【R136/S1】確定(修正)・b2think §2-5案1/§2-6): 「この画面
// について」パネル。段階導入 — app-shellノードの props.page_info を持つ画面
// だけトリガーを出す(未整備画面には何も足さない=誇張ゼロ。structure-canon.md:40の
// STRIP-1で撤去済みの3導線(愚痴/改善/Builder)のうち、G79-2裁定により愚痴/改善の
// 2導線のみ復活可=Builder・manualは出さない)。
type PageInfoFaqEntry = { q?: unknown; a?: unknown };
type PageInfo = {
  purpose?: unknown;
  how_to?: unknown;
  faq?: unknown;
  talk_channel?: unknown;
};
type TalkBoardKind = "complaint" | "improvement";
const TALK_BOARD_LABELS: Record<TalkBoardKind, string> = {
  complaint: "愚痴",
  improvement: "改善",
};

function PageInfoPanel({ pageInfo, screenId }: { pageInfo: PageInfo; screenId: string }) {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [composeKind, setComposeKind] = useState<TalkBoardKind | null>(null);
  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onNativeClose = () => setIsOpen(false);
    el.addEventListener("close", onNativeClose);
    return () => el.removeEventListener("close", onNativeClose);
  }, []);
  const open = useCallback(() => {
    setIsOpen(true);
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    setComposeKind(null);
    setComposeText("");
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  }, []);

  const howTo = Array.isArray(pageInfo.how_to)
    ? (pageInfo.how_to as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const faq = Array.isArray(pageInfo.faq)
    ? (pageInfo.faq as PageInfoFaqEntry[]).filter(
        (f): f is { q: string; a: string } => typeof f?.q === "string" && typeof f?.a === "string",
      )
    : [];
  // ★注意(cardgate3 §6実測・G79-2裁定): 「screen_idをchannelに自動刻印する既存実装」
  // は無い。plaza側の受け皿(POST /plaza/posts の channel)は実在するのみ
  // (plaza-routes.ts:173-222)。刻印はここで screenId をそのまま渡すことで行う。
  const talkEnabled = pageInfo.talk_channel === true;

  const submitTalk = useCallback(async () => {
    const kind = composeKind;
    const text = composeText.trim();
    if (!kind || !text || posting) return;
    setPosting(true);
    try {
      const res = await execute(
        { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
        { channel: screenId, board_kind: kind, topic: text, body: text },
      );
      const threadId = (res as { thread_id?: string } | undefined)?.thread_id;
      close();
      if (threadId) navigate("knowledge-thread", { thread_id: threadId });
    } finally {
      setPosting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeKind, composeText, posting, execute, screenId, navigate]);

  return (
    <div className="civ-page-info">
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="ghost"
        aria-haspopup="dialog"
        onClick={open}
      >
        この画面について
      </button>
      <dialog ref={dialogRef} className="civ-page-info-dialog" aria-label="この画面について">
        {isOpen && (
          <div className="civ-page-info-body">
            <h2 className="civ-heading">この画面について</h2>
            <p className="civ-text">{String(pageInfo.purpose ?? "")}</p>
            {howTo.length > 0 && (
              <ul className="civ-page-info-howto">
                {howTo.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            )}
            {faq.length > 0 && (
              <dl className="civ-page-info-faq">
                {faq.map((f, i) => (
                  <div key={i}>
                    <dt>{f.q}</dt>
                    <dd>{f.a}</dd>
                  </div>
                ))}
              </dl>
            )}
            {talkEnabled && (
              <div className="civ-page-info-talk">
                <h3 className="civ-heading">この画面について話す</h3>
                <div className="civ-page-info-talk-buttons">
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    aria-pressed={composeKind === "complaint"}
                    onClick={() => setComposeKind("complaint")}
                  >
                    愚痴
                  </button>
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    aria-pressed={composeKind === "improvement"}
                    onClick={() => setComposeKind("improvement")}
                  >
                    改善
                  </button>
                </div>
                {composeKind && (
                  <div className="civ-page-info-compose">
                    <label className="civ-label" htmlFor="page-info-talk-text">
                      {TALK_BOARD_LABELS[composeKind]}を書く
                    </label>
                    <textarea
                      id="page-info-talk-text"
                      className="civ-input"
                      value={composeText}
                      onChange={(e) => setComposeText(e.target.value)}
                    />
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      disabled={!composeText.trim() || posting}
                      onClick={submitTalk}
                    >
                      投稿する
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" onClick={close}>
              閉じる
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}

function AppShellNode({ node }: { node: ScreenNode }) {
  const execute = useContext(ExecuteCtx);
  const layout = useContext(LayoutCtx);
  const screenId = useContext(ScreenIdCtx);
  const pageInfo = props(node).page_info as PageInfo | undefined;
  const hasPageInfo = typeof pageInfo?.purpose === "string" && pageInfo.purpose.trim() !== "";
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [scope, setScope] = useState<HeaderScope>(DEFAULT_HEADER_SCOPE);

  useEffect(() => {
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/auth/session" }))
      .then((r) => {
        if (!alive) return;
        const body = r as { authenticated?: unknown } | undefined;
        setAuthenticated(body?.authenticated === true);
      })
      .catch(() => {
        if (alive) setAuthenticated(false);
      })
      .finally(() => {
        if (alive) setAuthLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // HDR-1: 選好投影(scope_species/scope_lineage_id)をログイン確定後に1度だけ
  // 取得する(未ログイン中は/me/preferencesが本人スコープを持たないため待つ)。
  useEffect(() => {
    if (!authLoaded || !authenticated) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/preferences" }))
      .then((r) => {
        if (!alive) return;
        const body = r as { scope_species?: unknown; scope_lineage_id?: unknown } | undefined;
        setScope({
          species: typeof body?.scope_species === "string" ? body.scope_species : "",
          lineageId: typeof body?.scope_lineage_id === "string" ? body.scope_lineage_id : "",
        });
      })
      .catch(() => {
        if (alive) setScope(DEFAULT_HEADER_SCOPE);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, authenticated]);

  const onLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await execute({ kind: "api", method: "POST", path: "/api/v1/auth/logout" });
    } catch {
      // ponytail: logout is best-effort — even if the API call fails, sending
      // the visitor to /s/login is the safe outcome (never strand them on a
      // page that still thinks it's logged in).
    } finally {
      if (typeof window !== "undefined") window.location.assign("/s/login");
    }
  }, [execute]);

  return (
    <div className="civ-app-shell" data-layout={layout !== "standard" ? layout : undefined}>
      {/* design-home-round.md §③: "headbar" is the class theme.js's own contract
          names for its slim header bar (theme.js:9) — kept as the documented
          marker even though ThemeToggleButton below (not theme.js's injector)
          is what actually renders the button here, see that component's
          comment for why. */}
      <header className="civ-chrome-header headbar">
        <a className="civ-brand" href="/">
          IHL
        </a>
        {authLoaded && authenticated && <DrawerNav />}
        {authLoaded && authenticated && <HeaderScopeSelector scope={scope} onSaved={setScope} />}
        {authLoaded && authenticated && (
          <nav className="civ-chrome-nav" aria-label="主要ナビゲーション">
            <a className="civ-link civ-chrome-link" href="/s/obs-search">
              観測対象を探す
            </a>
            <a className="civ-link civ-chrome-link" href="/me/me.html">
              マイページ
            </a>
            <a className="civ-link civ-chrome-link" href="/">
              通知
            </a>
            <a className="civ-link civ-chrome-link" href="/s/settings">
              設定
            </a>
          </nav>
        )}
        <div className="civ-chrome-auth">
          <ChromeAuthLinks authenticated={authLoaded && authenticated} loggingOut={loggingOut} onLogout={onLogout} />
        </div>
        {hasPageInfo && <PageInfoPanel pageInfo={pageInfo as PageInfo} screenId={screenId} />}
        <ThemeToggleButton />
      </header>
      <HeaderScopeCtx.Provider value={scope}>
        <Children nodes={node.children} />
      </HeaderScopeCtx.Provider>
    </div>
  );
}

registerNode("app-shell", AppShellNode);
