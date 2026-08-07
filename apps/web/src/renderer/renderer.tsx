"use client";

import "./zones/register-all";
// renderer分割Phase 2b: titleSimilarityはzones/knowledge.tsxへ移動したが、
// テスト(renderer-knw-dupconfirm.test.tsx)が "./renderer" から直接importする
// ため、Phase 1のinterpolate/HeaderScopeCtxと同じ理由でre-exportを維持する。
export { titleSimilarity } from "./zones/knowledge";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";
import { Progress as ShadcnProgress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Card as ShadcnCard } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { apiUrl, unwrapEnvelope } from "@/lib/api";
import { ApiError, mapError } from "@/lib/error-messages";
import { shouldOfferTranslation, translateOnDemand } from "@/lib/ugc-translate";
import { makeResolver, type Catalogs } from "@/lib/i18n-resolve";
import { computeCaptureColorPayload } from "@/lib/color-analysis";
import ResearchPanel from "@/research/ResearchPanel";
import { fetchManifestLatest, fetchManifestParquet, type ManifestLatestInfo } from "@/research/manifest-client";
import { loadDuckDb, registerManifest, runResearchQuery } from "@/research/duckdb-client";
import { saveResearchQueryToTruth } from "@/research/truth-query-save";
import type { ResearchQueryJson } from "@/research/query-generator";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { GraphView, type GraphViewIndividual, type PedigreeLink } from "./graph-view/GraphView";
import {
  clearBatch,
  loadBatchDraft,
  loadBatchResults,
  loadPreselect,
  saveBatchDraft,
  saveBatchResults,
  savePreselect,
  type BatchCommitItem,
  type BatchDraft,
  type BatchGroup,
  type BatchResult,
  type BatchResults,
  type DraftRow,
  type ScheduleTarget,
} from "./batch-draft";
import type { Action, ScreenDef, ScreenNode, Transition } from "./types";

import {
  DEFAULT_HEADER_SCOPE,
  DataSinkCtx,
  ExecuteCtx,
  FormValidityCtx,
  HeaderScopeCtx,
  InvalidCtx,
  LayoutCtx,
  LocaleCtx,
  MessagesCtx,
  NavigateCtx,
  ScopeCtx,
  ScreenIdCtx,
  TransitionsCtx,
  type Execute,
  type HeaderScope,
  type ResolveMessage,
  type Scope,
} from "./core/context";
import {
  anyField,
  appendHeaderScope,
  compareLine,
  currentStage,
  defaultExecute,
  displayText,
  errorText,
  formatDateJa,
  getPath,
  headerScopeQuery,
  interpolate,
  isRequiredCheckbox,
  isRequiredField,
  latestMeasurement,
  queryFromBody,
  queryFromResult,
  readQuery,
  requestInit,
  resolveStatic,
  scanFormValidity,
  screenHref,
  setPath,
  stageBadgeText,
  todayPlusDays,
} from "./core/scope";
import { lookupNode, registerNode } from "./core/registry";
import { Badge, ActorLabel, monogram, shortActorId } from "./core/primitives";
import type { ThreadPost, ThreadView } from "./core/thread";
import {
  type IndividualProfile,
  type PedNode,
  type ProfileCapture,
  type ProfileLifeEvent,
  type ProfileMeasurement,
  type ProfileParentRef,
  type ProfileSibling,
  type TimelineEntry,
  buildTimeline,
  collectAncestors,
  inbreedingCoefficient,
  inbreedingTone,
  isDegenerate,
  measureValue,
  profileLabel,
  seriesFor,
} from "./core/individual";
import { STAGE_LABELS_JA, ULID_RE, safeLabel, type PlacementRow } from "./core/scope";
import { Children, NodeView, props, useSource } from "./core/node-view";

// core/context.ts・core/scope.tsへ移動済み(zone B・renderer分割Phase 1)。
// テスト互換のため interpolate/HeaderScopeCtx を含め、元々ここでexportされて
// いたシンボルをそのままre-exportする(外部からの `./renderer` importを壊さない)。
export {
  DEFAULT_HEADER_SCOPE,
  HeaderScopeCtx,
  LayoutCtx,
  LocaleCtx,
  MessagesCtx,
  ScreenIdCtx,
  currentStage,
  formatDateJa,
  getPath,
  interpolate,
  latestMeasurement,
  setPath,
};
export type { Execute, HeaderScope, ResolveMessage, Scope };

/* -------------------------------------------------------------------------- *
 * Catalog v0 — 12 types (design-c2 §4.2). Semantic classes only; all color and
 * every one of the 7 states live in globals.css (.civ-interactive layer).
 * -------------------------------------------------------------------------- */

// Normalize a props.options-style list ("g" | {value,label}) into {value,label}.
type Opt = { value: string; label: string };
function toOptions(raw: unknown): Opt[] {
  return ((raw as Array<Record<string, unknown> | string>) ?? []).map((o) =>
    typeof o === "string"
      ? { value: o, label: o }
      : { value: String(o.value ?? ""), label: String(o.label ?? o.value ?? "") },
  );
}

