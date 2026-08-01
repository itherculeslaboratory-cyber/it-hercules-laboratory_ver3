"use client";
// F2 — 研究者モード本体のUI。renderer.tsx / screen-defs / navigation.json には一切
// 触れていない(スコープ境界により検索画面「研究者」タブへの組み込みは次波でHQが別途
// 発注する)。ここは独立した React コンポーネントとして完結させ、実行時の重い部分
// (duckdb-wasmのロード・接続・SQL実行)は onRunQuery として注入する — 本番配線時は
// duckdb-client.ts の loadDuckDb/registerManifest/runResearchQuery をそのまま渡せばよく、
// テスト時はモック関数を渡せる(テスト容易性のための設計判断・§9参照)。
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
}

const DEFAULT_CONDITION_JSON = JSON.stringify(
  { conditions: [{ column: "type", operator: "=", value: "obs-capture" }], limit: 100 },
  null,
  2,
);

export default function ResearchPanel({ manifestInfo, onRunQuery, now }: ResearchPanelProps) {
  const [conditionText, setConditionText] = useState(DEFAULT_CONDITION_JSON);
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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
        研究者モード: manifestはまだ生成されていません。生成器(libs/datalake)がR2へ
        manifest.parquetを配置すると、ここで検索できるようになります。
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

  return (
    <div data-testid="research-panel">
      <p data-testid="manifest-generation-info">
        manifest generation {manifestInfo.generation}
        {manifestInfo.generated_at ? `(生成: ${manifestInfo.generated_at})` : ""}
      </p>

      <label htmlFor="research-condition-json">検索条件(JSON)</label>
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
        {running ? "実行中..." : "実行"}
      </button>
      {runError && <p data-testid="run-error">{runError}</p>}

      {results && (
        <div data-testid="results-block">
          <p data-testid="results-count">{results.length}件</p>
          <button
            type="button"
            data-testid="export-csv"
            onClick={() => downloadTextFile("research-results.csv", resultsToCsv(results), "text/csv")}
          >
            CSV出力
          </button>
          <button
            type="button"
            data-testid="export-json"
            onClick={() => downloadTextFile("research-results.json", resultsToJson(results), "application/json")}
          >
            JSON出力
          </button>
        </div>
      )}

      <button type="button" data-testid="save-condition" onClick={handleSaveCondition}>
        検索条件を保存(JSONダウンロード)
      </button>
      <button type="button" data-testid="copy-share-url" onClick={handleCopyShareUrl}>
        共有URLをコピー
      </button>
    </div>
  );
}
