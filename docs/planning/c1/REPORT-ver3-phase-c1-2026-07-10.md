---
id: REPORT-ver3-phase-c1-2026-07-10
title: Phase C1 実行レポート — append-only 基盤 + CL-01〜13 negative TC 緑化 + R2 put-if-absent 実機検証
date: "2026-07-10"
status: active
---

# REPORT: ver3 Phase C1（2026-07-10）

> 自律実行（ultracode）。計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C1・§5。
> 完了条件（機械検証）: ① CL-01〜13 対応 negative TC 全 green（実行ログ）② 2重 put テストで先勝ち・後発 null を確認（実機）③ schemas/ からの TS 型 codegen が CI で回る。

## 状態

**完了（2026-07-10）** — 完了条件 3 点を独立ランで機械検証済み。

1. CL-01〜13 negative TC 全 green: `tests/cl-01〜cl-13`（13 ファイル / 101 テスト passed）。RED→GREEN の逐語ログは `docs/planning/c1/tc-red-green-log.md`。
2. 2 重 put 先勝ち・後発 null: 実 R2 バケット（`ihl-ver3-truth-dev`）で実測。`docs/planning/c1/r2-put-if-absent-evidence.md`。**判定 mode: storage** — put-if-absent はストレージ層（R2 `onlyIf`）で強制。アプリ層チェック（ver2 方式・R-05 フォールバック）は不要。
3. schemas/ → TS 型 codegen が CI で回る: `scripts/codegen-schemas.mjs` を root `npm run lint` チェーン末尾に配線（`codegen --check OK (12 files in sync)`）。CI は既存 lint step で通過。

最終 GATE 統合ラン: `npm run lint`（6 本 OK）/ `npm test`（apps/api 1 + tests 101 = 102 passed）/ `node scripts/codegen-schemas.mjs --check`（12 files in sync）。全緑。

## 成果物

| 成果物 | 内容 |
|---|---|
| `tests/cl-01-insert-only.test.ts` 〜 `tests/cl-13-tag-events.test.ts` | CL-01〜13 negative TC 13 ファイル・101 テスト（厳格 TDD: RED 81 failed → GREEN 101 passed）。`tests/helpers.ts` の in-memory R2 fake は実測エビデンスの意味論をミラー |
| `packages/truth` | append-only Truth 基盤: `envelope.ts`（Ajv draft-2020-12 で envelope + frozen 9 本を実行時検証）・`store.ts`（`putEvent` = 検証 → `truth/<type>/<id>.json` → R2 put-if-absent、update/delete 非存在）・`contracts.ts`（canonicalJson / deriveActorId / deriveTransferCode / cosineSimilarity — ver2 fixture ベクタ全一致）・`ulid.ts` |
| `packages/schema-types/src/generated/` | schemas/ からの TS 型 codegen 生成物 12 ファイル（`<!-- GENERATED -->` ヘッダ付き・手編集禁止） |
| `scripts/codegen-schemas.mjs` | codegen 本体 + `--check`（sync 検査）。root `package.json` に `codegen` / `codegen:check` script 追加、`lint` チェーン末尾へ配線（= CI 接続） |
| `apps/api/src/index.ts` | deny-by-default ミドルウェア（PUBLIC_ROUTES=`/health` のみ・Bearer DEV_TOKEN 必須・未知 route も 401 先行）+ `POST /events`（201/400/409） |
| `docs/planning/c1/tc-red-green-log.md` | RED/GREEN 実測ログ（逐語・捏造なし） |
| `docs/planning/c1/r2-put-if-absent-evidence.md` | 実 R2 での 2 重 put 実測（object 構文 / Headers 構文の両方で先勝ち・後発 null 確認）。**mode=storage 判定の根拠正本** |

## 残課題・人間ゲート

### C1 実機照合で確定した ver2 側の契約曖昧点（C2 冒頭で裁定 — frozen スキーマは未変更のまま）

1. **CL-08 `vector_length` の意味不整合**: ver2 `embedding_builder/run.py` は 384（要素数）を書くが、frozen スキーマの description は 1536（バイト長 = 384×4、`scoring.py` の dim×4 と一致）。fixture は ver2 実値 384 を保持（スキーマは integer のみ強制のため validate は通る）。ver3 でどちらかに確定してから codegen へ反映。
2. **CL-03 email 正規化の ver2 内不整合**: セッションストアは `strip().lower()` 後にハッシュ、マジックリンク route の `pii_access_event` は raw をハッシュ — 大文字混在入力で同一人物に 2 つの actor_id が生じ得る。ver3 の正規化方針は C2 裁定。ベクタは「raw が有意」として固定済み。
3. **CL-07 format 矛盾**: ver2 実装は `format='png'`、要件文は JPEG。frozen スキーマは意図的に const なし。TC も const 非存在を assert（矛盾の解消は C3 thumbnail 経路の裁定と同時）。

### 残課題（次フェーズ以降・可逆）

- CL-11 transfer code は ver2 同様に衝突ハンドリング未実装（uint24 空間・alternate-slice 未着手）。衝突対策は利用開始フェーズで判断。
- 検証用 R2 バケット `ihl-ver3-truth-dev` は dev 用として存置（append-only のため削除は不可逆操作 — 整理するなら人間裁定）。
- wrangler は Node 20 制約で 4.20.0 固定。Node 22 移行時に latest へ追従。
- `docs/planning/status.md` の「今どこ/次」を C1 完了 → C2 へ更新（commit ステップと同時で可）。

### 人間ゲート（AI では確定しない — status.md と同一）

- LICENSE 確定（確定まで private）
- Resend 実鍵投入
- GMO 本番契約・live 昇格
- 公開の実施