// Run a node action: interpolate api paths against scope, capture the result,
// then follow a matching transition (api actions only — navigate self-routes).
function useRunAction(nodeId: string) {
  const execute = useContext(ExecuteCtx);
  const scope = useContext(ScopeCtx);
  const transitions = useContext(TransitionsCtx);
  const navigate = useContext(NavigateCtx);
  const { setActionResult } = useContext(DataSinkCtx);
  return useCallback(
    async (action: Action, body?: Record<string, unknown>, file?: File | null) => {
      // A form whose action is a navigate is the 3-screen-confirm carry (OBS-25):
      // stash the shaped body + photo so the next screen's commit can replay it
      // (survives the full-page reload), and put scalar fields on the query for
      // {{params.*}} display. A plain button navigate (no body) keeps the old
      // single-arg execute path so test/onAction observers see the raw action.
      if (action.kind === "navigate") {
        if (body === undefined) {
          await execute(action);
        } else {
          await saveDraft(body, file ?? null);
          navigate(action.to, queryFromBody(body));
        }
        return;
      }
      // An api action can replay the pending confirm draft (body_from:"draft"):
      // the confirm screen's commit button carries no inline body, so pull the
      // shaped body + photo the entry form stashed on navigate.
      let effBody = body;
      let effFile = file ?? null;
      const fromDraft = action.body_from === "draft";
      if (fromDraft) {
        const d = await loadDraft();
        if (d) {
          // A caller that already shaped its own body (a form with its own
          // fields/static — e.g. F5's opt-out checkbox, V3-AIP-101) wins per-key
          // over the replayed draft; the draft only backfills what the caller
          // didn't provide. obs-confirm's plain-button case (body undefined) is
          // unchanged: effBody just becomes d.body as before.
          effBody = { ...d.body, ...(effBody ?? {}) };
          effFile = effFile ?? d.file;
        }
      }
      const act: Action = { ...action, path: interpolate(action.path, scope) };
      // Keep the single-arg call shape when there is no body (buttons), so
      // action executors observed in tests see exactly the action.
      const result = effBody === undefined ? await execute(act) : await execute(act, effBody);
      if (result && typeof result === "object") setActionResult(result);
      // Two-stage photo upload (design-c2 §3.2): the create action returns an
      // id first, then — if the form carried a photo — the file is POSTed as
      // multipart against that id, BEFORE the transition unmounts us.
      // capture_id (observation) and listing_id (c8磨き第2弾#2 market-trade
      // listing photo) are the two ids this rides today — not a generic
      // upload-config engine; add another id key here if a third screen needs
      // it (no screen-def has needed more than these two so far).
      const captureId = (result as Record<string, unknown> | undefined)?.capture_id;
      const uploadListingId = (result as Record<string, unknown> | undefined)?.listing_id;
      if (effFile && typeof captureId === "string") {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/observation/upload" },
          { capture_id: captureId, file: effFile },
        );
        // g80-e2color(b3think §3-3): 撮影経路でのクライアントLab焼き込み。重い画素
        // 処理はブラウザ側で行い(V3-AIP-104/invariant①)、結果だけをPOSTする。
        // ベストエフォート — 非画像/デコード失敗/保存失敗のいずれでもアップロード
        // 自体は既に成功済みなので、ここで投げて画面遷移を壊さない(thumbnail生成の
        // ベストエフォートと同型・observation-routes.ts:511-566)。
        try {
          const colorPayload = await computeCaptureColorPayload(effFile);
          if (colorPayload) {
            await execute({ kind: "api", method: "POST", path: `/api/v1/observation/${captureId}/color` }, colorPayload as unknown as Record<string, unknown>);
          }
        } catch {
          // best-effort: 色検索の対象にならないだけで、観測記録自体は既に保存済み。
        }
      } else if (effFile && typeof uploadListingId === "string") {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/market/listings/${uploadListingId}/photo` },
          { file: effFile },
        );
      }
      if (fromDraft) clearDraft();
      // c8 UI磨きR0801-9d452f-ui10toast: ここまで来た時点でapi actionは成功済み
      // (例外は上のcatchが拾う)。action.toastが明示されたformだけ、遷移が
      // 起きる直前にsessionStorageへ退避する(navigate直後のフルリロードを
      // 跨いでToastHostが1回だけ表示)。
      if (action.kind === "api" && action.toast) writeToast(action.toast);
      const t = transitions.find((x) => x.from === nodeId);
      // Scalar request-body fields ride forward too (not just the response) —
      // the next screen's confirm/done recap reads them via {{params.*}} (V3-AIP-101,
      // same trick queryFromBody already does for the navigate-kind branch above).
      // queryFromResult is spread last so an id/token in the response always wins
      // a key collision with a same-named request field.
      if (t) navigate(t.to_screen_id, { ...queryFromBody(effBody ?? {}), ...queryFromResult(result) });
    },
    [execute, scope, transitions, navigate, setActionResult, nodeId],
  );
}

export function ButtonNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const run = useRunAction(node.id);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(p.error ? String(p.error) : null);
  // V3-AIP-101 zero-tap registration (F6 "次の観測目安"): props.auto fires this
  // button's action once on mount instead of waiting for a click; `done` swaps
  // the button for a status line once it succeeds.
  const [done, setDone] = useState(false);
  const formValid = useContext(FormValidityCtx);
  const loading = pending || p.loading === true;
  const isSubmit = (p.type ?? "button") === "submit";
  // V3-AUT-06: a submit inside a gated (consent) form is disabled from first
  // paint until the form is valid — before any input event fires.
  const disabled = p.disabled === true || loading || (isSubmit && !formValid);

  const fire = useCallback(async () => {
    const action = node.action;
    if (!action) return;
    setError(null);
    setPending(true);
    try {
      const stat = p.static as Record<string, unknown> | undefined;
      // V3-AIP-101 磨き直し fix#12: a navigate action's `to` may carry a
      // "{{...}}" scope template (same convention "link" nodes' href already
      // uses), e.g. "obs-register-entry?id={{params.individual_id}}" — the
      // interpolated string rides straight through screenHref's literal
      // concat, so a bare id-carrying navigate button needs no new plumbing.
      const act: Action = action.kind === "navigate" ? { ...action, to: interpolate(action.to, scope) } : action;
      await run(act, stat ? resolveStatic(stat, scope) : undefined);
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }, [node.action, run, p.static, scope]);

  const onClick = useCallback(() => {
    if (disabled) return;
    void fire();
  }, [disabled, fire]);

  const firedRef = useRef(false);
  useEffect(() => {
    if (!p.auto || firedRef.current || !node.action) return;
    // auto_when gates the fire: a scope template that resolves empty/"false"/
    // "off" skips it — the F5 opt-out checkbox rides here as a query param
    // (present="on" when checked, absent when unchecked → resolves "").
    if (p.auto_when !== undefined) {
      const v = interpolate(String(p.auto_when), scope);
      if (!v || v === "false" || v === "off") return;
    }
    firedRef.current = true;
    void fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (p.auto && done) {
    // V3-AIP-101 磨き直し fix#11: success_label_date_from points at a scope
    // path (e.g. "result.next_observation_at") whose value is a server ISO
    // timestamp — never interpolated raw. It's formatted (formatDateJa) and
    // exposed to the SAME interpolate() call as a synthetic `date` field, so
    // success_label just writes "{{date}} 頃" — no new template syntax.
    const dateFrom = p.success_label_date_from;
    const successScope = dateFrom
      ? { ...scope, date: formatDateJa(getPath(scope, String(dateFrom))) }
      : scope;
    const successText = interpolate(
      displayText(resolve, p.success_label_key, p.success_label, "登録しました"),
      successScope,
    );
    return (
      <p className="civ-text" role="status">
        {successText}
      </p>
    );
  }

  return (
    <>
      <button
        type={(p.type as "button" | "submit") ?? "button"}
        className={cn("civ-interactive", "civ-button")}
        data-variant={String(p.variant ?? "primary")}
        data-compact={p.compact === true || undefined}
        data-loading={loading || undefined}
        aria-busy={loading || undefined}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        data-invalid={error ? true : undefined}
        aria-invalid={error ? true : undefined}
        onClick={node.action ? onClick : undefined}
      >
        {displayText(resolve, p.label_key, p.label, node.id)}
      </button>
      {error && (
        <span role="alert" className="civ-field-error">
          {error}
        </span>
      )}
    </>
  );
}

// V3-OBS-19 WorkflowContext(観測コンテキスト)— client-only 縮退版。種族
// (species_candidate)+発育段階(life_stage_candidate)を1度決めたら次の観測
// 画面の既定値だけをプリフィルする(taxonomy確定は常にユーザー・購読/検索/
// テンプレ横断スコープの本体設計は要件全文どおり後波)。visit-tracker/
// recent-chips と同じ localStorage 縮退パターン(新 Truth 型なし)。
const WORKFLOW_CONTEXT_KEY = "ihl:obs-workflow-context";
function readWorkflowContext(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WORKFLOW_CONTEXT_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeWorkflowContext(patch: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKFLOW_CONTEXT_KEY, JSON.stringify({ ...readWorkflowContext(), ...patch }));
  } catch {
    /* ignore — best-effort prefill only */
  }
}

// c8 UI磨きR0801-9d452f-ui05aiprof是正: ai-profile-settings.jsonのprofile-form
// はnode.actionが未定義で(実測確認済み)送信が文字通り何もしなかった。画面自身
// の notes は「鍵はこの端末にのみ保存」と明記しているため、サーバ送信ではなく
// このform専用のlocalStorage保存を実装する(props.local_key + props.local_key_field
// によるform node汎用オプトイン — WorkflowContextと同じ縮退パターン)。
function localFormKey(base: string, body: Record<string, unknown>, keyField?: string): string {
  const kf = keyField ?? "feature_id";
  const sub = body[kf];
  return typeof sub === "string" && sub ? `ihl:form:${base}:${sub}` : `ihl:form:${base}`;
}
function readLocalForm(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const LOCAL_FORM_SAVED_EVENT = "ihl:local-form-saved";
function writeLocalForm(key: string, body: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...body, saved_at: new Date().toISOString() }));
    // 同一画面内の設定済みバッジ(AiProfileStatusNode)はマウント時読み取りのみ
    // なので、保存直後に再読込させるための最小限の通知(フルリロードなし)。
    window.dispatchEvent(new Event(LOCAL_FORM_SAVED_EVENT));
  } catch {
    /* ignore — best-effort only, this端末専用データなので失敗しても致命的ではない */
  }
}

// c8 UI磨きR0801-9d452f-ui10toast(横断テーマ1): 送信系フォームの多くは
// action成功後「同じ画面へ再読込」の transition しか持たず、送信できたのか
// 何も分からない(navigate()が既定でwindow.location.assignのフルリロードで
// あるため、React state だけのトーストは遷移で消える)。sessionStorage に
// 1件だけ退避 → 遷移後の初回マウントで読んで表示 → 即座にクリアする
// flash-message パターンでリロードを跨ぐ。既存の props.action.toast
// (省略時は何もしない・上位互換)を各screen-defが明示指定した時だけ発火する。
const TOAST_KEY = "ihl:toast-flash";
function writeToast(message: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOAST_KEY, message);
  } catch {
    /* ignore — best-effort only, submit itself already succeeded */
  }
}
function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(TOAST_KEY);
      if (raw) window.sessionStorage.removeItem(TOAST_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    setMessage(raw);
    const t = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(t);
  }, []);
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="civ-toast">
      {message}
    </div>
  );
}

export function FieldNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const invalidCtx = useContext(InvalidCtx);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const variant = String(p.variant ?? "text");
  const name = String(p.name ?? node.id);
  const required = p.required === true;
  const invalid = p.invalid === true || invalidCtx.has(name);
  const id = `field-${node.id}`;
  // V3-OBS-19 WorkflowContext(観測コンテキスト・client-only 縮退): workflow_key
  // を持つフィールドは空欄のまま初回描画し(SSR/ハイドレーション安全)、マウント
  // 後に一度だけ localStorage の前回値を imperative に流し込む(未入力の時の
  // み・既定値プリフィルのみでオートサブミットはしない・ユーザーはいつでも
  // 上書きできる・taxonomy確定は常にユーザーのまま変わらない)。
  const workflowKey = p.workflow_key != null ? String(p.workflow_key) : "";
  const wfRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    if (!workflowKey) return;
    const el = wfRef.current;
    if (!el || el.value) return;
    const ctx = readWorkflowContext();
    if (ctx[workflowKey]) el.value = ctx[workflowKey];
  }, [workflowKey]);
  // V3-AIP-101 "前回値とΔ" (F2 live, obs-register-entry): a number field with
  // compare_source (another node's fetched `{source}.observations`) + compare_item
  // renders the previous value below the input and, as the user types, the delta.
  // liveValue is display-only state — the input stays uncontrolled for submit.
  const [liveValue, setLiveValue] = useState("");
  const compareSource = p.compare_source;
  const liveNum = Number(liveValue);
  const hasLive = liveValue !== "" && Number.isFinite(liveNum);
  const compareText = compareSource
    ? compareLine(scope, {
        source: compareSource,
        item: p.compare_item,
        unit: p.compare_unit,
        exclude: p.compare_exclude,
        current: hasLive ? liveNum : null,
      })
    : "";
  // V3-AIP-101 磨き直し fix#10: label_date_offset_days lets a field's label
  // carry a client-computed "today+N days" via the SAME {{date}} convention
  // ButtonNode's success_label_date_from uses (fix#11) — one date formatter,
  // two call sites. No API round-trip for a value that's pure arithmetic.
  const dateOffsetDays = p.label_date_offset_days;
  const labelScope =
    dateOffsetDays != null ? { ...scope, date: formatDateJa(todayPlusDays(Number(dateOffsetDays))) } : scope;
  const labelText = interpolate(displayText(resolve, p.label_key, p.label, name), labelScope);

  const shared = {
    id,
    name,
    className: "civ-input",
    "data-required": required || undefined,
    "aria-required": required || undefined,
    "aria-invalid": invalid || undefined,
    "data-invalid": invalid || undefined,
  } as const;

  let control: React.ReactNode;
  if (variant === "segmented") {
    // V3-OBS-18: a horizontal toggle group. Native radios (FormData picks the
    // checked one, no JS state needed) styled as buttons. One option is checked
    // from first paint (props.default or the first), so a `required` segmented
    // is always satisfied and its value always rides the submit body.
    const options = toOptions(p.options);
    const def = p.default != null ? String(p.default) : options[0]?.value ?? "";
    control = (
      <div className="civ-segmented" role="radiogroup" aria-label={displayText(resolve, p.label_key, p.label, name)}>
        {options.map((o) => (
          <label key={o.value} className="civ-segment">
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === def}
              data-required={required || undefined}
              aria-required={required || undefined}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (variant === "select") {
    const options = (p.options as Array<Record<string, unknown> | string>) ?? [];
    control = (
      <select {...shared} ref={workflowKey ? (wfRef as React.RefObject<HTMLSelectElement>) : undefined} defaultValue="">
        <option value="" disabled>
          {String(p.placeholder ?? "選択してください")}
        </option>
        {options.map((o) => {
          const value = typeof o === "string" ? o : String(o.value ?? "");
          const label = typeof o === "string" ? o : String(o.label ?? value);
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
    );
  } else if (variant === "photo") {
    // V3-AIP-101 磨き直し fix#7: a labeled/styled field instead of a bare
    // <input type=file> — icon + input row, same .civ-input border/height as
    // every other control (no drastic redesign, just not naked).
    return (
      <div className="civ-field">
        <label className="civ-label" htmlFor={id}>
          {labelText}
          {required ? " *" : ""}
        </label>
        <div className="civ-field-photo">
          <span className="civ-field-photo-icon" aria-hidden="true">
            📷
          </span>
          <input {...shared} type="file" accept="image/*" />
        </div>
      </div>
    );
  } else if (variant === "checkbox") {
    // V3-AIP-101 磨き直し fix#10: a styled labeled row (custom check mark via
    // CSS — no raw hex, tokens only) replacing the browser-default checkbox.
    // data-required='true' means "must be checked"; scanFormValidity + the
    // submit-time missing scan (unchecked => fd.get null) both cover it.
    // props.default:true = checked from first paint (F5's opt-out-by-default
    // "次の観測目安を自動設定" checkbox, V3-AIP-101). labelText may carry a
    // client-computed {{date}} (label_date_offset_days, see above).
    return (
      <div className="civ-field">
        <label className="civ-checkbox-row" htmlFor={id}>
          <input {...shared} type="checkbox" defaultChecked={p.default === true} />
          <span className="civ-label">{labelText}</span>
        </label>
        {invalid && (
          <span role="alert" className="civ-field-error">
            {String(p.error ?? "この項目を確認してください")}
          </span>
        )}
      </div>
    );
  } else if (variant === "hidden") {
    // Carries a scope value forward through a navigate/draft hop (e.g. the
    // individual id from F2 to F5) so a later screen's `static` can reference
    // {{params.*}} without the user re-entering it. No visible label/wrapper.
    return <input {...shared} type="hidden" value={interpolate(String(p.default ?? ""), scope)} readOnly />;
  } else if (variant === "textarea") {
    // c8 knowledge-thread: multi-line reply/description bodies. Same
    // .civ-input treatment as every other control (no bespoke styling) —
    // only the element differs.
    control = (
      <textarea
        {...shared}
        rows={Number(p.rows ?? 4)}
        placeholder={p.placeholder ? String(p.placeholder) : undefined}
        defaultValue={p.default != null ? interpolate(String(p.default), scope) : undefined}
      />
    );
  } else {
    control = (
      <input
        {...shared}
        ref={workflowKey ? (wfRef as React.RefObject<HTMLInputElement>) : undefined}
        type={variant === "number" ? "number" : variant === "date" ? "date" : "text"}
        placeholder={p.placeholder ? String(p.placeholder) : undefined}
        defaultValue={p.default != null ? interpolate(String(p.default), scope) : undefined}
        onChange={compareSource ? (e) => setLiveValue(e.target.value) : undefined}
      />
    );
  }

  return (
    <div className="civ-field">
      <label className="civ-label" htmlFor={id}>
        {labelText}
        {required ? " *" : ""}
      </label>
      {control}
      {compareText && (
        <p className="civ-text" data-muted="true">
          {compareText}
        </p>
      )}
      {invalid && (
        <span role="alert" className="civ-field-error">
          {String(p.error ?? "この項目を確認してください")}
        </span>
      )}
    </div>
  );
}

export function FormNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const headerScope = useContext(HeaderScopeCtx);
  const run = useRunAction(node.id);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(p.error ? String(p.error) : null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [localSaved, setLocalSaved] = useState(false);
  // V3-AUT-06: a form carrying a required consent checkbox gates its submit
  // reactively (disabled from first paint until valid). Text-only forms are not
  // gated, so their submit-time field-error path (below) is unchanged.
  // ponytail: gate trigger is "has a required checkbox"; extend if more consent
  // shapes appear. Initial validity is false while any required field is unset
  // (no field carries a default value/checked today).
  const gated = useMemo(() => anyField(node.children, isRequiredCheckbox), [node]);
  const [reactiveValid, setReactiveValid] = useState(
    () => !anyField(node.children, isRequiredField),
  );
  const formValid = gated ? reactiveValid : true;
  const onFormChange = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => setReactiveValid(scanFormValidity(e.currentTarget)),
    [],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const missing = new Set<string>();
      form.querySelectorAll("[data-required='true']").forEach((el) => {
        const n = el.getAttribute("name");
        if (n && !String(fd.get(n) ?? "").trim()) missing.add(n);
      });
      setInvalidFields(missing);
      if (missing.size) {
        setFormError("必須項目を入力してください");
        return;
      }
      setFormError(null);
      // c8 UI磨きR0801-9d452f-ui05aiprof: props.local_key を持つformはAPIを
      // 叩かず、この端末のlocalStorageにだけ保存する(node.action不要)。
      if (!node.action && !p.local_key) return;
      // Shape the request body to the API contract: static injects first
      // (e.g. measurement.kind, species_confirmed_by), then dotted field names
      // (`measurements.0.item`) nest into the arrays the schema requires.
      const body: Record<string, unknown> = {};
      const stat = p.static as Record<string, unknown> | undefined;
      if (stat) Object.assign(body, resolveStatic(stat, scope));
      // Split the form: text fields nest into the JSON body; a non-empty file
      // field (the photo) rides separately so run() can do the 2-stage upload.
      // ponytail: one photo per capture (design-c2 §3.1) — first file wins.
      let file: File | null = null;
      fd.forEach((v, k) => {
        if (typeof v === "string") {
          if (v.trim() === "") return;
          // A `variant:"number"` field renders <input type="number">, but
          // FormData always yields strings — coerce back to a JS number so
          // downstream numeric checks (typeof value === "number", e.g.
          // TimelineRow/measureValue) see a real number, not "65".
          const el = form.elements.namedItem(k);
          const isNumber = el instanceof HTMLInputElement && el.type === "number";
          setPath(body, k, isNumber ? Number(v) : v);
        } else if (v instanceof File && v.size > 0 && !file) {
          file = v;
        }
      });
      // V3-OBS-19 WorkflowContext 書き込み側: carry_to_workflow に挙げた
      // フィールド名の値だけを localStorage へ退避し、次の観測画面の
      // workflow_key プリフィルに使う(送信内容そのものは変えない)。
      const carry = p.carry_to_workflow as string[] | undefined;
      if (carry?.length) {
        const patch: Record<string, string> = {};
        for (const k of carry) {
          const v = getPath(body, k);
          if (typeof v === "string" && v) patch[k] = v;
          else if (typeof v === "number" && Number.isFinite(v)) patch[k] = String(v);
        }
        if (Object.keys(patch).length) writeWorkflowContext(patch);
      }
      // c8 UI磨きR0801-9d452f-ui05aiprof: local_key保存はAPI呼び出しを経由
      // しない(node.actionが無くても成立する唯一の分岐)。ここで完結して return。
      if (p.local_key) {
        writeLocalForm(
          localFormKey(String(p.local_key), body, p.local_key_field ? String(p.local_key_field) : undefined),
          body,
        );
        setLocalSaved(true);
        window.setTimeout(() => setLocalSaved(false), 3000);
        return;
      }
      if (!node.action) return;
      // HDR-1第2スライス(A1#4): props.header_scoped:true なフォーム(例: research-search
      // の POST /research/search)だけ、送信先パスへヘッダー観測対象クエリを足す
      // (useSource/BoardThreadsNode と同じオプトイン規約)。navigate kind には
      // path が無いので api kind のみ書き換える。
      const action =
        p.header_scoped && node.action.kind === "api"
          ? { ...node.action, path: appendHeaderScope(node.action.path, headerScope) }
          : node.action;
      // HDR-1第2bスライス(slice2b・批評家blocking是正): props.header_scoped_producer:true
      // な create フォーム(market-trade create-listing-form・data-descriptor
      // descriptor-form)は、ヘッダー観測対象(headerScope.species)を送信 body へ
      // 自動付与する(SW-1の設計意図="選択から付与・ユーザー再入力なし")。空 scope
      // (すべて)は何も付けない(species_id 無し=従来通り。API 側 schema は
      // minLength:1 のため空文字は送らない)。フォーム自身が既に species_id を
      // 持つ場合は上書きしない(将来 field 化された場合の保険)。
      if (p.header_scoped_producer && headerScope.species && body.species_id === undefined) {
        body.species_id = headerScope.species;
      }
      setPending(true);
      try {
        await run(action, body, file);
      } catch (err) {
        setFormError(errorText(err));
      } finally {
        setPending(false);
      }
    },
    [
      node.action,
      run,
      p.static,
      p.header_scoped,
      p.header_scoped_producer,
      p.local_key,
      p.local_key_field,
      scope,
      headerScope.species,
      headerScope.lineageId,
    ],
  );

  return (
    <form
      className="civ-form"
      aria-busy={pending || undefined}
      data-loading={pending || undefined}
      onSubmit={onSubmit}
      onChange={gated ? onFormChange : undefined}
      noValidate
    >
      <FormValidityCtx.Provider value={formValid}>
        <InvalidCtx.Provider value={invalidFields}>
          <Children nodes={node.children} />
        </InvalidCtx.Provider>
      </FormValidityCtx.Provider>
      {formError && (
        <p role="alert" className="civ-form-error">
          {formError}
        </p>
      )}
      {localSaved && (
        <p role="status" className="civ-form-success">
          {String(p.local_saved_text ?? "この端末に保存しました")}
        </p>
      )}
    </form>
  );
}

// c8 UI磨きR0801-9d452f-ui05aiprof: props.options([{value,label}]) + props.local_key
// を受け取り、feature_idごとに localFormKey(local_key, {feature_id}) が
// localStorageに存在するかだけを見て「設定済み/未設定」バッジを並べる
// (読み取り専用・サーバ通信なし)。マウント後に一度だけ読む(SSR安全)。
function AiProfileStatusNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const options = toOptions(p.options);
  const localKey = String(p.local_key ?? "");
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!localKey) return;
    const reread = () => {
      const set = new Set<string>();
      for (const o of options) {
        if (readLocalForm(localFormKey(localKey, { feature_id: o.value }))) set.add(o.value);
      }
      setConfigured(set);
    };
    reread();
    window.addEventListener(LOCAL_FORM_SAVED_EVENT, reread);
    return () => window.removeEventListener(LOCAL_FORM_SAVED_EVENT, reread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localKey, options.map((o) => o.value).join(",")]);
  return (
    <div className="civ-card-badges">
      {options.map((o) => (
        <Badge
          key={o.value}
          text={`${o.label}: ${configured.has(o.value) ? "設定済み" : "未設定"}`}
          tone={configured.has(o.value) ? "success" : "neutral"}
        />
      ))}
    </div>
  );
}

export function ListNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  // c9 wave1 KNW Slice1: board-threads is a `list` variant (schemas/ node type
  // enum is C9-owned/out of scope — reuse "list" + props.variant, same
  // dispatch convention as FieldNode's props.variant, instead of adding a
  // new node type).
  // renderer分割Phase 2b(uiplan §1-5 Phase2b②): threads/knowledge-hub/
  // knowledge-thread-chat/species-book/home-dashboard/ind-*(6画面)は
  // zones/*.tsx へ切り出し済みのため lookupNode("list:"+variant) 経由にする。
  // ai-profile-status のみ zone C 内(AiProfileStatusNode)に残るため直呼び。
  const zoneVariants = [
    "threads",
    "knowledge-hub",
    "knowledge-thread-chat",
    "species-book",
    "home-dashboard",
    "ind-detail",
    "ind-match",
    "pref-pairwise",
    "ind-species",
    "ind-cross",
    "ind-bio-card",
    "ind-card-batch",
    "qr-individual-hub",
  ];
  if (typeof p.variant === "string" && zoneVariants.includes(p.variant)) {
    const Comp = lookupNode(`list:${p.variant}`);
    return Comp ? <Comp node={node} /> : null;
  }
  // c8 UI磨きR0801-9d452f-ui05aiprof: 同じ in-scope トリック(list +
  // props.variant)。5機能それぞれの設定済み/未設定バッジ(localFormKeyの
  // 読み取りのみ・APIは叩かない)。
  if (p.variant === "ai-profile-status") {
    return <AiProfileStatusNode node={node} />;
  }
  useSource(node);
  const scope = useContext(ScopeCtx);

  // Data-bound list: repeat the item template over a bound array. Each element
  // is the interpolation scope for `item_text` (e.g. "{{measurements.0.item}}").
  if (p.bind_items) {
    const items = (getPath(scope, String(p.bind_items)) as unknown[]) ?? [];
    // V3-UIX-03: an honest empty state instead of a blank list.
    if (items.length === 0 && p.empty_text) {
      return <p className="civ-empty">{String(p.empty_text)}</p>;
    }
    const textTpl = p.item_text ? String(p.item_text) : "";
    const imgTpl = p.item_image ? String(p.item_image) : "";
    const altTpl = p.item_alt ? String(p.item_alt) : "";
    // c8磨き第2弾#5: item_actor_field names a ROW key holding an actor_id (e.g.
    // dispute's messages "actor_id", market-trade board's "from") — rendered
    // via the actor 表示プリミティブ ahead of item_text instead of the raw id
    // string (author display name, fallback short hash).
    const actorField = p.item_actor_field ? String(p.item_actor_field) : "";
    return (
      <ul className="civ-list">
        {items.map((it, i) => (
          <li key={i}>
            <article className="civ-card">
              {actorField && <ActorLabel actorId={String(getPath(it, actorField) ?? "")} />}
              {textTpl && <p className="civ-text">{interpolate(textTpl, it)}</p>}
              {imgTpl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="civ-image" src={interpolate(imgTpl, it)} alt={interpolate(altTpl, it)} />
              )}
            </article>
          </li>
        ))}
      </ul>
    );
  }

  const children = node.children ?? [];
  if (children.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  return (
    <ul className="civ-list">
      {children.map((c) => (
        <li key={c.id}>
          <NodeView node={c} />
        </li>
      ))}
    </ul>
  );
}

// A card may carry props.source_path: it GETs on mount and stores the response
// at data[node.id], so children can read scalar fields via {{data.<id>.…}}.
// (Lists bind arrays; cards surface the same fetch for single-object screens
// like obs-detail's summary and qr-resume's token→individual resolve.)
//
// A層(c7 ui-parity-map §2-2 リッチカード): additive rich props on the SAME
// "card" node type (upper-compat — a plain card with none of these props
// renders exactly as before). icon is a literal glyph (no icon lib dependency
// — see renderer.test.tsx/design notes), title/meta interpolate against the
// full scope like heading/text do, badges[] reuses <Badge>, and a chevron nav
// affordance renders only when the node itself carries an `action` (unused by
// CardNode until now — action is a generic ScreenNode field per the schema).
export function CardNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const scope = useContext(ScopeCtx);
  const resolve = useContext(MessagesCtx);
  const run = useRunAction(node.id);
  const children = node.children ?? [];
  const bindText = p.bind_text ? String(p.bind_text) : "";
  const icon = p.icon != null ? String(p.icon) : "";
  const title = interpolate(displayText(resolve, p.title_key, p.title, ""), scope);
  const meta = p.meta != null ? interpolate(displayText(resolve, p.meta_key, p.meta, ""), scope) : "";
  const badges = (p.badges as Array<Record<string, unknown>> | undefined) ?? [];
  // V3-AIP-101 磨き直し fix#5/#8: a `disclosure` child marked props.badge_row
  // rides INSIDE the same badges flex row as the decorative species badge —
  // the stage chip must be tappable while card's own badges[] stay inert, so
  // the interactive trigger is a normal child rendered in-row instead of a
  // fork of the badges[] shape. Every other child renders below as usual.
  const badgeRowChildren = children.filter((c) => c.type === "disclosure" && c.props?.badge_row === true);
  const restChildren = children.filter((c) => !(c.type === "disclosure" && c.props?.badge_row === true));
  if (children.length === 0 && !bindText && !title && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  // props.bind_text renders the card's OWN fetched object (data[node.id]), so
  // bare fields ({{karma_value}}, {{listing.title}}) resolve against the
  // source_path response — the single-object twin of a list's bind_items.
  return (
    <ShadcnCard>
      {p.draft ? <span className="civ-draft-badge">草案</span> : null}
      {(icon || title) && (
        <div className="civ-card-head">
          {icon && (
            <span className="civ-card-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {title && <h3 className="civ-card-title">{title}</h3>}
        </div>
      )}
      {meta && (
        <p className="civ-text" data-muted="true">
          {meta}
        </p>
      )}
      {(badges.length > 0 || badgeRowChildren.length > 0) && (
        <div className="civ-card-badges">
          {badges.map((b, i) => (
            <Badge
              key={i}
              // fix#8: badge text now interpolates against the full scope
              // (species: "{{data.individual.master.species}}") — a literal
              // badge with no "{{" is unaffected (interpolate is a no-op).
              text={interpolate(displayText(resolve, b.text_key ?? b.label_key, b.text ?? b.label, ""), scope)}
              tone={b.tone != null ? String(b.tone) : undefined}
            />
          ))}
          {badgeRowChildren.map((c) => (
            <NodeView key={c.id} node={c} />
          ))}
        </div>
      )}
      {bindText ? (
        <p className="civ-text">
          {interpolate(bindText, getPath(scope, `data.${node.id}`) ?? {})}
        </p>
      ) : null}
      <Children nodes={restChildren} />
      {node.action && (
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-card-nav-btn")}
          data-variant="ghost"
          aria-label={displayText(resolve, p.nav_label_key, p.nav_label, "開く")}
          onClick={() => run(node.action!)}
        >
          ›
        </button>
      )}
    </ShadcnCard>
  );
}

// Status badge / chip tone (§2-3): success/warning/caution/neutral, mapped
// onto the existing --civ-primary/--civ-danger/--civ-danger-bg/--civ-text-muted
// tokens (no new hex — check-ui-tokens forbids it). warning is filled danger,
// caution is outlined danger (same hue, lower urgency); success is outlined
// primary; neutral (default/unknown tone) is the muted outline.
// V3-UIX-04: 色は意味のみ(緑=成功/赤=失敗/青=情報/黄=注意)。caution/info はそれぞれ
// 専用トークン(--civ-caution*/--civ-info*)を持ち、caution が danger(失敗)と混同され
// ないようにする(旧実装は同色だった)。
// g84-retroA(RETRO-1 ○85 T1): internal markup now delegates to the shadcn-
// scaffolded src/components/ui/badge.tsx (installed via `npx shadcn add
// badge`, then re-tuned to this app's 5-tone system — see that file's header
// comment for why the tone axis stays CSS-driven instead of cva/Tailwind).
// Signature (text/tone) is unchanged: renderCell()'s "badge" table cell
// (TableNode, out of this order's scope) also calls this helper.
// renderer分割Phase 2b(g85-split2a-ruling §3 #2)によりBadge本体はcore/primitives.tsxへ
// 一本化(importは冒頭)。

export function BadgeNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  // V3-AIP-101 F2 ステージ表示: derive_from points at a timeline array (life
  // events); the badge shows the current stage (latest molt/eclosion) via a
  // JSON-authored label map, so the vocabulary/labels stay in the screen-def,
  // not hardcoded in the renderer. No timeline yet ⇒ empty_text.
  if (p.derive_from) {
    const { text, hasStage } = stageBadgeText(scope, p.derive_from, p.stage_labels, p.empty_text);
    return <Badge text={text} tone={hasStage ? String(p.tone ?? "neutral") : "neutral"} />;
  }
  const text = interpolate(displayText(resolve, p.text_key, p.text ?? p.label, ""), scope);
  return <Badge text={text} tone={p.tone != null ? String(p.tone) : undefined} />;
}

// Progress bar / gauge (§2-4). value/max accept a literal number or a
// "{{...}}" template resolved against scope (so a screen can bind a fetched
// count without a dedicated bind_* prop, same trick heading/text use).
function numFromProp(raw: unknown, scope: Scope): number {
  if (typeof raw === "number") return raw;
  const n = Number(interpolate(String(raw ?? "0"), scope));
  return Number.isFinite(n) ? n : 0;
}
// g84-retroA(RETRO-1 ○85 T2): internal markup now delegates to the shadcn-
// scaffolded src/components/ui/progress.tsx (installed via `npx shadcn add
// progress`, restyled onto .civ-progress* — see that file's header comment).
// Signature (value/max/label) is unchanged: renderCell()'s "progress" table
// cell (TableNode, out of this order's scope) also calls this helper.
function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  return <ShadcnProgress value={value} max={max} label={label} />;
}
export function ProgressNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const value = numFromProp(p.value, scope);
  const max = p.max != null ? numFromProp(p.max, scope) : 100;
  const label = displayText(resolve, p.label_key, p.label, "");
  const showValue = p.show_value !== false;
  return (
    <div className="civ-progress-field">
      {label && <span className="civ-label">{label}</span>}
      <ProgressBar value={value} max={max} label={label || undefined} />
      {showValue && (
        <span className="civ-progress-value">{Math.round((value / (max || 1)) * 100)}%</span>
      )}
    </div>
  );
}

