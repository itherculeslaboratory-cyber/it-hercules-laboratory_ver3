"use client";
// F2 — 研究者モード本体のUI。renderer.tsx の research-panel ノード(g81-f2wiring T1)
// から screen-defs/obs-search.json「研究者」タブに配線されている。実行時の重い部分
// (duckdb-wasmのロード・接続・SQL実行)は onRunQuery として注入する設計は維持
// (config-drivenなrenderer本体から素朴に呼べ、テスト時はモック関数を渡せる)。
// duckdb-client.ts の loadDuckDb/registerManifest/runResearchQuery をそのまま渡せる。
import { useMemo, useState } from "react";
import {
  generateResearchQuerySql,
  type ResearchQueryJson,
} from "./query-generator";
import { WhitelistViolationError } from "./manifest-query-columns";
import type { ManifestLatestInfo } from "./manifest-client";
import { resultsToCsv, resultsToJson, downloadTextFile } from "./result-export";
import { buildSavedCondition, conditionToJson, encodeConditionForUrl } from "./condition-share";

export interface ResearchPanelProps {
  manifestInfo: ManifestLatestInfo;
  onRunQuery: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  /** テスト/呼び出し側が時刻を注入できるように(Date.now直呼びを避ける)。省略時は Date.now()。 */
  now?: () => Date;
  /**
   * i18n\ja.json(obs-search.research-panel.*)の解決関数(renderer.tsxのMessagesCtx
   * 由来)。省略時はハードコード文言(このファイル内のフォールバック文字列。文言は
   * i18n化の前と一字も変えていない)にフォールバックする — テスト側は注入不要。
   */
  resolve?: (key: string) => string | undefined;
  /**
   * g81-f2wiring T4: 検索条件JSONを ihl.research.query.v1 として Truth へ保存する
   * (condition-share.ts のダウンロード/URL共有とは併存)。省略時はボタン自体を
   * 出さない(actor_id が未確定なテスト・埋め込み用途向けの後方互換)。
   */
  onSaveToTruth?: (query: ResearchQueryJson, manifestGeneration: number) => Promise<void>;
}

// g81-f2wiring T2: 文言はi18n\ja.jsonへ移した(値は一字も変えていない)。resolve が
// 無い/キー未ヒットの時は fallback へ落ちる(renderer.tsxのdisplayText()と同じ規約)。
function t(resolve: ((key: string) => string | undefined) | undefined, key: string, fallback: string): string {
  const m = resolve?.(key);
  return m != null && m !== "" ? m : fallback;
}

const DEFAULT_CONDITION_JSON = JSON.stringify(
  { conditions: [{ column: "type", operator: "=", value: "obs-capture" }], limit: 100 },
  null,
  2,
);

