// Truth バックアップ二重化(V3-CST-09・round-16 採番)。Truth 正本(R2)を別プロバイダ
// (Backblaze B2 等)へ複製するアダプタ。gmo-connector.ts/payjp-connector.ts と同じ
// 接続層分離パターン: MODE=dry-run(既定・実接続なし)/live(本番 — 人間ゲート: B2 契約+
// 実鍵投入+実接続まで明示 throw)。本ラン(実装レーン)のスコープは「アダプタ+設定手順書
// (docs/ops/runbook.md §7)+dry-run 検証」まで — 実 B2 API 呼び出しコードは書かない
// (実契約が無い状態でネットワーク呼び出しコードだけ先行させても検証できず、後日の
// 実装時に実 API 形状で書き直すほうが安全なため)。
import type { R2BucketLite } from "@ihl/truth";

export interface TruthBackupEnv {
  // dry-run(既定): 実ネットワーク呼び出しなしで「何をコピーするか」の計画だけを返す。
  // live: B2 契約+実鍵投入(人間ゲート)まで明示 throw。
  TRUTH_BACKUP_MODE?: string;
  TRUTH_BACKUP_B2_BUCKET?: string;
  TRUTH_BACKUP_B2_KEY_ID?: string;
  TRUTH_BACKUP_B2_APP_KEY?: string;
}

export interface BackupPlan {
  mode: string;
  total_keys: number;
  keys: string[];
}

// Thrown when TRUTH_BACKUP_MODE=live is requested. Real B2 sync is a human gate
// (B2 バケット/アプリケーションキーの契約作成+実鍵投入は AGENTS.md 人間ゲート5種)。
export class TruthBackupLiveNotImplementedError extends Error {
  constructor() {
    super(
      "TRUTH_BACKUP_LIVE_NOT_IMPLEMENTED — real B2 sync requires a human gate " +
        "(B2 bucket + application key contract + real key injection). " +
        "See docs/ops/runbook.md §7 for the setup procedure.",
    );
    this.name = "TruthBackupLiveNotImplementedError";
  }
}

/**
 * dry-run: list every Truth key and report the copy plan (no network call).
 * live: throw until the human gate (real B2 contract + keys) is cleared.
 */
export async function planTruthBackup(
  bucket: R2BucketLite,
  env: TruthBackupEnv,
): Promise<BackupPlan> {
  const mode = env.TRUTH_BACKUP_MODE ?? "dry-run";
  if (mode === "live") throw new TruthBackupLiveNotImplementedError();
  const { objects } = await bucket.list({ prefix: "truth/" });
  return { mode, total_keys: objects.length, keys: objects.map((o) => o.key) };
}

// ── V3-FND-08: データ所有権(エクスポート/インポート・復元ポイント) ──────────
// planTruthBackup が「Truth 全体を外部プロバイダへコピーする計画」なのに対し、
// 以下は「ユーザー自身のデータ範囲」と「復元ポイント(世界全体のキー一覧の
// スナップショット)」という別の切り口を同じ Truth 正本に対して提供する。
// ponytail: 対応形式は本ランで JSON のみ実装する(statement は CSV/画像/動画/音声/
// PDF も挙げるが、それらは JSON バンドルの上に乗るフォーマット変換層であり、各
// ドメインのバイナリ資産(photo/thumbnail 等)の扱いを個別に要る=follow-up と正直に
// 明記する。R2バケット全体の日次/週次「スケジュール」自体は cron 宣言=人間ゲートの
// 対象なので本モジュールはトリガーを持たず、作成関数のみを提供する。
import { TruthStore, ulid } from "@ihl/truth";

export const RESTORE_POINT_TYPE = "ihl.fnd.restore_point.v1";

export interface RestorePointRecord {
  restore_point_id: string;
  created_at: string;
  total_keys: number;
  keys: string[];
}

function agentProvenance() {
  return { generator_kind: "agent" as const, agent_name: "claude-code" };
}

/**
 * 現時点の Truth 全キーを1件の復元ポイントとして append する(データ所有権の
 * 「復元ポイントの作成」)。実際の復元(過去キー内容の再適用)は Truth が
 * INSERT ONLY のため別途の実装を要り、本ランのスコープ外(follow-up)。
 */