// Multi-column data table (§2-1, the biggest single fix — the main cause of
// the "table collapses to a 1-line list" density loss per ui-parity-map §0).
// Rows bind the same way a list does (source_path fetch + bind_items dotted
// path); columns are declarative ({key,label,cell}) so a column can render its
// cell as plain text, a Badge, or a ProgressBar without any per-screen code.
function useBoundItems(node: ScreenNode): unknown[] {
  useSource(node);
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const path = p.bind_items ? String(p.bind_items) : "";
  if (!path) return [];
  return (getPath(scope, path) as unknown[]) ?? [];
}
function renderCell(col: Record<string, unknown>, row: unknown): React.ReactNode {
  const key = String(col.key ?? "");
  const value = getPath(row, key);
  const cell = String(col.cell ?? "text");
  if (cell === "badge") {
    const tone =
      col.tone != null
        ? String(col.tone)
        : col.tone_key != null
          ? String(getPath(row, String(col.tone_key)) ?? "neutral")
          : "neutral";
    // c8 knowledge-thread consensus/divisive columns are booleans (Polis
    // decision, not free text) — true_label/false_label give them Japanese
    // copy instead of showing the raw "true"/"false" string.
    const text =
      typeof value === "boolean"
        ? String(value ? (col.true_label ?? "true") : (col.false_label ?? "false"))
        : String(value ?? "");
    return <Badge text={text} tone={tone} />;
  }
  if (cell === "progress") {
    const n = Number(value ?? 0);
    return <ProgressBar value={Number.isFinite(n) ? n : 0} max={Number(col.max ?? 100)} />;
  }
  if (cell === "date") {
    return formatDateJa(value) || "—";
  }
  if (cell === "actor") {
    // c8#5: an actor_id column (e.g. market-trade's bids-table "bidder") shows
    // the display name (fallback short hash) instead of the raw id string.
    return value ? <ActorLabel actorId={String(value)} /> : "—";
  }
  if (cell === "observed") {
    // V3-AIP-101 磨き直し fix#2: date + a representative measurement in one
    // column ("2026-07-11・82.5g") — col.key is the date field, col.measurement_key
    // the summary string field (both come straight off GET /individuals).
    const dateStr = formatDateJa(value);
    if (!dateStr) return "—";
    const measure = col.measurement_key ? getPath(row, String(col.measurement_key)) : undefined;
    return measure != null && measure !== "" ? `${dateStr}・${measure}` : dateStr;
  }
  if (cell === "link") {
    // V3-AIP-101: a row-level navigate affordance (bind_items has no per-item
    // action hook otherwise). href_tpl interpolates against the ROW (list/
    // image-grid item templates use the same row-as-scope convention).
    const href = interpolate(String(col.href_tpl ?? ""), row);
    return (
      <a className="civ-link" href={href}>
        {String(col.link_label ?? "開く")}
      </a>
    );
  }
  return value == null ? "" : String(value);
}