export default function ResearchPanel({ manifestInfo, onRunQuery, now, resolve, onSaveToTruth }: ResearchPanelProps) {
  const [conditionText, setConditionText] = useState(DEFAULT_CONDITION_JSON);
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [truthSaveState, setTruthSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [truthSaveError, setTruthSaveError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const json = JSON.parse(conditionText) as ResearchQueryJson;
      return { query: json, parseError: null as string | null };
    } catch (e) {
      return { query: null, parseError: e instanceof Error ? e.message : String(e) };
    }
  }, [conditionText]);

  const generated = useMemo(() => {
    if (!parsed.query) return { sql: null, params: null, error: parsed.parseError };
    try {
      const { sql, params } = generateResearchQuerySql(parsed.query);
      return { sql, params, error: null as string | null };
    } catch (e) {
      const message =
        e instanceof WhitelistViolationError ? e.message : e instanceof Error ? e.message : String(e);
      return { sql: null, params: null, error: message };
    }
  }, [parsed]);

  if (manifestInfo.generation === null) {
    // 正直表示(design §4-4④・§4-4末尾「まだ生成されていません」)。誇張ゼロ。
    return (
      <div data-testid="research-panel-empty">
        {t(
          resolve,
          "obs-search.research-panel.empty.text",
          "研究者モード: manifestはまだ生成されていません。生成器(libs/datalake)がR2へ " +
            "manifest.parquetを配置すると、ここで検索できるようになります。",
        )}
      </div>
    );
  }

  async function handleRun() {
    if (!generated.sql || !generated.params) return;
    setRunning(true);
    setRunError(null);
    try {
      const rows = await onRunQuery(generated.sql, generated.params);
      setResults(rows);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function handleSaveCondition() {
    if (!parsed.query || manifestInfo.generation === null) return;
    const savedAt = (now ? now() : new Date()).toISOString();
    const saved = buildSavedCondition(parsed.query, manifestInfo.generation, savedAt);
    downloadTextFile("research-query-condition.json", conditionToJson(saved), "application/json");
  }

  function handleCopyShareUrl() {
    if (!parsed.query || manifestInfo.generation === null) return;
    const savedAt = (now ? now() : new Date()).toISOString();
    const saved = buildSavedCondition(parsed.query, manifestInfo.generation, savedAt);
    const encoded = encodeConditionForUrl(saved);
    const url = `${window.location.origin}${window.location.pathname}?condition=${encoded}`;
    void navigator.clipboard?.writeText(url);
  }

  async function handleSaveToTruth() {
    if (!onSaveToTruth || !parsed.query || manifestInfo.generation === null) return;
    setTruthSaveState("saving");
    setTruthSaveError(null);
    try {
      await onSaveToTruth(parsed.query, manifestInfo.generation);
      setTruthSaveState("saved");
    } catch (e) {
      setTruthSaveState("error");
      setTruthSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div data-testid="research-panel">
      <p data-testid="manifest-generation-info">
        manifest generation {manifestInfo.generation}
        {manifestInfo.generated_at
          ? t(resolve, "obs-search.research-panel.generated-at.text", "(生成: {{generated_at}})").replace(
              "{{generated_at}}",
              manifestInfo.generated_at,
            )
          : ""}
      </p>

      <label htmlFor="research-condition-json">
        {t(resolve, "obs-search.research-panel.condition-json.label", "検索条件(JSON)")}
      </label>
      <textarea
        id="research-condition-json"
        data-testid="condition-json-input"
        value={conditionText}
        onChange={(e) => setConditionText(e.target.value)}
      />

      {/* design §4-3「読取専用SQLプレビュー」— 生成したSQL文字列をそのまま表示する。 */}
      <pre data-testid="sql-preview">{generated.sql ?? ""}</pre>
      {generated.error && <p data-testid="query-error">{generated.error}</p>}

      <button type="button" data-testid="run-button" onClick={handleRun} disabled={!generated.sql || running}>
        {running
          ? t(resolve, "obs-search.research-panel.run-running.label", "実行中...")
          : t(resolve, "obs-search.research-panel.run.label", "実行")}
      </button>
      {runError && <p data-testid="run-error">{runError}</p>}

      {results && (
        <div data-testid="results-block">
          <p data-testid="results-count">
            {t(resolve, "obs-search.research-panel.results-count.text", "{{count}}件").replace(
              "{{count}}",
              String(results.length),
            )}
          </p>
          <button
            type="button"
            data-testid="export-csv"
            onClick={() => downloadTextFile("research-results.csv", resultsToCsv(results), "text/csv")}
          >
            {t(resolve, "obs-search.research-panel.export-csv.label", "CSV出力")}
          </button>
          <button
            type="button"
            data-testid="export-json"
            onClick={() => downloadTextFile("research-results.json", resultsToJson(results), "application/json")}
          >
            {t(resolve, "obs-search.research-panel.export-json.label", "JSON出力")}
          </button>
        </div>
      )}

      <button type="button" data-testid="save-condition" onClick={handleSaveCondition}>
        {t(resolve, "obs-search.research-panel.save-condition.label", "検索条件を保存(JSONダウンロード)")}
      </button>
      <button type="button" data-testid="copy-share-url" onClick={handleCopyShareUrl}>
        {t(resolve, "obs-search.research-panel.copy-share-url.label", "共有URLをコピー")}
      </button>
      {onSaveToTruth && (
        <>
          <button
            type="button"
            data-testid="save-to-truth"
            onClick={handleSaveToTruth}
            disabled={!parsed.query || truthSaveState === "saving"}
          >
            {truthSaveState === "saving"
              ? t(resolve, "obs-search.research-panel.save-to-truth-saving.label", "保存中...")
              : t(resolve, "obs-search.research-panel.save-to-truth.label", "Truthに保存")}
          </button>
          {truthSaveState === "saved" && (
            <p data-testid="save-to-truth-saved">
              {t(resolve, "obs-search.research-panel.save-to-truth-saved.text", "Truthに保存しました。")}
            </p>
          )}
          {truthSaveState === "error" && (
            <p data-testid="save-to-truth-error">{truthSaveError}</p>
          )}
        </>
      )}
    </div>
  );
}