export async function createRestorePoint(s: TruthStore, now: Date, bucket: R2BucketLite): Promise<RestorePointRecord> {
  const { objects } = await bucket.list({ prefix: "truth/" });
  const id = ulid();
  const record: RestorePointRecord = {
    restore_point_id: id,
    created_at: now.toISOString(),
    total_keys: objects.length,
    keys: objects.map((o) => o.key),
  };
  await s.putEventAt(`truth/${RESTORE_POINT_TYPE}/${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RESTORE_POINT_TYPE,
    time: now.toISOString(),
    provenance: agentProvenance(),
    data: record,
  });
  return record;
}

/** 復元ポイントの一覧(作成日時の昇順)。 */
export async function listRestorePoints(s: TruthStore): Promise<RestorePointRecord[]> {
  const events = await s.listEvents(`truth/${RESTORE_POINT_TYPE}/`);
  return events
    .map((e) => e.data as RestorePointRecord)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

// ── V3-FND-08 論点2(w-fnd2): 復元 = 過去内容の「再投稿」 ────────────────────
// Truth は put-if-absent(store.ts writeOnce)のため同じキーへの再書き込みは
// 409(conflict)になり、「巻き戻し」は実装できない(design19 §T1-4 訂正)。
// よって「復元」は過去内容を新しい ULID・現在時刻の新イベントとして append する
// 操作として実装する。★復元は取り消しではない — 削除したはずのものが新イベントとして
// 戻る(画面文言は apps/web 側の責務・この艦はAPI/純関数まで)。
export const RESTORE_APPLIED_TYPE = "ihl.fnd.restore_applied.v1";
export const MAX_RESTORE_POINTS = 5;
export const MAX_RESTORE_APPLICATIONS_PER_ACTOR = 5;

export class RestorePointNotFoundError extends Error {
  constructor(restorePointId: string) {
    super(`RESTORE_POINT_NOT_FOUND: ${restorePointId}`);
    this.name = "RestorePointNotFoundError";
  }
}
export class RestorePointLimitExceededError extends Error {
  constructor() {
    super(`RESTORE_POINT_LIMIT_EXCEEDED: max ${MAX_RESTORE_POINTS} restore points`);
    this.name = "RestorePointLimitExceededError";
  }
}
export class RestoreApplyLimitExceededError extends Error {
  constructor(actorId: string) {
    super(`RESTORE_APPLY_LIMIT_EXCEEDED: actor ${actorId} already applied ${MAX_RESTORE_APPLICATIONS_PER_ACTOR} restores`);
    this.name = "RestoreApplyLimitExceededError";
  }
}

/**
 * createRestorePoint のラッパー。既存の復元ポイント数が上限(5件)に達していたら
 * 作成を拒否する(FND-31の「5個/user」と同種の上限を流用・design19 T1-4)。
 */
export async function createRestorePointWithLimit(
  s: TruthStore,
  now: Date,
  bucket: R2BucketLite,
): Promise<RestorePointRecord> {
  const existing = await listRestorePoints(s);
  if (existing.length >= MAX_RESTORE_POINTS) throw new RestorePointLimitExceededError();
  return createRestorePoint(s, now, bucket);
}

export interface RestoreApplyResult {
  restore_point_id: string;
  applied_event_count: number;
}

/**
 * 復元ポイントに記録されたキー一覧のうち、actorId の所有物(OWNER_FIELD_NAMES一致)
 * だけを、新しい ULID・現在時刻の新イベントとして再投稿する(「利用者個人の復元」)。
 * バケット全体(世界全体)の復元は別機能(運用者の災害復旧・本モジュールの対象外)。
 */
export async function applyRestorePoint(
  s: TruthStore,
  restorePointId: string,
  actorId: string,
  now: Date,
): Promise<RestoreApplyResult> {
  const points = await listRestorePoints(s);
  const point = points.find((p) => p.restore_point_id === restorePointId);
  if (!point) throw new RestorePointNotFoundError(restorePointId);

  const priorApplications = await s.listEvents(`truth/${RESTORE_APPLIED_TYPE}/`);
  const actorApplyCount = priorApplications.filter(
    (e) => (e.data as { actor_id?: string } | undefined)?.actor_id === actorId,
  ).length;
  if (actorApplyCount >= MAX_RESTORE_APPLICATIONS_PER_ACTOR) throw new RestoreApplyLimitExceededError(actorId);

  let appliedCount = 0;
  for (const key of point.keys) {
    if (!key.startsWith("truth/")) continue;
    if (key.startsWith(`truth/${RESTORE_POINT_TYPE}/`)) continue; // 復元ポイント自体は再投稿しない
    const original = await s.readEvent(key);
    if (!original) continue;
    const data = (original.data ?? {}) as Record<string, unknown>;
    const isOwnedByActor = OWNER_FIELD_NAMES.some((f) => data[f] === actorId);
    if (!isOwnedByActor) continue;

    const repost = { ...original, id: ulid(), time: now.toISOString() };
    const res = await s.putEvent(repost);
    if (res.status === "inserted") appliedCount++;
  }

  const id = ulid();
  await s.putEventAt(`truth/${RESTORE_APPLIED_TYPE}/${actorId}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RESTORE_APPLIED_TYPE,
    time: now.toISOString(),
    provenance: agentProvenance(),
    data: {
      actor_id: actorId,
      restore_point_id: restorePointId,
      applied_event_count: appliedCount,
      at: now.toISOString(),
    },
  });

  return { restore_point_id: restorePointId, applied_event_count: appliedCount };
}