// g87-p0base(catalog L19 P0穴3件のうち2件=field textarea/scope条件表示は
// 発注時点で既に実装済みだった=e128561。残る1件=table button/actionセルの
// み本ラウンドの実装対象。既存の row-as-scope 規約("link" cell の href_tpl
// 上記・ImageGridNode の item_action_screen/query/label)と既存の実行経路
// (ButtonNode/useRunActionのnavigate・api分岐)をそのまま合成する — 新規の
// 実行経路は発明しない。col.action は node.action と同じ {kind:"navigate",
// to,query?} / {kind:"api",method,path,toast?,static?} の形だが、
// to/path/query/static の各テンプレート文字列は SCOPE ではなく ROW を対象に
// 解決する(このテーブルの他セル=href_tpl/actor/observed 等が全てROWを対象に
// 解決するのと同じ規約)。呼び出し先screen-defが未だ存在しない(g83-uiprogress
// 実測=table button/actionセルを使う画面は現時点で0件)ため、この形は
// 「既存2規約の合成」として妥当と判断した(判断の詳細は報告書に記載)。
function TableActionCell({
  tableNodeId,
  col,
  row,
}: {
  tableNodeId: string;
  col: Record<string, unknown>;
  row: unknown;
}) {
  const run = useRunAction(tableNodeId);
  const navigate = useContext(NavigateCtx);
  const [pending, setPending] = useState(false);
  const rawAction = col.action as
    | { kind?: string; to?: string; query?: Record<string, string>; method?: string; path?: string; toast?: string; static?: Record<string, unknown> }
    | undefined;
  const label = String(col.label ?? "実行");
  const onClick = useCallback(async () => {
    if (!rawAction || pending) return;
    setPending(true);
    try {
      if (rawAction.kind === "navigate") {
        const to = interpolate(String(rawAction.to ?? ""), row);
        const queryTpl = rawAction.query ?? {};
        navigate(to, Object.fromEntries(Object.entries(queryTpl).map(([k, v]) => [k, interpolate(String(v), row)])));
      } else {
        const action: Action = {
          kind: "api",
          method: (rawAction.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined) ?? "POST",
          path: interpolate(String(rawAction.path ?? ""), row),
          toast: rawAction.toast,
        };
        const body = rawAction.static ? resolveStatic(rawAction.static, row as Scope) : undefined;
        await run(action, body);
      }
    } finally {
      setPending(false);
    }
  }, [rawAction, pending, navigate, run, row]);
  return (
    <button
      type="button"
      className={cn("civ-interactive", "civ-button")}
      data-variant={col.variant ? String(col.variant) : "ghost"}
      disabled={pending}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function TableNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const items = useBoundItems(node);
  const columns = (p.columns as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  return (
    // c8: a mobile-width (390px) viewport clips trailing columns without a
    // scroll wrapper — this affects every table-node screen, not just c8's,
    // so the fix lives at the shared node rather than per-screen. The scroll
    // wrapper now lives inside <Table> itself (src/components/ui/table.tsx).
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c, i) => (
            <TableHead key={i}>{displayText(resolve, c.label_key, c.label, String(c.key ?? ""))}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row, ri) => (
          <TableRow key={ri}>
            {columns.map((c, ci) => (
              // c8磨き第2弾#7: data-label feeds the <=560px responsive
              // card-mode CSS (globals.css) — each cell shows its own
              // column label via ::before, so a table reflows into a
              // stacked card list instead of a squeezed horizontal scroll
              // (受領10 モバイル「詳細を開く」ボタン潰れの根本対処)。
              <TableCell key={ci} data-label={displayText(resolve, c.label_key, c.label, String(c.key ?? ""))}>
                {String(c.cell ?? "text") === "button" ? (
                  <TableActionCell tableNodeId={node.id} col={c} row={row} />
                ) : (
                  renderCell(c, row)
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Tabs / section switcher (§2-5). props.tabs[] drives the tab strip; each
// child node opts into a tab via props.tab_id — only the active tab's
// children render (unassigned children never show, keeping the contract
// explicit rather than "everything without tab_id always shows").
export function TabsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const tabs = (p.tabs as Array<Record<string, unknown>>) ?? [];
  const rawDefault = p.default_tab != null ? String(p.default_tab) : String(tabs[0]?.id ?? "");
  // c8 market-trade: default_tab may carry a "{{...}}" scope template (e.g.
  // "{{data.state.stage}}") so a screen can auto-select the tab matching
  // server-fetched state (public listing vs. private post-match board). The
  // fetch that fills scope.data is async (useSource resolves after mount), so
  // a plain useState initializer would only ever see the pre-fetch empty
  // value — the effect below re-applies the resolved default once the data
  // arrives, but only until the visitor taps a tab themselves.
  const resolvedDefault = rawDefault.includes("{{") ? interpolate(rawDefault, scope) : rawDefault;
  // uib09-1a(b2think §3-3): 選択タブの記憶。props.persist_key が付いた画面
  // (obs-search)だけ localStorage を読み書きする — 未指定の画面(market-trade等)
  // は従来どおり default_tab のみで挙動不変。
  const persistKey = p.persist_key != null ? String(p.persist_key) : null;
  const restoredTab = (() => {
    if (!persistKey || typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem(persistKey);
      return saved && tabs.some((t) => String(t.id ?? "") === saved) ? saved : null;
    } catch {
      return null;
    }
  })();
  const [active, setActiveState] = useState<string>(restoredTab ?? (resolvedDefault || String(tabs[0]?.id ?? "")));
  const setActive = (id: string) => {
    setActiveState(id);
    if (!persistKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(persistKey, id);
    } catch {
      /* best effort */
    }
  };
  // restoredTab がある時は復元済みタブを default_tab で上書きしない(既にタップ
  // 済み扱いにする)。
  const touchedRef = useRef(restoredTab != null);
  useEffect(() => {
    if (touchedRef.current) return;
    if (resolvedDefault && tabs.some((t) => String(t.id ?? "") === resolvedDefault) && resolvedDefault !== active) {
      setActiveState(resolvedDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDefault]);
  const children = node.children ?? [];
  return (
    <Tabs
      value={active}
      onValueChange={(id) => {
        touchedRef.current = true;
        setActive(id);
      }}
    >
      <TabsList>
        {tabs.map((t) => {
          const id = String(t.id ?? "");
          return (
            <TabsTrigger key={id} value={id} active={id === active}>
              {displayText(resolve, t.label_key, t.label, id)}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value={active}>
        {children
          .filter((c) => String(c.props?.tab_id ?? "") === active)
          .map((c) => (
            <NodeView key={c.id} node={c} />
          ))}
      </TabsContent>
    </Tabs>
  );
}

// True if ANY "{{path}}" reference in `tpl` resolves to null/"" against
// `scope` — used by ImageGridNode to tell "no photo uploaded yet" (e.g.
// item_image references a row's optional cover_photo_id) apart from "photo
// exists", so a missing photo renders an honest placeholder instead of a
// broken <img src="…/photo/">.
function templateHasMissingRef(tpl: string, scope: unknown): boolean {
  for (const m of tpl.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const v = getPath(scope, m[1]);
    if (v == null || v === "") return true;
  }
  return false;
}

// V3-OBS-24 類似個体サイドバー: image-grid の bind_items(GET+source_path)は
// POST の類似検索(OBS-11 rerank)を表現できないため、同じ「宣言的語彙で表現し
// きれない専用フェッチ」縮退(individual-profile/growth-chart と同じ扱い)で
// search_path+search_body を足す。bind_items と排他 — 両方指定は search_path
// が勝つ。search_response_path はレスポンス中の配列の位置(例: "individuals"・
// aggregate モードの POST /observation/search 応答)。
function useSearchItems(node: ScreenNode): unknown[] {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const { setNodeData } = useContext(DataSinkCtx);
  const path = p.search_path ? String(p.search_path) : "";
  const bodyTpl = (p.search_body as Record<string, unknown> | undefined) ?? {};
  const bodyKey = JSON.stringify(bodyTpl);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const body = resolveStatic(bodyTpl, scope);
    Promise.resolve(execute({ kind: "api", method: "POST", path }, body))
      .then((r) => {
        if (alive && r !== undefined) setNodeData(node.id, r);
      })
      .catch(() => {
        /* honest empty state — no match / no embedding yet is not an error to show */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bodyKey]);
  const stored = getPath(scope, `data.${node.id}`);
  const respPath = p.search_response_path ? String(p.search_response_path) : "";
  const arr = respPath ? getPath(stored, respPath) : stored;
  return Array.isArray(arr) ? arr : [];
}

// Image grid / thumbnail cards (§2-6) — the bind_items twin of ListNode's
// image branch, laid out as a grid instead of a stacked list, each cell
// carrying a meta line + optional Badge. c8磨き第2弾#2(受領10「画像を押せば
// 詳細が出る」): item_href makes the whole card a click-through link — no
// separate "詳細を開く" button to squeeze on mobile. (+ V3-OBS-24 an optional
// per-item navigate button — item_action_screen/item_action_query/
// item_action_label — e.g. a similar-individual card's "引用として見る"
// citation button — item_href and the action button are independent, both
// may be present).
export function ImageGridNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const navigate = useContext(NavigateCtx);
  const boundItems = useBoundItems(node);
  const searchItems = useSearchItems(node);
  const items = p.search_path ? searchItems : boundItems;
  if (items.length === 0 && p.empty_text) {
    return <p className="civ-empty">{String(p.empty_text)}</p>;
  }
  const imgTpl = p.item_image ? String(p.item_image) : "";
  const altTpl = p.item_alt ? String(p.item_alt) : "";
  const labelTpl = p.item_label ? String(p.item_label) : "";
  const metaTpl = p.item_meta ? String(p.item_meta) : "";
  const badgeTpl = p.item_badge ? String(p.item_badge) : "";
  const badgeToneTpl = p.item_badge_tone ? String(p.item_badge_tone) : "";
  const hrefTpl = p.item_href ? String(p.item_href) : "";
  // Dynamic tag: <a> when the card navigates, <figure> otherwise — same
  // .civ-thumb-card box either way (see globals.css, tag-agnostic selector).
  const Wrapper = hrefTpl ? "a" : "figure";
  const actionScreen = p.item_action_screen ? String(p.item_action_screen) : "";
  const actionQueryTpl = (p.item_action_query as Record<string, string> | undefined) ?? {};
  const actionLabel = p.item_action_label ? String(p.item_action_label) : "";
  return (
    <div className="civ-image-grid">
      {items.map((rawIt, i) => {
        // V3-OBS-24 スコア%: OBS-11 rerank score is a 0..1 float — a bare
        // {{score}} template can't round/×100, so a rounded score_pct rides
        // the per-item scope alongside the raw fields (additive, no interpolate change).
        const s = (rawIt as Record<string, unknown>)?.score;
        const it = typeof s === "number" && Number.isFinite(s) ? { ...(rawIt as object), score_pct: Math.round(s * 100) } : rawIt;
        return (
        <Wrapper className="civ-thumb-card" key={i} {...(hrefTpl ? { href: interpolate(hrefTpl, it) } : {})}>
          {imgTpl && !templateHasMissingRef(imgTpl, it) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-image" src={interpolate(imgTpl, it)} alt={interpolate(altTpl, it)} />
          ) : (
            imgTpl && (
              <div className="civ-thumb-placeholder" aria-hidden="true">
                📷
              </div>
            )
          )}
          <figcaption>
            {labelTpl && <p className="civ-text">{interpolate(labelTpl, it)}</p>}
            {metaTpl && (
              <p className="civ-text" data-muted="true">
                {interpolate(metaTpl, it)}
              </p>
            )}
            {badgeTpl && (
              <Badge
                text={interpolate(badgeTpl, it)}
                tone={badgeToneTpl ? interpolate(badgeToneTpl, it) : undefined}
              />
            )}
            {actionScreen && actionLabel && (
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                onClick={() =>
                  navigate(
                    actionScreen,
                    Object.fromEntries(
                      Object.entries(actionQueryTpl).map(([k, v]) => [k, interpolate(String(v), it)]),
                    ),
                  )
                }
              >
                {actionLabel}
              </button>
            )}
          </figcaption>
        </Wrapper>
        );
      })}
    </div>
  );
}

// Stepper — multi-stage progress with the current step highlighted (§2-7).
// props.current is either a 0-based index or a step id (matched against
// steps[].id); steps before it are "done", the match is "current", the rest
// "upcoming".
export function StepperNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const steps = (p.steps as Array<Record<string, unknown>>) ?? [];
  // c8 market-trade: `current` may be a "{{...}}" scope template (a literal
  // step id/index straight off fetched data). `current_from` + `current_map`
  // additionally remap a raw fetched value (e.g. the transaction state string
  // "shipped") onto a step index — the same derive_from+labels convention
  // BadgeNode already uses for life-stage, so a many-states→N-steps screen
  // doesn't need N literal step ids matching the backend's state machine 1:1.
  let cur: unknown = p.current;
  if (typeof cur === "string" && cur.includes("{{")) cur = interpolate(cur, scope);
  if (p.current_from) {
    const raw = interpolate(String(p.current_from), scope);
    const map = (p.current_map as Record<string, unknown> | undefined) ?? {};
    cur = raw in map ? map[raw] : raw;
  }
  const currentIndex =
    typeof cur === "number" ? cur : Math.max(0, steps.findIndex((s) => String(s.id ?? "") === String(cur ?? "")));
  return (
    <ol className="civ-stepper">
      {steps.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={String(s.id ?? i)} className="civ-step" data-state={state}>
            <span className="civ-step-index" aria-hidden="true">
              {i + 1}
            </span>
            <span className="civ-step-label">{displayText(resolve, s.label_key, s.label, String(i + 1))}</span>
          </li>
        );
      })}
    </ol>
  );
}

// KPI / stat tile (§2-8) — a big number + label + optional trend Badge.
// props.value/trend are templates interpolated against scope (like text
// nodes); an optional own source_path feeds {{data.<id>.field}} the same way
// CardNode's source_path does, so a tile can be the only fetcher on screen.
// props.fallback (V3-UIX-26 文明ミニマップ「API失敗時は近似フォールバック
// 表示」): while the bound value is still empty (either loading, or the fetch
// truly failed and useSource's catch() silently gave up), show this instead
// of a blank tile — both states honestly mean "no real number yet".
export function KpiTileNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  useSource(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const resolved = interpolate(String(p.value ?? ""), scope);
  const value = resolved !== "" ? resolved : p.fallback != null ? String(p.fallback) : "";
  const label = displayText(resolve, p.label_key, p.label, "");
  const trend = p.trend != null ? interpolate(String(p.trend), scope) : "";
  return (
    <div className="civ-kpi-tile">
      <span className="civ-kpi-value">{value}</span>
      {label && <span className="civ-kpi-label">{label}</span>}
      {trend && <Badge text={trend} tone={p.trend_tone != null ? String(p.trend_tone) : undefined} />}
    </div>
  );
}

export function QrNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const value = interpolate(String(p.value ?? p.token ?? ""), scope);
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value || " ", { type: "svg", margin: 0 })
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      className="civ-qr"
      role="img"
      aria-label={`QRコード: ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// V3-I18-06: user-generated text shown in its ORIGINAL language, with an
// on-device "翻訳" affordance offered only when the viewer's locale differs from
// the content's `lang`. Translation runs on-device on demand — never a server
// call (see lib/ugc-translate). Original text is shown until the viewer opts in.
export function UgcText({ node, text }: { node: ScreenNode; text: string }) {
  const p = props(node);
  const viewerLocale = useContext(LocaleCtx);
  const lang = p.lang ? String(p.lang) : undefined;
  const [shown, setShown] = useState(text);
  const [busy, setBusy] = useState(false);
  const offer = shouldOfferTranslation(lang, viewerLocale);
  const onTranslate = useCallback(async () => {
    setBusy(true);
    try {
      const r = await translateOnDemand({ text, sourceLang: lang, viewerLocale });
      setShown(r.text);
    } finally {
      setBusy(false);
    }
  }, [text, lang, viewerLocale]);
  return (
    <p className="civ-text" data-muted={p.muted === true || undefined} lang={lang}>
      {shown}
      {offer && (
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          aria-busy={busy || undefined}
          onClick={onTranslate}
        >
          翻訳
        </button>
      )}
    </p>
  );
}

// V3-OBS-18: the observation measurement table — a header row (項目/数値/単位/
// 計測方法) over N rows, each row an item select + number input + unit select +
// method select. props.rows seeds the initial template rows; "行を追加" appends
// blank rows (client state). Each row also emits a hidden measurements.i.kind so
// the shaped body is [{item,value,unit,method,kind:"number"}] — the same dotted
// FormData nesting obs-entry uses, so it rides the existing form contract.
// ponytail: uncontrolled rows. An untouched template row still submits its
// item/unit/method/kind with an empty value; the confirm/API step should drop
// measurements missing a value. Add per-row value-gating only if that leak bites.
//
// V3-OBS-27 StructuredRow統一: 測定行/撮影条件行/環境スナップショット行を同じ
// コンポーネントで表現する。種別差は専用ノードを増やさず tpl.group (既定
// "measurement") のみで表現(複数 group が混在する時だけ小見出しを挟む)。
// tpl.value_origin が "direct_observed" 以外(自動取得)なら、その行は
// 読取専用(ロック) — 入力欄の代わりに出所バッジ(◎/○/△+日本語ラベル)を表示し、
// 手入力行は従来どおり編集可(source は内部メタでユーザー選択式にしない)。
// props.readonly:true は表全体を閲覧専用にする(obs-detail 等・行追加/項目追加
// ボタンも隠す)。props.bind_items は table/list と同じ規約でスコープの配列
// (例: 祖先 card の source_path が fetch した data.detail.capture.measurements)
// を rows として束ねる — obs-entry のような静的 props.rows と排他。
const ORIGIN_GRADE: Record<string, "◎" | "○" | "△"> = {
  direct_observed: "◎",
  image_derived: "○",
  environment_derived: "○",
  lineage_derived: "○",
  estimated: "△",
  imputed: "△",
  aggregate: "△",
  model_inference: "△",
  unknown: "△",
};
const ORIGIN_LABEL: Record<string, string> = {
  direct_observed: "手入力",
  image_derived: "画像由来",
  environment_derived: "環境由来",
  lineage_derived: "血統由来",
  estimated: "推定",
  imputed: "補完",
  aggregate: "集計",
  model_inference: "モデル推論",
  unknown: "不明",
};
const GROUP_LABEL: Record<string, string> = {
  measurement: "計測",
  photo_condition: "撮影条件",
  environment_snapshot: "環境スナップショット",
};
const originTone = (grade: "◎" | "○" | "△" | ""): string =>
  grade === "◎" ? "success" : grade === "○" ? "neutral" : grade === "△" ? "caution" : "neutral";

export function MeasurementTableNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const boundRows = useBoundItems(node);
  const baseItems = toOptions(p.item_options);
  const baseUnits = toOptions(p.unit_options);
  const methodOpts = toOptions(p.method_options);
  const templates = p.bind_items
    ? (boundRows as Array<Record<string, unknown>>)
    : ((p.rows as Array<Record<string, unknown>>) ?? []);
  const readonly = p.readonly === true;
  const [extra, setExtra] = useState(0);
  // V3-OBS-18 自由項目: user-defined item/unit choices extend every row's select.
  const [extraItems, setExtraItems] = useState<Opt[]>([]);
  const [extraUnits, setExtraUnits] = useState<Opt[]>([]);
  const [adding, setAdding] = useState<null | "item" | "unit">(null);
  const [pendingName, setPendingName] = useState("");
  const itemOpts = [...baseItems, ...extraItems];
  const unitOpts = [...baseUnits, ...extraUnits];
  const rowCount = readonly ? templates.length : templates.length + extra;
  const th = (k: unknown, l: unknown, fb: string) => displayText(resolve, k, l, fb);
  const itemLabel = th(p.item_label_key, p.item_label, "項目");
  const valueLabel = th(p.value_label_key, p.value_label, "数値");
  const unitLabel = th(p.unit_label_key, p.unit_label, "単位");
  const methodLabel = th(p.method_label_key, p.method_label, readonly ? "出所" : "計測方法");
  const canAddItem = p.add_item_label != null && !readonly;
  const canAddUnit = p.add_unit_label != null && !readonly;
  const groupOf = (t: Record<string, unknown>) => (t.group != null ? String(t.group) : "measurement");
  const hasMultipleGroups = new Set(templates.map(groupOf)).size > 1;

  const confirmAdd = () => {
    const v = pendingName.trim();
    if (v) {
      const opt = { value: v, label: v };
      const setter = adding === "item" ? setExtraItems : setExtraUnits;
      setter((xs) => (xs.some((o) => o.value === v) ? xs : [...xs, opt]));
    }
    setPendingName("");
    setAdding(null);
  };

  if (readonly && templates.length === 0) {
    return p.empty_text ? <p className="civ-empty">{String(p.empty_text)}</p> : null;
  }

  return (
    <div className="civ-measure-table" role="group" aria-label={th(p.label_key, p.label, "計測")}>
      <div className="civ-measure-head" aria-hidden="true">
        <span>{itemLabel}</span>
        <span>{valueLabel}</span>
        <span>{unitLabel}</span>
        <span>{methodLabel}</span>
      </div>
      {Array.from({ length: rowCount }).map((_, i) => {
        const tpl = templates[i] ?? {};
        const dItem = tpl.item != null ? String(tpl.item) : "";
        const dUnit = tpl.unit != null ? String(tpl.unit) : "";
        const dMethod =
          tpl.method != null ? String(tpl.method) : String(methodOpts[0]?.value ?? "");
        const rowN = i + 1;
        const group = groupOf(tpl);
        const prevGroup = i > 0 ? groupOf(templates[i - 1] ?? {}) : null;
        const showGroupHeader = hasMultipleGroups && group !== prevGroup;
        const origin = tpl.value_origin != null ? String(tpl.value_origin) : "";
        const locked = readonly || (origin !== "" && origin !== "direct_observed");
        const rowNode = locked ? (
          <div className="civ-measure-row" data-locked="true" key={i}>
            <span className="civ-text" aria-label={`${itemLabel} ${rowN}`}>
              {dItem || "—"}
            </span>
            <span className="civ-text" aria-label={`${valueLabel} ${rowN}`}>
              {tpl.value != null ? String(tpl.value) : "—"}
            </span>
            <span className="civ-text" aria-label={`${unitLabel} ${rowN}`}>
              {dUnit}
            </span>
            <span className="civ-measure-origin" aria-label={`${methodLabel} ${rowN}`}>
              <Badge
                text={`${origin ? ORIGIN_GRADE[origin] ?? "" : ""} ${origin ? (ORIGIN_LABEL[origin] ?? origin) : "手入力"}`.trim()}
                tone={originTone(origin ? (ORIGIN_GRADE[origin] ?? "") : "")}
              />
              {readonly ? null : (
                <span aria-hidden="true" title="自動取得・読取専用">
                  🔒
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="civ-measure-row" key={i}>
            <select
              className="civ-input"
              name={`measurements.${i}.item`}
              defaultValue={dItem}
              aria-label={`${itemLabel} ${rowN}`}
            >
              {dItem === "" && <option value="">—</option>}
              {itemOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="civ-input"
              type="number"
              inputMode="decimal"
              name={`measurements.${i}.value`}
              defaultValue={tpl.value != null ? String(tpl.value) : undefined}
              aria-label={`${valueLabel} ${rowN}`}
            />
            <select
              className="civ-input"
              name={`measurements.${i}.unit`}
              defaultValue={dUnit}
              aria-label={`${unitLabel} ${rowN}`}
            >
              {dUnit === "" && <option value="">—</option>}
              {unitOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="civ-input"
              name={`measurements.${i}.method`}
              defaultValue={dMethod}
              aria-label={`${methodLabel} ${rowN}`}
            >
              {methodOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input type="hidden" name={`measurements.${i}.kind`} value="number" readOnly />
          </div>
        );
        return (
          <React.Fragment key={i}>
            {showGroupHeader && <div className="civ-measure-group">{GROUP_LABEL[group] ?? group}</div>}
            {rowNode}
          </React.Fragment>
        );
      })}
      {!readonly && (
        <div className="civ-measure-actions">
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={() => setExtra((n) => n + 1)}
          >
            {th(p.add_label_key, p.add_label, "行を追加")}
          </button>
          {canAddItem && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="ghost"
              onClick={() => {
                setAdding("item");
                setPendingName("");
              }}
            >
              {th(p.add_item_label_key, p.add_item_label, "＋ 項目を追加")}
            </button>
          )}
          {canAddUnit && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="ghost"
              onClick={() => {
                setAdding("unit");
                setPendingName("");
              }}
            >
              {th(p.add_unit_label_key, p.add_unit_label, "＋ 単位を追加")}
            </button>
          )}
        </div>
      )}
      {adding && (
        <div className="civ-measure-add">
          {/* no `name` — this is a choice-builder, not a submitted measurement field */}
          <input
            className="civ-input"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder={String(
              (adding === "item" ? p.item_placeholder : p.unit_placeholder) ??
                (adding === "item" ? "例: 頭角幅" : "例: mg"),
            )}
            aria-label={adding === "item" ? itemLabel : unitLabel}
          />
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={confirmAdd}
          >
            {adding === "item" ? "項目を追加" : "単位を追加"}
          </button>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            onClick={() => setAdding(null)}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

// V3-AIP-101 「この子への追観測?」候補チップ: a client-only recently-viewed
// cache (no new Truth type — a convenience index, same footing as the draft
// sessionStorage carry). visit-tracker stamps the current individual on F2
// mount; recent-chips reads the last 3 on F1. Capped at 10, newest first,
// deduped by id.
// 磨き直し fix#1: the entry carries label/name/species/stage too (never the
// raw id) so F1 can render a rich chip instead of a bare-ULID pill. Old
// bare {id,at} rows already in localStorage still parse fine — the extra
// fields are just undefined until the next visit re-stamps them.
const RECENT_KEY = "ihl:obs-recent-individuals";
type RecentEntry = { id: string; at: number; label?: string; name?: string; species?: string; stage?: string };

function readRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const rows = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
function pushRecent(entry: Omit<RecentEntry, "at">): void {
  if (typeof window === "undefined" || !entry.id) return;
  const next = [{ ...entry, at: Date.now() }, ...readRecent().filter((e) => e.id !== entry.id)].slice(0, 10);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — best effort, no crash */
  }
}
function relativeLabel(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

export function VisitTrackerNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const id = p.id_from ? String(getPath(scope, String(p.id_from)) ?? "") : "";
  // 磨き直し fix#1: props.from points at the paired card's fetched individual
  // (e.g. "data.individual") so the stamped entry carries label/species/stage,
  // not just the id. The effect deliberately depends on the RESOLVED source
  // object, not just `id` — `useSource`'s fetch resolves asynchronously via
  // setNodeData (a re-render), so gating on `source` (not just `id`) means the
  // pre-fetch empty enrichment is never the one that gets persisted. Without a
  // `from` prop (no other consumer today) it falls back to the old id-only stamp.
  const fromPath = p.from ? String(p.from) : "";
  const source = fromPath ? (getPath(scope, fromPath) as Record<string, unknown> | undefined) : undefined;
  const stageLabels = (p.stage_labels as Record<string, string> | undefined) ?? {};
  useEffect(() => {
    if (!id) return;
    if (!fromPath) {
      pushRecent({ id });
      return;
    }
    if (!source) return; // still waiting on the paired fetch
    const master = (source.master as Record<string, unknown> | undefined) ?? {};
    const label = typeof master.local_label_text === "string" ? master.local_label_text : undefined;
    const name = typeof source.name === "string" ? source.name : undefined;
    const species = typeof master.species === "string" ? master.species : undefined;
    const stageCode = currentStage(source.timeline);
    const stage = stageCode ? (stageLabels[stageCode] ?? stageCode) : undefined;
    pushRecent({ id, label, name, species, stage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fromPath, source]);
  return null;
}

// 磨き直し fix#1: a rich CardNode-style chip — label/name lead over the raw
// id (never shown), species+stage as badges, relative time as the caption.
// Reuses the same .civ-card/.civ-badge/.civ-interactive vocabulary CardNode
// uses (a bare button pill would have re-invented that shell).
export function RecentChipsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const navigate = useContext(NavigateCtx);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  useEffect(() => setEntries(readRecent().slice(0, 3)), []);
  // 履歴ゼロならチップ行ごと非表示(空行を出さない・仕様どおり).
  if (entries.length === 0) return null;
  const to = p.to ? String(p.to) : "";
  const label = displayText(resolve, p.label_key, p.label, "この子への追観測?");
  return (
    <section aria-label={label}>
      <p className="civ-text" data-muted="true">
        {label}
      </p>
      <div className="civ-chip-row">
        {entries.map((e) => {
          const title = e.label || e.name || e.species || "個体";
          return (
            <button
              key={e.id}
              type="button"
              className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
              onClick={() => navigate(to, { id: e.id })}
            >
              <span className="civ-card-title">{title}</span>
              {(e.species || e.stage) && (
                <span className="civ-card-badges">
                  {e.species && <Badge text={e.species} tone="neutral" />}
                  {e.stage && <Badge text={e.stage} tone="neutral" />}
                </span>
              )}
              <span className="civ-text" data-muted="true">
                {relativeLabel(e.at)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// 磨き直し fix#5/#6: one shared collapsed-by-default trigger + revealed-body
// mechanism (no forked half-implementation per fix). trigger_style:"badge"
// renders a tappable Badge chip (F2 stage — text can be derive_from-computed,
// same lookup BadgeNode uses); anything else renders a normal .civ-button
// (F2 death). Children show only once tapped; collapsing back is out of scope
// (both consumers navigate/reload on submit, which resets `open` for free).
export function DisclosureNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const resolve = useContext(MessagesCtx);
  const scope = useContext(ScopeCtx);
  const [open, setOpen] = useState(false);
  const isBadge = p.trigger_style === "badge";
  let label: string;
  let tone: string | undefined;
  if (p.derive_from) {
    const derived = stageBadgeText(scope, p.derive_from, p.stage_labels, p.empty_text);
    label = derived.text;
    tone = derived.hasStage ? String(p.tone ?? "neutral") : "neutral";
  } else {
    label = interpolate(displayText(resolve, p.trigger_label_key, p.trigger_label, "詳細"), scope);
    tone = p.tone != null ? String(p.tone) : undefined;
  }
  if (isBadge) label = `${label} ${open ? "▾" : "▸"}`;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="civ-disclosure"
      data-open={open || undefined}
    >
      <CollapsibleTrigger asChild>
        {isBadge ? (
          <button
            type="button"
            className={cn("civ-interactive", "civ-badge", "civ-disclosure-trigger")}
            data-tone={tone ?? "neutral"}
          >
            {label}
          </button>
        ) : (
          <button
            type="button"
            className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
            data-variant={String(p.trigger_style ?? "secondary")}
          >
            {label}
          </button>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="civ-disclosure-body">
        <Children nodes={node.children} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface RendererProps {
  def: ScreenDef;
  onAction?: Execute;
  onNavigate?: (to: string, query?: Record<string, string>) => void;
  /** URL query scope (?id=…). Defaults to window.location.search in the browser. */
  params?: Record<string, string>;
  /**
   * I18-08 text_key resolver (lib/i18n supplies the catalog + fallback chain).
   * Explicit resolveMessage wins; otherwise it is derived from `catalogs` +
   * `viewerLocale` below (a plain function can't cross the server/client
   * boundary, but the serializable catalog data can — I18-01/I18-03).
   */
  resolveMessage?: ResolveMessage;
  /** I18-08: catalogs loaded server-side (lib/i18n loadCatalogs()); combined
   *  with viewerLocale to build the resolver when resolveMessage is omitted. */
  catalogs?: Catalogs;
  /** I18-06/I18-03 viewer locale — drives both the UGC translate affordance
   *  and (via `catalogs`) the resolved UI text; follows the account's saved
   *  preference so the whole product switches with it (I18-01/I18-03). */
  viewerLocale?: string;
}

export function Renderer({
  def,
  onAction,
  onNavigate,
  params,
  resolveMessage,
  catalogs,
  viewerLocale,
}: RendererProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Record<string, unknown>>({});
  const [viewer, setViewer] = useState<Record<string, unknown>>({});
  const execute = onAction ?? defaultExecute(onNavigate);
  const resolvedMessage = useMemo(
    () => resolveMessage ?? (catalogs ? makeResolver(catalogs, viewerLocale ?? "ja") : () => undefined),
    [resolveMessage, catalogs, viewerLocale],
  );

  // c8#1: fetch the viewer once per screen mount so any node's `when` can
  // compare {{viewer.actor_id}} against fetched data (buyer/seller/thread_owner
  // role gating) without every node re-implementing its own /me/profile call
  // (ThreadPostsNode did exactly that before this existed — same idea, lifted
  // one level so declarative screen-defs can use it too). Only fires when THIS
  // screen-def actually has a `when` prop somewhere — the other ~46 screens
  // (and every existing action-count assertion in renderer.test.tsx) see zero
  // behaviour change, and no screen pays for a fetch it never reads.
  const needsViewer = useMemo(() => anyField(def.nodes, (n) => n.props?.when != null), [def]);
  useEffect(() => {
    if (!needsViewer) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/profile" }))
      .then((r) => {
        if (alive && r && typeof r === "object") setViewer(r as Record<string, unknown>);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsViewer]);

  const navigate = useCallback(
    (to: string, query?: Record<string, string>) => {
      if (onNavigate) onNavigate(to, query);
      else if (typeof window !== "undefined") window.location.assign(screenHref(to, query));
    },
    [onNavigate],
  );
  const setNodeData = useCallback(
    (id: string, value: unknown) => setData((d) => ({ ...d, [id]: value })),
    [],
  );
  const setActionResult = useCallback(
    (value: unknown) =>
      setResult((r) => ({ ...r, ...(value && typeof value === "object" ? (value as object) : {}) })),
    [],
  );

  const scope: Scope = { params: params ?? readQuery(), data, result, viewer };

  return (
    <MessagesCtx.Provider value={resolvedMessage}>
      <LocaleCtx.Provider value={viewerLocale ?? "ja"}>
        <LayoutCtx.Provider value={def.layout ?? "standard"}>
          <ScreenIdCtx.Provider value={def.screen_id}>
            <ExecuteCtx.Provider value={execute}>
              <ScopeCtx.Provider value={scope}>
                <TransitionsCtx.Provider value={def.transitions ?? []}>
                  <NavigateCtx.Provider value={navigate}>
                    <DataSinkCtx.Provider value={{ setNodeData, setActionResult }}>
                      {def.nodes.map((n) => (
                        <NodeView key={n.id} node={n} />
                      ))}
                      <ToastHost />
                    </DataSinkCtx.Provider>
                  </NavigateCtx.Provider>
                </TransitionsCtx.Provider>
              </ScopeCtx.Provider>
            </ExecuteCtx.Provider>
          </ScreenIdCtx.Provider>
        </LayoutCtx.Provider>
      </LocaleCtx.Provider>
    </MessagesCtx.Provider>
  );
}