// data.actor_id/owner_id/author_id/rater_id/ratee_id は既存イベント群(ledger-routes.ts
// karmaEnvelope の actor_id・plaza-post の author_id 等)で使われる代表的な所有者フィールド
// 名。ドメインごとの厳密なオーナーシップ定義は各艦の投影ロジックが正だが、この横断
// 抽出は「範囲選択して...エクスポート」の最小実装として実用十分(statement準拠・
// 完全性の保証はしない=誇張ゼロ)。
const OWNER_FIELD_NAMES = ["actor_id", "owner_id", "author_id"] as const;

export interface ActorExportBundle {
  actor_id: string;
  exported_at: string;
  format: "json";
  event_count: number;
  events: Record<string, unknown>[];
}

// ── V3-FND-08 論点1(w-fnd2): 範囲選択(range) ────────────────────────────
// 要件逐語(registry.json V3-FND-08)「自分のデータを範囲選択して...エクスポート」
// の「範囲選択」を、type prefix(ドメイン絞り込み)と time 区間の両方で指定できる
// ようにする(未指定=従来どおり全件。既存呼び出し元・既存テストは無変更で動く)。
export interface ExportRange {
  /** イベント type の前方一致リスト(例: ["ihl.obs."])。省略時は全 type 対象。 */
  types?: string[];
  /** ISO8601。event.time >= from のみ対象(閉区間)。 */
  from?: string;
  /** ISO8601。event.time <= to のみ対象(閉区間)。 */
  to?: string;
}

function eventInRange(e: Record<string, unknown>, range?: ExportRange): boolean {
  if (!range) return true;
  const type = typeof e.type === "string" ? e.type : "";
  const time = typeof e.time === "string" ? e.time : "";
  if (range.types && range.types.length > 0 && !range.types.some((t) => type.startsWith(t))) return false;
  if (range.from && time < range.from) return false;
  if (range.to && time > range.to) return false;
  return true;
}

/**
 * ユーザー自身のデータを範囲選択してエクスポートする(V3-FND-08「自分のデータを
 * 範囲選択して...エクスポートでき...データ所有権を保証する」の JSON 実装)。
 * Truth 全体を prefix="truth/" で走査し、既知のオーナーフィールドが actorId と
 * 一致するイベントだけを JSON バンドルとして返す。画像/動画/音声/PDF 形式は
 * follow-up(バイナリ資産の個別ドメイン知識が要るため。本ランでは実装しない)。
 * CSV は下の exportActorDataAsCsv で第3波にて追加した(w3-fnd)。
 */
export async function exportActorData(
  s: TruthStore,
  actorId: string,
  now: Date,
  range?: ExportRange,
): Promise<ActorExportBundle> {
  const all = await s.listEvents("truth/");
  const mine = all.filter((e) => {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const owned = OWNER_FIELD_NAMES.some((f) => data[f] === actorId);
    return owned && eventInRange(e, range);
  });
  return { actor_id: actorId, exported_at: now.toISOString(), format: "json", event_count: mine.length, events: mine };
}

// ── V3-FND-08 follow-up(w3-fnd 第3波): CSV 形式 ────────────────────────
// w1/w2 の note が明記した「多形式は follow-up」のうち、バイナリ資産を伴わない
// CSV だけを本ランで実装する(画像/動画/音声/PDF はドメイン別バイナリ変換層が要る
// ため引き続き follow-up・誇張ゼロで正直に持ち越す)。新規依存は追加していない
// (V3-FND-28 凍結遵守。手書きの最小 CSV エスケープのみ)。
function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * exportActorData と同じ抽出条件で、type/time/data を1行1イベントの CSV 文字列
 * として返す(ヘッダ行: id,type,time,data)。data は JSON 文字列としてそのまま1列に
 * 格納する(ネストしたイベント形状ごとに列を可変にしないための最小実装)。
 */
export async function exportActorDataAsCsv(
  s: TruthStore,
  actorId: string,
  now: Date,
  range?: ExportRange,
): Promise<string> {
  const bundle = await exportActorData(s, actorId, now, range);
  const header = "id,type,time,data";
  const rows = bundle.events.map((e) => {
    const row = e as Record<string, unknown>;
    return [csvEscape(row.id), csvEscape(row.type), csvEscape(row.time), csvEscape(row.data)].join(",");
  });
  return [header, ...rows].join("\n");
}

// ── V3-FND-08 論点1(w-fnd2): 多形式は「変換」せず「同梱」する ──────────────
// design19 §T1-4 案A: 画像/動画/音声は元から R2 に blob として在るので、変換せず
// アーカイブへ原本のまま同梱する。PDF は生成しない(新規依存0) — 印刷用 HTML を
// 同梱し、ブラウザの「印刷 → PDF で保存」に委ねる。アーカイブ形式は .tar.gz
// (tar は自前 USTAR ライター・gzip は Workers 標準 CompressionStream。
// wrangler dev --local(実 workerd)で1リクエストの gzip 往復を実機確認済み —
// 詳細は本ラン報告書「疎通確認」節参照)。

// 既知のバイナリ資産フィールド名から media/ プレフィクスの blob キーを推定する
// (observation-routes.ts の実際の書き込みパターン: thumbnail_path はフルキーを
// 既に持つ・photo_id/image_id は media/photo/<id> に対応)。ドメイン網羅の保証は
// しない(誇張ゼロ・見つかったものだけ同梱する best-effort)。
function extractBlobKeys(events: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const e of events) {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (typeof data.thumbnail_path === "string") keys.add(data.thumbnail_path);
    if (typeof data.photo_id === "string") keys.add(`media/photo/${data.photo_id}`);
    if (typeof data.image_id === "string") keys.add(`media/photo/${data.image_id}`);
  }
  return [...keys];
}

function blobFileName(key: string): string {
  return key.replace(/[/\\]/g, "_");
}

function buildPrintableHtml(bundle: ActorExportBundle, blobKeys: string[]): string {
  const rows = bundle.events
    .map((e) => {
      const row = e as Record<string, unknown>;
      return `<tr><td>${escapeHtml(String(row.type ?? ""))}</td><td>${escapeHtml(String(row.time ?? ""))}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>データエクスポート(${escapeHtml(bundle.actor_id)}) — ${escapeHtml(bundle.exported_at)}</title>
<style>body{font-family:sans-serif;margin:2em;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;}</style>
</head>
<body>
<h1>データエクスポート — ${escapeHtml(bundle.actor_id)}</h1>
<p>作成日時: ${escapeHtml(bundle.exported_at)} / 件数: ${bundle.event_count} / 同梱ファイル: ${blobKeys.length}件</p>
<p>この印刷用ページは、ブラウザの「印刷 → PDF として保存」でPDF化できます(このアーカイブ自体はPDFを生成していません)。</p>
<table><thead><tr><th>type</th><th>time</th></tr></thead><tbody>
${rows}
</tbody></table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ── 手書き USTAR tar ライター(新規依存0・V3-FND-28 凍結遵守) ──────────────
function tarHeader(name: string, size: number, mtimeSec: number, typeflag: string): Uint8Array {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const writeStr = (offset: number, str: string, len: number) => {
    buf.set(enc.encode(str).subarray(0, len), offset);
  };
  const writeOctal = (offset: number, value: number, len: number) => {
    writeStr(offset, value.toString(8).padStart(len - 1, "0") + "\0", len);
  };
  writeStr(0, name, 100);
  writeStr(100, "0000644\0", 8);
  writeStr(108, "0000000\0", 8);
  writeStr(116, "0000000\0", 8);
  writeOctal(124, size, 12);
  writeOctal(136, mtimeSec, 12);
  writeStr(148, "        ", 8); // checksum placeholder (8 spaces per USTAR spec)
  writeStr(156, typeflag, 1);
  writeStr(257, "ustar\0", 6);
  writeStr(263, "00", 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeStr(148, sum.toString(8).padStart(6, "0") + "\0 ", 8);
  return buf;
}

function padTo512(len: number): number {
  const rem = len % 512;
  return rem === 0 ? 0 : 512 - rem;
}

/** 最小限の USTAR tar アーカイブを組む(GNU拡張なし・ファイル名100文字以内前提)。 */
function buildTar(files: { path: string; data: Uint8Array }[], mtimeSec: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const f of files) {
    const header = tarHeader(f.path, f.data.byteLength, mtimeSec, "0");
    const pad = new Uint8Array(padTo512(f.data.byteLength));
    parts.push(header, f.data, pad);
    total += header.byteLength + f.data.byteLength + pad.byteLength;
  }
  const eof = new Uint8Array(1024); // 2 zero-filled 512-byte blocks terminate a tar archive
  parts.push(eof);
  total += eof.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export interface ActorExportArchive {
  bytes: ArrayBuffer;
  event_count: number;
  blob_count: number;
}

/**
 * V3-FND-08 論点1本体: JSON+CSV+blob群+印刷用HTMLを1本の .tar.gz へ同梱する。
 * 範囲選択(range)は必須引数(要件が明示的に求めているため既定=無制限にしない)。
 */
export async function buildActorExportArchive(
  s: TruthStore,
  bucket: R2BucketLite,
  actorId: string,
  now: Date,
  range: ExportRange,
): Promise<ActorExportArchive> {
  const bundle = await exportActorData(s, actorId, now, range);
  const csv = await exportActorDataAsCsv(s, actorId, now, range);
  const blobKeys = extractBlobKeys(bundle.events);

  const enc = new TextEncoder();
  const files: { path: string; data: Uint8Array }[] = [
    { path: "bundle.json", data: enc.encode(JSON.stringify(bundle, null, 2)) },
    { path: "bundle.csv", data: enc.encode(csv) },
    { path: "print.html", data: enc.encode(buildPrintableHtml(bundle, blobKeys)) },
  ];

  let blobCount = 0;
  for (const key of blobKeys) {
    const obj = await bucket.get(key);
    if (!obj) continue; // 参照が指す blob が既に存在しない場合はスキップ(誇張ゼロ)
    const buf = await obj.arrayBuffer();
    files.push({ path: `blobs/${blobFileName(key)}`, data: new Uint8Array(buf) });
    blobCount++;
  }

  const tarBytes = buildTar(files, Math.floor(now.getTime() / 1000));
  const cs = new CompressionStream("gzip");
  const gzStream = new Blob([tarBytes]).stream().pipeThrough(cs);
  const gzBytes = await new Response(gzStream).arrayBuffer();

  return { bytes: gzBytes, event_count: bundle.event_count, blob_count: blobCount };
}
