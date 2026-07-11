---
id: design-c5
title: C5 設計契約(8クラスタ・実装対象139件)
date: "2026-07-11"
status: active
---

# design-c5 — Phase C5 設計契約

> 正本: 本書 + `c5-cluster-table.md`(分割表・見積)。各クラスタ設計は Workflow(設計 opus→批評家 opus effort-high→修正)を通過済み。
> 各節末尾「批評家指摘」の扱い: verdict=pass の節(K1/K3/K6/K7)は**未反映 — 実装時に必ず反映**。verdict=fail の節(K2/K4/K5/K8)は修正エージェント反映済み・監査痕跡として残置(参考)。
> 共通規約(全クラスタ): 全 route deny-by-default(protected 既定)・書込 actor_id はセッション principal 強制・Truth は TruthStore put-if-absent(INSERT ONLY・409)・投影都度再計算・schemas/ 正本→codegen・frozen 変更は対応 TC 緑化前禁止・「未実装/WIP」UI 表記禁止・新規 npm 依存は原則禁止。
> 実装順序: K2→K1→K3→K4→K5→K6→K7→K8。


### K2 認証/ロール+セキュリティ/法務

> 実装エージェント向け正本。C1〜C4 の共通規約を全て引き継ぐ(署名付きステートレスセッション `apps/api/src/session.ts`・Truth append-only `packages/truth`・deny-by-default `apps/api/src/index.ts`・ScreenDef Renderer `apps/web/src/renderer`・GATE `scripts/*.mjs`)。**frozen 変更・新イベント型・新 npm 依存・codegen 生成物の追加は一切不要**(下記で構造的に担保)。

#### 0. 対象要件ID一覧(13件・1件も落とさない)

| ID | 本波で実装 | 保留/人間ゲート(automatable=false) |
|---|---|---|
| V3-AUT-04 | (実装済確認・変更なし) magic-link→verify→session | 実 Resend 鍵 + 本番送信→クリック E2E(実鍵) |
| V3-AUT-06 | login.json に規約同意 checkbox + Renderer reactive submit 無効化(初期 paint から disabled) | 規約全文スクロール完了で同意可(明示 future) |
| V3-AUT-11 | navigation.json + 国/言語/規約 screendef + check-navigation.mjs GATE(schema 不使用・構造検証はスクリプト内蔵) | — |
| V3-AUT-22 | requireRole 中間層 + roles claim 配線(機構のみ) | 統一ロール体系確定(人間裁定)まで admin route への配線・Capability チャネルは保留(YAGNI: 呼び手が出る同じ波で追加) |
| V3-SEC-02 | derive-collector-pubkey.mjs(秘密鍵→SPKI 導出) | — |
| V3-SEC-03 | (境界は実装済・変更なし) サーバは公開鍵のみ保持 | WEB 手入力/CSV/GUI 鍵管理(future) |
| V3-SEC-04 | check-secrets.mjs lint GATE | — |
| V3-SEC-06 | SETTLEMENT_ACCRUAL_RATE=0.08 + accrued_total 投影 | X/Facebook OAuth 連携(実 OAuth 鍵=人間ゲート・future) |
| V3-SEC-07(S) | pii.mjs エンジン + POST /pii-session(route 045) + pii-scan.mjs + deriveEmailIndex(async) | — |
| V3-SEC-13 | pii.mjs redactForPublic(住所末尾4桁保持・構造化ID 許可) | 画像 QR/バーコード復号・OCR 住所マスク(画像処理・Vision OFF・公開実施=人間ゲート) |
| V3-SEC-31 | MANIFESTO.md / CODE_OF_CONDUCT.md / LICENSE 起票 + check-public-docs.mjs GATE | Apache 2.0 最終確定 + 公開実施(人間ゲート) |
| V3-SEC-45 | — | サンドボックス実行基盤全体(Extism/WASM/vm + GrapesJS/Blockly/Monaco + Fork Whitelist)= 大規模別波・新依存不可避・C5 でユーザーコード実行面を出さない → **停止報告(フェーズ+依存の裁定待ち)** |
| V3-SEC-52 | check-cron.mjs lint GATE(未同意 cron を fail) | — |

#### 1. 確定値

##### 1.1 route 表(method / path / access / handler)

| method | path | access | handler(ファイル) |
|---|---|---|---|
| POST | `/api/v1/pii-session` | protected(既定・PUBLIC_ROUTES に入れない) | `apps/api/src/pii-routes.ts` → `maskPii`(route 045・V3-SEC-07) |
| GET | `/api/v1/gmo/reconciliation/meta` | protected(既存) | `apps/api/src/gmo-routes.ts` `projectReconciliation`(**MODIFY**: `accrued_total` 追加・V3-SEC-06) |

- 新規 HTTP route はこの1本(`/pii-session`)のみ。ロールゲートは route ではなく中間層(§1.4)で、本波では**どの route にも attach しない**(統一ロール体系未確定 = V3-AUT-22 保留)。
- `/pii-session` は index.ts の session 中間層を通る(protected)。応答は `{ masked: string, findings: {type,start,end}[], count: number }`。**Truth へ生 PII を一切 append しない**(セッション限定 = 何も永続しない → 「マスク前保存禁止」を構造的に充足)。

##### 1.2 新イベント型 / 投影関数

- **新イベント型: なし。新スキーマ・codegen 生成物: なし**。pii-session は非永続、accrual/roles/email_index は派生値・claim(不変条項① ID/Index は使う瞬間だけ)。navigation.json は codegen 消費対象ではない(TS 型を生成しない)ため `schemas/` に置かず、その構造検証は check-navigation.mjs に内蔵する(§2 major 修正)。よって `codegen-schemas.mjs` / `codegen-validators.mjs` の生成物は不変・`npm run codegen` 不要。
- 投影関数(いずれも純関数・都度再計算):
  - `projectReconciliation`(gmo-routes.ts・**MODIFY**): 出力に `accrued_total: number` を追加 = `Math.round(confirmed_total * SETTLEMENT_ACCRUAL_RATE)`。
  - `maskPii(text) → { masked, findings }`(pii.mjs・**同期**・regex のみ): 全 PII を `{{PII:<TYPE>}}` 置換。
  - `redactForPublic(text) → { redacted, findings }`(pii.mjs・**同期**・V3-SEC-13): 構造化ID(`TRK-…` 追跡番号・ULID 観測画像ID・`trade_event` ID)は非マスク許可、住所は末尾4桁保持、他 PII はマスク。
  - `deriveEmailIndex(email) → Promise<string>`(pii.mjs・**async**): `normalizeEmail` 後 `crypto.subtle.digest("SHA-256", …)` → hex(既存 `packages/truth/src/contracts.ts` の sha256 helper と同形の WebCrypto)。呼ぶ瞬間に算出・非保存。**pii.mjs は node:crypto を import しない**(Worker バンドルは wrangler.toml で nodejs_compat 無し。WebCrypto グローバルのみ・関数本体内で参照)。

##### 1.3 screen-defs 追加(Renderer 再利用・コード追加最小)

| ファイル | 種別 | 内容(確定) |
|---|---|---|
| `screen-defs/login.json` | MODIFY | `magic-form` 内・`send` ボタンの前に `{ id:"terms", type:"field", props:{ variant:"checkbox", name:"terms", label:"利用規約に同意する", required:true } }` を追加 |
| `screen-defs/country-select.json` | NEW | select field `country`(options: `JP,US,GB,DE,FR` の最小集合・ponytail: 必要時拡張)+ 続行ボタン `transitions:[{from:"continue",to_screen_id:"language-select"}]` |
| `screen-defs/language-select.json` | NEW | select field `language`(options: `ja,en` の最小集合)+ 続行ボタン `transitions:[{from:"continue",to_screen_id:"terms"}]` |
| `screen-defs/terms.json` | NEW | 規約 text ノード + 同意ボタン `transitions:[{from:"agree",to_screen_id:"home"}]`。国/言語/規約は navigate のみ(ロケール永続は本 K2 対象外・future) |
| `screen-defs/navigation.json` | NEW | **screendef ではない**フロー地図。`{ entry:"login", screens:[全10 screen_id], edges:[…] }`。`schemas/` には置かない(codegen 非対象)。check-navigation.mjs が構造+完全性を検証。全 Renderer/screendef ローダのループから **除外**(§1.3末尾 + §2) |

**navigation.json の確定内容**(edges は「onboarding 背骨 ∪ 既存全 screendef transition」の完全集合 — 背骨だけで作ると check(c) が落ちる):

```json
{
  "entry": "login",
  "screens": ["login","country-select","language-select","terms","home","obs-domain-select","obs-entry","obs-detail","individual-detail","qr-resume"],
  "edges": [
    {"from":"login","to":"country-select","label":"オンボーディング開始"},
    {"from":"country-select","to":"language-select","label":"国選択後"},
    {"from":"language-select","to":"terms","label":"言語選択後"},
    {"from":"terms","to":"home","label":"規約同意後"},
    {"from":"login","to":"home","label":"dev-login"},
    {"from":"home","to":"obs-domain-select","label":"観測ドメイン選択へ"},
    {"from":"home","to":"individual-detail","label":"個体詳細へ"},
    {"from":"obs-domain-select","to":"obs-entry","label":"生き物ドメインで観測入力へ"},
    {"from":"obs-entry","to":"obs-detail","label":"記録後に詳細ビューへ"},
    {"from":"obs-detail","to":"individual-detail","label":"個体詳細へ"},
    {"from":"qr-resume","to":"obs-entry","label":"個体文脈付きで観測入力へ"}
  ]
}
```

- `screens` = 全10 screendef の `screen_id` 集合(individual-detail は末端・transition なしだが screens には含む)。
- edges 内訳: 背骨4本(login→country-select→language-select→terms→home)+ 既存/新 screendef transition 由来7本(login→home[dev-login]・home→obs-domain-select・home→individual-detail・obs-domain-select→obs-entry・obs-entry→obs-detail・obs-detail→individual-detail・qr-resume→obs-entry)。国/言語/規約の新 transition(country-select→language-select 等3本)は背骨に含まれ重複しないので合計11本。`login→country-select` は screendef transition を持たない追加 edge(check(c) は screendef transition ⊆ edges を要求するのみで、余剰 edge は check(b) の from/to∈screens を満たせば可)。

##### 1.4 ロール中間層(V3-AUT-22・機構のみ・requireRole のみ)

- `apps/api/src/authz.ts`(NEW): `requireRole(...allowed: string[]): MiddlewareHandler` = `c.get("roles")` に allowed のいずれも無ければ `403 {error:"FORBIDDEN"}`、有れば `next()`。**taxonomy 非依存**(任意ロール文字列で動く)。
- `session.ts`(MODIFY): `SessionPayload` に `roles?: string[]` を追加。`issueSessionToken(actorId, secret, roles: string[] = [])` は非空時のみ claim に載せる(後方互換)。`verifySessionToken` はそのまま通す。
- `index.ts`(MODIFY): cookie/Bearer セッション経路で `c.set("roles", Array.isArray(p.roles) ? p.roles.filter(x => typeof x === "string") : [])`。DEV_TOKEN 経路は `roles=[]`。
- `env.ts`(MODIFY): `Variables` に `roles: string[]`。
- **requireCapability / caps チャネルは本波で作らない(YAGNI)**: 本波はどの route にも attach せず、Capability 読取専用表示も統一ロール裁定後に保留。roles 1 本で機構の往復 TC は成立し、caps は呼び手ゼロ・近未来の消費者もない。admin route を配線する同じ後続波で、必要になった時点で `caps` claim + `requireCapability` を追加する(投機的抽象を今作らない)。
- **保留**: 具体ロール名の凍結・admin route への `requireRole` attach は統一ロール体系の人間裁定後。

##### 1.5 凍結定数

- `apps/api/src/economy-constants.ts`(MODIFY): `export const SETTLEMENT_ACCRUAL_RATE = 0.08;`(V3-SEC-06・積立レート。丸めは円単位 `Math.round`。較正は V3-GOV-17 管理 GUI = 後波)。
- `pii.mjs`: `PII_PATTERNS`(決定論 regex・LLM 不使用)= `EMAIL / PHONE_JP / CREDIT_CARD / COORDS / SNS_ID / PEM_PRIVATE_KEY / ENV_SECRET`(`re_…` `sk-…` `AKIA…` `[A-Z_]{4,}=\S{12,}`)、住所は `ADDRESS_JP`(`〒?\d{3}-?\d{4}` + 都道府県/市/区/町/丁目/番地 ヒューリスティック)。`STRUCTURED_ID_ALLOW`(`TRK-[A-Z0-9]+` / ULID / `trade_event` ID)。**ponytail: 電話/住所/カードは naive ヒューリスティック — 各 regex に較正ノート(誤検出時に調整する唯一箇所)。**

#### 2. 実装ファイル計画

**NEW(実装)**
- `apps/api/src/pii.mjs` — PII エンジン(JSDoc 型・依存ゼロ・**node:crypto 不使用**)。`detectPii/maskPii/redactForPublic`(同期)+ `deriveEmailIndex`(async・crypto.subtle)+ 定数。**Worker(TS route)・vitest・bare-node script の3ランタイムから同一ソースを import できるよう `.mjs`**(esbuild/vitest/node すべて .mjs 解決可)。
- `apps/api/src/pii.d.ts` — pii.mjs の型宣言(`deriveEmailIndex` は `(email: string) => Promise<string>`)。
- `apps/api/src/pii-routes.ts` — `POST /pii-session`(route 045)。`maskPii` を呼び返すのみ・非永続。
- `apps/api/src/authz.ts` — `requireRole`(§1.4・requireCapability は作らない)。
- `screen-defs/country-select.json` / `language-select.json` / `terms.json` / `navigation.json`(§1.3)。
- `scripts/check-secrets.mjs` — 秘密混入 GATE(V3-SEC-04)。`git ls-files` 対象・`scanText` を export(TC 用)。検出: PEM 秘密鍵ブロック / `re_[A-Za-z0-9]{16,}` / `sk-[A-Za-z0-9]{16,}` / `AKIA[0-9A-Z]{16}` / 追跡された実 `.env` ファイル。除外: `.env.example`・`scripts/check-secrets.mjs`・`apps/api/src/pii.mjs`・`apps/api/src/pii.d.ts`・`scripts/pii-scan.mjs`・`scripts/derive-collector-pubkey.mjs`・`tests/pii.test.ts`・`tests/check-secrets.test.ts`・`tests/derive-collector-pubkey.test.ts`・node_modules/.git/generated/dist/.next。
- `scripts/check-cron.mjs` — `apps/api/wrangler.toml` を走査し `[triggers]`/`crons` があれば同意許可リスト(`config/consented-crons.json` 不在=空)に無い限り fail(V3-SEC-52)。`scanWranglerCron` を export。
- `scripts/check-navigation.mjs` — **schema 不使用**。navigation.json を読み、(0) 構造検証を内蔵(`entry` が string・`screens` が string[]・`edges` が `{from,to,label?}` の配列・`additionalProperties` 相当の余剰キー無し ≈8行)、(a) `screens` 集合 == `screen-defs/*.json`(navigation.json 除く)の screen_id 集合(双方向完全性)、(b) 全 edge.from/to ∈ screens、(c) 各 screendef `transitions[]` の (from screen→to_screen_id) に対応する edge が navigation.json に存在、(d) entry ∈ screens(V3-AUT-11)。`checkNavigation` を export。**JSON Schema ファイルも codegen 生成物も追加しない**(navigation.json は TS 型消費者がどこにも無い = codegen 非対象。構造検証はこの ~8 行で足る — ponytail: lazy correct path)。
- `scripts/check-public-docs.mjs` — `MANIFESTO.md/README.md/CONTRIBUTING.md/CODE_OF_CONDUCT.md/LICENSE` の存在 GATE(V3-SEC-31)。
- `scripts/derive-collector-pubkey.mjs` — `createPublicKey(privatePem).export({type:"spki",format:"pem"})`。`deriveSpki(privatePem)` を export。CLI `node scripts/derive-collector-pubkey.mjs <collector_id> <priv-pem-path>` → `{"<id>":"<SPKI PEM>"}` を stdout(COLLECTOR_PUBLIC_KEYS へ人手で merge)。**実 .env は書き換えない**(秘密ファイルは人間ゲート)。**bare-node script につき node:crypto のみ・新依存なし**(V3-SEC-02。Worker ではないので node:crypto 可)。
- `scripts/pii-scan.mjs` — 資料群バッチ(V3-SEC-07)。`node scripts/pii-scan.mjs <srcDir> <outDir>` → 各ファイルを `maskPii` し `<outDir>/masked/<rel>` へ、`<outDir>/pii-candidates.json`(人間ゲート用候補一覧)・`<outDir>/pii-diff.json`(原本→マスク span 差分)を生成。**srcDir は不変更(原本隔離)**。pii.mjs を import(単一エンジン)。
- `MANIFESTO.md` — 思想/構造/優先順位の宣言草案。`LICENSE` — Apache License 2.0 全文(標準・逐語)。`CODE_OF_CONDUCT.md` — Contributor Covenant(標準・逐語)。**起票は可逆。Apache 2.0 の最終確定・公開実施は人間ゲート(冒頭に注記)。**

**MODIFY**
- `apps/api/src/index.ts` — `piiRoutes` を `app.route("/api/v1", piiRoutes)`(§1.1)。session 中間層で `roles` を context に set(§1.4・DEV_TOKEN 経路は `[]`)。
- `apps/api/src/env.ts` — `Variables` に `roles: string[]` を追加(§1.4)。
- `apps/api/src/session.ts` — `SessionPayload.roles?: string[]` + `issueSessionToken(actorId, secret, roles = [])`(§1.4)。
- `apps/api/src/gmo-routes.ts` — `projectReconciliation` に `accrued_total`(§1.2・V3-SEC-06)。
- `apps/api/src/economy-constants.ts` — `SETTLEMENT_ACCRUAL_RATE`(§1.5)。
- `screen-defs/login.json` — 規約 checkbox(§1.3・V3-AUT-06)。
- `apps/web/src/renderer/renderer.tsx` — (i) `FieldNode` に `variant==="checkbox"`(`<input type="checkbox">`・`data-required` は「checked 必須」)、(ii) 新 `FormValidityCtx`(boolean・**既定 false**)。`FormNode` は **マウント時に同期で初期妥当性を算出**(`useMemo` で `node.children` 内の `[data-required]` を走査し text: `trim!==""` / checkbox: 未チェック=false → 空フォームは false)し、以降 `onInput` で再走査して provide。`ButtonNode` は `p.type==="submit"` のとき `disabled ||= !formValid` → **初回 paint から disabled**(V3-AUT-06 の「未同意/未入力時は無効」を初期描画で満たす。onInput 発火前に true になる欠陥を回避)。submit 時の欠落判定(既存 line 339-346)は checkbox 未チェック=`fd.get`null で既にカバー。
- `apps/web/src/renderer/types.ts` — `field` variant 型に `checkbox` 追加(型のみ)。
- `apps/web/src/lib/screendefs.ts` — `allScreenDefs()` が `navigation.json` を除外することを保証(グロブ or 明示除外)。
- `apps/web/src/renderer/renderer.test.tsx` — 既存 `expect(defs.length).toBe(7)` を `toBe(10)` に更新(login+home+obs系3+individual+qr の 7 → +country/language/terms = 10。navigation.json は screendef ではないので数えない)。
- `scripts/check-ui-tokens.mjs` — screendef 検証ループで `screen-defs/navigation.json` を除外(除外 set に1行追加)。
- `package.json` — `lint` に `&& node scripts/check-secrets.mjs && node scripts/check-cron.mjs && node scripts/check-navigation.mjs && node scripts/check-public-docs.mjs` を追記。derive-collector-pubkey/pii-scan は GATE ではなくツール(lint に入れない)。**codegen ステップの追加は不要**(§1.2)。
- `scripts/lint-filenames.mjs` — `LICENSE`(拡張子なし)を allowlist に許可する必要があれば追加(統合時に確認)。

#### 3. TC 計画(ファイルパス + ケース・要件ID対応)

- `tests/pii.test.ts`(V3-SEC-07 / V3-SEC-13): (1) `detectPii` が email/phone/card/coords/sns/pem/env 各型を検出、(2) `maskPii` が各出現を `{{PII:<TYPE>}}` に置換、(3) `POST /api/v1/pii-session` が masked を返し **FakeR2Bucket に生 email が1件も無い**(順序=マスク前非保存の強制)、(4) `await deriveEmailIndex(email)` が同一 email で安定 sha256 hex(async・crypto.subtle 経路)、(5) `redactForPublic` が `TRK-…`/ULID/trade_event ID を保持し住所末尾4桁を残し他をマスク、(6) `pii-scan.mjs` を実行し masked コピー + candidates + diff 生成・src 不変更。
- `tests/authz.test.ts`(V3-AUT-22): 任意ロール文字列で `requireRole("admin")` が roles 無し→403 / 有り→通過、`issueSessionToken(...,["admin"])`→`verifySessionToken` で roles claim 往復、DEV_TOKEN 経路 roles=[]。(caps は本波対象外)
- `tests/gmo-accrual.test.ts`(V3-SEC-06): `projectReconciliation` の `accrued_total === Math.round(confirmed_total * 0.08)`(端数丸め含む)。既存 `tests/gmo-reconcile.test.ts` は transfer_code 一致時のみ台帳 append を担保(継続 green)。
- `tests/check-secrets.test.ts`(V3-SEC-04): `scanText` が PEM/`re_…`/`sk-…`/`AKIA…` を検出、`.env.example` プレースホルダ(全 x の `re_xxxx…`)は誤検出しない。
- `tests/check-cron.test.ts`(V3-SEC-52): `scanWranglerCron` が cron 記載 toml を違反、cron 無し toml を OK。
- `tests/check-navigation.test.ts`(V3-AUT-11): 不正構造(entry 欠落 / edges 非配列)→fail、dangling edge(未知 screen 参照)→fail、screendef transition の欠落→fail、完全な navigation.json→pass。
- `tests/derive-collector-pubkey.test.ts`(V3-SEC-02): `crypto.generateKeyPairSync("ed25519")` の秘密鍵から `deriveSpki` が公開鍵 SPKI と一致 + 秘密鍵で署名→導出公開鍵で verify 成功。
- `tests/check-public-docs.test.ts`(V3-SEC-31): 5 ドキュメントの1つが欠けると GATE fail・全存在で pass。
- `apps/web/src/renderer/renderer.test.tsx`(V3-AUT-06): 規約 checkbox 未チェック時 submit ボタンが**初期描画から** `disabled`、email 入力 + checkbox チェックで enable(初期妥当性が同期算出されることを含意)。
- **automatable=false(人間ゲート由来・自動化不能)**: V3-AUT-04 本番送信→クリック E2E(実 Resend 鍵)/ V3-AUT-22 admin route ロールゲート + Capability チャネル(統一ロール裁定後・呼び手が出る波で caps ごと追加)/ V3-SEC-06 X/Facebook OAuth 連携(実 OAuth 鍵)/ V3-SEC-13 画像 QR/OCR 住所マスク(画像処理・公開実施)/ V3-SEC-31 Apache 2.0 確定 + 公開 / V3-SEC-45 サンドボックス(別波・依存裁定待ち)。

#### 4. クラスタ内実装順序

1. `pii.mjs`(node:crypto 不使用・deriveEmailIndex は crypto.subtle async)+ `pii.d.ts` → `tests/pii.test.ts`(engine 部)。
2. `pii-routes.ts` + `index.ts` 配線 → route 045 TC。
3. `authz.ts`(requireRole のみ)+ `session.ts`/`env.ts`/`index.ts` の roles 配線 → `tests/authz.test.ts`。
4. `economy-constants.ts` + `gmo-routes.ts` accrued_total → `tests/gmo-accrual.test.ts`。
5. Renderer(checkbox variant + 同期初期妥当性 reactive submit)→ `login.json` 修正 → `renderer.test.tsx`。
6. 国/言語/規約 screendef + `navigation.json`(11 edge 完全集合)+ `check-ui-tokens.mjs` 除外 + `screendefs.ts` 除外 + `renderer.test.tsx` の `toBe(10)` 更新。**schemas/ 追加なし = codegen 実行なし**。
7. GATE scripts(check-secrets/check-cron/check-navigation[構造検証内蔵]/check-public-docs)+ `package.json` lint 追記 → 各 GATE の TC。**GATE は新規ファイルを含めて緑になる位置(最後)に追加**。
8. `derive-collector-pubkey.mjs`(node:crypto・bare script)+ `pii-scan.mjs` + 3 公開ドキュメント。
9. 各段: `npm run lint && npm test && pytest -q` 全 green 実測 → commit(参照 REPORT-ver3-phase-c5-2026-07-11)。

#### 5. 分母除外・停止報告(human-gate)

- **停止報告(実行しない・人間裁定/実鍵待ち)**:
  - **V3-SEC-45 サンドボックス実行基盤 全体** — Extism/WASM/vm ランタイム + GrapesJS/Blockly/Monaco + Fork Whitelist は大規模別波。新依存が不可避で、C5 でユーザーコード実行面を出さない以上、投機実装(呼び手ゼロの read-only ラッパ等)を作らない。**フェーズ割当 + 許容依存の裁定待ち**として分母除外。
  - **V3-AUT-22** admin route への `requireRole` attach + Capability チャネル(`caps` claim + `requireCapability` + 読取専用表示)— 統一ロール体系 1 案確定(人間裁定)まで配線しない。機構(requireRole 中間層 + roles claim + 汎用 TC)は本波で緑化。caps は呼び手が出る同じ波で追加(本波では作らない = YAGNI)。
  - **V3-AUT-04** 実 Resend 鍵投入 + 本番 送信→クリック E2E(+ 厳密 VPS SMTP 中継が要求される場合の中継追加)= 人間ゲート(実鍵)。dev E2E は既存 green。
  - **V3-SEC-06** X/Facebook OAuth 連携 = 実 OAuth アプリ資格情報(人間ゲート)。8% 積立投影は本波で緑化。
  - **V3-SEC-13** 画像 QR/バーコード復号・OCR 住所マスク = 画像処理(Vision 既定 OFF・新依存)+ 公開実施(人間ゲート)。テキスト redact は本波で緑化。
  - **V3-SEC-31** Apache 2.0 最終確定 + 公開日の実施 = 人間ゲート(公開の実施)。5 ドキュメント起票は可逆・本波で実施。
- **可逆で本波実施(承認待ちでブロックしない)**: pii エンジン/route/バッチ、requireRole 機構、8% 定数/投影、checkbox/同期 reactive submit、navigation + 国/言語/規約 screendef、4 lint GATE、derive-collector-pubkey、3 公開ドキュメント起票。

#### K2 批評家指摘(実装時反映・verdict=fail)

1. **[major]** §1.2 asserts "codegen 不要" and §2's NEW list adds schemas/nav/navigation.schema.json without any generated artifact. But codegen-schemas.mjs (→ packages/schema-types/src/generated/nav/navigation.ts + index.ts) AND codegen-validators.mjs (→ packages/truth/src/generated/validators.mjs) both recursively walk schemas/**/*.schema.json, and `npm run lint` runs both with `--check`. Adding the schema without regenerating makes lint fail with `missing: nav/navigation.ts` (and a validators drift). The contract's cost claim is wrong and the file plan omits both the generated outputs and the `npm run codegen`+commit step — an implementer trusting "codegen 不要" ships a red GATE.
   - 反映: Either (a) drop the standalone schema and inline the ~8-line entry/screens/edges structural check directly in check-navigation.mjs (ponytail: no schema file, no codegen artifacts — this is the lazy correct path since navigation.json is not a codegen consumer for TS types anywhere), or (b) keep schemas/nav/navigation.schema.json but delete the "codegen 不要" claim, add `packages/schema-types/src/generated/nav/navigation.ts` + `index.ts` update + validators.mjs regen to the file plan, and add `npm run codegen` as an explicit pre-lint step in §4.
2. **[minor]** Reactive submit-disable spec (§1.3 renderer MODIFY) contradicts its own V3-AUT-06 TC. FormValidityCtx is specified as "boolean・既定 true" and FormNode updates it only on `onInput`. On initial render (email empty, terms unchecked) no input event has fired, so formValid stays true and the submit button renders ENABLED — but tests/renderer.test.tsx asserts "規約 checkbox 未チェック時 submit disabled" at initial paint (and the requirement literally says 未同意/未入力時は無効化). The design as written fails its own acceptance test on first render.
   - 反映: Compute initial validity synchronously on mount (default the ctx to false, or run the [data-required] scan in a useEffect / useMemo over node.children on first render) so the button is disabled before any user interaction. Do not rely on onInput-only with default true.
3. **[minor]** §1.2 specifies `deriveEmailIndex(email) → sha256hex` as if synchronous, but the repo's only Worker-safe SHA-256 is async WebCrypto `crypto.subtle.digest` (packages/truth/src/contracts.ts sha256/deriveActorId are all `async`). pii.mjs is imported into the Cloudflare Worker via pii-routes.ts, and apps/api/wrangler.toml shows no nodejs_compat flag, so a node:crypto `createHash` at module scope would break the Worker bundle.
   - 反映: Specify deriveEmailIndex as `async (email) → Promise<string>` implemented with `crypto.subtle.digest("SHA-256", …)` + hex encode (mirroring the existing sha256 helper), and forbid node:crypto anywhere in pii.mjs. Update the TC wording from a sync call accordingly.
4. **[minor]** §1.3's navigation.json content spec lists only the onboarding backbone edges (login→country-select→language-select→terms→home), but §2 check-navigation check (c) requires an edge in navigation.json for EVERY existing screendef transition. The current 7 screendefs carry 7 transitions (login→home via dev-login, home→obs-domain-select, home→individual-detail, obs-detail→individual-detail, obs-domain-select→obs-entry, obs-entry→obs-detail, qr-resume→obs-entry). An implementer building navigation.json from the described backbone alone would fail check (c).
   - 反映: Enumerate the full edge set in §1.3 (backbone edges PLUS all 7 existing screendef-transition edges, including login→home for dev-login), or explicitly note that the edge list must be the union of the backbone and every screendef transition so the implementer populates it completely.
5. **[minor]** §1.4 plumbs both requireRole AND requireCapability plus `caps` claim wiring across session.ts/env.ts/index.ts/issueSessionToken, yet nothing is attached to any route this wave (V3-AUT-22 wiring deferred to human ruling) and the Capability read-only display is also deferred. requireRole+roles alone proves the mechanism and satisfies the authz round-trip TC; the caps channel has zero callers and no near-term consumer — speculative abstraction.
   - 反映: Ship requireRole + `roles` claim + the roles round-trip TC only. Defer requireCapability and the `caps` plumbing until the capability taxonomy is ruled on and a display/route actually consumes it (YAGNI); add it in the same follow-up wave that wires admin routes.

### K1 観測拡張+個体/ブリーディング

> 設計契約(実装エージェント向け正本)。参照レポート ID = REPORT-ver3-phase-c5-2026-07-11。C2/C3/C4 の共通規約を全て引き継ぐ(全 route deny-by-default=protected・書込は `data.actor_id` をセッション principal で強制刻印 V3-AUT-17・Truth は INSERT ONLY で put-if-absent 409・投影は都度再計算で常駐 DB 禁止・frozen 変更禁止)。既存資産(`observation-routes.ts`・`ledger-routes.ts`・`market-routes.ts`・`collector-routes.ts`・`packages/truth` TruthStore・screen-defs Renderer・`schemas/frozen/*`)を最大再利用し車輪の再発明をしない。

#### 0. 対象要件 ID 一覧(30 件・1 件も落とさない)

個体/ブリーディング(g8): V3-IND-01・V3-IND-02・V3-IND-04・V3-IND-07・V3-IND-12・V3-IND-13・V3-IND-15・V3-IND-19・V3-IND-21。
観測(g2 + g11-S): V3-OBS-01・V3-OBS-02・V3-OBS-03・V3-OBS-06・V3-OBS-07・V3-OBS-08・V3-OBS-09・V3-OBS-10・V3-OBS-11・V3-OBS-18・V3-OBS-20・V3-OBS-21・V3-OBS-23・V3-OBS-25・V3-OBS-28・V3-OBS-31・V3-OBS-43・V3-OBS-44・V3-OBS-45・V3-OBS-46・V3-OBS-47・V3-OBS-48・V3-OBS-52・V3-OBS-56・V3-OBS-62・V3-OBS-63。

消化する route-matrix(planned→implemented): infra-route-011(home/summary)・012(detail 既存・reuse)・013(image 既存+thumbnail 追加)・014(reanalysis-manifest)・015(measurement-dictionary)・016(targets/catalog)・017(templates 既存・reuse)・018(templates/{id})・020/023(measurements)・021(solid-observation/commit)・022(dictionary-extensions)・024(search 既存・extend)・025(targets/search)・026/027(templates/upload 既存・extend)。

#### 1. 確定値

##### 1.1 route 表(method / path / access / handler)

新規ファイル 6 本 + `observation-routes.ts` 拡張。全 protected(公開 3 route 以外)。`{id}` は `individual_id` 等の path param。

個体系 — `apps/api/src/individual-routes.ts`:
| method | path | handler | 要件 |
|---|---|---|---|
| POST | /api/v1/individuals | createIndividual(master record・成長データ枠なし) | IND-02 |
| GET | /api/v1/individuals/{id} | getIndividual(6 文化 + timeline 集約投影) | IND-02/13 |
| POST | /api/v1/individuals/{id}/parents | addParent(cross_parent append・parent_role) | IND-01/12 |
| GET | /api/v1/individuals/{id}/pedigree | getPedigree(buildPedigree 多世代・欠損親) | IND-01 |
| GET | /api/v1/individuals/{id}/cross | getCross(?metric= 差替・率系決定論投影) | IND-12 |
| POST | /api/v1/individuals/{id}/name | renameIndividual(name_event append) | IND-04 |
| GET | /api/v1/individuals/{id}/name | getName(?at=ISO で当時名再現) | IND-04 |
| POST | /api/v1/brand-templates | putBrandTemplate(active=false で論理削除も本 route) | IND-04 |
| GET | /api/v1/individuals/{id}/bio-card | getBioCard(種/形態/サイズ/特徴/QR URL) | IND-15 |
| POST | /api/v1/individuals/qr-batch | issueQrBatch(count∈{100,500,1000}・URL 化) | IND-15 |
| GET | /api/v1/individuals/{id}/authenticity | getAuthenticity(連続性スコア + 登録数vs実在数) | IND-21 |
| POST | /api/v1/individuals/{id}/life-events | addLifeEvent(birth/molt/death/eclosion/specimen/move) | IND-12/13 |

種/形態 — `apps/api/src/taxon-routes.ts`:
| POST | /api/v1/species | createSpecies(put-if-absent 409・fork forked_from) | IND-19 |
| GET | /api/v1/species | listSpecies(統計自動計算投影) | IND-19 |
| GET | /api/v1/species/{id} | getSpecies(平均サイズ/体重/市場平均価格) | IND-19 |
| POST | /api/v1/morphs | createMorph | IND-19 |
| POST | /api/v1/species/aliases | approveAlias(人間承認後の alias 統合 append) | IND-19 |
| GET | /api/v1/species/alias-candidates | aliasCandidates(?name= Levenshtein/Jaro-Winkler 類似度) | IND-19 |

マチアプ — `apps/api/src/match-routes.ts`:
| POST | /api/v1/match/preference | appendPreference(単一 preference_event・kind 分岐・y∈{+1,-1}) | IND-07 |
| GET | /api/v1/match/ranking | getRanking(内積降順・score 非露出) | IND-07 |

タグ — `apps/api/src/tag-routes.ts`:
| POST | /api/v1/tags | appendTag(frozen tag-event・ai_tags/user_tags 両層必須) | OBS-63/07/52 |
| GET | /api/v1/tags | aggregateTags(?target_type=&target_id= → strong/weak/disputed) | OBS-63 |

機器 — `apps/api/src/device-routes.ts`:
| POST | /api/v1/devices | createDevice(placement 紐付け・個体紐付けは 400・API キー暗号化保存・開始日のみ) | OBS-31 |
| GET | /api/v1/devices | listDevices(display_name 表示・raw ID 非表示) | OBS-31 |
| POST | /api/v1/devices/{id}/test | testConnection(接続テスト・自動デバイス発見) | OBS-31 |

C-USB / ホーム / insight — `apps/api/src/home-routes.ts` + `apps/api/src/cusb-routes.ts`:
| GET | /api/v1/home/summary | getHomeSummary(今日の要約・近接/超過/観測中) | OBS-21 |
| GET | /api/v1/observation/insights | getInsights(空白検出=超過個体・データ欠落) | OBS-43 |
| POST | /api/v1/cusb | cusbIngest(validate→lineage/semantic 付与→保存→hash 改ざん検知) | OBS-44 |

`observation-routes.ts` 拡張(既存モジュールに追記):
| GET | /api/v1/observation/{capture_id}/thumbnail/{photo_id} | serveThumbnail(512px JPEG・raw 一括 DL 経路なし) | OBS-23 |
| GET | /api/v1/observation/measurement-dictionary | getMeasurementDictionary(item_hash 登録辞書) | OBS-18 |
| GET | /api/v1/observation/targets/catalog | getTargetCatalog(ローカル分類ツリー・QID 付与) | OBS-02 |
| POST | /api/v1/observation/targets/search | searchTargets(学名 substring / yes-no 二分探索 / ツリー → QID+taxonomy) | OBS-02/03 |
| POST | /api/v1/observation/measurements | appendMeasurement(value_origin 必須・item_hash 未登録検出) | OBS-06/18 |
| POST | /api/v1/observation/dictionary-extensions | extendDictionary(未登録項目 はい/今回だけ/常に) | OBS-18 |
| GET | /api/v1/observation/templates/{template_id} | getTemplate(雌雄別/令齢別/置き場所別 scope 込み) | OBS-18 |
| POST | /api/v1/observation/{capture_id}/reanalyze | reanalyze(新 analysis_id append・delta・semver) | OBS-48 |
| GET | /api/v1/observation/{capture_id}/reanalysis-manifest | getReanalysisManifest | OBS-48 |
| POST | /api/v1/solid-observation/commit | commitObservation(3 画面確認後の唯一の保存・亜種必須ゲート) | OBS-25/62 |
| POST | /api/v1/observation/annotations | appendAnnotation(LabelMe AST 保存・postMessage 契約) | OBS-46/47 |
| (extend) POST | /api/v1/observation/search | 既存 + query 自身除外 + prototype 平均ベクトル + 合成 rerank | OBS-10/11 |
| (extend) POST | /api/v1/observation/upload | 既存 + 撮影時 photo_conditions 自動埋込 | OBS-28 |
| (extend) GET | /api/v1/qr/{token} | 既存 + 前回値 prefill + entryMode=qr(棚→個体→種→テンプレ連鎖) | OBS-20 |

##### 1.2 新イベント型(type 名 + schemas ファイル + キー構造)

全て `schemas/events/`(非 frozen・可逆)。envelope は CloudEvents(既存 `envelope()` ヘルパ再利用)。Truth キーは既存レイアウト踏襲。

| type 名 | schemas ファイル | Truth キー | 要件 |
|---|---|---|---|
| ihl.ind.master.v1 | schemas/events/ind-master.schema.json(dataschema は frozen individual-key を参照する識別足場・**成長データフィールドを持たない**: individual_id/local_label_text/species/birth_or_hatch_date/source_type/actor_id/created_at のみ) | truth/ihl.ind.master.v1/{individual_id}.json | IND-02 |
| ihl.ind.cross-parent.v1 | schemas/events/ind-cross-parent.schema.json(child_id/parent_id/parent_role∈{sire,dam,surrogate}/actor_id/created_at — 血統 Truth 正本) | truth/ihl.ind.cross-parent.v1/{child_id}-{parent_role}.json | IND-01/12 |
| ihl.ind.name-event.v1 | schemas/events/ind-name-event.schema.json(individual_id/name/brand_template_id?/actor_id/created_at) | truth/ihl.ind.name-event.v1/{individual_id}-{ulid}.json | IND-04 |
| ihl.ind.brand-template.v1 | schemas/events/ind-brand-template.schema.json(brand_template_id/pattern/active:bool/actor_id/created_at) | truth/ihl.ind.brand-template.v1/{brand_template_id}-{ulid}.json | IND-04 |
| ihl.ind.life-event.v1 | schemas/events/ind-life-event.schema.json(individual_id/kind∈{birth,molt,death,eclosion,specimen,move}/at/detail?/actor_id) | truth/ihl.ind.life-event.v1/{individual_id}-{ulid}.json | IND-12/13 |
| ihl.taxon.species.v1 | schemas/events/taxon-species.schema.json(species_id/name/lineage?/forked_from?/actor_id) | truth/ihl.taxon.species.v1/{species_id}.json | IND-19 |
| ihl.taxon.morph.v1 | schemas/events/taxon-morph.schema.json(morph_id/species_id/name/forked_from?) | truth/ihl.taxon.morph.v1/{morph_id}.json | IND-19 |
| ihl.taxon.alias.v1 | schemas/events/taxon-alias.schema.json(alias_id/canonical_species_id/alias_text/approved_by/actor_id — 人間承認済のみ) | truth/ihl.taxon.alias.v1/{alias_id}.json | IND-19 |
| ihl.match.preference.v1 | schemas/events/match-preference.schema.json(pref_id/actor_id/item_id/kind∈{swipe,pass,valuecheck}/y∈{1,-1}/features:number[]/created_at) | truth/ihl.match.preference.v1/{actor_id}-{ulid}.json | IND-07 |
| ihl.obs.schedule.v1 | schemas/events/obs-schedule.schema.json(schedule_id/individual_id/next_observation_at/stage/template_id/actor_id) | truth/ihl.obs.schedule.v1/{individual_id}-{ulid}.json | OBS-21 |
| ihl.obs.device.v1 | schemas/events/obs-device.schema.json(device_id/placement_ref/provider/display_name/api_key_ciphertext/started_on/actor_id — **subject_ref=individual は拒否**) | truth/ihl.obs.device.v1/{device_id}.json | OBS-31 |
| ihl.obs.annotation.v1 | schemas/events/obs-annotation.schema.json(annotation_id/capture_id/ast:object(点/線/polygon/label)/value_origin/actor_id) | truth/ihl.obs.annotation.v1/{capture_id}-{ulid}.json | OBS-46/47 |
| ihl.obs.analysis.v1 | schemas/events/obs-analysis.schema.json(analysis_id/capture_id/results/delta?/correction_semver/is_manual_edit:bool/actor_id — 上書き禁止 append) | truth/ihl.obs.analysis.v1/{capture_id}-{ulid}.json | OBS-47/48 |
| ihl.cusb.ingest.v1 | schemas/events/cusb-ingest.schema.json(input_kind∈{screen,api,sensor,file,human,network}/payload_hash/lineage/semantic/actor_id) | truth/ihl.cusb.ingest.v1/{payload_hash}.json | OBS-44 |

タグは **frozen `schemas/frozen/tag-event.schema.json` を再利用**(新設しない・CL-13)。type=`ihl.obs.tag_event.v1`・キー `truth/ihl.obs.tag_event.v1/{target_type}-{target_id}-{ulid}.json`(CL-13 テストと同一)。

##### 1.3 既存スキーマの可逆修正(events/・非 frozen・reversible)

- `schemas/events/obs-capture.schema.json`: measurement item に **`value_origin`(required・provenance enum の 9 値参照)** 追加(OBS-06)。トップに `entry_mode`(enum{manual,qr}・任意 OBS-20)・`subspecies_candidate`/`subspecies_confirmed_by`(const "user" OBS-62)・`photo_conditions`(object{temp_c?,humidity_pct?,captured_at} OBS-28)追加。既存 vitest fixture(`observation.test.ts`・`obs-entry.json`)へ `value_origin:"direct_observed"` を補記。
- `schemas/events/obs-template.schema.json`: items に `image-annotation/api/calc` は既に存在。トップに `scope`(object{sex?,instar?∈{first,second,third_early,third_late},placement?})追加(OBS-18)。item に `item_hash`(任意)追加。

##### 1.4 投影関数(純関数・都度再計算・Truth スキーマのみ依存 D7)

route モジュールから export(`projectLedger` 前例に倣いインライン純関数・libs 新設しない):
- `buildPedigree(store, individualId, maxDepth=6)` → 系譜ツリー。`ihl.ind.cross-parent.v1` を再帰 walk。欠損親は `{known:false}` ノード。visited set で循環遮断。
- `projectIndividual(store, id)` → master + `projectName` + timeline(life-event を時系列 sort:誕生→観測→移動→死亡→標本→マーケット)+ 6 文化ブロック(観測履歴/スケジュール/テンプレ/DataSource=device/市場オファー/改善)。
- `projectName(store, id, at?)` → name_event を created_at 昇順 reduce、`at` 指定時はその時点以前の最後の name(当時名)。brand_template active=false 後も過去 name_event は保持され再現可。
- `projectCross(store, id, metric?)` → pedigree 傘下 capture の齢別平均体重(初/二/三令初期・後期)・サイズ極値(最大重量/最大全長/最小全長)・率系(死亡率=death life-event/総数, 完品率, 羽化不全率, 生存率, 孵化率, 性比, 色再現性)。`metric` で率カード 1 種を返す(?metric=mortality|completion|eclosion_failure)。決定論。
- `projectBioCard(store, id)` → species/morph/最新サイズ/特徴タグ/`qr_url`(= 個体 URL)。
- `projectAuthenticity(store, id)` → 連続性証拠(画像 sha256 連鎖の有無・event/state 履歴の連続性・成長曲線の単調性)+ 登録数vs実在数(life-event 由来)照合スコア。
- `projectSpeciesStats(store, speciesId)` → 平均サイズ/体重/市場平均価格(該当 capture + listing から集計)。
- `aliasCandidates(name, existing[])` → Levenshtein + Jaro-Winkler の決定論類似度上位(embedding 類似は既定 OFF=不変条項①・後述 defer)。純関数(依存追加なし・約 40 行)。
- `projectPreferenceWeights(store, actorId)` → preference_event を `w ← w + α·y·x`(α=`LEARNING_RATE`)で reduce。`rankByPreference(w, candidates)` は内積 `w·x` 降順・**score をレスポンスに含めない**。
- `compositeScore({embedding,color,size,lineage})` → `0.50·e + 0.20·color + 0.20·size + 0.10·lineage`。欠測既定 color/size=0.5・lineage=0.0。`aggregateIndividual(scores, method)` = max | mean_top3 | weighted_latest。
- `confidenceGrade(measurement)` → value_origin/source から 自動取得>手入力>後日編集 の順で決定論スコア → ◎/○/△。
- `aggregateTags(store, targetType, targetId)` → tag_event 群から strong(合意)/weak/disputed を導出、ai_tags/user_tags 二層で返す(**両層いずれか欠落は 400**)。
- `computeNextObservationAt(template, stage, from)` → テンプレ stage 間隔(定数)から次回日算出。`projectHomeSummary(store, actorId)` → 近接/超過/観測中。
- `projectInsightGaps(store)` → 超過個体・観測欠落個体(仮説生成/引用ネットワークは defer)。

##### 1.5 screen-defs 追加/修正(Renderer 再利用・コード追加最小)

新規: `screen-defs/obs-confirm.json`(OBS-25/62・確認画面・主 CTA『登録する』1 つ=POST /solid-observation/commit)・`obs-navigator.json`(OBS-02・学名/yes-no/ツリー 3 経路・テキストのみ)・`cross.json`(IND-12・率カード共通ノードを `source_path` の ?metric= で差替)・`bio-card.json`(IND-15)・`match.json`(IND-07・2 枚並べ左右 1 タップ + どちらも×)・`species.json`(IND-19)・`device.json`(OBS-31)。
修正: `obs-domain-select.json`(OBS-01・**ラベルを要件準拠に修正**: 生き物→生物・鉱物→**器物**・場所→**環境**。value コード biology/mineral/digital/place/custom は既存コード/テスト参照のワイヤ値のため不変=最小可逆修正。button の action に domain を持たせ obs-entry へ引き継ぐ配線修正)・`obs-entry.json`(OBS-25・save-and-done 廃止・action を confirm へ navigate に変更)・`individual-detail.json`(IND-13・6 文化 + timeline ブロック追加)・`home.json`(OBS-21・今日の要約 list 追加 source_path=/api/v1/home/summary)・`qr-resume.json`(OBS-20・prefill 表示)。

##### 1.6 凍結定数(`apps/api/src/observation-constants.ts` 1 ファイルに集約・ハードコード散在禁止)

```
RERANK_WEIGHTS = { embedding:0.50, color:0.20, size:0.20, lineage:0.10 }  // OBS-11 ADR-H-12
RERANK_MISSING = { color:0.5, size:0.5, lineage:0.0 }                     // OBS-11 欠測既定
LEARNING_RATE  = 0.1                                                       // OBS/IND-07 α
QR_BATCH_SIZES = [100, 500, 1000]                                         // IND-15
SCHEDULE_STAGE_INTERVAL_DAYS = { first_to_second:30, second_to_third:30 } // OBS-21 例値
NAVIGATOR_TARGET_QUESTIONS = { min:7, max:12 }                            // OBS-02
SCALE_PAPER = { sheet:"A4", grid_cm:{w:19,h:26}, marker_mm:10, qr_mm:15, thin_line_mm:1, thick_line_mm:10, tolerance_mm:0.2 } // OBS-45
EMBEDDING_DIM = 384 (既存 observation-routes より再利用)                   // OBS-09/10
CONFIDENCE_ORDER = { direct_observed:"◎", image_derived:"○", environment_derived:"○", estimated:"△", imputed:"△", unknown:"△" } // OBS-07
```
Python 定数(`components/obs-manifest/`): DINOv2 `dinov2_vits14`/384/L2・dummy backend(sha256→正規乱数→L2)・`IHL_EMBEDDING_BACKEND` 切替(OBS-09)。searchable_capture_set 固定列順(OBS-56): `[capture, individual, measurement(縦持ち), lineage, life_event, environment_timeseries, embedding_manifest, embedding_locator, thumbnail, qc, color, shape]`(定数化・実 Polars 実行は defer)。

#### 2. 実装ファイル計画

new(TS route): `apps/api/src/individual-routes.ts`・`taxon-routes.ts`・`match-routes.ts`・`tag-routes.ts`・`device-routes.ts`・`home-routes.ts`・`cusb-routes.ts`・`observation-constants.ts`。
modify: `apps/api/src/index.ts`(7 モジュールを `app.route("/api/v1", …)` で配線・deny-by-default 維持)・`apps/api/src/observation-routes.ts`(thumbnail 配信/measurements/targets/reanalyze/commit/annotations/search 拡張/upload photo_conditions/qr prefill)。
new(schema): §1.2 の 14 ファイル(`schemas/events/`)。modify: `obs-capture.schema.json`・`obs-template.schema.json`(§1.3)。
new(screen-def): §1.5 の 7 ファイル。modify: §1.5 の 5 ファイル。
new(Python component・contract slice): `components/obs-manifest/run.py` + `manifest`(OBS-08 ITO: input/output manifest・run_info/errors.jsonl・output_manifest 必須・同 run_id 出力先既存で fail・失敗行 continue)+ dummy image backend(OBS-09)+ `tests/test_manifest.py`。
modify: `tests/fixtures/route-matrix.csv`(011–027 の該当行 planned→implemented + ver3_note)・`04-traceability/rtm.json`(要件↔TC 閉包・自動生成側は codegen)。

#### 3. TC 計画(テストファイル + ケース・要件 ID 対応)

全 TC は `tests/helpers.ts` の FakeR2Bucket + DEV_TOKEN bearer で実 app を driving(既存 `observation.test.ts` 前例)。

- `tests/individual.test.ts` — IND-01/02/04/12/13/15/21:
  - master 作成→GET が成長データ枠を持たない/subject_ref 参照が実 record に解決(IND-02)。
  - cross-parent 追加→buildPedigree が多世代ツリー再構成・欠損親=known:false・循環入力で無限ループしない(IND-01)。
  - name_event 複数 append→projectName が最新名/`at=` で当時名再現/brand_template active=false 後も過去名再現(IND-04)。
  - projectCross が死亡率/完品率/羽化不全率を決定論計算・?metric= で率カード差替・ホーム直接不可(個体経由のみ)(IND-12)。
  - getIndividual が 6 文化 + timeline(誕生〜標本〜マーケット)を 1 レスポンスに集約(IND-13)。
  - bio-card 生成・qr-batch が {100,500,1000} のみ受理・QR 中身=個体 URL(IND-15)。
  - authenticity: 画像 hash/event 連続性スコア・登録数vs実在数照合・出品文血統矛盾検知(IND-21)。
- `tests/taxon.test.ts` — IND-19: species/morph put-if-absent 409・fork(forked_from)系譜・aliasCandidates が Levenshtein/Jaro-Winkler で候補・approveAlias は承認後のみ統合・projectSpeciesStats 自動計算。
- `tests/match.test.ts` — IND-07: preference append→`w←w+α·y·x` 後 ranking が内積降順・**score がレスポンスに露出しない**・単一 preference_event 列で kind 分岐。
- `tests/tags.test.ts` — OBS-63/07/52: tag_event append→aggregateTags が strong/weak/disputed 導出・ai_tags/user_tags 両層欠落で 400・remeasure タグ付与(OBS-07/52)・confidenceGrade が 自動>手入力>後日編集 順。
- `tests/devices.test.ts` — OBS-31: placement 紐付け OK・**個体紐付けで 400**・api_key_ciphertext 保存(平文非露出)・display_name 表示・開始日のみ入力。
- `tests/observation-ext.test.ts` — OBS-06/10/11/18/20/23/25/48/62:
  - measurement に value_origin 欠落/不正で 400・imputed と estimated を別値保持(OBS-06)。
  - search: query 自身除外・prototype 平均ベクトル・compositeScore が 0.50/0.20/0.20/0.10 + 欠測既定で決定論・aggregateIndividual 3 方式(OBS-10/11)。
  - item_hash 未登録検出→dictionary-extensions(はい/今回だけ/常に)・template scope 別(OBS-18)。
  - qr resolve→prefill + entry_mode=qr が capture に記録(OBS-20)。
  - thumbnail(512 JPEG)配信・raw 一括 DL エンドポイント不在(OBS-23)。
  - commit 経由でのみ保存・確認画面 submit CTA 1 つ・save-and-done 不可(OBS-25 E2E)。
  - 亜種未確定で commit 400(必須ゲート・AI 自動確定禁止)(OBS-62/03)。
  - reanalyze が新 analysis_id append(既存非上書き)・delta + correction_semver 記録・元画像非削除(OBS-48)。
- `tests/cusb.test.ts` — OBS-44: POST /cusb が validate→lineage/semantic 付与→保存を通し不正 schema 400・payload_hash 改ざん検知。
- `tests/home-insights.test.ts` — OBS-21/43: computeNextObservationAt→schedule INSERT・home/summary が近接/超過列挙・insights が空白(超過/欠落)検出。
- `tests/targets.test.ts` — OBS-02/03: 学名 substring / yes-no 二分探索 / ツリー 3 経路が QID+taxonomy 返却・収束 7〜12 問・候補提示と確定分離(AI が species_confirmed を書けない不変)。
- `tests/obs-annotations.test.ts` — OBS-46/47: annotation AST append/round-trip・自動計測値は修正不可(edit route 不在)・手入力は value_origin タグ付与。
- `tests/upload-conditions.test.ts` — OBS-28: 撮影時 photo_conditions 自動埋込・閾値超過アラート発火・プレースホルダ値偽装拒否。
- `components/obs-manifest/tests/test_manifest.py` — OBS-08/09: output_manifest/errors.jsonl 出力・同 run_id 出力先既存で fail・不正 1 行で continue+errors 追記・dummy image backend が sha256→L2 正規化 384 次元・NaN 無し・決定論(同入力同出力)。

自動化不可(automatable=false・manual/物理/視覚)は §5 に分離、tc_map に列挙。

#### 4. クラスタ内実装順序

1. `observation-constants.ts` + §1.2/1.3 schema(codegen 型)。2. `individual-routes.ts`(master→cross-parent→pedigree→name→life-event→cross→bio-card→authenticity)。3. `taxon-routes.ts`。4. `observation-routes.ts` 拡張(value_origin/measurements/targets/search/thumbnail/reanalyze/commit/annotations/upload/qr)。5. `tag-routes.ts`・`match-routes.ts`・`device-routes.ts`。6. `home-routes.ts`・`cusb-routes.ts`。7. `index.ts` 配線。8. screen-defs(修正→新規)。9. `components/obs-manifest`(Python contract slice)。10. route-matrix.csv 更新 + 全 TC green(vitest + pytest)実測→ lint/GATE→ commit。各段 lint/test 全 green 実測後に次段。

#### 5. 分母除外・停止報告(human-gate + 費用/範囲 defer)

**人間ゲート(実行しない・停止報告):**
- OBS-28 間隔ポーリング(5/10/30/60 分)の **cron 常駐配線** = 常駐トークン消費の開始 → 停止報告し config/schedule のみ実装、Cron 起動は人間承認後。
- OBS-31 各 Provider の **実 API キー投入** = 実鍵投入 → 暗号化保存経路 + dummy provider の接続テストまで実装、実鍵は投入しない。
- IND-15 名刺型番(A-one/コクヨ 91×55mm)の **100%等倍・切込位置ズレ** = 物理治具 → 生成/連番/URL 化は自動 TC、印刷実測は人間。

**費用/範囲 defer(不変条項① LLM/Vision/FAISS 既定 OFF・V3-CST-01 従量課金回避のため契約/slice のみ実装し重い外部/クライアント実体は後波・分母から除外):**
- OBS-02 の **Wikidata ライブ照会**(ローカル分類カタログ + 決定論二分探索で QID を返す slice を実装、live enrichment は後波)。
- OBS-09 の **DINOv2 実バックエンド**(dummy 決定論バックエンド + Protocol/manifest を実装、torch/GPU 実推論は後波)。
- OBS-45 の **ブラウザ WASM/WebGL 画像処理**(Canny/Hough/射影変換)(スケール紙規格 const + 数値のみ送信契約を実装、クライアント CV 実装は後波)。
- OBS-46 の **LabelMe OSS iframe/flexlayout 統合**(AST 保存イベント + postMessage 契約を実装、iframe UI は apps/web 後波・視覚は manual)。
- OBS-47 の **ローカル HSV/Lab/輪郭解析実体**(自動値不可変・手入力タグの契約を実装、クライアント解析実装は後波)。
- OBS-56 の **searchable_capture_set Polars join バッチ**(固定列順 const + latest pointer/snapshot_id 契約を定義、Polars component 実行はバッチ波=メンテはバッチ化 V3-CST-01)。
- OBS-43 の **仮説生成/引用ネットワーク**(決定論の空白検出=超過/欠落 insight を実装、LLM 依存の仮説/引用は後波)。
- IND-19 の **embedding 類似の alias 検出**(Levenshtein/Jaro-Winkler の決定論候補を実装、embedding 類似は既定 OFF のため後波)。
- OBS-18 の **プラチナ投票による自然淘汰 UI**(fork + item_hash 検出を実装、投票 UI は後波・付与は既存 grantPlatinum 再利用)。

これらは frozen 非変更・append-only・可逆で、後波が既存契約の上に積める設計とする(スキーマ進化は追加のみ・不変条項③)。

#### K1 批評家指摘(実装時反映・verdict=pass)

1. **[minor]** §0 header claims 「対象要件 ID 一覧(30 件・1 件も落とさない)」but actually enumerates 35 requirements (9 IND: 01/02/04/07/12/13/15/19/21 + 26 OBS: 01/02/03/06/07/08/09/10/11/18/20/21/23/25/28/31/43/44/45/46/47/48/52/56/62/63) — which also matches the 35 objects in the source c5-cluster-k1.json. Coverage itself is complete (all 35 appear in both the contract body and tc_map), so this is a labeling error, not a dropped requirement.
   - 反映: Fix the count to 35 件 (9 IND + 26 OBS). The enumeration and tc_map are already correct; only the header number is wrong and should not be trusted as a completeness check.
2. **[minor]** §1.6 CONFIDENCE_ORDER maps only 6 of the 9 frozen provenance value_origin enum values (direct_observed/image_derived/environment_derived/estimated/imputed/unknown). The frozen schemas/frozen/provenance.schema.json enum also contains lineage_derived, aggregate, and model_inference, and §1.3 makes value_origin required on every measurement referencing all 9 values — so confidenceGrade() has no ◎/○/△ mapping for a measurement whose origin is lineage_derived/aggregate/model_inference.
   - 反映: Add the 3 missing enum values to CONFIDENCE_ORDER (or specify an explicit default grade, e.g. △) so confidenceGrade is total over the frozen 9-value enum and OBS-07 does not produce undefined for valid inputs.
3. **[minor]** §1.2 states envelope は「既存 envelope() ヘルパ再利用」, but in observation-routes.ts envelope() and store() are module-private (function envelope(...), not exported). The 6 new route files cannot import them as written.
   - 反映: Specify that observation-routes.ts must export envelope()/store() (or extract them to a shared module), or that each new route file inlines its own copy per the projectLedger inline-helper precedent. As written 「再利用」is not directly possible.
4. **[minor]** OBS-63 two-layer rule is under-specified against the frozen substrate. schemas/frozen/tag-event.schema.json (CL-13) has no ai_tags/user_tags fields — only source_type (machine vs human). §1.1 appendTag says 「ai_tags/user_tags 両層必須」and §1.4/tc_map say aggregateTags returns 400 when 「両層いずれか欠落」, but a single append-only tag_event can only ever carry one layer, so a 400-on-append reading is unsatisfiable and the 400 must fire at the aggregate/query level (or via a request that names the layer).
   - 反映: Clarify that ai_tags/user_tags are derived from source_type (machine=ai / human=user) at aggregateTags time, and state precisely where the 400 fires (e.g. on the aggregate read when a target has zero events in one derived layer, not on individual appendTag), so the implementer doesn't wire an impossible per-append guard.

### K3 カルマ/経済+マーケット取引

> 対象: ver3 Phase C5 クラスタ K3。C4 設計契約(`docs/planning/c4/design-c4.md`)を継承し、C4 で「付与関数+TC まで」に留めた経済系を**配線(cron フック/状態機械/取引フロー)**まで進める。5 不変条項厳守: ①常駐 DB 禁止・派生値は投影で都度再計算・LLM/Vision/FAISS 既定 OFF ②フォーク文化 ③R2 INSERT ONLY(`packages/truth` TruthStore 再利用・UPDATE/DELETE 禁止) ④人間ゲート ⑤検証されないものは納品されない。
> 既存資産の再利用を最優先: `fib`/`fibPenalty`/`clampKarma`/`projectLedger`/`appendKarma`/`grantKarmaCountIncrease`/`grantPlatinum`(`ledger-routes.ts`)・`reconcileOnce`/`extractTransferCode`/`makeGmoConnector`(`gmo-routes.ts`/`gmo-connector.ts`)・`marketRoutes`(`market-routes.ts`)・`TruthStore.putEvent/putEventAt/listEvents/readEvent`(`packages/truth/src/store.ts`)・`deriveActorId`/`deriveTransferCode`(`contracts.ts`)・ScreenDef Renderer(`schemas/screendef/screendef.schema.json`)。

#### 0. 対象要件 ID 一覧(30 件・1 件も落とさない)

カルマ/経済(g3-karma): **V3-KRM-03・04・05・06・10・11・12・13・16・20・21・24・25**(13 件)
マーケット取引(g4-market/g11-s-tier): **V3-MKT-01・02・03・04・06・10・12・14・20・22・23・25・27・29・36・39**(16 件)…合計 29。加えて経済横断の維持費税は MKT-10=カルマ連動で KRM/MKT 双方に跨る。**計 29 requirement**(KRM 13 + MKT 16)。

#### 1. 設計の骨子(共有機構 — 車輪の再発明をしない)

全要件を **10 の新イベント型 + 1 本の cron + 少数の純関数投影 + 3 本の config** に畳む。個別 route はこれらを呼ぶだけ(Kernel 集約 = MKT-39)。

| 共有機構 | 実体 | カバー要件 |
|---|---|---|
| 追記イベント + prefix-scan 投影 | `TruthStore.putEvent`/`listEvents` 既存パターン(`projectLedger` 型) | 全要件の永続化 |
| `fib(n)` 再利用 | `ledger-routes.ts` 既存 | KRM-05/12, MKT-10 |
| 純関数 reducer | `reduceMarket`(状態機械)ほか | MKT-02/03/04/29 |
| 単一 cron `scheduled()` | `batch.ts` が月次ジョブを分岐 | KRM-03/11/12, MKT-04/10 |
| 共有 HMAC 検証 | `hmac.ts` `verifyHmacSha256()` | KRM-13, MKT-14 |
| CSV policy resolver | `policy.ts` `resolvePolicyInt()` = 同一 key の timestamp 最新行を正 | KRM-16, MKT-39 |
| 3 軸貢献度エンジン | `contribution.ts` `applyContributionDelta`/`projectContribution` | KRM-10/11/12/13, MKT-10/36 |

#### 2. 確定値

##### 2.1 新イベント型(10 種・全て `ihl.<domain>.<event>.vN`・schema は `schemas/events/`。frozen `ledger-entry`(CL-12)は緑化前に触らない=新台帳は非 frozen 側に置く)

| # | type 名 | schema ファイル(new) | data キー構造(確定) | カバー |
|---|---|---|---|---|
| 1 | `ihl.economy.pt_event.v1` | `schemas/events/economy-pt-event.schema.json` | `{pt_event_id, actor_id, delta(整数・+mint/-spend), reason_code(mint\|indulgence_spend\|vote_spend\|manual), ref?, created_at, schema_version}` | KRM-05/10/12/25 |
| 2 | `ihl.economy.contribution_event.v1` | `schemas/events/economy-contribution-event.schema.json` | `{contribution_event_id, node_id, actor_id, axis(research\|capital\|development), delta(number≥0=非負累積invariant), source(github\|board\|fork\|vote\|tax\|manual), source_ref?, created_at, schema_version}` | KRM-10/11/12/13, MKT-10/36 |
| 3 | `ihl.mkt.transaction_event.v1` | `schemas/events/mkt-transaction-event.schema.json` | `{transaction_event_id, listing_id, actor_id, kind(list_fixed\|list_auction\|list_lottery\|list_platinum\|offer\|love_letter\|bid\|match\|ship\|receive\|rate\|settle\|delist\|transfer\|tax_debt\|tax_pay\|fee_unpaid), counterparty?, amount?, individual_ids?, payload?, created_at, schema_version}` | MKT-01/02/03/04/06/10/29 |
| 4 | `ihl.mkt.rating.v1` | `schemas/events/mkt-rating.schema.json` | `{rating_id, listing_id, rater_id, ratee_id, grade(good\|normal\|bad), tags?[], comment?, reason?(bad は必須), auto(bool), created_at, schema_version}` | MKT-27, MKT-04 |
| 5 | `ihl.mkt.template.v1` | `schemas/events/mkt-template.schema.json` | `{template_id, actor_id, kind(paper\|ui_skin\|graph\|weights\|ai_pack\|prompt), title, forked_from?, body_ref?, created_at, schema_version}` | MKT-22 |
| 6 | `ihl.mkt.post_office.v1` | `schemas/events/mkt-post-office.schema.json` | `{post_office_event_id, actor_id, post_office_id, is_default(bool), created_at, schema_version}`(住所は保持しない=PII 不使用・不変条項③) | MKT-20 |
| 7 | `ihl.social.eval.v1` | `schemas/events/social-eval.schema.json` | `{eval_id, target_node_id, target_layer(0-3), rater_id, kind(vote\|like\|dislike\|favorite\|follow\|fork\|proposal), created_at, schema_version}` | KRM-20 |
| 8 | `ihl.social.platinum_vote.v1` | `schemas/events/social-platinum-vote.schema.json` | `{vote_id, target_id(論文/UI/イベント/プロンプト), voter_id, coins(1票=1coin・任意枚数), created_at, schema_version}` | KRM-25 |
| 9 | `ihl.research.proposal.v1` | `schemas/events/research-proposal.schema.json` | `{proposal_event_id, proposal_id, actor_id, kind(create\|fork\|rank_change\|hypothesis_transition\|support\|reject), rank?(official\|recommended\|popular\|beginner\|minor), state?(draft\|hypothesis\|supported\|rejected), forked_from?, created_at, schema_version}` | KRM-24 |
| 10 | `ihl.gmo.obligation.v1` | `schemas/events/gmo-obligation.schema.json` | `{obligation_id, actor_id, transfer_code, amount(整数>0), obligation_kind(fee_tax\|pt_topup\|p2p), due_date(date-time=義務発生日), created_at, schema_version}` | MKT-12, MKT-10 |

codegen: 追加後 `node scripts/codegen-schemas.mjs`(逆流禁止=schemas→generated 一方向)を実行し `--check` 緑化。

##### 2.2 route 表(全て deny-by-default=`index.ts` の session gate で protected。webhook のみ session 層 public + HMAC self-gate=CL-09 collector/ingest と同型)

| method | path | access | handler(file) | カバー |
|---|---|---|---|---|
| POST | `/api/v1/market/listings/{id}/transition` | protected | `market-routes.ts`(MOD) | MKT-02(許可辺のみ・不正遷移 409) |
| GET | `/api/v1/market/listings/{id}/state` | protected | `market-routes.ts`(MOD) | MKT-02/03(reduceMarket 末尾状態+stage) |
| GET | `/api/v1/market/listings/{id}/board` | protected | `market-routes.ts`(MOD) | MKT-03(当事者2人のみ・第三者 403) |
| POST | `/api/v1/market/offers` | protected | `market-routes.ts`(MOD) | MKT-06(直接オファー/ラブレター) |
| POST | `/api/v1/market/ratings` | protected | `market-rating-routes.ts`(NEW) | MKT-27 |
| GET | `/api/v1/market/users/{actor}/ratings` | protected | `market-rating-routes.ts`(NEW) | MKT-27(公開・低評価フィルタ) |
| POST | `/api/v1/market/templates` | protected | `market-template-routes.ts`(NEW) | MKT-22(出品) |
| GET | `/api/v1/market/templates` | protected | `market-template-routes.ts`(NEW) | MKT-22(一覧+ranking) |
| POST | `/api/v1/market/templates/{id}/fork` | protected | `market-template-routes.ts`(NEW) | MKT-22(forked_from) |
| POST | `/api/v1/market/listings/draft` | protected | `market-pricing-routes.ts`(NEW) | MKT-23(黄金フロー autofill) |
| GET | `/api/v1/market/listings/{id}/price-recommendation` | protected | `market-pricing-routes.ts`(NEW) | MKT-25(embedding OFF 経路) |
| GET | `/api/v1/market/listings/{id}/shipping-estimate` | protected | `market-pricing-routes.ts`(NEW) | MKT-20 |
| POST | `/api/v1/me/post-offices` | protected | `market-pricing-routes.ts`(NEW) | MKT-20 |
| GET | `/api/v1/market/listings/{id}/ownership` | protected | `market-routes.ts`(MOD) | MKT-29(観測系譜) |
| POST | `/api/v1/social/eval` | protected | `social-routes.ts`(NEW) | KRM-20 |
| GET | `/api/v1/components/{node_id}/eval` | protected | `social-routes.ts`(NEW) | KRM-20(総合指標・統計のみ・公式ランキング非生成) |
| POST | `/api/v1/social/platinum-votes` | protected | `social-routes.ts`(NEW) | KRM-25 |
| GET | `/api/v1/proposals/{id}/votes` | protected | `social-routes.ts`(NEW) | KRM-25(公開合計値+投票者内訳) |
| POST | `/api/v1/proposals` | protected | `proposal-routes.ts`(NEW) | KRM-24(改善案 create) |
| POST | `/api/v1/proposals/{id}/fork` | protected | `proposal-routes.ts`(NEW) | KRM-24(rank=beginner 自動) |
| POST | `/api/v1/proposals/{id}/transition` | protected | `proposal-routes.ts`(NEW) | KRM-24(rank/hypothesis 遷移) |
| POST | `/api/v1/shop/indulgence` | protected | `shop-routes.ts`(NEW) | KRM-05(免罪符購入) |
| GET | `/api/v1/shop/indulgence/price` | protected | `shop-routes.ts`(NEW) | KRM-05(Fib 段階価格) |
| GET | `/api/v1/me/contribution` | protected | `contribution-routes.ts`(NEW) | KRM-10/12(3 軸・本人) |
| GET | `/api/v1/me/pt` | protected | `contribution-routes.ts`(NEW) | KRM-10(PT 非公開=本人のみ) |
| GET | `/api/v1/me/profile` | protected | `profile-routes.ts`(NEW) | KRM-21(本人) |
| GET | `/api/v1/users/{actor}/profile` | protected | `profile-routes.ts`(NEW) | KRM-21/04(3 指標個別・BAN 公開表示) |
| GET | `/api/v1/me/status` | protected | `profile-routes.ts`(NEW) | KRM-16(統合ステータス+append-only 履歴) |
| POST | `/api/v1/github/webhook` | **public(session 層)** + HMAC self-gate | `github-webhook-routes.ts`(NEW) | KRM-13 |

**MKT-14 GMO webhook route は本クラスタでは登録しない**(`/api/v1/gmo/webhook`=route-matrix 057 は `planned` 据置)。理由: 実 subscribe/実行系/live 受信=人間ゲート(GMO 本番契約・実鍵)であり権限分類器が拒否する既知事象。本クラスタは `verifyGmoWebhookHmac()` 関数 + parse + TC までを納品し、route への配線はゲート通過後の別波とする。

route-matrix.csv(57 行 frozen ver2 inventory)は**変更しない**。上記 ver3 新規 route は同 CSV 未登録=CL-04 の 57 行 count/AUTH 照合に影響しない(既存の POST /market/listings と同扱い=`design-c4 §3`・route-029 note)。`index.ts` の `PUBLIC_ROUTES` へ `"/api/v1/github/webhook"` を 1 行追加(collector/ingest と同じ self-gate 方式)。

##### 2.3 投影関数(純関数・都度再計算=不変条項①。全て prefix-scan+filter+reduce の `projectLedger` 型)

- `reduceMarket(events): {listing_id, state, owner_id, matched_with?, bids[], stage}` — `market-settlement.ts`(NEW)。unlisted→listed_{fixed,auction,lottery,platinum}→(match)→matched→(ship)→shipped→(receive+rate)→sold / delisted / offer_pending。**許可辺表 `MARKET_EDGES` 定数**外の遷移は route が 409。落札(auction settled)は Stage1 省略で Stage2 直行(MKT-03)。
- `projectSettlement(events, now): {settled(bool), settled_at?, fee_unpaid_started_at?}` — 成立=受取申告 kind:receive **かつ** 評価確定 kind:rate。配送完了(ship)+`AUTO_GOOD_RATING_DAYS`(30)無評価→自動 `grade:good, auto:true`(cron)。8% fee は成立後起算(MKT-04)。
- `projectOwnershipLineage(events): {chain:[{from,to,at,carried_observations}]}` — 成立時 owner 移転+観測データ引継ぎを一本系譜へ。`external:true` フラグ時は引き継がない(MKT-29)。
- `projectContribution(events, actorId): {axes:{research,capital,development:{score, minted, next_threshold}}}` — 各 delta を軸別に非負累積(減算イベントは拒否=append 側 guard)。`next_threshold = CONTRIBUTION_PER_PLATINum * fib(mintedCount+1)`(KRM-12: 100,100,200,300,500…)。累計残高は非減衰(KRM-12)。称号=`score ≥ CONTRIBUTION_TITLE_THRESHOLD`(10000)で導出(KRM-11・イベント不要=投影で算出)。
- `applyContributionDelta(s, node_id, axis, delta, ancestors)` — 子ノードへ delta、依存グラフ祖先へ `UPSTREAM_PERCENT`(0.10)を重み配分(祖先無しは子に残す)。軸別 `minted*100→fib` 到達ごと `issueCoin`(=grantPlatinum 1 枚)+端数繰越(KRM-11/12)。
- `projectPt(events, actorId): {balance}` = pt_event delta 合計(非公開=本人のみ返却・KRM-10)。
- `indulgenceStage(events, actorId, now): number` = 初期 1、購入(indulgence_spend)ごと +1、暦月(UTC)経過ごと -1、下限 1。価格 PT = `fib(stage)`(KRM-05・初回 fib(1)=1PT)。
- `projectSocialEval(events, node_id): {counts:{vote,like,dislike,favorite,follow,fork,proposal}}` — 対象 layer 0-3 のみ集計(layer4 除外)、本人自己評価は集計前に除外(rater_id≠author)。**公式ランキング配列は生成しない**(統計のみ・KRM-20)。
- `projectPlatinumVoteTally(events, target_id): {total, breakdown:[{voter_id, coins}]}` — 全員公開合計値+内訳。閾値到達判定は `resolvePolicyInt('platinum_vote.official_threshold', governance)`(既定 100・GUI 可変)。到達で本人通知+**公式昇格候補化**(実昇格=人間ゲート・KRM-25)。
- `reduceProposal(events, proposal_id): {rank, state, trust}` — rank 遷移(minor→beginner→popular→recommended→official)、hypothesis 状態機械(draft→hypothesis→supported/rejected)、trust=支持/(支持+否定)。閾値以上で supported 昇格・低支持アーカイブ(KRM-24)。
- `projectRating(events, actorId): {good, normal, bad, trades, cancels, said, star_avg}` — ADR-H-08 件数モデル。低評価フィルタ=`bad≥LOW_RATING_BAD_THRESHOLD(5) || karma≤LOW_RATING_KARMA_MAX(0) || star_avg≤LOW_RATING_STAR_MAX(2)`(MKT-27)。カルマ/好み学習とは投影分離。
- `projectProfile(s, actorId): {karma:{value,count,ban}, contribution:{axes,research_score}, market:{rating}, public_safety_locked:[...], intl_trust(0-100)}` — 3 指標**個別**(研究スコアは contribution 内訳=独立 4 番目にしない・ADR-H-08)。取引実績/カルマ/悪レビュー/公開 ON 不服申立て=`public_safety`=非公開設定不可(常に公開)。国/言語/文化タグ/自己紹介/アイコンのみ公開設定可(KRM-21)。
- `isBanned(s, actorId): boolean` = `projectLedger.karma_value ≤ KARMA_BAN_THRESHOLD(-100)`(KRM-04)。BAN は可逆実装(公開ゲートでない)。
- `recommendPrice(observations, comparables): {anchor, method('weighted_mean'|'median'), sources[]}` — 観測特徴量(種/血統/サイズ/性別/産地/環境ログ)の whitelist/subset 経路で類似個体の過去成約価格を集約(重み付き平均・中央値)、計算元込み全公開。embedding は明示 ON 時のみ(既定 OFF=不変条項①・MKT-25)。ロジック年次投票は governance policy で選定(実昇格=人間ゲート)。
- `buildListingDraft(individual_ids, template): draft` — 個体 ID 複数選択で親個体画像/血統/成長履歴/温度重量ログ/類似価格/過去取引を自動引用、変数化テンプレ(`{{size}}{{bloodline}}`)から説明文生成、`recommendPrice` で推奨価格自動入力(MKT-23・相場スタブ可)。
- `estimateShipping(individual_obs, from_office, to_office): {size, yen}` — 観測データから梱包サイズ推定→郵便局間距離×サイズ。着払い前提・実送料入力なし(MKT-20)。
- `computeFees(gross, {commercial, forked}): {civilization(3%), maintenance_tax(8%), fork_rebate(10%)}` — `market-settlement.ts`。OSS 非商用=全 0(経済圏外・MKT-36)。
- `resolvePolicyInt(policy_key, csvRows): number` — 同一 `policy_key` の timestamp 最新行の `policy_int` を返す(MKT-39 tradePolicyResolver / KRM-16 policy table 共用・`policy.ts`)。

##### 2.4 GMO FIFO 消込(MKT-12・`gmo-routes.ts` MOD)

`reconcileOnce` を義務台帳対応へ拡張: `ihl.gmo.obligation.v1`(同一 code 同額の複数 pending)を `due_date` 昇順に整列 → 入金(振込日時 `transactionDate` 優先)を**義務発生日以降で最古の未払いへ FIFO 消込**。消込は `RECON_TYPE` に `obligation_ref` を付けて append(itemKey put-if-absent=二重 409・既存冪等踏襲)。1 安定コードを 8% 税/PT/P2P で共用(振込の真偽は暴かず事実を並べる)。既存 `extractTransferCode`(ゆらぎ耐性)再利用。

##### 2.5 HMAC 検証(KRM-13, MKT-14・`hmac.ts` NEW)

`verifyHmacSha256(rawBody, signatureHeader, secret): Promise<boolean>` — WebCrypto `crypto.subtle`(新規 npm 依存なし)。GitHub=`X-Hub-Signature-256`(`sha256=` prefix)、GMO=同 SHA-256 HMAC。定数時間比較。KRM-13 は `github_delivery_id`(`X-GitHub-Delivery`)を Truth キーに使い put-if-absent=べき等(重複 delivery=409 スキップ)。換算表 `config/github-contribution-weights.json`(PR/Issue/review/comment/push/release/star→pt+badge 条件)を `policy.ts` 経由でロードしハードコードしない。

##### 2.6 cron `scheduled()`(KRM-03/11/12, MKT-04/10・単一ハンドラ `batch.ts` NEW + `index.ts` MOD + `wrangler.toml` MOD)

`export default { fetch: app.fetch, scheduled: handleScheduled }` へ変更。`wrangler.toml` に `[triggers] crons = ["0 15 * * *"]`(UTC 15:00=JST 0:00 日次・実処理は日付判定で月次分岐)。`handleScheduled` が下記を順に実行:
- KRM-03: 毎月 25 日基準(`RECOVERY_BASE_DAY`)。当月 count≥1 履歴あり→ count-1(reason `monthly_batch`)。当月 count=0 完遂→ value +`MONTHLY_RECOVERY`(10)上限 `KARMA_VALUE_MAX`(100)。期間中 1 日でも count≥1 なら +10 なし。
- KRM-12: 各軸当月ミント無し→鋳造閾値 Fib 1 段降下(下限 `CONTRIBUTION_PER_PLATINUM`=100・累計残高は非減衰)。UTC 暦月境界。
- KRM-11: フォーク収益/投票プラチナ 10% を低レイヤー作者へ月集計還元。
- MKT-04: 配送完了+30 日無評価 listing に自動 `grade:good`(auto)を append。
- MKT-10: fee_unpaid の取引成立月起算 月次 Fibonacci Δcount(`grantKarmaCountIncrease` reason `fee_unpaid` 再利用・全額消込月で当該取引由来 Δcount 停止・他事由と加算)。

##### 2.7 凍結定数(`economy-constants.ts` に追記・ハードコード散在禁止=1 ファイル集約。較正は KRM-16 policy=後波 GUI)

```
INDULGENCE_INITIAL_PRICE_PT = 1        // KRM-05 初回1PT (=fib(1))
FEE_MAINTENANCE_TAX_RATE     = 0.08    // MKT-10/36 維持費税
FEE_COMMERCIAL_RATE          = 0.03    // MKT-36 文明拠出
FEE_FORK_REVENUE_RATE        = 0.10    // MKT-36 原作者還元
UPSTREAM_PERCENT             = 0.10    // KRM-11 祖先重み配分
TAX_GRACE_DAYS               = 30      // MKT-10 猶予
AUTO_GOOD_RATING_DAYS        = 30      // MKT-04 自動良い
CONTRIBUTION_PER_PLATINUM    = 100     // KRM-11/12 1PT鋳造基礎
CONTRIBUTION_TITLE_THRESHOLD = 10000   // KRM-11 称号(GUI可変=policy 既定値)
KARMA_BAN_THRESHOLD          = -100    // KRM-04 永久BAN
SOCIAL_EVAL_LAYER_MAX        = 3       // KRM-20 layer0-3のみ
LOW_RATING_BAD_THRESHOLD     = 5       // MKT-27
LOW_RATING_KARMA_MAX         = 0       // MKT-27
LOW_RATING_STAR_MAX          = 2       // MKT-27
RANKING_WEIGHTS = {usage:40,retention:20,rating:20,forks:10,improvements:10} // MKT-22
INTL_TRUST_MIN=0, INTL_TRUST_MAX=100   // KRM-21
```
GUI 可変な閾値(称号 10000・公式化ライン 100・免罪符初期価格)は `config/economy-policy.csv` の既定行にも複製し `resolvePolicyInt` 経由参照(KRM-16)。定数はテストのスナップショットで凍結(MKT-36 fee 定数含む)。

##### 2.8 screen-defs 追加(Renderer 再利用・コード追加最小・「未実装/WIP」表記禁止=V3-UIX-01)

| file(new) | 画面 | カバー |
|---|---|---|
| `screen-defs/economy-status.json` | プラチナ/カルマ/貢献度/称号+履歴の統合ステータス | KRM-16 |
| `screen-defs/profile.json` | Karma/Contribution/Market 3 指標個別・BAN 公開表示 | KRM-21/04 |
| `screen-defs/platinum-shop.json` | 「プラチナコインショップ」(免罪符・用語統一) | KRM-05 |
| `screen-defs/market-trade.json` | stage=クエリ stepper(公開→private board・推奨価格/推定送料表示) | MKT-03/23/25/20 |
| `screen-defs/template-market.json` | テンプレ出品/フォーク/投票・ranking 表示 | MKT-22 |

##### 2.9 config(new・JSON/CSV 正本・生成物でない=手編集可)

- `config/economy-policy.csv`(header `policy_key,policy_int,domain,timestamp`)— KRM-16 統一フォーマット(trigger/action/amount, domain=platinum|karma|contribution|titles)。
- `config/market-governance.csv`(header `policy_key,policy_int,timestamp`)— MKT-39 tradePolicyResolver。
- `config/github-contribution-weights.json`— KRM-13 行動→pt+badge 換算表。

#### 3. 実装ファイル計画

**NEW**
- `apps/api/src/hmac.ts`(KRM-13/MKT-14 共有 HMAC)
- `apps/api/src/policy.ts`(KRM-16/MKT-39 resolvePolicyInt + config loader)
- `apps/api/src/contribution.ts`(KRM-10/11/12 エンジン: applyContributionDelta/projectContribution)
- `apps/api/src/contribution-routes.ts`(KRM-10/12 GET /me/contribution・/me/pt)
- `apps/api/src/shop-routes.ts`(KRM-05 免罪符・PT 消費)
- `apps/api/src/market-settlement.ts`(MKT-02/04/10/29/36 reduceMarket/projectSettlement/projectOwnershipLineage/computeFees・純関数)
- `apps/api/src/market-rating-routes.ts`(MKT-27)
- `apps/api/src/market-template-routes.ts`(MKT-22)
- `apps/api/src/market-pricing-routes.ts`(MKT-20/23/25 recommendPrice/buildListingDraft/estimateShipping + routes)
- `apps/api/src/social-routes.ts`(KRM-20/25)
- `apps/api/src/proposal-routes.ts`(KRM-24)
- `apps/api/src/profile-routes.ts`(KRM-21/04/16 profile/status/ban)
- `apps/api/src/github-webhook-routes.ts`(KRM-13)
- `apps/api/src/gmo-webhook.ts`(MKT-14 verifyGmoWebhookHmac + parse・route 未配線=関数+TC まで)
- `apps/api/src/batch.ts`(KRM-03/11/12・MKT-04/10 月次 cron)
- schemas 10 種(§2.1)+ codegen 生成物(自動)
- screen-defs 5 種(§2.8)・config 3 種(§2.9)
- TC: §4 の各 `tests/*.test.ts`

**MODIFY**
- `apps/api/src/economy-constants.ts`(§2.7 定数追記)
- `apps/api/src/ledger-routes.ts`(KRM-06 appendKarma に value+delta guard=reason `monthly_batch` 以外の value 正増加を throw / KRM-04 `isBanned` export)
- `apps/api/src/market-routes.ts`(MKT-01/02/03/06/29 transition/state/board/offers/ownership route 追加・reduceMarket 呼出)
- `apps/api/src/gmo-routes.ts`(MKT-12 reconcileOnce を obligation FIFO へ拡張)
- `apps/api/src/index.ts`(scheduled export・PUBLIC_ROUTES に github/webhook 追加・BAN gate は auth-routes verify で・route.route 登録)
- `apps/api/src/auth-routes.ts`(KRM-04 session 発行前に isBanned→403。ponytail: BAN 判定はログイン時のみ=毎リクエスト全 karma 走査を避ける。既発行 session の再チェックは短命 session 前提で後波)
- `apps/api/wrangler.toml`(`[triggers] crons`)

#### 4. TC 計画(要件 ID 対応・`tests/*.test.ts`・harness=`FakeR2Bucket`/`makeEnv`/`AUTH_HEADERS` 既存 helper 再利用)

- `tests/karma-recovery.test.ts` — KRM-03(25 日基準 count-1・count=0 完遂月のみ value+10 上限 100・月内 count≥1 発生月は +10 なし・時刻注入)、KRM-06(value 正増加が monthly_batch 以外で throw・貢献付与が karma でなく contribution/coin に落ちる)
- `tests/karma-ban.test.ts` — KRM-04(karma_value≤-100 で verify 403・profile に永久 BAN 公開・R2 イベント保持=削除なし・免罪符非適用)
- `tests/indulgence-shop.test.ts` — KRM-05(1 購入 count-1・count=0 で不可・value/Fib 逆操作しない・価格 fib(stage): 購入+1/暦月-1・「プラチナコインショップ」用語)
- `tests/contribution.test.ts` — KRM-10(非負累積・減算拒否・5 概念別台帳: PT 非公開/Supporter 非影響)、KRM-11(子Δ→祖先 10% 配分・累計 100 で issueCoin1+端数繰越・称号 10000)、KRM-12(各軸 100→1PT・2 枚目以降 fib(n)*100・当月無ミントで Fib1 段降下 下限 100・残高非減衰・UTC 月境界)
- `tests/github-webhook.test.ts` — KRM-13(HMAC 不正署名拒否・同一 delivery_id 再送べき等 409・config weights 変更が換算に反映)
- `tests/economy-policy.test.ts` — KRM-16(policy_key+policy_int 参照解決・append-only 履歴)、MKT-39(同一 policy_key 古/新 2 行で resolvePolicyInt が最新行を返す)
- `tests/social-eval.test.ts` — KRM-20(layer0-3 のみ集計・layer4 除外・本人自己評価拒否・公式ランキング非生成)
- `tests/profile.test.ts` — KRM-21(3 指標個別返却・研究スコアが Contribution 配下・public_safety の非公開設定拒否・intl_trust 0-100)
- `tests/proposal.test.ts` — KRM-24(fork で rank=beginner 自動・rank 昇格遷移・hypothesis が信頼度で supported/rejected 収束・低支持アーカイブ)
- `tests/platinum-vote.test.ts` — KRM-25(1 票=1coin 積上げ公開合計値・投票者内訳全公開・閾値到達で公式昇格通知=候補化)
- `tests/market-state-machine.test.ts` — MKT-01(各チャネル list_* 成立ルール・非エスクロー=資金非預り invariant)、MKT-02(許可辺遷移反映・不正遷移 409・reduceMarket 末尾状態・遷移マトリクス網羅)
- `tests/market-stage.test.ts` — MKT-03(matched 後 private board は当事者 2 人のみ・第三者 403・落札は stage=Stage2 直行)
- `tests/market-settlement.test.ts` — MKT-04(受取+評価で成立・fee_unpaid 起算・配送+30 日無評価が自動 good・時刻注入 境界 29/30/31 日)、MKT-10(8% 税負債・30 日境界・fibPenalty 連動・全額消込で Δcount 停止)
- `tests/market-offer.test.ts` — MKT-06(ラブレター値段非開示集約→出品者選択で成立・拒否ポリシー個体で 409/403)
- `tests/gmo-fifo.test.ts` — MKT-12(義務 3 件 同一 code 同額 due_date 昇順+入金 1 件→振込日時優先で最古未払いへ消込・残 2 件 pending)
- `tests/gmo-webhook-hmac.test.ts` — MKT-14(verifyGmoWebhookHmac 正/改竄・match_pending 再送二重防止=冪等)
- `tests/market-shipping.test.ts` — MKT-20(観測+送/受局 ID→梱包サイズ→推定送料・住所フィールド非保持)
- `tests/market-template.test.ts` — MKT-22(ランキング=40/20/20/10/10 重み算出・fork で forked_from 連結)
- `tests/market-autofill.test.ts` — MKT-23(個体 ID 選択だけで観測引用付き draft 生成+推奨価格・相場スタブ)
- `tests/market-pricing.test.ts` — MKT-25(類似個体成約価格→重み付き平均/中央値・計算元込み・embedding OFF 経路)
- `tests/market-rating.test.ts` — MKT-27(good/normal/bad 集計・bad の reason 必須・低評価フィルタ 閾値 5/karma≤0/≤2★ 除外)
- `tests/market-ownership.test.ts` — MKT-29(成立→A個体をBへ移転・系譜連結・external フラグで非引継)
- `tests/market-fees.test.ts` — MKT-36(3%/8%/10% 各拠出算出・OSS 非商用=0・定数スナップショット凍結)

#### 5. クラスタ内実装順序

1. 基盤(依存なし): `economy-constants.ts`(§2.7)・`hmac.ts`・`policy.ts`+config 3 種。
2. schemas 10 種 + `codegen-schemas.mjs`(`--check` 緑化)。
3. 貢献度エンジン `contribution.ts`+`contribution-routes.ts`(KRM-10/11/12)。
4. PT/免罪符 `shop-routes.ts`(KRM-05)。
5. カルマ guard/BAN/救済 `ledger-routes.ts` MOD + `auth-routes.ts` MOD(KRM-06/04)+ 救済は §8 の batch へ。
6. GitHub webhook `github-webhook-routes.ts`(KRM-13)。
7. マーケット状態機械 `market-settlement.ts`+`market-routes.ts` MOD(MKT-01/02/03/06)。
8. 決済/税/手数料/所有権(MKT-04/10/29/36)。
9. 評価 `market-rating-routes.ts`(MKT-27)・テンプレ `market-template-routes.ts`(MKT-22)・価格/黄金フロー/送料 `market-pricing-routes.ts`(MKT-25/23/20)。
10. GMO FIFO `gmo-routes.ts` MOD(MKT-12)+ GMO webhook HMAC `gmo-webhook.ts`(MKT-14 関数+TC)。
11. 社会評価 `social-routes.ts`(KRM-20/25)・改善案 `proposal-routes.ts`(KRM-24)。
12. プロフィール/統合ステータス `profile-routes.ts`(KRM-21/16)。
13. cron 配線 `batch.ts`+`index.ts` scheduled+`wrangler.toml`(KRM-03/11/12・MKT-04/10)。
14. screen-defs 5 種。
15. 全 TC 緑化 → `npm run lint`(filename/generated/schema/frontmatter/ui-tokens 全 GATE)緑 → commit。

#### 6. 分母除外・停止報告(human-gate)

以下は AI が**完成品(関数・route・TC・投影)まで作り切る**が、実行系だけ人間ゲートで止める(不変条項④・キックオフ既定契約 2)。分母(自動検証カバレッジ)からは実鍵/実金銭/実昇格の**最終実施のみ**除外:

- **MKT-14 GMO 実 webhook 受信 / live 昇格 / 実入金確認** — `verifyGmoWebhookHmac`+parse+TC は納品。`/api/v1/gmo/webhook` route 配線・実 subscribe・`GMO_CONNECTOR_MODE=live` は GMO 本番契約+実鍵投入(人間ゲート)。権限分類器が金銭 API 実行を拒否する既知事象のため設計から実行系を除外。
- **MKT-12 実銀行 FIFO 消込の実測** — FIFO ロジック+TC は自動。live 口座の実入金に対する消込確定は実鍵(人間ゲート)。
- **KRM-25 公式デフォルト/本番への実昇格** — 投票集計・通知・昇格候補化まで AI。公式化ライン到達後の実 Promote は明示 Promote=人間ゲート(批評家指摘)。
- **KRM-16 GUI ノーコード CRUD** — policy table+resolver+CSV+統合ステータス画面は納品。GUI 編集フォーム実装は後波(本クラスタは append-only 履歴の読み取り投影まで)。

上記以外の可逆作業(状態機械・投影・cron 論理・BAN 判定=KRM-04 は可逆実装で公開ゲートでない)は承認を待たず進める。

#### K3 批評家指摘(実装時反映・verdict=pass)

1. **[minor]** §2.1 のスキーマ追加手順が不完全。新イベント10種の data スキーマを putEvent 時に実際に検証させるには、(a) scripts/codegen-validators.mjs の hardcoded SCHEMAS 配列(L35-51)への追記、(b) packages/truth/src/envelope.ts の hardcoded VALIDATOR_NAME マップ + EVENT_NAMES セットへの追記、(c) codegen-validators.mjs 再生成(validators.cjs)が必須。しかし設計は『node scripts/codegen-schemas.mjs(--check 緑化)』だけを指示している。codegen-schemas.mjs は TS 型を自動walk生成するだけで、バリデータは別スクリプト codegen-validators.mjs が hardcoded リストから生成する。設計どおりに実装すると新イベントは envelope.validateEnvelope の eventSchemaFor が null を返し data 検証がサイレントにスキップされる(例: mkt-rating の bad→reason 必須 が schema 層で効かない)。--check も新規未登録分は検出しないため GATE は赤にならず、スキーマ追加の目的(検証)が無効化される。
   - 反映: §2.1 の codegen 指示を修正: (1)『codegen-schemas.mjs(型)+ codegen-validators.mjs(バリデータ)両方を再生成し --check 緑化』と明記。(2) 実装ファイル計画に『envelope.ts の VALIDATOR_NAME/EVENT_NAMES と codegen-validators.mjs の SCHEMAS 配列へ新10種を登録(MODIFY)』を追加。この2ファイル編集を実装順序 §5 step2 に含める。
2. **[minor]** §2.2 の『route-matrix.csv(57行 frozen)は変更しない。上記 ver3 新規 route は同 CSV 未登録』が事実誤認。tests/fixtures/route-matrix.csv の route-030『/api/v1/market/transfer/{listing_id}』・route-031『/market/listings/{id}/match』・route-032『/market/listings/{id}/transition』は既に登録済(status=planned)。設計が MKT-02 で実装する transition route は未登録ではなく planned 既登録行に一致する。実害は小(CL-04 test は gate-before-routing で protected 行を実装/planned に関わらず 401 照合するため、planned 行を実装しても緑のまま。status vs 実装 の照合テストは存在しない)。
   - 反映: §2.2 の記述を『transition/match は route-matrix に planned 既登録(route-031/032)であり、実装しても CL-04 は 401 gate 照合のため緑を維持。CSV は変更不要(status 列と実装の照合テストは無い)』へ訂正。誤った『未登録』主張を削除し、実装者が『新規行追加が必要か』で迷わないようにする。
3. **[minor]** §0 の見出し『対象要件 ID 一覧(30 件・1 件も落とさない)』と本文『合計 29』『計 29 requirement(KRM 13 + MKT 16)』が矛盾。実カウントは KRM 13 + MKT 16 = 29 で、tc_map・正本 JSON も 29 件。見出しの『30 件』が誤り。
   - 反映: §0 見出しを『29 件』へ訂正。分母の食い違いは網羅チェックの信頼性を損なうため、確定値として 29 に統一する。

### K4 UI/UX+設定+i18n

> 実装エージェント向け正本。C2/C3/C4 の共通規約を全て引き継ぐ（`docs/planning/c2/design-c2.md` §4 の ScreenDef/Renderer/ThemePack、C4 の route/schema/TruthStore 慣行）。route span は `tests/fixtures/route-matrix.csv` infra-route-041〜051（凍結 57 行・行追加禁止）。参照レポート ID = REPORT-ver3-phase-c5-2026-07-11。
>
> **本版は批評家 4 指摘（major×3 + minor×1）反映の修正版。** 反映点は各節に「批評家修正」で明示: (1) I18-06 の `lang` 刻印に伴う mkt-listing schema 編集＋validators 再生成、(2) 投票冪等の機構統一（storage 409 を撤回し投影 dedup へ）、(3) 新イベント 4 種の write-time validation 配線（envelope.ts + codegen-validators.mjs）、(4) nav-reachability の到達ターゲットを実在 screen_id に確定。

#### 0. 対象要件ID一覧（13件・1件も落とさない）

V3-I18-06 / V3-I18-08 / V3-UIX-01 / V3-UIX-02 / V3-UIX-03 / V3-UIX-05 / V3-UIX-14 / V3-UIX-16 / V3-UIX-17 / V3-UIX-25 / V3-UIX-32 / V3-UIX-45 / V3-UIX-81。

各要件は「partial（既存実装あり→差分のみ）」「todo-code」「todo-tc」に分かれる。既に green のもの（UIX-17 単一 Renderer・UIX-81 の a11y 7状態/reduced-motion/44px/AA）は**再実装せず**、残差だけを本契約で埋める。

#### 1. 確定値

##### 1.1 route 表（全て protected = deny-by-default。`index.ts` の auth middleware が既にゲート。PUBLIC_ROUTES に足さない＝コード不要）

| # | method | path | access | handler(ファイル:関数) |
|---|--------|------|--------|------------------------|
| 041 | GET | /api/v1/me/preferences | protected | `settings-routes.ts: getPreferences`（projectPreferences 投影） |
| 042 | GET | /api/v1/me/settings | protected | `settings-routes.ts: getMeSettings`（preferences + account_meta 集約） |
| 043,050 | GET | /api/v1/settings | protected | `settings-routes.ts: getWorldSettings`（利用可能 locale 一覧・theme-pack 一覧・feature flags を都度算出） |
| 044,051 | PATCH | /api/v1/me/preferences | protected | `settings-routes.ts: patchPreferences`（`ihl.pref.set.v1` を append。UPDATE でなく追記＝不変条項③） |
| 045 | POST | /api/v1/settings/pii-session | protected | **本クラスタ非実装**（V3-SEC-07 の PII セッション限定保持＝別クラスタ。deny-by-default で 401 既定のまま。route-matrix は planned 据置） |
| 046 | GET | /api/v1/theme-packs | protected | `theme-routes.ts: listThemePacks`（built-in 2 パック + ユーザー fork） |
| 047 | GET | /api/v1/theme-packs/{pack_id} | protected | `theme-routes.ts: getThemePack`（tokens + 継承チェーン lineage[]） |
| 048 | POST | /api/v1/builder/canvas | protected | `theme-routes.ts: postCanvas`（UI/OS テンプレを node として保存/fork＝`ihl.ui.template.v1`。V3-UIX-45 + V3-UIX-17 残差「UI をノードとして保存/fork」を同一機構で充足） |
| 049 | POST | /api/v1/theme-packs | protected | `theme-routes.ts: postThemePack`（`ihl.theme.pack.v1` を append。fork = parent_pack_id 付き追記） |

**投票 route は新設しない**（matrix 57 行凍結）。like/platinum 投票は既存 `POST /events`（`index.ts:103`・append-only・provenance.actor_id をセッション principal で強制刻印済）へ `ihl.ui.vote.v1` を投げる。テンプレ/パック新規作成は 048/049、投票は /events の再利用。

**pack_id / template_id は client 任意 ULID（省略時サーバ `ulid()`）**＝`market-routes.ts` の listing_id 慣行と同型（`envelope.id = pack_id/template_id` に据える）。envelope.schema.json が `id` を ULID パターン `^[0-9A-HJKMNP-TV-Z]{26}$` で強制するため、これらは必ず ULID。同一 ULID 再 POST は putEvent の put-if-absent で **storage-enforced 409**（market と同じ・実機検証済 `docs/planning/c1/r2-put-if-absent-evidence.md`）。built-in パック id（`minimal-light`/`minimal-dark`）は ULID でないが**イベントでなく JSON ファイル直配信**なので envelope 検証を通らず、fork の `parent_pack_id` に built-in slug が入るのは data フィールド（lineage 終端）としてのみで問題ない。

##### 1.2 新イベント型（全て `schemas/events/` 配下・CloudEvents data 部・codegen で TS 型自動生成）

| type 名 | schema ファイル | data キー構造（`additionalProperties:false`） |
|---------|----------------|----------------------------------------------|
| `ihl.pref.set.v1` | `schemas/events/pref-set.schema.json` | pref_set_id, actor_id, locale?, theme_pack_id?, template_id?, reduced_motion_override?("system"\|"reduce"\|"no-preference"), created_at, schema_version |
| `ihl.theme.pack.v1` | `schemas/events/theme-pack.schema.json` | pack_id, actor_id, name, mode("light"\|"dark"), parent_pack_id?, tokens(色トークンのみ・下記 1.5 の 11 キー), created_at, schema_version |
| `ihl.ui.template.v1` | `schemas/events/ui-template.schema.json` | template_id, actor_id, name, level("default"\|"recommended"\|"custom"), parent_template_id?, theme_pack_id?, screen_overrides?(object: screen_id→ScreenDef 部分), social(object: author_name?), created_at, schema_version |
| `ihl.ui.vote.v1` | `schemas/events/ui-vote.schema.json` | vote_id, actor_id, target_kind("template"\|"pack"), target_id, vote_kind("like"\|"platinum"), created_at, schema_version |

**批評家修正(3) — write-time validation の配線を明示。** これら 4 schema は「置くだけ」では検証されない。`validateEnvelope`（`packages/truth/src/envelope.ts`）は `eventSchemaFor()` が返す名前のみ data を検証し、その名前集合は `EVENT_NAMES`（envelope.ts:46）と `VALIDATOR_NAME`（envelope.ts:16）の**手管理表**であり、precompiled validator の生成元 `SCHEMAS` 配列（`scripts/codegen-validators.mjs:35`）も**手管理の固定リスト**（再帰 walk ではない）。よって 3 箇所すべてに 4 種を登録し `node scripts/codegen-validators.mjs` を再実行しない限り、data は `additionalProperties:false`/enum を**素通り**する（lint も緑のまま no-op）。登録内容は §2 modify に列挙。負の TC（bad `mode`/余剰キー→400）で配線が実際に効くことを担保する。

**vote_id は ulid（envelope.id）**＝他イベントと同形。投票の 1 actor / 1 target / 1 kind 冪等は **storage 409 でなく投影 dedup で担保**（下記 1.3・批評家修正(2)）。

i18n メッセージカタログは**イベントでなく config data**：`schemas/i18n/catalog.schema.json`（`{ "$comment", "patternProperties": { "^[a-z0-9-]+\\.[a-z0-9-]+\\.[a-z0-9-]+$": {"type":"string"} } }` — キー形式 `{screen}.{component}.{field}` を schema で強制）。カタログ実体は `i18n/{locale}.json`（screen-defs と同じくデータ・Renderer が読む）。catalog schema は Truth event でないため envelope 検証対象外（`SCHEMAS` 配列にも入れない。`schemas/i18n/` を対象にする専用 GATE `check-i18n-keys.mjs` が構造検証を担う）。

design-tokens SSOT は `config/design-tokens.json`（要件文言は "design_token.yaml" だが **YAML パーサ dep を足さない**＝ponytail/不変条項①。repo は全て JSON 正本（schemas/screen-defs/i18n）なので JSON に統一。この逸脱は本節に明記）。schema なし（codegen が必須トークンキー存在を構造検証）。

##### 1.3 投影関数（都度再計算・常駐 DB 禁止＝不変条項①。台帳投影と同型の prefix scan + actor フィルタ）

- `settings-routes.ts: projectPreferences(store, actorId)` — `truth/ihl.pref.set.v1/` を prefix scan → actor 一致のみ → created_at/ULID で **last-write-wins** に畳み込み `{locale, theme_pack_id, template_id, reduced_motion_override}`。空なら既定 `{locale:"ja", theme_pack_id:"minimal-light", template_id:"default", reduced_motion_override:"system"}`。
- `theme-routes.ts: listThemePacks(store)` — built-in（`theme-packs/*.json` 読取）+ user fork（`ihl.theme.pack.v1` prefix scan）を結合。
- `theme-routes.ts: packLineage(store, packId)` — parent_pack_id を built-in 到達まで辿り lineage[] を返す（fork 系譜ツリー）。
- `theme-routes.ts: projectTemplateVotes(store, templateId)` — `ihl.ui.vote.v1` を target_id 一致で prefix scan し、**distinct (actor_id, target_id, vote_kind) タプルへ dedup してから** vote_kind 別に集計 `{likes, platinum}` + `usage_count`（`ihl.pref.set.v1` で当該 template_id を選んだ actor 数）→ `adoption_candidate = platinum>=ADOPTION_PLATINUM_THRESHOLD || usage_count>=ADOPTION_USAGE_THRESHOLD`。

**批評家修正(2) — 投票冪等の機構を統一（storage 409 を撤回）。** 旧版は「決定的キー `<actor>-<target_id>-<vote_kind>` を put-if-absent し二重投票 409」としていたが、投票は `POST /events`（putEvent 経由）を通り storage キーは `truth/ihl.ui.vote.v1/<envelope.id>.json`、envelope.id は ULID パターン必須。ハイフン決定的キーは envelope.id になれず（400 になる）、putEvent に明示キー引数は無く（putEventAt は POST /events が使わない）、再投票は毎回別 ULID で別キー化するため storage 409 は**構造的に発火しない**。よって冪等は**投影 projectTemplateVotes 側で distinct (actor,target,kind) 集合カウント**により担保する（1 actor が同一 target に同一 kind を複数回投げても票は 1）。route/matrix を触らず、"append-only + 投影で真実を再計算" の不変条項①/③に整合。TC は「二重投票後も likes/platinum が 1」を assert（409 を期待しない）。

##### 1.4 screen-defs 追加/変更（データのみ・コード追加は Renderer 拡張の最小限。全て新規テキストは text_key 参照＝直書き禁止 I18-08）

- 新規 `screen-defs/settings.json` — locale 選択(field select)・theme-pack 選択・reduced-motion 選択・現在値(source_path `/api/v1/me/preferences`)・PATCH 保存 form。section≤3/card≤3/末尾 next_step。
- 新規 `screen-defs/theme-gallery.json` — theme-pack 一覧(list bind `/api/v1/theme-packs`)・選択適用・fork ボタン（V3-UIX-14/16/45）。
- 新規 `screen-defs/ui-templates.json` — テンプレ一覧(level バッジ・social)・like/platinum 投票ボタン・fork・採用候補バッジ（V3-UIX-45）。
- 変更 `screen-defs/home.json` — **現在地カード**(card source_path `/api/v1/me/ledger`＝既存 route 再利用・karma/platinum の今日の状態)・**FeatureNode 入口**(観測 `/s/obs-domain-select`・個体 `/s/individual-detail`・テーマ `/s/theme-gallery`・UI テンプレ `/s/ui-templates`・設定 `/s/settings` link)・3ホップ超ターゲット用**ショートカットチップ最大2**（V3-UIX-25/02）。
- 変更 `screen-defs/{home,login,obs-domain-select,obs-entry,obs-detail,individual-detail,qr-resume}.json`（既存7）— literal 日本語を `text_key` へ機械変換。`i18n/ja.json` は変換元の現行文字列で seed → **描画結果はバイト同一**（既存 e2e 不変）。

##### 1.5 凍結定数（ハードコード散在禁止・1 ファイル集約）

- `apps/api/src/ui-constants.ts`：`TEMPLATE_LEVELS=["default","recommended","custom"]` / `VOTE_KINDS=["like","platinum"]` / `ADOPTION_PLATINUM_THRESHOLD=8` / `ADOPTION_USAGE_THRESHOLD=21` / `BUILTIN_THEME_PACK_IDS=["minimal-light","minimal-dark"]` / `DEFAULT_LOCALE="ja"` / `DEFAULT_TEMPLATE_ID="default"`。
- ThemePack 色トークン 11 キー（fork 対象＝色文明のみ。radius/tap/motion/font/fs-1..4 は全画面共通で pack 上書き対象外）：`bg, surface, surface-2, text, text-muted, border, primary, primary-text, focus, danger, danger-bg`。
- `apps/web/src/lib/i18n.ts`：`DEFAULT_LOCALE="ja"` + fallback チェーン順 `[<exact:ja-JP>, <lang:ja>, DEFAULT_LOCALE, key]`。要件例は "国別→言語別→en→key" だが本アプリ authored 言語＝日本語のため**完全カタログ層を ja に置く**（"en" が担う「必ず埋まる最終層」を ja が担う）。空白文言を出さない不変（＝要件の真意）を満たす。この逸脱は本節に明記。
- `scripts/check-ui-copy.mjs`：`FORBIDDEN_UI_WORDS=["未実装","WIP","準備中","工事中","近日公開","作成中","coming soon","TODO","FIXME"]`。

#### 2. 実装ファイル計画

**new（schema/codegen 起点）**
- `schemas/events/pref-set.schema.json` / `theme-pack.schema.json` / `ui-template.schema.json` / `ui-vote.schema.json`
- `schemas/i18n/catalog.schema.json`
- `config/design-tokens.json`（built-in 2 パックの色 SSOT）

**new（API）**
- `apps/api/src/ui-constants.ts`
- `apps/api/src/settings-routes.ts`（041-044,050,051 + projectPreferences）
- `apps/api/src/theme-routes.ts`（046-049 + listThemePacks/packLineage/projectTemplateVotes）

**new（web/データ）**
- `apps/web/src/lib/i18n.ts`（resolveMessage + MessagesCtx + fallback）
- `apps/web/src/lib/error-messages.ts`（`ApiError` class + `mapError(code)` code→日本語 + 汎用 fallback）
- `apps/web/src/lib/theme.ts`（`applyThemePack(tokens)`＝document root へ inline `--civ-*` セット＝リロード無し即反映 V3-UIX-45）
- `apps/web/src/lib/ugc-translate.ts`（端末側オンデマンド翻訳フック `translateOnDemand(text, viewerLocale)`＝既定 OFF・原文表示 + 明示押下で発火。常駐サーバ翻訳 API を叩かない＝I18-06。実体は端末 API プレースホルダ + 呼出契約のみ）
- `i18n/ja.json`（完全カタログ・seed）/ `i18n/en.json`（部分 overlay）
- `screen-defs/settings.json` / `theme-gallery.json` / `ui-templates.json`
- `apps/web/src/app/tokens.generated.css`（GENERATED・codegen 出力）
- `theme-packs/minimal-light.json` / `theme-packs/minimal-dark.json`（GENERATED・API 配信用 built-in パック）

**new（GATE scripts）**
- `scripts/check-ui-copy.mjs`（V3-UIX-01 禁止語 scan：screen-defs/** + apps/web/** + i18n/**）
- `scripts/check-screendef-structure.mjs`（V3-UIX-05 section≤3/card≤3/next_step 存在/text 3行以内）
- `scripts/check-i18n-keys.mjs`（V3-I18-08 欠落キー検知 + screen-defs 生 CJK 直書き検知）
- `scripts/codegen-theme-css.mjs`（V3-UIX-16 `config/design-tokens.json` → `tokens.generated.css` + `theme-packs/*.json`。`--check` 対応）

**modify**
- `packages/truth/src/envelope.ts`（**批評家修正(3)**：`VALIDATOR_NAME` に `"pref-set":"prefSet"`,`"theme-pack":"themePack"`,`"ui-template":"uiTemplate"`,`"ui-vote":"uiVote"` を追加、`EVENT_NAMES` に `"pref-set","theme-pack","ui-template","ui-vote"` を追加。これで `validateEnvelope`→`eventSchemaFor` が 4 種の data を検証する）
- `scripts/codegen-validators.mjs`（**批評家修正(3)**：`SCHEMAS` 配列に `["prefSet","events/pref-set.schema.json"]`,`["themePack","events/theme-pack.schema.json"]`,`["uiTemplate","events/ui-template.schema.json"]`,`["uiVote","events/ui-vote.schema.json"]` を追加。追加後 `node scripts/codegen-validators.mjs` を実行し `validators.cjs` を再生成＝逆流禁止・GENERATED。`--check` が緑になることを確認）
- `schemas/events/mkt-listing.schema.json`（**批評家修正(1)**：`properties` に `"lang": {"type":"string","description":"UGC 原文の作者言語タグ（BCP-47・actor locale 由来）。翻訳はしない＝I18-06。"}` を追加。`additionalProperties:false` は維持。mkt-listing は `EVENT_NAMES` 登録済で `validateEnvelope` が data を検証するため、schema に lang を足さずに market-routes で刻印すると POST /market/listings が全件 400 INVALID_LISTING に回帰する。schema 追記後 `node scripts/codegen-validators.mjs` で `mktListing` validator を再生成し、既存 market POST/list テストが緑維持を確認）
- `apps/api/src/index.ts`（`app.route("/api/v1", settingsRoutes)` / `app.route("/api/v1", themeRoutes)` 追記。PUBLIC_ROUTES 変更なし）
- `apps/api/src/market-routes.ts`（出品 data に `lang` を actor の locale から刻印＝UGC 原文言語タグ・V3-I18-06。翻訳はしない。locale は `projectPreferences(store, actorId).locale`（未設定は DEFAULT_LOCALE="ja"）を再利用）
- `apps/web/src/renderer/renderer.tsx`（(a) `text_key` 解決を heading/text/button label/field label に追加 (b) ListNode/CardNode の **empty 状態** `props.empty_text` (c) defaultExecute を `ApiError(code)` throw に変更・ButtonNode/FormNode の error 表示を `mapError` 経由 (d) `props.draft` で **草案バッジ** span 描画 (e) UGC text field に翻訳アフォーダンス（`ugc-translate.ts` フック呼出・既定 OFF・原文表示））
- `apps/web/src/renderer/types.ts`（node props に text_key/empty_text/draft/next_step/ugc の型注釈追記・schema と同期）
- `schemas/screendef/screendef.schema.json`（node の `props` は additionalProperties:true のため schema 変更不要。action の PATCH は既に enum 済で対応不要を確認）
- `apps/web/src/app/globals.css`（token :root ブロックを `@import "./tokens.generated.css"` に置換し手書き token 撤去。component クラス層は残置。`.civ-draft-badge` / `.civ-empty` クラス追加）
- `scripts/check-ui-tokens.mjs`（TOKEN_FILES 免除に `apps/web/src/app/tokens.generated.css` と `theme-packs/**` を追加＝トークン定義データは生 hex が正）
- `scripts/check-contrast.mjs`（token ブロック読取元を `globals.css` → `tokens.generated.css` に変更）
- `package.json`（lint チェーンに codegen-theme-css --check・check-ui-copy・check-screendef-structure・check-i18n-keys を追加。`codegen-validators --check` は既存チェーンにあり 4 種追加を自動検査）

#### 3. TC 計画（テストファイル + ケース・要件ID対応）

- `tests/settings-preferences.test.ts`（**I18-08/UIX-16**）：PATCH で pref-set append→GET /me/preferences が LWW 反映 / 本人スコープ（他人 pref 不可視）/ 未設定時の既定値 / GET /settings が locale・pack 一覧を返す / **負の validation**（PATCH に `reduced_motion_override:"bogus"` 等の enum 外 or 余剰キー → 400・批評家修正(3) の配線が効くこと）。
- `tests/theme-packs.test.ts`（**UIX-14/16**）：GET /theme-packs が built-in 2 + user fork / POST /theme-packs fork→parent_pack_id 系譜 / GET /theme-packs/{id} が lineage[] を built-in まで返す / 同一 pack_id(ULID) 二重 POST 409（storage put-if-absent）/ **負の validation**（`mode:"blue"` 等 enum 外 → 400・批評家修正(3)）。
- `tests/theme-codegen.test.ts`（**UIX-16**）：`config/design-tokens.json`→`tokens.generated.css`+`theme-packs/*.json` の codegen が冪等（--check 一致）/ 生成 CSS が :root light/dark/data-theme 4 ブロックを含む / 逆流なし（生成物手編集を check-generated が検知）。
- `tests/ui-template.test.ts`（**UIX-45/17**）：POST /builder/canvas で template append（UI-as-node 保存）/ fork→parent_template_id 系譜 / like/platinum 投票（/events 経由）で projectTemplateVotes 加算 / **同一 (actor,target,kind) の二重投票後も likes/platinum が 1（投影 dedup 冪等・409 を期待しない＝批評家修正(2)）** / 閾値到達で adoption_candidate=true。
- `tests/i18n-ugc.test.ts`（**I18-06**）：market listing POST で description が**原文のまま**保存されサーバ翻訳が走らない不変（保存 data.description === 入力・data.lang == actor locale）。**前提**: mkt-listing schema に lang 追加済（批評家修正(1)）で POST が 201・既存 market テスト緑維持。
- `apps/web/src/lib/i18n.test.ts`（**I18-08**）：fallback チェーンが exact→lang→ja→key で解決し**空文字を返さない**（未対応 locale でも ja 文言）。
- `apps/web/src/lib/error-messages.test.ts`（**UIX-03**）：`mapError("409")`=競合日本語 / 未知コード=汎用 fallback / raw "api 409" を露出しない。
- `apps/web/src/renderer/renderer.test.tsx`（modify・**UIX-03/01/81/17**）：list 0 件で empty_text 描画（"写真なし" 系の正直な空）/ 401・403・409 が日本語表示 / text_key が MessagesCtx 経由で解決 / `props.draft` で「草案」バッジ描画（role/aria 維持）/ 全 **10** screen-def が単一 Renderer で描画。既存 7-state/reduced-motion/44px TC は不変で維持。
- `tests/check-ui-copy.test.ts`（**UIX-01**）：`scanCopy()` が禁止語混入 screen-def/tsx を検出（positive）・正常文言は 0（negative）。
- `tests/check-screendef-structure.test.ts`（**UIX-05**）：section>3 / card>3 / next_step 欠落 / text 4 行以上を各々検出、全 screen-def が現行構造で PASS。
- `tests/check-i18n-keys.test.ts`（**I18-08**）：screen-def 参照キーが ja.json に無いと fail / screen-def の props.text に生 CJK 直書きを検出。
- `tests/nav-reachability.test.ts`（**UIX-02/25**）：全 screen-def の transitions[] + navigate action をグラフ化し BFS。**批評家修正(4) — 到達ターゲットは本クラスタ実在 10 screen-def の screen_id に確定**：観測保存→`obs-detail` / 設定→`settings` / テーマ変更→`theme-gallery` / UI テンプレ選択→`ui-templates`。いずれも home から ≤3 クリック・超過 0 を受入。**market/gmo/lottery 画面は本クラスタに screen-def を持たない（別クラスタ）ため本 TC の到達ターゲットに含めない**（screen-def 追加時に各クラスタで自 reachability を検証）。
- `e2e/ugc-translate.spec.ts`（**I18-06**）：閲覧者 locale=en で UGC カードに「翻訳」アフォーダンスが出て、押下時に**端末側オンデマンド**翻訳フック（`ugc-translate.ts`）が呼ばれる（常駐サーバ翻訳 API を叩かない＝ネットワークに翻訳リクエストが出ないことを assert）。

#### 4. クラスタ内実装順序

1. schema 4 種 + i18n catalog schema + mkt-listing lang 追記 →（**批評家修正(1)(3)**）`packages/truth/src/envelope.ts`（VALIDATOR_NAME + EVENT_NAMES に 4 種登録）・`scripts/codegen-validators.mjs`（SCHEMAS に 4 種追加）を編集 → `node scripts/codegen-validators.mjs` + `npm run codegen`（validators.cjs + TS 型再生成・逆流禁止）。`codegen-validators --check` 緑を確認。
2. `ui-constants.ts`・`lib/i18n.ts` DEFAULT_LOCALE。
3. `config/design-tokens.json` + `codegen-theme-css.mjs` → `tokens.generated.css`・`theme-packs/*.json`。`check-ui-tokens`(免除追加)・`check-contrast`(参照元変更)・`globals.css`(@import 化) を同時に緑化。lint チェーン配線。（UIX-16）
4. API：`settings-routes.ts`・`theme-routes.ts` + `index.ts` 配線。`market-routes.ts` に lang 刻印（projectPreferences で locale 取得）。（UIX-14/16/45/17・I18-06 part1）
5. i18n：`i18n/ja.json`(既存7から seed)・`en.json` overlay・`lib/i18n.ts` resolver + MessagesCtx。既存 7 screen-def を text_key へ変換。`check-i18n-keys.mjs` 配線。（I18-08）
6. Renderer 拡張：text_key 解決 / empty_text / `lib/error-messages.ts` + error mapping / draft バッジ / `globals.css` バッジ・empty クラス。（UIX-03/01/81 draft）
7. web データ：`lib/theme.ts` 即反映 + 新 3 screen-def（settings/theme-gallery/ui-templates）+ home.json 現在地カード/FeatureNode/チップ。（UIX-25/45/14/16）
8. GATE：`check-ui-copy.mjs`・`check-screendef-structure.mjs` 実装 + lint 配線。（UIX-01/05）
9. UGC 閲覧側：`lib/ugc-translate.ts` 端末オンデマンド翻訳フック（既定 OFF・原文表示 + 翻訳アフォーダンス）+ Renderer の UGC field 規約（`lang` 既定継承）。（I18-06 part2）
10. 全 TC + `nav-reachability`(UIX-02) + e2e。`npm run lint && npm test && pytest -q` 全緑を実測してから commit。

#### 5. 分母除外・停止報告（human-gate / 別クラスタ）

- **V3-UIX-45（テンプレ/パック共有の「公開実施」）**：fork・投票・使用率集計・即反映は全て自動実行（可逆）。ただし他ユーザーへ**公開する/公開解除する**判断は人間ゲート「公開の実施」。共有機能の骨格までを本クラスタで作り、公開トグルの実行は停止報告。→ tc_map で automatable=false。
- **V3-UIX-32（採用 OSS の GPL/AGPL ライセンス実適合判定）**：Next.js15+ScreenDef 採用・shadcn/ui 不採用（ScreenDef+civ-catalog へ置換）の方針は本契約で明文化済。掲示板 5ch 型テンプレ/tldraw 等の OSS 実導入とその license-scan は**知の広場 PROTECTED クラスタ**（本クラスタ対象外）。ライセンス実適合は設計レビュー人手。→ automatable=false。
- **V3-UIX-81（重要文書の多媒体マトリクス：法的版/小5版×読み上げ/動画×字幕）**：Renderer 共通層 a11y（7状態/reduced-motion/44px/aria/AA）は実装+TC 済で本クラスタ完了。多媒体マトリクスは **V3-SEC-21/22・V3-VID-23（SEC/VID クラスタ）**接続で本クラスタ範囲外。→ automatable=false（本クラスタ内では既存 render TC が green）。
- **V3-I18-06（常駐サーバ翻訳の不採用）**：閲覧側翻訳は**端末側・オンデマンド・既定 OFF**（`lib/ugc-translate.ts`）に限定（常駐翻訳 API は不変条項①違反）。設計制約として固定。UGC 共有テキストの公開/公開解除は人間ゲート「公開の実施」。
- 実鍵/本番鍵・金銭・物理治具・撤回台帳の人間ゲートは本クラスタに**該当なし**。

#### K4 批評家指摘(実装時反映・verdict=fail)

1. **[major]** I18-06 lang stamping breaks market POST. §2 tells the implementer to stamp `lang` into the market listing data in market-routes.ts, but omits editing schemas/events/mkt-listing.schema.json. That schema has `additionalProperties:false` and IS enforced: `mkt-listing` is in envelope.ts EVENT_NAMES, so validateEnvelope validates data against it before putEvent writes. Adding `lang` therefore makes every POST /market/listings return 400 INVALID_LISTING — regressing existing green market tests AND failing the new i18n-ugc.test.ts assertion `data.lang == actor locale`.
   - 反映: Add `lang` (string) to mkt-listing.schema.json properties, then regenerate validators (node scripts/codegen-validators.mjs) and codegen TS types. List both the schema edit and the validators.cjs regen in §2. Keep additionalProperties:false but include lang. Verify existing market POST/list tests stay green.
2. **[major]** Vote idempotency is self-contradictory and unachievable as specified. §1.1 routes like/platinum votes through the existing POST /events, which calls putEvent(body) → stores at truth/<type>/<envelope.id>.json, and envelope.schema.json REQUIRES envelope.id to match the ULID pattern ^[0-9A-HJKMNP-TV-Z]{26}$. §1.3 demands a deterministic key `<actor>-<target_id>-<vote_kind>` + put-if-absent 409, and ui-template.test.ts asserts 1-actor/1-target/1-kind → 409. A deterministic hyphenated key cannot be envelope.id (fails ULID pattern → 400), and putEvent offers no explicit-key path (only putEventAt does, which POST /events does not use). Re-votes get fresh ULIDs → distinct storage keys → no 409 ever fires.
   - 反映: Pick one consistent mechanism: (a) de-dupe votes in the projection projectTemplateVotes by (actor,target,kind) last-write-wins and DROP the 'put-if-absent 409' claim + its TC; or (b) give votes a dedicated putEventAt path keyed truth/ihl.ui.vote.v1/<actor>-<target>-<kind>.json — but that needs a route/handler that POST /events doesn't provide and must reconcile with the 'no new route / matrix frozen' rule. Do not promise storage-enforced 409 through POST /events.
3. **[major]** The 4 new event data schemas are never wired into write-time validation. envelope.ts (VALIDATOR_NAME map + EVENT_NAMES set) and scripts/codegen-validators.mjs (SCHEMAS array) are hand-maintained — the validators.cjs generator uses a fixed list, NOT the recursive walk that codegen-schemas.mjs uses. §2's modify list omits both files, and §4 step 1 claims `npm run codegen` suffices. It does not: with the new schemas absent from the SCHEMAS array, validators.cjs is unchanged, codegen-validators --check stays green (lint passes), and pref-set/theme-pack/ui-template/ui-vote data (additionalProperties:false, enums mode/level/vote_kind/target_kind) is written WITHOUT validation — the stated schema enforcement silently no-ops.
   - 反映: Add `packages/truth/src/envelope.ts` (register the 4 names in VALIDATOR_NAME + EVENT_NAMES) and `scripts/codegen-validators.mjs` (4 entries in the SCHEMAS array) to §2 modify, then run codegen and add a negative TC (e.g. bad `mode`/extra key rejected 400) so the wiring is actually exercised — otherwise no gate proves the schemas are enforced.
4. **[minor]** nav-reachability TC (UIX-02/25) targets screens with no screen-def. §3 lists BFS targets '取引 ui-templates 相当 market' and 'GMO transfer-code 相当', but §1.4 adds only settings/theme-gallery/ui-templates screen-defs (no market, no gmo screen-def). If the test literally requires reaching a `market` or `gmo` node, the graph has no such node and BFS fails; the '相当' hedge leaves the implementer guessing which existing screen proxies each target.
   - 反映: Name the exact screen_id each導線 target maps to in the current 10 screen-defs (e.g. 取引→ui-templates, GMO→<existing screen or explicitly out-of-scope>), or drop targets that have no screen-def in this cluster so the reachability assertion is unambiguous.

### K5 論文/研究+wiki/知識

> 計画正本: 開発計画 §3.1 C5 / 01-requirements/registry.json（V3-PPR-*・V3-WIK-*）。C2〜C4 の共通規約を全て引き継ぐ。コミット参照 ID = REPORT-ver3-phase-c5-2026-07-11。
> **本クラスタは frozen スキーマを一切変更しない**（不変③・CL 凍結安全）。既存資産（TruthStore append-only / envelope / 投影=prefix scan 都度再計算 / cosineSimilarity@`@ihl/truth` / 台帳付与関数 / observation-routes 検索梯子 / components/wiki-ingest ruri backend）を最大再利用し、車輪を再発明しない。

#### 0. 設計方針（不変条項の当クラスタ具体化）

- **共通 CMS 基盤に集約（WIK-16 の明文要求）**: 論文/記事/ブログ/チャットログ/新聞を単一イベント `ihl.research.content.v1` + `content_type` enum で兼用。paper だけが `sections`(PaperSectionsV1 6 節) と `conditions`(条件P JSON) と `claims` を持つ。エンティティ乱立を避ける。
- **常駐 index を作らない（不変①・WIK-13 の実装解釈）**: 「投稿=検索可能」「R2 索引自動更新」は *維持型二次インデックスを持たない*ことで満たす。content イベントを type prefix に append した瞬間、prefix scan 投影がそれを拾う ＝ append それ自体が索引更新。observation-routes の検索梯子と同じ都度再計算。
- **PPR-09 は frozen provenance を触らない**: `committed_at = envelope.time`（既存）、`observed_at = data.observed_at`（content 非 frozen スキーマの新フィールド）、measurement 行の source は frozen `provenance.value_origin` の **enum 値を参照**（列挙を再定義しない）。reanalysis-manifest / bundle / scale sheet は永続化せず**投影関数**。`client_content_digest` は content data の任意フィールドとして*定義のみ*（statement「ver1 未配線」— 計算は v2）。→ frozen 変更ゼロ・CL-02 完全安全。
- **タグの target は既存 enum を流用**: frozen tag-event の `target_type` enum に "content" は無い。content へのタグは `target_type="cross"` + `target_id=content_id` を用いる（cross バケットは既存）。frozen 変更を回避。
- **LLM・embedding 計算は既定 OFF（不変①）**: Paper Match/gap/tag suggest/wiki 蒸留/新聞の中核は決定論。LLM 助言・ruri 実埋め込みは明示トグル + 実 API/モデル（人間ゲート「実鍵投入」）。ベクトルは components/wiki-ingest でオフライン生成し embedding-manifest(frozen) として置かれた前提で TS 側は読むだけ。

#### 1. 対象要件 ID 一覧（14 件・全件本契約でカバー）

V3-PPR-01, V3-PPR-03, V3-PPR-06, V3-PPR-09, V3-PPR-13, V3-PPR-16, V3-PPR-17, V3-PPR-18, V3-PPR-30（PPR 9 件）、V3-WIK-01, V3-WIK-13, V3-WIK-14, V3-WIK-16, V3-WIK-17（WIK 5 件）。計 14 件（正本 c5-cluster-k5.json エントリ数と一致）。全 14 件が §2.1 route 表・§4 tc_map に出現し網羅漏れなし。

#### 2. 確定値

##### 2.1 route 表（全て `/api/v1` 配下・access=protected［deny-by-default: PUBLIC_ROUTES に載せない］・書込は data.actor_id をセッション principal 強制刻印 V3-AUT-17）

| method | path | handler(module.fn) | 要件 |
|---|---|---|---|
| POST | `/research/content` | research-content-routes.createContent | WIK-16, PPR-03, PPR-30 |
| GET | `/research/content` | research-content-routes.listContent | WIK-16, WIK-13 |
| GET | `/research/content/:id` | research-content-routes.getContent | WIK-16, PPR-03 |
| POST | `/research/content/:id/tags` | research-content-routes.addTag | WIK-14 |
| POST | `/research/content/:id/tags/suggest` | research-content-routes.suggestTags | WIK-14 |
| POST | `/research/search` | research-content-routes.unifiedSearch | WIK-13, WIK-14 |
| POST | `/research/shared` | research-content-routes.receiveShared | WIK-17 |
| GET | `/research/chat-index` | research-content-routes.chatIndex | WIK-17 |
| POST | `/research/paper-match` | paper-match-routes.paperMatch | PPR-01, PPR-30 |
| POST | `/research/gap` | paper-match-routes.gap | PPR-06 |
| POST | `/research/content/:id/hypothesis` | paper-match-routes.appendHypothesis | PPR-01 |
| POST | `/research/projects` | project-routes.createProject | PPR-16 |
| GET | `/research/projects` | project-routes.listProjects | PPR-16 |
| GET | `/research/projects/:id` | project-routes.projectHub | PPR-16 |
| POST | `/research/projects/:id/versions` | project-routes.branchVersion | PPR-16 |
| GET | `/research/projects/:id/best-version` | project-routes.bestVersion | PPR-16 |
| POST | `/research/citations` | project-routes.createCitation | PPR-18 |
| GET | `/research/content/:id/reanalysis-manifest` | project-routes.reanalysisManifest | PPR-09 |
| GET | `/research/content/:id/bundle` | project-routes.bundle | PPR-09 |
| POST | `/research/canonical/mapping` | research-canonical-routes.addMapping | PPR-13 |
| GET | `/research/canonical/mapping/:qid` | research-canonical-routes.getMapping | PPR-13 |
| POST | `/research/categories` | research-canonical-routes.addCategory | PPR-13 |
| GET | `/research/categories` | research-canonical-routes.categoryTree | PPR-13 |
| POST | `/research/tasks` | research-agent-batch.createTask | PPR-17 |
| GET | `/research/tasks` | research-agent-batch.taskTree | PPR-17 |
| POST | `/research/agent/run` | research-agent-batch.runBatchOnce | WIK-01, PPR-17 |
| GET | `/research/newspaper` | research-agent-batch.latestNewspaper | PPR-17 |
| GET | `/research/wiki/:node_id` | research-agent-batch.getWikiNode | WIK-01 |

`POST /research/agent/run` は日次蒸留 + タスク生成 + 新聞生成の**単発手動トリガ**（TC・手動運転用）。**Cron 定期配線（scheduled ハンドラの実 trigger 有効化）は §6 の人間ゲート**。

##### 2.2 新イベント型（schemas/events/ 新設・7 スキーマ・JSON Schema 2020-12・additionalProperties:false・codegen で TS 型を出す＝逆流禁止）

すべて `dataschema` を各スキーマに向け、envelope(frozen 不変)に載せて `putEvent`/`putEventAt` で append。Truth キーは `truth/<type>/<id>.json`（型 prefix scan 投影）。冪等キー = 各エンティティ ID → 二重 put は storage 層 put-if-absent で 409。

> **決定論エンティティ ID と envelope.id の分離（実装契約・obs-photo と同一パターン）**: `citation_id`/`task_id`/`wiki_node.node_id`/`mapping_id` 等の `sha1(...)` 由来決定論キーは **`putEventAt` の storage key（`truth/<type>/<id>.json` の `<id>`）としてのみ使う**。frozen envelope.schema.json は `envelope.id` を `^[0-9A-HJKMNP-TV-Z]{26}$`(ULID) に強制するため、**`envelope.id` は毎回 `ulid()` で新規採番する**（sha1 hex 40字は ULID 不適合で検証に弾かれる）。冪等性・二重 put 409 は storage-key put-if-absent が担保し、envelope.id とは無関係。実装者が `envelope.id=sha1` と設定してはならない。

**検証マップの同期（必須配線・批評家 major 反映）**: 7 新スキーマの inner data 検証は `validateEnvelope→eventSchemaFor` が名前を返した時のみ走り、それは `packages/truth/src/envelope.ts` の `EVENT_NAMES` Set + `VALIDATOR_NAME` マップ（手書き）への登録が前提。さらに `scripts/codegen-validators.mjs` の `SCHEMAS` 配列（ハードコード・「Must stay in sync with envelope.ts」注記付き）を回して `validators.cjs` を再生成しないと validator 本体が生成されない。**この 2 ファイルへの 7 件追加を §3 modify に明記**（下記）。未配線だと envelope 外側パターン(`type=^ihl\.…\.v[0-9]+$`)は通るが inner data が無検証で putEvent が任意データを受理し、PPR-03 の paper-sections.test.ts が putEvent 経路で成立しない。check-generated lint はハードコード同士の byte 比較なので欠落を検知しない。

1. **`ihl.research.content.v1`** — `schemas/events/content.schema.json`。キー構造 `truth/ihl.research.content.v1/<content_id>.json`。
   必須: `content_id, actor_id, content_type, title, created_at, schema_version`。`content_type` enum=`["article","blog","paper","chat_log","newspaper"]`。任意: `body_markdown`（article/blog/chat_log）、`cited_paper_ids[]`、`cited_session_ids[]`（引用・WIK-16／別途 citation イベントで append-only 記録もする）、`project_id`（PPR-16 集約キー）、`individual_id`（ブログ個体紐付け）、`client_content_digest`（canonical SHA-256・**定義のみ v1 未計算**）、`observed_at`(date-time・PPR-09 観測時刻＝committed_at=envelope.time と分離)、`system_tags[]/ai_tags[]/user_tags[]`（3 層タグの初期スナップショット・正本は tag-event）。
   paper 専用: `sections`（オブジェクト・キー=PAPER_SECTIONS 6 種・各 `{filled:bool, text:string}`）、`completeness_pct`(0–100)、`conditions`（条件P: `{key:{min?,max?,eq?,required:bool,unit?}}`）、`claims[]`（`{claim_id, statement, status:"hypothesis"|"evidenced", evidence_refs[]}`）、`measurements[]`（各 `{item, value, unit, value_origin, observed_at}`・value_origin は frozen enum 値）。文体スキンは content に埋めず `skin_id` 参照のみ（構造/文体分離・PPR-03）。
2. **`ihl.research.citation.v1`** — `schemas/events/citation.schema.json`。キー `truth/ihl.research.citation.v1/<citation_id>.json`（`citation_id`=canonical: `sha1(content_id|provider_actor_id|source_session_id)`。storage key として使用・envelope.id は別途 ulid()）。`content_id`, `provider_actor_id`, `source_session_id`, `contribution_points`(int≥0), `anonymous`(bool), `match_snapshot`(充足キー列), `status` enum=`["provided","updated"]`, `created_at`, `schema_version`。不足キー充足時の更新は status=updated の**別イベント append**（UPDATE 禁止）。
3. **`ihl.research.project.v1`** — `schemas/events/project.schema.json`。キー `truth/ihl.research.project.v1/<project_id>.json`。`project_id, actor_id, title, created_at, schema_version`；任意 `parent_project_id`(Ver 分岐)、`parent_version_label`、`lots[]`(`{lot_id, qr_url}`)、`links[]`, `contributors[]`。version 分岐は parent_project_id を持つ新 project row（別スキーマ不要）。
4. **`ihl.research.mapping_event.v1`** — `schemas/events/mapping-event.schema.json`。キー `truth/ihl.research.mapping_event.v1/<qid>__<target_db>.json`（Q番号+対象DB 合成キー→同一対応再 put=409 append-only。storage key・envelope.id は ulid()）。`mapping_id, wikidata_qid, target_db, target_id, domain, created_at, schema_version`。`target_db` は §2.5 DOMAIN_API_MAP の値。
5. **`ihl.research.category.v1`** — `schemas/events/category.schema.json`。キー `truth/ihl.research.category.v1/<category_id>.json`。`category_id, actor_id, label, domain, parent_category_id?, created_at, schema_version`。ユーザー追加可能な学術分類階層（亜種・重複防止のため domain を必須・親子で木構成）。
6. **`ihl.research.task_node.v1`** — `schemas/events/task-node.schema.json`。キー `truth/ihl.research.task_node.v1/<task_id>.json`（`task_id`=**決定論キー**: `sha1(source_kind|source_ref|normalized_question)` → 同一 limitations 入力で同一ノード・冪等。storage key・envelope.id は ulid()）。`task_id, question, source_kind` enum=`["limitation","next_question","data_gap","failure_cluster","complaint_cluster"]`, `source_ref`, `difficulty` enum=`["beginner","intermediate","researcher"]`, `priority`(0–100), `program_id?`, `created_at, schema_version`。program は task_node に `program_id`（goals/milestones/dependencies を持つ別 task_node type=program）で束ねる。
7. **`ihl.research.wiki_node.v1`** — `schemas/events/wiki-node.schema.json`。キー `truth/ihl.research.wiki_node.v1/<node_id>.json`（`node_id`=**決定論キー**: `sha1(level|scope_ref|content_hash)` → 同一入力で同一ノード append-only。storage key・envelope.id は ulid()）。`node_id, level` enum=`["board_summary","big_wiki"]`, `scope_ref`(掲示板ID/論文ID), `summary_markdown`, `source_event_ids[]`, `created_at, schema_version`。日次蒸留は掲示板要約(board_summary)の上に大 Wiki(big_wiki)を積む階層。新聞は content_type=newspaper で content に格納（別スキーマ不要）。

タグは**新スキーマを作らず** frozen `tag-event.schema.json` を再利用。envelope type=`ihl.research.tag_event.v1`・dataschema=`schemas/frozen/tag-event.schema.json`・`target_type="cross"`・`tag_type ∈ {system,ai,user}`・`source_type ∈ {ui,ai,user}`。

##### 2.3 投影関数（都度再計算・純関数・常駐 DB なし）

- **`matchConditions(conditionsP, observationJson)`**（paper-match）→ `{satisfied[], missing[], violated[], required_count, match_rate}`。`required:true` のキーのみ分母。`satisfied`=required かつ観測が min/max/eq を満たす。`violated`=観測が範囲外。`missing`=required だが観測に無い。`match_rate = satisfied.length / required_count`（required_count=0 なら 1.0）。**PPR-30 Stage1 機械検査＝この関数を事前妥当性チェックに使う**（同一実装再利用）。
- **`autoFillDescriptor(templateSections, observationEvents)`**（paper-match / PPR-30）→ 観測イベントを節に投影して穴埋め。充足キー → 対応 claim の `evidence_refs` に自動リンク・`status="evidenced"`。未検証 claim は `status="hypothesis"` 固定。
- **`gapAnalysis(paper, neighbors, observationJson?)`**（paper-match / PPR-06）→ `{data_gap[], semantic_gap[], missing_perspectives[]}`。data_gap = required 条件キー − 観測キー。semantic_gap = 近傍論文(cosineSimilarity 上位)の conditions キー ∪ − 当該 paper キー（差分軸）。missing_perspectives = 両者統合し温度/湿度/餌量/密度/failure_case/ethics/cost 等の**欠観点ラベル**を安定列挙（capture_id/key 名昇順ソートで決定論）。**全種族横断**=近傍探索で species フィルタを掛けない。ベクトル無ければ data_gap のみ返す（embedding OFF でも動く）。
- **`projectHub(store, projectId)`**（project）→ project + 集約: paper/blog(content.project_id)・citation・market listing・observation(subject_ref)・task_node を projectId で束ねた投影。
- **`bestVersion(store, projectId)`**（project / PPR-16）→ Ver 別・lot 別に観測を集計（成長指標平均等の決定論スコア）→ 最高スコア Ver/lot を選定。同点は version_label 昇順。
- **`reanalysisManifest(store, contentId)`**（project / PPR-09）→ content が引用する観測/計測イベントから**事実キーのみ**（`imageR2Key, scaleTemplateId, bpcmsEngineProfile, run_id, input_hash`）を集約。**画像バイナリ非含**。同一 imageR2Key/scaleTemplateId → 同一マニフェスト（決定論）。`bundle(store, contentId)` は manifest + sections + measurements(value_origin 付) を 1 束にした投影。
- **`unifiedSearch(store, query)`**（WIK-13/14）→ 4 本柱を prefix scan で合成: fulltext(title/body 部分一致)・tag(tag-event 集計)・user(actor_id)・node(content_id/type)。type/tags フィルタ + 任意 query_vector で embedding 類似（observation-routes と同じ cosineSimilarity・OFF 既定）。**RAG 優先度順** §2.5 RAG_PRIORITY で並べる。決定論: content_id 昇順・スコア同点は content_id。
- **`suggestTags(content)`**（WIK-14）→ 決定論抽出（本文トークン頻度 or 任意 embedding 近傍タグ）で **ai_tags 最大 10**。**非永続**（提案のみ）。ユーザーが `addTag` で確認 POST した時にのみ tag_event append。→ AI が人間タグを上書きしない。
- **`chatIndex(store)`**（WIK-17）→ content_type=chat_log を prefix scan → 全文/タグ/時系列（created_at 降順）索引投影。
- **`generateTaskNodes(store)` / `distillWiki(store)` / `generateNewspaper(store)`**（agent-batch）→ limitations/next_questions/data_gap/失敗クラスタ/愚痴クラスタ → 決定論キーで task_node append（同一入力→同一ノード）。掲示板/論文 → board_summary → big_wiki 階層 append。全新規ノードスキャン → newspaper(content) append。全て append-only・LLM 助言はトグル OFF 時スキップ。

台帳連携（PPR-18・批評家 major 反映）: 観測 append 時のカルマ付与フックは C4 で保留された配線 — **本クラスタで citation 生成時に `grantPlatinum(s, actorId, amount, "contribution_rebate")`（ledger-routes.ts 既存関数）のみを呼ぶ**（貢献ポイント→プラチナ報酬）。`amount = contribution_points`（既定 `CONTRIBUTION_POINTS_PER_CITATION`）。**`grantKarmaCountIncrease` は呼ばない** — 同関数はカルマ count(=違反回数)を進め fibPenalty を value 層に -penalty で append する**懲罰関数**（reason_code=dispute/fee_unpaid 等）であり、貢献者を減点し PPR-18『貢献ポイント付与』の意図と正反対になる。この台帳に正の count 報酬関数は存在しないため、正の報酬は grantPlatinum に一本化する。付与関数は再利用し再実装しない。

##### 2.4 screen-defs 追加（screen-defs/*.json・Renderer 再利用・コード追加ゼロ・node type は既存 12 種 enum のみ・「未実装/WIP」表記禁止 V3-UIX-01）

- `screen-defs/paper-detail.json` — route `/research/paper/detail`。6 節(sections)・completeness・measurements(value_origin バッジ)・citations・再解析マニフェストリンク。source_path `/api/v1/research/content/{{params.id}}`。
- `screen-defs/paper-match.json` — route `/research/paper/match`。条件P×観測フォーム（`?solid=1`/`?auto=1` ブリッジで観測 JSON 流し込み）→ 充足/不足/違反/一致率カード + 不足キー静的ヒント（1 行）+ 「仮説を Project に追記」button(action=api POST hypothesis)。
- `screen-defs/data-descriptor.json` — route `/research/descriptor`。Data Descriptor 節穴埋め form（field variant=text/number/select）→ 自動充填プレビュー・claim/仮説ラベル表示。
- `screen-defs/project-hub.json` — route `/research/project/hub`。プロフィール/タイムライン/Ver 分岐リスト/lot QR/bestVersion カード。source_path `/api/v1/research/projects/{{params.id}}`。
- `screen-defs/research-search.json` — route `/research/search`。4 本柱統合検索 form + 結果 list（type/tags フィルタ）。
- `screen-defs/research-newspaper.json` — route `/research/newspaper`。文明研究新聞（新規 task_node ダイジェスト list）。source_path `/api/v1/research/newspaper`。

##### 2.5 凍結定数（`apps/api/src/research-constants.ts` 1 ファイル集約・散在ハードコード禁止・較正は V3-GOV-17 後波）

- `CONTENT_TYPES = ["article","blog","paper","chat_log","newspaper"]`
- `PAPER_SECTIONS = ["purpose","hypothesis","conditions","verification","phase","gap"]`（PaperSectionsV1 6 節: 目的/仮説/条件/検証/現在のフェーズ/ギャップ）
- `AI_TAGS_MAX = 10`
- `RAG_PRIORITY = ["system","ai","user","summary","payload","embedding"]`
- `DIFFICULTY = ["beginner","intermediate","researcher"]`
- `CONTRIBUTION_POINTS_PER_CITATION = 1`
- `NEWSPAPER_CRON_UTC = "0 21 * * *"`（**JST 06:00 = UTC 前日 21:00** — C4 で踏んだ UTC/JST ずれを明示回避）
- `DOMAIN_API_MAP`（PPR-13 分野別専門 API 対応表・確定値）:
  - `medicine: ["ICD-11","ATC","ClinicalTrials.gov"]`
  - `ai: ["HuggingFace","PapersWithCode"]`
  - `materials: ["Materials Project","PubChem"]`
  - `weather: ["NOAA","Copernicus"]`
  - `game: ["Wikidata"]`
  - `biology/physics/agriculture/education: ["Wikidata","GBIF","NCBI"]`（既定接続先）
- `RESEARCH_LLM_MODE`（env・既定 `"off"`）: `off` で静的ヒントのみ・`on` は実 API キー必須（§6 人間ゲート）。
- `LATEX_FORBIDDEN = /[\\$]/`（Phase1 LaTeX 禁止・JSON/YAML 節 + プレビューのみ・PPR-03）。
- value_origin/source enum は **再定義せず** frozen `provenance.schema.json` の enum を単一正本として参照。

#### 3. 実装ファイル計画

**new（TS・schemas・screen-defs）**
- `schemas/events/content.schema.json`, `citation.schema.json`, `project.schema.json`, `mapping-event.schema.json`, `category.schema.json`, `task-node.schema.json`, `wiki-node.schema.json`（7）
- `apps/api/src/research-constants.ts`
- `apps/api/src/research-content-routes.ts`（content CRUD / tags(3 層) / unifiedSearch / share 受信 / chat-index）
- `apps/api/src/paper-match-routes.ts` + `apps/api/src/paper-match.ts`（`matchConditions`/`autoFillDescriptor`/`gapAnalysis` 純関数・routes は薄い）
- `apps/api/src/project-routes.ts`（**PPR-16 の 100 番台分離モジュール**: hub/version/bestVersion/citation/reanalysis-manifest/bundle）
- `apps/api/src/research-canonical-routes.ts`（mapping_event / category）
- `apps/api/src/research-agent-batch.ts`（task 生成 / wiki 蒸留 / 新聞・`runBatchOnce` 手動 + `scheduled` ハンドラ実体）
- `apps/web/src/app/manifest.ts`（Next.js metadata route・PWA `share_target` POST → `/api/v1/research/shared`・WIK-17）
- screen-defs 6 本（§2.4）

**modify**
- `packages/truth/src/envelope.ts` — `VALIDATOR_NAME` マップに 7 件（`content:"content"`, `citation:"citation"`, `project:"project"`, `mapping-event:"mappingEvent"`, `category:"category"`, `task-node:"taskNode"`, `wiki-node:"wikiNode"`）+ `EVENT_NAMES` Set に 7 kebab 名（`content, citation, project, mapping-event, category, task-node, wiki-node`）を追加（**批評家 major 反映・未追加だと inner data 無検証**）。frozen 側（FROZEN_NAMES）は不変。
- `scripts/codegen-validators.mjs` — `SCHEMAS` 配列に 7 件（`["content","events/content.schema.json"]` 〜 `["wikiNode","events/wiki-node.schema.json"]`・exportName は envelope.ts の VALIDATOR_NAME 値と一致）を追加 → `node scripts/codegen-validators.mjs` 再実行で `packages/truth/src/generated/validators.cjs` 再生成（手編集禁止・逆流禁止）。**envelope.ts と SCHEMAS の 2 所を同時同期**（「Must stay in sync with envelope.ts」注記の要求）。
- `apps/api/src/index.ts` — 5 route モジュールを `app.route("/api/v1", …)` で登録 + `export default { fetch: app.fetch, scheduled }`（scheduled は research-agent-batch から）。全 route は PUBLIC_ROUTES に**載せない**＝protected（deny-by-default）。
- `apps/api/src/env.ts` — `RESEARCH_LLM_MODE` 型追加（任意）。
- codegen 生成物（`packages/**/generated`）は codegen 実行で更新（手編集禁止）。

**触らない**: `schemas/frozen/**`（provenance/tag-event/ledger-entry 含む全 frozen）・`apps/api/wrangler.toml` の crons（§6 ゲート）・ledger-routes 付与関数（再利用のみ）。

#### 4. TC 計画（vitest `apps/api/src/*.test.ts`・要件 ID 対応）

- `apps/api/src/paper-match.test.ts` — PPR-01: 全一致/部分/違反ケースで satisfied/missing/violated 分類 + `match_rate=satisfied/required` 決定論。PPR-30: 観測投影で節自動充填・充足キー→claim 証拠自動リンク・未検証は仮説ラベル固定・Stage1 機械検査＝matchConditions 流用。PPR-06: 注入固定ベクトルの近傍差分軸→missing_perspectives 安定列挙（全種族横断・species 非フィルタ）+ data_gap キー差分・ベクトル無しで data_gap のみ返す。
- `apps/api/src/paper-sections.test.ts` — PPR-03: content.schema.json paper 検証（6 節必須・completeness_pct∈[0,100]・`LATEX_FORBIDDEN` で `\`/`$` 混入拒否・paper≠content_type 他）。**検証は putEvent 経路（validateEnvelope→eventSchemaFor("content")）で成立させる — envelope.ts/SCHEMAS 両所同期が前提**。
- `apps/api/src/research-content.test.ts` — WIK-16: content INSERT ONLY 同一キー再 put=409・content_type enum。WIK-13: content append 直後に fulltext/tag/user/node 4 索引（prefix scan 投影）即ヒット・DB 不使用。WIK-14: ai_tags が user_tags を上書きしない・RAG_PRIORITY 順ヒット・ai_tags≤10・suggest 非永続で確認 POST のみ append。WIK-17: share POST→content_type=chat_log append→chat-index 投影反映。
- `apps/api/src/project-hub.test.ts` — PPR-16: bestVersion（Ver/lot 別観測集計から決定論選定）・projectId 集約投影。PPR-18: 観測マッチ→citation 生成→不足キー充足で status=updated 追記が冪等（同一キー再 put=409）・貢献ポイント投影 + `grantPlatinum(…,"contribution_rebate")` 付与呼出（懲罰関数は呼ばない）。PPR-09: reanalysisManifest 同一 imageR2Key/scaleTemplateId→同一結果・`observed_at(data)≠committed_at(envelope.time)` 分離・measurement 行 value_origin 付与。
- `apps/api/src/research-canonical.test.ts` — PPR-13: mapping_event append-only（Q番号→外部 ID 再 put=409）・DOMAIN_API_MAP 定数存在・category 追加 append（親子木）。
- `apps/api/src/research-agent-batch.test.ts` — PPR-17: generateTaskNodes 同一 limitations→同一 task_id（決定論）・difficulty/priority ヒューリスティック算出・newspaper 生成。WIK-01: distillWiki 同一入力→同一 wiki_node・board_summary→big_wiki 階層・append-only・LLM OFF でスキップ。

lint/GATE（filename/生成物/agents 同期/schema/frontmatter）+ `npm test` 全 green を納品条件（不変⑤）。批評家（仕様適合/出典実在/網羅/矛盾）通過まで納品しない。

#### 5. クラスタ内実装順序

1. `research-constants.ts` + 7 schemas 起票 → **同時に `packages/truth/src/envelope.ts`（VALIDATOR_NAME + EVENT_NAMES）と `scripts/codegen-validators.mjs`（SCHEMAS 配列）へ 7 件同期** → `node scripts/codegen-validators.mjs`（validators.cjs 再生成）+ codegen（TS 型生成・逆流禁止）。検証マップ 2 所の同期を欠くと 2 以降の putEvent 経路 TC が無検証で誤 green するため最初に固める。
2. `content.schema.json` 起票直後に `paper-sections.test.ts` を green（PPR-03 スキーマ検証を putEvent 経路で先に固める）。
3. `research-content-routes.ts`（content CRUD → tags → search → share/chat）+ `research-content.test.ts`（WIK-16/13/14/17）。
4. `paper-match.ts`（純関数）+ `paper-match-routes.ts` + `paper-match.test.ts`（PPR-01/30/06）。content が前提なので 3 の後。
5. `project-routes.ts`（100 番台）+ `project-hub.test.ts`（PPR-16/18/09）。paper/citation/observation 前提。ledger `grantPlatinum` を呼ぶ。
6. `research-canonical-routes.ts` + `research-canonical.test.ts`（PPR-13）。独立・任意順。
7. `research-agent-batch.ts`（`runBatchOnce` 手動 + `scheduled` 実体）+ `research-agent-batch.test.ts`（WIK-01/PPR-17）。content/task 前提。
8. screen-defs 6 本 + `apps/web/src/app/manifest.ts`。
9. `index.ts` に route/scheduled 登録 → lint/test/pytest 全 green → 批評家 → commit。

#### 6. 分母除外・停止報告（human-gate — 実行しない）

- **Cron 定期配線の有効化**（`wrangler.toml [triggers] crons` 追加 + deploy で毎日 6 時 scheduled が回り始める）＝ グローバル契約「常駐的なトークン消費の開始」。**本クラスタは scheduled ハンドラ実体 + 手動 `POST /research/agent/run` までを納品**し、定期 trigger の有効化は人間ゲート（PPR-17 新聞 / WIK-01 日次蒸留）。
- **LLM 助言経路の実 API キー投入**（`RESEARCH_LLM_MODE=on` + 実鍵）＝ 人間ゲート「実鍵投入」。既定 OFF の決定論経路（静的ヒント 1 行）までを green で納品。PPR-01/PPR-30。
- **ruri 実埋め込み計算 / 外部専門 API 実クエリ**（GBIF/NCBI/HuggingFace 等への実ネット呼出）＝ 既定 OFF（不変①コスト）。TS 側はオフライン生成済みベクトル/対応表を読むだけ。実接続の常時化は後波。PPR-06/PPR-13。
- **PWA share_target 実機共有動作**の確認はブラウザ操作（自動化不可）— manifest 配線と受信 route・投影 TC までを納品。WIK-17。

これら 4 点は完了条件の分母から除外し、達成部分（決定論投影・スキーマ・route・TC）を green で締める。

#### K5 批評家指摘(実装時反映・verdict=fail)

1. **[major]** 新イベント型の data 検証が配線されない。7 新スキーマ(content/citation/project/mapping-event/category/task-node/wiki-node)は schemas/events/ に置かれるが、putEvent の内部 data 検証は validateEnvelope→eventSchemaFor が名前を返した時のみ走り、それは packages/truth/src/envelope.ts の EVENT_NAMES 集合 + VALIDATOR_NAME マップ(いずれも手書きハードコード)への登録が前提。さらに scripts/codegen-validators.mjs は SCHEMAS 配列(35行, ディレクトリ walk ではなくハードコード, 「Must stay in sync with envelope.ts」注記付き)を回すため、新スキーマの validator を自動生成しない。契約の modify リストはこの 2 ファイルを挙げていない。未配線だと envelope 外側パターン(type=^ihl\.…\.v[0-9]+$)は通るが inner data は無検証で putEvent が任意データを受理し、PPR-03 の paper-sections.test.ts(6節必須/completeness_pct∈[0,100]/LATEX_FORBIDDEN 拒否)が putEvent 経路で成立しない。check-generated lint はハードコード同士の byte 比較なので欠落を検知しない。
   - 反映: modify リストに packages/truth/src/envelope.ts(VALIDATOR_NAME + EVENT_NAMES に 7 件追加)と scripts/codegen-validators.mjs(SCHEMAS 配列に 7 件追加→codegen 再実行で validators.cjs 再生成)を明記する。§3/§5 の実装順序に「7 スキーマ起票時に検証マップ両所を同期」を追加する。
2. **[major]** §2.3 台帳連携が既存関数を誤用。「citation 生成時に grantPlatinum/grantKarmaCountIncrease(ledger-routes 既存関数)を呼ぶ（貢献ポイント→プラチナ）」とあるが、ledger-routes.ts:122 の grantKarmaCountIncrease は懲罰関数——カルマ count(=違反回数)を steps 進め、fibPenalty を value 層に -penalty で append する(reason_code は dispute/fee_unpaid 等)。貢献(データ提供/引用)でこれを呼ぶと貢献者を減点し、PPR-18『貢献ポイント付与』の意図と正反対になる。この台帳には正の count 報酬関数は存在しない。tc_map の PPR-18 も『プラチナ付与関数呼出』のみで grantKarmaCountIncrease は検査対象外。
   - 反映: citation 報酬経路は grantPlatinum(s, actorId, amount, "contribution_rebate") のみを呼ぶ。§2.3 から grantKarmaCountIncrease の呼出記述を削除する(懲罰関数であり貢献報酬には不適)。
3. **[minor]** 要件件数の内部矛盾。§1 見出しは「16 件・全件本契約でカバー」だが列挙 ID は 14 件(V3-PPR-01/03/06/09/13/16/17/18/30 の 9 件 + V3-WIK-01/13/14/16/17 の 5 件)で、正本 c5-cluster-k5.json のエントリ数も 14。網羅漏れは無い(14 件全てが route 表・tc_map に出現)が「16 件」は誤カウントで誇張ゼロ規約に抵触。
   - 反映: 「16 件」を「14 件」に訂正する。
4. **[minor]** 決定論 ID と ULID エンベロープの衝突可能性が曖昧。citation_id/task_id/wiki_node.node_id を sha1(...) 『の ULID 相当決定論キー』と記すが、frozen envelope.schema.json は envelope.id を ^[0-9A-HJKMNP-TV-Z]{26}$(ULID)に強制し、sha1 hex(40字)は不適合。機構は sha1 由来 id を putEventAt の STORAGE KEY として使い envelope.id は fresh ulid() を保つ場合(obs-photo と同一パターン)のみ成立する。契約はエンティティ id と envelope.id を混同表記しており、実装者が envelope.id=sha1 と設定すると検証で弾かれる。
   - 反映: §2.2 に『決定論エンティティ ID は putEventAt の storage key として使い、envelope.id は毎回 ulid() で採番する(冪等性は storage-key put-if-absent が担保)』を明記する。

### K6 知の広場+ガバナンス(PROTECTED)

> 対象要件 13 件・全 route PROTECTED(index.ts §1.5 deny-by-default が gate・新 route は PUBLIC_ROUTES 非登録で自動保護)。書込は `data.actor_id` をセッション principal で強制刻印(V3-AUT-17)。Truth は R2 INSERT ONLY(TruthStore 再利用・UPDATE/DELETE メソッド不在=CL-12)。派生値(スレ表示・consensus・ランキング・閾値・判例検索)は全て投影で都度再計算(常駐 DB 禁止・不変条項①)。LLM/Vision/FAISS は既定 OFF — 要約・判例文・分類は「手動/後日バッチが埋める空スロット」として設計し LLM 呼び出しはコードに入れない。参照正本: `ihl-ver2/docs/planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md`(3柱 IA・HG-KN-01〜08)。コミット参照 = REPORT-ver3-phase-c5-2026-07-11。

#### 1. 対象要件 ID 一覧(13 件・1 件も落とさない)

V3-BBS-01 / V3-BBS-03 / V3-BBS-05 / V3-BBS-10 / V3-BBS-20 / V3-BBS-29 / V3-BBS-36 / V3-GOV-01 / V3-GOV-09 / V3-GOV-12 / V3-GOV-13 / V3-GOV-19 / V3-GOV-23

要件→機構の対応:

| 要件 | 中核機構 |
|------|----------|
| BBS-01 | /knowledge ハブ + 3柱 screendef・ナビ1層・≤3クリック |
| BBS-03 | channel=screen_id への3板(guide/complaint/improvement)投影 + 改善サイクル(愚痴→分類スロット→改善→Fork公開→signal収集→ランキング) |
| BBS-05 | plaza-post append-only・materialized view 投影・permalink 不変・tombstone・チャネル分離 |
| BBS-10 | plaza-summary 4層(post emb/block emb/current_summary+open_questions/diff)・100投稿ブロック・要約は手動スロット |
| BBS-20 | CiteRef 共用型・cite_refs[] 構造化正本・安定URL・[ihl:cite] token 従属・通知/検索/出典チャネル分離 |
| BBS-29 | plaza-fork(public→rank=beginner / private)・5段ランク投影・全Fork非削除共存 |
| BBS-36 | Zulip型 channel+必須topic・Polis型 plaza-stance(Agree/Disagree/Pass)→consensus/divisive を決定論投影(LLM不要) |
| GOV-01 | gov-dispute 二人部屋(open/message/close)・期限切れ強制close・不服申立無し |
| GOV-09 | gov-flag 不使用フラグ(R2 DELETEなし)+ grantKarmaCountIncrease(steps=10) |
| GOV-12 | gov-precedent 判例 append(dispute close 時)・全文/タグ検索・cite 可能 |
| GOV-13 | negative 回帰 TC(auto-moderation endpoint / NGワード表 不在の assert)。コード追加なし |
| GOV-19 | gov-vote(threshold_adjust)→ projectThreshold で閾値を都度投影・ルールも fork 対象 |
| GOV-23 | plaza-fork(target_type=os/screen/component)+ gov-vote(os_merge)+ signal 自然淘汰 → projectOsPromotion・content_hash 改変検知 |

#### 2. 確定値

##### 2.1 route 表(全 protected・`/api/v1` prefix・plaza-routes.ts / gov-routes.ts)

| slot | method | path | access | handler(関数) | 要件 |
|------|--------|------|--------|---------------|------|
| 033 | POST | /api/v1/plaza/posts | protected | `appendPost` | BBS-01/03/05/20/36 |
| 033 | GET | /api/v1/plaza/channels/:channel/threads | protected | `projectChannelThreads` | BBS-01/36 |
| 033 | GET | /api/v1/plaza/threads/:thread_id | protected | `projectThread` | BBS-05 |
| 033 | GET | /api/v1/plaza/posts/:post_id | protected | `readPost` | BBS-05/20 |
| 034 | POST | /api/v1/plaza/stances | protected | `appendStance` | BBS-36 |
| 034 | GET | /api/v1/plaza/threads/:thread_id/consensus | protected | `projectConsensus` | BBS-36 |
| 035 | POST | /api/v1/plaza/forks | protected | `appendFork` | BBS-29/GOV-19/23 |
| 035 | GET | /api/v1/plaza/forks | protected | `projectForkRanks`(query: target_type, forked_from, search) | BBS-29 |
| 035 | GET | /api/v1/plaza/forks/:fork_id | protected | `readFork` | BBS-29/GOV-23 |
| 036 | POST | /api/v1/plaza/signals | protected | `appendSignal`(like/use/retain) | BBS-03/GOV-23 |
| 036 | GET | /api/v1/plaza/ranking | protected | `projectRanking`(query: channel or target_type) | BBS-03/GOV-23 |
| 036 | POST | /api/v1/plaza/summaries | protected | `appendSummary` | BBS-10 |
| 036 | GET | /api/v1/plaza/threads/:thread_id/summary | protected | `projectSummary`(4層) | BBS-10 |
| 037 | POST | /api/v1/gov/votes | protected | `appendVote`(kind: os_merge/threshold_adjust/fork_rank) | GOV-19/23 |
| 037 | GET | /api/v1/gov/rules/:rule_id/threshold | protected | `projectThreshold` | GOV-19 |
| 037 | GET | /api/v1/gov/os/promotion | protected | `projectOsPromotion`(query: fork_id) | GOV-23 |
| 038 | POST | /api/v1/gov/disputes | protected | `openDispute` | GOV-01 |
| 039 | POST | /api/v1/gov/disputes/:dispute_id/messages | protected | `appendDisputeMessage` | GOV-01 |
| 040 | POST | /api/v1/gov/disputes/:dispute_id/close | protected | `closeDispute`(→ `appendPrecedent`) | GOV-01/GOV-12 |
| 040 | GET | /api/v1/gov/disputes/:dispute_id | protected | `projectDispute` | GOV-01 |
| 040 | GET | /api/v1/gov/precedents | protected | `projectPrecedents`(query: q, tag) | GOV-12 |
| 040 | GET | /api/v1/gov/precedents/:precedent_id | protected | `readPrecedent` | GOV-12 |
| 040 | POST | /api/v1/gov/flags | protected(+admin) | `applyFlag`(→ `grantKarmaCountIncrease` steps=10) | GOV-09 |

> `POST /gov/flags` は行政/admin 操作。role ゲート(admin capability)は K2 の role 実装に依存する。K6 では deny-by-default 保護のみ確定し、handler 冒頭に `// TODO(K2): admin capability gate` を置き、K2 完了後に capability チェックを差す(現状は保護 route=認証済みなら誰でも叩ける状態。TC は「フラグ event が R2 DELETE せず append され Δcount+10 が課される」ことのみ検証し、role 制限は K2 の TC で担保)。

##### 2.2 新イベント型

CloudEvents envelope(`schemas/events/envelope.schema.json`)再利用。data 部スキーマを新設。`type` は `^ihl\.[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$` に適合。

| type 名 | schemas/ ファイル | Truth キー構造 | data キー(必須太字) |
|---------|-------------------|----------------|----------------------|
| (共用型) | `schemas/events/cite-ref.schema.json` | ― (component schema・envelope data ではない) | **type**(enum: observation/individual/paper/thread/post/user/tag/listing/precedent/fork)・**id**・label?・post_id? |
| `ihl.plaza.post.v1` | `schemas/events/plaza-post.schema.json` | `truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json` | **post_id**・**actor_id**・**channel**(=screen_id/feature)・**topic**・**board_kind**(guide/complaint/improvement)・**thread_id**(root は post_id 自身)・**body**・reply_to?(>>=post_id)・correction_of?(追記訂正=post_id)・cite_refs?(CiteRef[])・mentions?(actor_id[]=@通知)・tags?(string[]=#検索)・**created_at**・**schema_version** |
| `ihl.plaza.stance.v1` | `schemas/events/plaza-stance.schema.json` | `truth/ihl.plaza.stance.v1/<statement_id>/<stance_id>.json` | **stance_id**・**actor_id**・**statement_id**(=post_id 等)・**value**(agree/disagree/pass)・**created_at**・**schema_version** |
| `ihl.plaza.fork.v1` | `schemas/events/plaza-fork.schema.json` | `truth/ihl.plaza.fork.v1/<target_type>/<fork_id>.json` | **fork_id**・**actor_id**・**target_type**(component/screen/rule/os/template)・**forked_from**(親 ref 文字列)・**visibility**(public/private)・**title**・content_hash?(sha256・改変検知)・**created_at**・**schema_version** |
| `ihl.plaza.signal.v1` | `schemas/events/plaza-signal.schema.json` | `truth/ihl.plaza.signal.v1/<target_type>/<target_id>/<signal_id>.json` | **signal_id**・**actor_id**・**target_type**・**target_id**・**signal**(like/use/retain)・**created_at**・**schema_version** |
| `ihl.plaza.summary.v1` | `schemas/events/plaza-summary.schema.json` | `truth/ihl.plaza.summary.v1/<thread_id>/<block_index>-<summary_id>.json` | **summary_id**・**thread_id**・**block_index**(整数=floor(post_index/100))・**current_summary**(string・空可)・open_questions?(string[])・diff?(string・前 summary からの差分)・**generator**(manual/batch)・**created_at**・**schema_version** |
| `ihl.gov.vote.v1` | `schemas/events/gov-vote.schema.json` | `truth/ihl.gov.vote.v1/<proposal_target>/<vote_id>.json` | **vote_id**・**actor_id**・**kind**(os_merge/threshold_adjust/fork_rank)・**proposal_target**(rule_id/fork_id/os ref)・**value**(approve/reject)・adjust_to?(number・threshold_adjust 時の提案値)・rank_to?(fork_rank 時の提案ランク)・**created_at**・**schema_version** |
| `ihl.gov.dispute.v1` | `schemas/events/gov-dispute.schema.json` | `truth/ihl.gov.dispute.v1/<dispute_id>/<event_id>.json` | **dispute_id**・**actor_id**・**action**(open/message/close)・category?(market/board/bugfix・open時必須)・respondent_id?(open時必須)・subject_ref?(CiteRef・open)・body?(message)・resolution?(resolved/force_closed・close)・**created_at**・**schema_version** |
| `ihl.gov.precedent.v1` | `schemas/events/gov-precedent.schema.json` | `truth/ihl.gov.precedent.v1/<precedent_id>.json` | **precedent_id**・**dispute_id**・**title**・**category**・**summary**・culture_guide?(文化差ガイド)・tags?(string[])・**created_at**・**schema_version** |
| `ihl.gov.flag.v1` | `schemas/events/gov-flag.schema.json` | `truth/ihl.gov.flag.v1/<target_id>/<flag_id>.json` | **flag_id**・**actor_id**(=行政指摘を記録した operator)・**target_type**(listing/data/image)・**target_id**・**target_owner**(Δcount を課される actor_id)・reason?・**created_at**・**schema_version** |

> `plaza-post.schema.json` の `cite_refs` は `{ "type":"array", "items": { "$ref": "cite-ref.schema.json" } }`(相対 $ref・同 dir)。同 $ref を gov-dispute の `subject_ref`・gov 判例引用でも使い CiteRef を単一正本にする(スキーマ複製禁止)。相対 $ref は ajv(base $id 解決)と json-schema-to-typescript(同 dir ファイル解決)の双方で解決される。

##### 2.3 投影関数(全て決定論・都度再計算・LLM 不使用)

- `projectThread(s, channel, thread_id)`: prefix scan `truth/ihl.plaza.post.v1/<channel>/<thread_id>/` → ULID 昇順。correction_of を辿り原投稿に追記セクションを畳む(上書きせず両方保持)。各 cite_ref の target 実在を解決し、欠落/非公開なら `tombstones[]` に `{ ref, reason }` を積む(cite_ref 自体は消さない=BBS-05)。
- `projectChannelThreads(s, channel)`: prefix scan `truth/ihl.plaza.post.v1/<channel>/` → thread_id ごとに (topic, board_kind, 最新 post 時刻, post 数) を集約。板は board_kind でグルーピング(guide/complaint/improvement)。
- `projectConsensus(s, statement_ids[])`: 各 statement の stance を scan → (actor_id ごとに最大 ULID を latest として採用=append-only 上書き)→ agree/disagree/pass を計数。`consensus`= agree/(agree+disagree) ≥ CONSENSUS_AGREE_RATIO かつ (agree+disagree) ≥ CONSENSUS_MIN_VOTES。`divisive`= min(agree,disagree)/(agree+disagree) ≥ DIVISIVE_MIN_SIDE_RATIO かつ 同 n 条件。純算術・クラスタリング/LLM なし。
- `projectForkRanks(s, target_type, forked_from?, search=false)`: fork を scan → 各 fork の effective rank を `reduceForkRank(fork, votes)` で算出(初期=public→beginner / private→非掲載、gov.vote kind=fork_rank の最新 approve が rank を昇降)。FORK_RANK_ORDER 昇順で整列。search=false のとき rank=minor を除外(minor は検索のみ=BBS-29)。全 fork 非削除・共存。
- `projectRanking(s, scope)`: signal(like/use/retain)+ vote approve 数 + fork 数を RANKING_WEIGHTS で加重合算し降順(BBS-03 利用率→ランキング / GOV-23 自然淘汰)。
- `projectThreshold(s, rule_id, base)`: gov.vote kind=threshold_adjust を scan → approve 多数決で確定した最新 adjust_to を採用、無ければ base(economy-constants の既定値)を返す(GOV-19 閾値のユーザー投票調整)。
- `projectOsPromotion(s, fork_id)`: 対象 fork の projectRanking スコア ≥ OS_PROMOTION_MIN_SCORE かつ gov.vote kind=os_merge approve が閾値超で `promotable:true`(GOV-23 /os/main 昇格)。
- `projectDispute(s, dispute_id)`: scan `truth/ihl.gov.dispute.v1/<dispute_id>/` → open を起点に participants={opener, respondent} を確定、message を時系列に、close で status=resolved/force_closed。close が無く now > opened_at + DISPUTE_TTL_DAYS なら `expired:true`(UI 表示用・実 close は cron/手動が append=C5 配線)。
- `projectSummary(s, thread_id)`: 4層を返す — (1) post embedding は CL-08 embedding-manifest 参照(既存基盤・384次元)、(2) block 要約 embedding 参照、(3) current_summary+open_questions=最新 summary event、(4) diff 履歴=全 summary event の diff 列。block_index=floor(post 通番/SUMMARY_BLOCK_SIZE)。要約本文は空スロット許容(手動/バッチが後日 append)。
- `projectPrecedents(s, q?, tag?)`: scan `truth/ihl.gov.precedent.v1/` → title/summary/culture_guide 部分一致(q)・tags 一致(tag)でフィルタ(全文/タグ検索・GOV-12)。
- 補助: `parseCiteTokens(body)`([ihl:cite type=X id=Y] を抽出し cite_refs に統合・cite_refs が正本で token は従属)・`citeUrl(ref)`(type→安定 URL: post→`/knowledge/<channel>/t/<thread_id>#<post_id>` 等・BBS-20)・`sha256Hex(text)`(Web Crypto subtle・content_hash 用)。

##### 2.4 screen-defs 追加(JSON のみ・既存 Renderer 12ノード catalog 再利用・コード追加ゼロ)

| screen_id | route | 内容 | 要件 |
|-----------|-------|------|------|
| knowledge-hub | /knowledge | 3柱カード(公式掲示板/論文/GitHub掲示板)のみ・ナビ1層・タブなし(タブとカード重複禁止=BBS-01)。各カード action=navigate | BBS-01/36 |
| knowledge-board | /knowledge/board | 柱1: channel 別スレ一覧 + 3板(説明/愚痴/改善)リンク + 「投稿」form + 「引用」button | BBS-01/03/05 |
| knowledge-paper | /knowledge/paper | 柱2: 論文(K5 の論文照合へ navigate) | BBS-01 |
| knowledge-github | /knowledge/github | 柱3: GitHub 改善履歴 link-out(link ノード・新タブ) | BBS-01 |

> home.json に「知の広場」ボタン(action=navigate to knowledge-hub)を1つ追加 → ホーム→柱主要操作が ホーム→hub→柱=2〜3クリックに収まる(BBS-01 ≤3クリック)。Renderer には既存 node 種(card/list/button/form/field/link/heading/text)だけで表現し新 node 型・新コード不要。

> BBS-03「全画面テンプレに3板必須付与」の恒久解: 板は channel=screen_id をキーに `GET /plaza/channels/<screen_id>/threads` で引ける(データ側で全画面に紐付く)。3板の投影は board_kind enum で担保。knowledge-board を参照実装とし、全既存 screendef への board-strip ノード一括付与は per-screen 作業として段階展開(lint `check-board-strip` で将来 GATE 化)。「改善案/Fork 一覧のポップアップ・タグ絞込」は宣言的 screendef JSON の表現外 — C5 では forks 一覧を navigate 到達で提供し、ポップアップ化は Renderer 拡張の別波(ponytail: 到達性は満たしつつ UI 演出は上げ代として残す・「未実装/WIP」表記は出さない)。

##### 2.5 凍結定数(`apps/api/src/plaza-constants.ts`・ハードコード散在禁止・較正は V3-GOV-17 GUI 後波)

```
BOARD_KINDS = ["guide","complaint","improvement"]            // 説明/愚痴/改善(BBS-03)
FORK_RANKS  = ["official","recommended","popular","beginner","minor"]  // 表示順(BBS-29)
STANCE_VALUES = ["agree","disagree","pass"]                  // Polis(BBS-36)
CONSENSUS_MIN_VOTES = 5                                       // 合意/対立の最小票数
CONSENSUS_AGREE_RATIO = 0.6                                   // consensus 閾値(ponytail: 較正knob)
DIVISIVE_MIN_SIDE_RATIO = 0.3                                 // divisive 閾値(ponytail: 較正knob)
SUMMARY_BLOCK_SIZE = 100                                      // 100投稿ごと(BBS-10)
DISPUTE_TTL_DAYS = 14                                         // 期限切れ強制close(GOV-01・ponytail: 較正knob)
GOV_FLAG_COUNT_STEPS = 10                                     // Δcount+10(GOV-09)
RANKING_WEIGHTS = { like:1, use:2, retain:3, vote:5, fork:1 } // 自然淘汰(GOV-23・ponytail: 較正knob)
OS_PROMOTION_MIN_SCORE = 100                                  // /os/main 昇格閾値(GOV-23・ponytail: 較正knob)
```

#### 3. 実装ファイル計画

NEW:
- `schemas/events/cite-ref.schema.json`(CiteRef 共用型)
- `schemas/events/plaza-post.schema.json` / `plaza-stance.schema.json` / `plaza-fork.schema.json` / `plaza-signal.schema.json` / `plaza-summary.schema.json`
- `schemas/events/gov-vote.schema.json` / `gov-dispute.schema.json` / `gov-precedent.schema.json` / `gov-flag.schema.json`
- `apps/api/src/plaza-routes.ts`(post/stance/fork/signal/summary + 投影関数)
- `apps/api/src/gov-routes.ts`(vote/dispute/precedent/flag + 投影関数・ledger-routes の `grantKarmaCountIncrease` を import 再利用)
- `apps/api/src/plaza-constants.ts`(§2.5)
- `screen-defs/knowledge-hub.json` / `knowledge-board.json` / `knowledge-paper.json` / `knowledge-github.json`
- `tests/plaza-posts.test.ts` / `plaza-consensus.test.ts` / `plaza-fork.test.ts` / `plaza-summary.test.ts` / `plaza-cite.test.ts` / `gov-dispute.test.ts` / `gov-precedent.test.ts` / `gov-vote-threshold.test.ts` / `gov-flag.test.ts` / `gov-no-automod.test.ts` / `knowledge-screens.test.ts`

MODIFY:
- `apps/api/src/index.ts`: `app.route("/api/v1", plazaRoutes)` + `app.route("/api/v1", govRoutes)` を追記(market の直後・保護は自動)。
- `packages/truth/src/envelope.ts`: `VALIDATOR_NAME` に citeRef/plazaPost/plazaStance/plazaFork/plazaSignal/plazaSummary/govVote/govDispute/govPrecedent/govFlag を追加、`EVENT_NAMES` に上記 9 イベント(cite-ref は除く=envelope data 対象でない)を追加。
- `scripts/codegen-validators.mjs`: `SCHEMAS[]` に上記 10 スキーマを追加(cite-ref を含めて同一 ajv インスタンスに登録し plaza-post の $ref を解決)。
- `screen-defs/home.json`: 「知の広場」ボタン + transition 1件追記。
- 再生成(生成物・手編集禁止): `node scripts/codegen-validators.mjs`(→ `packages/truth/src/generated/validators.cjs`)+ `node scripts/codegen-schemas.mjs`(→ `packages/schema-types/src/generated/**` に CiteRef 等の TS 型)。両 `--check` を CI GATE 済み。

不変条項適合の確認: 全書込 putEvent/putEventAt(put-if-absent 409・UPDATE/DELETE メソッド不在)/ 投影は listEvents prefix scan の都度再計算(常駐 DB なし)/ LLM 呼び出しゼロ(要約・判例・分類は空スロット)/ CiteRef は schemas 単一正本 / route は deny-by-default で PROTECTED。

#### 4. TC 計画(要件 ID 対応・FakeR2Bucket + AUTH_HEADERS 既存パターン)

- `tests/plaza-posts.test.ts`(BBS-01/03/05/36-topic/20): topic 欠落→400(必須)・post append→projectThread が ULID 順 materialized view を返す・correction_of が原投稿を上書きせず追記で共存・permalink(thread_id/post_id)が編集後も不変・欠落 cite target に tombstone・チャネル分離(reply_to>>・mentions@・tags#・cite_refs が別フィールド)・同 post_id 二重→409・未認証 401。
- `tests/plaza-cite.test.ts`(BBS-20): cite_refs[] が正本で [ihl:cite] token より優先(token をパースしても cite_refs に統合)・citeUrl が全 type(post/thread/user/tag/observation/paper/listing/precedent/fork)で安定 URL を返す。
- `tests/plaza-consensus.test.ts`(BBS-36): Agree/Disagree/Pass を append-only 収集・同 actor の再投票は最新 ULID を採用・consensus/divisive が閾値算術で決定論分類・LLM 非依存(同入力同出力)。
- `tests/plaza-fork.test.ts`(BBS-29/GOV-19/GOV-23): public fork→rank=beginner 自動・gov.vote fork_rank で昇格・FORK_RANK_ORDER 表示順・minor は search=false で除外/true で出現・全 fork 非削除共存・content_hash 改変検知(不一致検出)。
- `tests/plaza-summary.test.ts`(BBS-10): block_index=floor(通番/100)・projectSummary が4層(post emb 参照/block emb 参照/current_summary+open_questions/diff 履歴)を返す・要約空スロット許容(LLM 呼ばない)・summary append で diff が履歴に積まれる。
- `tests/gov-dispute.test.ts`(GOV-01): open→message→close の projection 状態遷移・participants は opener/respondent の2名限定(第三者の message 投稿を拒否)・close なしで TTL 超過→expired:true・不服申立 route 不在。
- `tests/gov-precedent.test.ts`(GOV-12): dispute close で precedent が R2 append・projectPrecedents が q/tag 検索・precedent が CiteRef(type=precedent)で引用可能・R2 DELETE なし。
- `tests/gov-vote-threshold.test.ts`(GOV-19): threshold_adjust vote→projectThreshold が投票結果値を返す(無投票時は economy-constants 既定)・os_merge vote+スコアで projectOsPromotion が promotable 判定(GOV-23)。
- `tests/gov-flag.test.ts`(GOV-09): flag event append で R2 DELETE せず論理無効化・対象 owner に grantKarmaCountIncrease(steps=10) で Δcount+10 とフィボナッチ減点が台帳 append される・投影に反映。
- `tests/gov-no-automod.test.ts`(GOV-13): `apps/api/src` を走査し auto-moderation endpoint / NGワード表(禁止語配列)が存在しないことを assert(negative 回帰・実装ゼロ)。
- `tests/knowledge-screens.test.ts`(BBS-01): knowledge-hub が3柱カードのみ(タブノード不在=タブ/カード重複禁止)・home→hub→各柱主要操作が transitions 上 ≤3 クリック・4 screendef が screendef.schema.json に妥当。

#### 5. クラスタ内実装順序

1. `plaza-constants.ts` + 10 スキーマ(cite-ref → plaza-* → gov-*)を新設し `codegen-validators`/`codegen-schemas` + envelope.ts マップを結線(--check 緑)。
2. `plaza-routes.ts`(post/thread/cite → stance/consensus → fork/rank → signal/ranking/summary)+ TC(plaza-posts/cite/consensus/fork/summary)。
3. `gov-routes.ts`(vote/threshold/os → dispute open/message/close → precedent → flag)+ TC(gov-dispute/precedent/vote-threshold/flag)+ gov-no-automod。
4. `index.ts` mount + screen-defs 4枚 + home.json ボタン + knowledge-screens TC。
5. `npm run lint`(filename/frontmatter/schema/agents 同期/ui-tokens)+ `npm test`(vitest run)全緑を実測 → commit。

依存: `grantKarmaCountIncrease`(ledger-routes.ts・C4 既実装)を gov-routes が import。K2 の role/capability には gov/flags の admin ゲートのみ依存(TODO で分離・K6 の他機能はブロックしない)。

#### 6. 分母除外・停止報告(human-gate)

- 実装は PROTECTED で完了まで進める。以下のみ人間ゲート — 機械が [x] を偽装せず停止報告する:
  - **公開の実施**(BBS-01): /knowledge の一般公開・公開解除は「公開の実施」ゲート。実装(route/screendef)は完成させるが公開スイッチは押さない。
  - **HG-KN-01〜08**(知の広場 IA の人間裁定・分母除外): 本設計は推奨案を仮置きし、裁定で差し替え可能な構造にする — HG-KN-01=**C**(その他板は v1 非掲載) / HG-KN-02=**C**(外側3柱・内側タブのハイブリッド) / HG-KN-03=**B**(walkId=画面種別・本番は /knowledge 配下) / HG-KN-04=**A**(論文板は柱2正本) / HG-KN-05=**A**(記事/ブログは柱2統合) / HG-KN-06=**A**(汎用引用を柱確定と同時昇格) / HG-KN-07=**A**(GitHub 柱 URL=/knowledge/github) / HG-KN-08=**B**(Hub を3柱カード再設計)。いずれも screendef の route/カード構成に閉じており、裁定確定後に JSON 差し替えで反映(コード不変)。
  - **GOV-09 の行政命令服従判断**: フラグ付与 route と Δcount は自動化するが、「その行政命令に従うか」の意思決定自体は人間ゲート(V3-AIP-31)。route は operator が明示操作したときだけ append する(自動 poll しない)。
  - **GOV-13**: 自動モデレーション不採用は思想。negative TC で不在を回帰ガードするのみ(実装物なし)。

#### K6 批評家指摘(実装時反映・verdict=pass)

1. **[minor]** cite-ref.schema.json introduces the repo's FIRST cross-file relative $ref (plaza-post cite_refs → cite-ref.schema.json). No existing schema uses cross-file $ref, so neither codegen path is proven on this shape. Two risks: (a) ajv standalone must resolve the relative $ref via matching $id base — requires cite-ref.schema.json to carry $id https://schemas.it-hercules.uk/events/cite-ref.schema.json; (b) codegen-schemas.mjs compiles every *.schema.json independently AND json-schema-to-typescript inlines the referenced type into plaza-post.ts while cite-ref.ts is also emitted, so the barrel index.ts `export *` may export CiteRef twice → ambiguous re-export if any consumer imports it.
   - 反映: Before relying on it, run `node scripts/codegen-validators.mjs --check` and `node scripts/codegen-schemas.mjs --check` plus `tsc` on packages/schema-types; ensure cite-ref.schema.json $id matches the events/ base convention. If the barrel collides, give the inlined ref a distinct type or drop cite-ref.ts from the barrel.
2. **[minor]** §2.3 defines projectConsensus(s, statement_ids[]) but the route GET /plaza/threads/:thread_id/consensus supplies a thread_id, not statement_ids[]. The step that derives the thread's statement_ids (= post_ids in the thread) before calling projectConsensus, and the return shape (per-statement consensus/divisive map vs single aggregate), are unspecified.
   - 反映: Spell out that the handler first prefix-scans truth/ihl.plaza.post.v1/<channel>/<thread_id>/ to collect post_ids as statement_ids, then returns a per-statement {statement_id, agree, disagree, pass, consensus, divisive} array.
3. **[minor]** projectThreshold(s, rule_id, base) falls back to 'economy-constants 既定' when unvoted, but economy-constants.ts has NO generic per-rule threshold constant (only KARMA_VALUE_* / MONTHLY_RECOVERY / Fib anchors). The rule_id→base-default mapping is undefined, so an implementer cannot know which constant seeds a given rule_id.
   - 反映: Either enumerate the rule_id→base map (which economy-constant seeds each votable threshold) or state that base is always caller-supplied and the TC passes it explicitly; do not imply economy-constants already holds these values.
4. **[minor]** closeDispute → appendPrecedent: gov-precedent requires title, category, summary (non-derivable without LLM, which is OFF). With LLM disabled the human closer must supply these, but the close request body fields (precedent title/summary/tags; category presumably copied from dispute.category) are not enumerated in the route/contract.
   - 反映: Add the close endpoint's request body shape (title, summary, tags?, culture_guide?) and state category is inherited from the dispute's category, so appendPrecedent has all required fields at close time.
5. **[minor]** POST /gov/flags is disclosed as protected-but-not-admin (TODO(K2) gate), meaning any authenticated user can flag an arbitrary target_owner and inflict grantKarmaCountIncrease(steps=10) — a severe karma penalty (count+10, value −143) on any actor. This is honestly disclosed and dependency-blocked on K2, but it is a real griefing/abuse vector against GOV-09's admin-only intent.
   - 反映: Acceptable as a disclosed phased split, but record it as an explicit K2 blocker (not just an inline TODO) so the admin-capability gate is a hard completion condition for GOV-09, and keep the TC asserting only append+Δcount as planned.

### K7 基盤/インフラ+コスト/運用

> 実装エージェント向け正本。C2〜C4 の共通規約(schemas/ 唯一正本→codegen 一方向・R2 INSERT ONLY・deny-by-default・本人スコープ・frozen 変更禁止・「未実装/WIP」UI 禁止)を全て引き継ぐ。コミット参照 ID = REPORT-ver3-phase-c5-2026-07-11。
> 設計方針(ponytail + 5 不変条項): 各要件は**検証可能な最小スライス**を確定納品し、大型アーキ要件(FND-04 全 route の Kernel 経由化・FND-05 全実イベントの prev_hash 連結・FND-18 real parquet・FND-21 real LLM プロバイダ)の**壮大な全面移行部分は明示 defer**(ceiling を各節に記載)。理由: 不変条項①(10 年コスト最小・LLM/Vision 既定 OFF・使う瞬間だけ)と YAGNI。既存資産(canonicalJson/sha256/TruthStore put-if-absent/hono cors)を最大再利用し新規 npm 依存ゼロ。

---

#### 0. 対象要件 ID 一覧(9 件・全件カバー)

| ID | Tier | 規模 | 本波の確定納品(検証可能スライス) | defer(理由) |
|----|------|------|-----------------------------------|-------------|
| V3-OTH-02 | A | S | `scripts/lint-components.mjs` + 両 component に manifest/golden 追加 → lint GATE | — |
| V3-CST-05 | A | L | `.env` 2 層 example 分離 + `docs/ops/runbook.md` 運用手順書 | nginx/certbot/pm2 実機・prod R2 シード・cutover は人間ゲート/manual |
| V3-FND-15 | S | L | `schemas/common/lineage-meta.schema.json` 共用型 + `computeLineageMeta` 決定論ヘルパ + TC | 全既存イベントへの retrofit 付与(FeatureNode 毎・将来) |
| V3-FND-04 | A | L | `packages/truth/src/kernel.ts` 純粋 `reduce`(OCC/単調 ts/削除禁止)+ TC | 全 route の Kernel 経由化(現状 route 直 append)は将来波 |
| V3-FND-05 | A | L | `packages/truth/src/hash-chain.ts`(GENESIS/eventHash/verifyChain/worldHash)+ TC | 実 R2 append 経路への prev_hash 常時連結は将来波 |
| V3-FND-11 | A | M | API 側 CORS 全応答一貫(500/401 含む)middleware+onError + TC | apps/web 直叩き URL 切替・Pages edge/.next cache 削除は cutover(C6/人間ゲート) |
| V3-FND-12 | A | M | `scripts/lint-deps.mjs`(import 方向 + nested npm + wrangler binding 走査)→ lint GATE | 深度/15 ファイル制限の完全 linter(現状違反なし=YAGNI) |
| V3-FND-18 | A | L | `src` 4 概念 event schema + `source-routes.ts` + `telemetry-merge.ts`(written/skipped_*)+ 未終了 binding 409 + TC | real parquet(JSON バケット append で代替)・観測 commit 深統合(K1 依存) |
| V3-FND-21 | A | L | `apps/api/src/ai-kernel.ts` LLMClient 抽象 + A90 route(既定 AI_DISABLED)+ モック差替 TC | real LocalAI/OpenAI 呼び出し(既定 OFF・実鍵人間ゲート) |

---

#### 1. 確定値

##### 1.1 route 表(method / path / access / handler)

| method | path | access | handler(ファイル:関数) | 要件 |
|--------|------|--------|------------------------|------|
| POST | /api/v1/placements | protected | source-routes.ts: `createPlacement` | FND-18 |
| GET | /api/v1/placements | protected | source-routes.ts: `listPlacements` | FND-18 |
| POST | /api/v1/device-bindings | protected | source-routes.ts: `createBinding`(未終了 dup→409) | FND-18 |
| POST | /api/v1/device-bindings/end | protected | source-routes.ts: `endBinding`(end 相=新 INSERT) | FND-18 |
| GET | /api/v1/device-bindings | protected | source-routes.ts: `listBindings` | FND-18 |
| POST | /api/v1/occupancy | protected | source-routes.ts: `createOccupancy` | FND-18 |
| GET | /api/v1/occupancy | protected | source-routes.ts: `listOccupancy` | FND-18 |
| POST | /api/v1/telemetry | protected | source-routes.ts: `ingestTelemetry`(written/skipped_duplicate/skipped_invalid) | FND-18 |
| POST | /api/v1/ai/:task | protected | ai-kernel.ts: `runAiTask`(既定 501 AI_DISABLED) | FND-21 |

- 全て deny-by-default(PUBLIC_ROUTES に追加しない=session 保護)。書込のみ認証は V3-CST-01/AUT-17 に整合。telemetry の署名済み値経路は既存 `/collector/ingest`(C3)を再利用し重複実装しない。
- CORS(FND-11)は **middleware + onError** であり route ではない。OPTIONS preflight は `hono/cors` が全 path で応答。`:task` ∈ `{translate,summarize,search,generate,classify}` 以外は 404。

##### 1.2 新イベント型(type 名 + schemas/ ファイル名 + Truth キー構造)

| type(grep 正本) | schemas/ ファイル | Truth キー | 冪等/備考 |
|------------------|-------------------|-----------|----------|
| ihl.src.placement.v1 | events/placement.schema.json | truth/ihl.src.placement.v1/`<placement_id>`.json | putEvent(id=ULID)・Tier A INSERT ONLY |
| ihl.src.device_binding.v1 | events/device-binding.schema.json | truth/ihl.src.device_binding.v1/`<binding_id>`-`<phase>`.json | phase∈{start,end}。start は同一 device_id の open binding 有れば route が 409。end=新 INSERT(UPDATE しない) |
| ihl.src.occupancy.v1 | events/occupancy.schema.json | truth/ihl.src.occupancy.v1/`<occupancy_id>`.json | Tier A INSERT ONLY |
| ihl.src.telemetry.v1 | events/telemetry-ingest.schema.json | truth/ihl.src.telemetry.v1/`<device_id>`-`<bucket_start_ms>`.json | Tier B。putEventAt の put-if-absent が **冪等マージ**を storage 層で保証(inserted=written / 409=skipped_duplicate)。real parquet は defer |

- data 部 required(確定): placement=`{placement_id, actor_id, label, created_at, schema_version}` / device_binding=`{binding_id, actor_id, device_id, placement_id, phase, subject_ref?, effective_at, schema_version}` / occupancy=`{occupancy_id, actor_id, placement_id, subject_ref, effective_at, schema_version}` / telemetry=`{device_id, bucket_start_ms, metric, mean, count, source_granularity_ms, schema_version}`。null/空文字禁止(値なしはフィールド省略・FND-15/AI ファースト規約)。
- QR 再発行=新 INSERT は既存 `ind-qr`(put-if-absent)で構造充足済。本波で新規コード不要(参照のみ)。

**共用型(イベントではない・FND-15)**: `schemas/common/lineage-meta.schema.json`
required=`[uuid, lineage_hash, content_hash, generation]`。任意=`parent_uuid`(値なし省略)・`ancestor_chain`(uuid 配列)・`semantic_hash`(embedding 派生・既定 OFF なので通常省略)。全 hash は SHA-256 hex(64 文字)。generation は integer ≥0。envelope の provenance 拡張・frozen/provenance(再現性メタ run_id/schema_version/input_hash)とは**別層**で、両立して付与する。

##### 1.3 投影関数 / 純粋関数(確定シグネチャ)

- FND-15: `computeLineageMeta(content: unknown, parent?: LineageMeta): Promise<LineageMeta>`(`packages/truth/src/lineage.ts`)。content_hash=SHA-256(canonicalJson(content))。lineage_hash=SHA-256((parent?.lineage_hash ?? GENESIS_HASH)+content_hash)。ancestor_chain=parent ? [...parent.ancestor_chain, parent.uuid] : []。generation=parent ? parent.generation+1 : 0。uuid=`ulid()`。既存 `canonicalJson` + sha256(contracts.ts)を再利用・新規ハッシュ実装禁止。
- FND-04: `reduce(world: World, command: Command): Promise<ReduceResult>`(`packages/truth/src/kernel.ts`・純粋/副作用ゼロ/IO なし)。World=`{snapshotVersion, lastTimestamp, nodes: Record<id,Node>}`。Command=`{prevSnapshotVersion, timestamp, op}`。判定順: ① prevSnapshotVersion≠world.snapshotVersion → `{status:"conflict"}`(world 不変) ② timestamp≤lastTimestamp → `{status:"rejected", reason:"timestamp_not_monotonic"}` ③ op が kind∈{record,root} の削除 → `{status:"rejected", reason:"delete_forbidden"}` ④ 成功 → `{status:"ok", world:{nodes', lastTimestamp:timestamp, snapshotVersion: await worldHash(nodes')}}`。決定論(Date.now/乱数/crypto 鍵なし・入力のみ関数)。
- FND-05(`packages/truth/src/hash-chain.ts`): `eventHash(prevHash, core): Promise<string>`=SHA-256(canonicalJson({prev_hash:prevHash, ...core}))。`verifyChain(events): Promise<{valid, brokenAt: number|null}>`(prev_hash 連結の連続性 + 各 event_hash 再計算一致で改竄検知)。`worldHash(nodes): Promise<string>`=各ノード canonical hash を昇順ソート→連結→SHA-256(順序独立)。空 world→`EMPTY_WORLD_HASH`。snapshotVersion は worldHash と同一値(FND-04 と共有)。
- FND-18: `bucketize(rows): {device_id, bucket_start_ms, metric, mean, count, source_granularity_ms}[]`(`telemetry-merge.ts`・純粋。1 分行→5 分バケット平均集約・invalid 行除外)。`projectOpenBindings(store, deviceId): Promise<string[]>`(open=start に対応 end 無し・409 判定用。listEvents prefix scan 再利用)。listPlacements/listOccupancy/listBindings=`listEvents` 投影。
- FND-21: `makeLLMClient(env): LLMClient`(既定=disabled・`IHL_AI_PROVIDER` 未設定で `complete()` が AI_DISABLED throw)。`interface LLMClient { complete(req): Promise<{text:string}> }`。route はテストが factory を差替可能な形で client を解決(DI)。

##### 1.4 screen-defs 追加

**なし。** 本クラスタは基盤/インフラ/運用でありユーザー向け画面を持たない。A90 は API(AI_DISABLED を返す・「未実装」文言なし)。UI 追加要件は K4。

##### 1.5 凍結定数(所在モジュールに集約・インライン magic number 禁止)

- `packages/truth/src/hash-chain.ts`: `GENESIS_HASH = "0".repeat(64)`(genesis prev_hash 番人)・`EMPTY_WORLD_HASH`(=SHA-256("") 相当の空 world 番人)。
- `apps/api/src/telemetry-merge.ts`: `TELEMETRY_BUCKET_MS = 300_000`(5 分)・`TELEMETRY_SOURCE_MS = 60_000`(1 分粒度)。
- `apps/api/src/ai-kernel.ts`: `AI_TASKS = ["translate","summarize","search","generate","classify"] as const`・既定 disabled。
- `apps/api/src/index.ts`(CORS): `CORS_ALLOW_METHODS="GET,POST,OPTIONS"`・`CORS_ALLOW_HEADERS="Content-Type,Authorization"`・`CORS_MAX_AGE=86400`・credentials=true・許可 origin は env `CORS_ALLOW_ORIGINS`(カンマ列)から一致 origin を echo(cookie 認証のため `*` 不可)。

##### 1.6 env.ts Bindings 追加(型のみ・実値は .env.platform)

- `CORS_ALLOW_ORIGINS?: string`(FND-11・許可 origin カンマ列)
- `IHL_AI_PROVIDER?: string`(FND-21・未設定=AI_DISABLED)

---

#### 2. 実装ファイル計画

**NEW(schemas)** — 追加後 `npm run codegen` 必須(TS 型 + validators 再生成・生成物はコミット。手編集禁止):
- `schemas/common/lineage-meta.schema.json`(FND-15)
- `schemas/events/placement.schema.json` / `device-binding.schema.json` / `occupancy.schema.json` / `telemetry-ingest.schema.json`(FND-18)
- 各 schema は `$schema`(draft 2020-12)+ `$id`(https://schemas.it-hercules.uk/…)+ `x_ihl_req` 必須(validate-schemas GATE)。

**NEW(packages/truth)**: `src/lineage.ts`・`src/kernel.ts`・`src/hash-chain.ts`(canonicalJson/sha256 再利用・新 package 作らず truth に co-locate=ponytail: Kernel/hash は Truth 直前層。将来肥大したら packages/kernel へ昇格)。

**NEW(apps/api/src)**: `source-routes.ts`(FND-18 route 群)・`telemetry-merge.ts`(純粋 bucketize)・`ai-kernel.ts`(FND-21)。

**NEW(scripts)**: `lint-deps.mjs`(FND-12 + FND-02 wrangler 走査)・`lint-components.mjs`(OTH-02)。

**NEW(components 構造補完・OTH-02)**: `components/collector-switchbot/manifest.json` + `golden/ingest-vector.json`、`components/wiki-ingest/manifest.json` + `golden/parity-vector.json`。manifest required=`{id, entrypoint, inputs, outputs, tests, golden}`(entrypoint は実在ファイル名を宣言。wiki-ingest は run.py 不在=`parity_check.py` を宣言。lint は run.py 固定でなく manifest.entrypoint 実在を検査=野生の component を弾かない faithful 実装)。

**NEW(.env / docs・CST-05)**: `.env.platform.example`(管理者/インフラ: GMO_*・RESEND_*・SESSION_SECRET・PUBLIC_APP_URL・CF_*・COLLECTOR_PUBLIC_KEYS・CORS_ALLOW_ORIGINS・IHL_AI_PROVIDER)・`.env.local.example`(ユーザー設定: SWITCHBOT_TOKEN/SECRET・COLLECTOR_ID・COLLECTOR_PRIVATE_KEY_PEM・INGEST_URL・COLLECTOR_USER_ID・COLLECTOR_PLACEMENT_ID)。**実値は書かない(型のみ)**。`docs/ops/runbook.md`(frontmatter 必須)。

**NEW(tests)**: `tests/fnd-04-kernel.test.ts`・`fnd-05-hash-chain.test.ts`・`fnd-11-cors.test.ts`・`fnd-15-lineage-meta.test.ts`・`fnd-18-source.test.ts`・`fnd-21-ai-kernel.test.ts`(vitest・helpers.ts のメモリ R2 モック再利用=不変条項⑤ の「本番 R2 差替えずモック」)。

**MODIFY**:
- `packages/truth/src/index.ts`: lineage/kernel/hash-chain の export 追加。
- `packages/truth/src/envelope.ts`: VALIDATOR_NAME に `lineage-meta→lineageMeta` + 4 event、EVENT_NAMES に 4 event 追加(lineage-meta は frozen/event でないので `validateLineageMeta` 用に COMMON 経路 or VALIDATOR_NAME 直参照)。
- `scripts/codegen-validators.mjs`: SCHEMAS 配列に 5 件追加(envelope.ts と同期)。
- `apps/api/src/index.ts`: 先頭に `hono/cors` middleware(env 由来 origin allowlist・credentials)+ `app.onError`(500 でも CORS ヘッダ付与)+ `app.route` で source-routes/ai-kernel 結線。
- `apps/api/src/env.ts`: Bindings に 2 キー追加。
- `package.json`: lint に `node scripts/lint-deps.mjs && node scripts/lint-components.mjs` 追加(codegen --check は既存)。
- `.env.example`: 2 層への 4 行インデックス(「管理者=.env.platform.example / ユーザー=.env.local.example をコピーせよ」)へ改稿。
- `packages/schema-types/src/generated/**` ・ `packages/truth/src/generated/validators.cjs`: codegen 再生成(script 経由・手編集禁止)。

---

#### 3. TC 計画(テストファイル + ケース + 要件対応)

- `tests/fnd-15-lineage-meta.test.ts`(V3-FND-15): ① 正常 meta が生成 validator 緑・`lineage_hash` 欠落で fail・null フィールドで fail(値なし=省略の強制) ② 決定論: 同一 content 二回で content_hash/lineage_hash 一致 ③ 系譜: 子の ancestor_chain に親 uuid 含・generation=親+1・lineage_hash が親依存で変化。**automatable**。
- `tests/fnd-04-kernel.test.ts`(V3-FND-04): ① 決定論(同一 world+command 二回で snapshotVersion 含む結果 byte 一致) ② OCC(誤 prevSnapshotVersion→conflict・world 不変) ③ 単調 ts(timestamp≤lastTimestamp→rejected) ④ 削除禁止(record/root 削除 op→rejected)。**automatable**。
- `tests/fnd-05-hash-chain.test.ts`(V3-FND-05): ① 正当連結→verifyChain valid ② 1 イベント data 改竄→event_hash 再計算不一致→brokenAt 検出 ③ worldHash 順序独立(挿入順違いで同値)・空 world=EMPTY_WORLD_HASH。**automatable**。
- `tests/fnd-11-cors.test.ts`(V3-FND-11): ① 200 に許可 origin の ACAO+ACAC ② 401(AUTH_REQUIRED)にも CORS ヘッダ ③ 意図的 throw route→onError 500 でも CORS ヘッダ ④ OPTIONS preflight→204 + allow-methods/headers ⑤ 非許可 origin→ACAO 無し。502 はプロキシ層生成のため runbook で「削らない」を担保(manual)。**automatable**(コア)。
- `tests/fnd-18-source.test.ts`(V3-FND-18): ① telemetry マージ written/skipped_duplicate(同 bucket 再送=409)/skipped_invalid(NaN/欠損)の各カウント ② 1 分行→5 分バケット平均集約 ③ device-binding 未終了 dup→409 ④ placement/occupancy INSERT + put-if-absent 409。**automatable**。
- `tests/fnd-21-ai-kernel.test.ts`(V3-FND-21): ① モック LLMClient を factory に注入→A90 経由でモック出力が返る(機能別 AI 差替の証明) ② provider 未設定既定→AI_DISABLED(501)。**automatable**。
- `scripts/lint-deps.mjs`(V3-FND-12 + FND-02): 自己 self-check(`--selftest`: 既知 bad import=apps→apps / libs→apps / `*/shared/` / wrangler d1|kv|durable_objects binding を fail と判定)+ `npm run lint` が現 repo で緑。**automatable**。
- `scripts/lint-components.mjs`(V3-OTH-02): manifest/entrypoint 実在/tests/golden/README 欠落で fail・現 repo(補完後)で緑。**automatable**。
- `docs/ops/runbook.md` + `.env.*.example`(V3-CST-05): 運用手順の nginx+certbot/pm2/HTTPS/VPS 再構築は**本番 VPS 手動検証(CI 外)=manual**。`.env` 2 層 example の存在・frontmatter・非 ASCII 無しは既存 filename/frontmatter lint が機械確認。**automatable=false**。

自動化率(automatable): 9 件中 8 件自動化(CST-05 のみ manual)= wave 受入 80% 規約(srs §8)充足。

---

#### 4. クラスタ内実装順序

1. **FND-15**(lineage-meta schema + lineage.ts + codegen)→ 決定論ハッシュ基盤を先に確定。
2. **FND-04 + FND-05**(kernel.ts + hash-chain.ts・worldHash を共有)→ 純粋コア。同時実装(相互依存)。
3. **FND-18**(4 event schema + source-routes + telemetry-merge + codegen)→ TruthStore 再利用の route 群。
4. **FND-21**(ai-kernel + env)→ 既定 OFF の seam。
5. **FND-11**(index.ts CORS middleware/onError + env)→ 全 route 確定後に横断適用。
6. **FND-12 + FND-02**(lint-deps)→ 全コード着地後に方向/binding 走査が緑になる状態で結線。
7. **OTH-02**(lint-components + manifest/golden 補完)→ 最後の GATE 化。
8. **CST-05**(.env 2 層 + runbook)→ docs。最後。
各段: `npm run lint`(codegen --check 含む)+ `npm test` + `pytest -q` 全緑実測→担当ファイルのみ明示 add→ secrets grep→ commit。frozen 変更なし(全て新規 schema/コード)。

---

#### 5. 分母除外・停止報告(human-gate / 実施しない)

- **V3-CST-05 の実施系**: GMO 本番入金・ver4 本番 cutover(DNS 切替/ロールバック)・Resend/GMO live/collector 実鍵投入・prod R2 空/シード投入の**実施**・nginx+certbot/pm2 の本番 VPS 構築 = 人間ゲート(公開/実鍵/金銭)。本波は**手順書(docs)と .env 型のみ**を納品し、実行は停止報告。
- **V3-FND-11 の実施系**: apps/web の本番直叩き URL 切替・Pages 本番デプロイ・DNS/route 変更 = cutover(C6/人間ゲート)。本波は API 側 CORS 実装 + staging 検証まで。
- **V3-FND-21**: real LLM プロバイダ鍵投入 = 実鍵(人間ゲート)。既定 OFF ゆえ発火せず(不変条項①整合)。
- **V3-FND-18**: collector 実鍵は C3 で人間ゲート済(本波は署名検証経路の再利用のみ)。
- **FND-02 lint の採否判断(理由)**: **採用(最小)**。現 wrangler.toml は R2 バケット 1 binding のみ(R2=append-only object store で不変条項①の許可対象・常駐 DB ではない)。単独の重量級 linter 新設は現状ターゲット不在で YAGNI。ただし将来誰かが `[[d1_databases]]`/`[[kv_namespaces]]`/`durable_objects`/`hyperdrive`(=常駐 SSOT 化)を足すのは 3am 級の後悔なので、`lint-deps.mjs` に **3 行の binding denylist 走査**を同梱(費用ほぼゼロ・invariant ① を構造で強制)。cron の同意ゲートは K2 の V3-SEC-52 が担当し重複させない。
- **ponytail ceiling(defer 明記)**: FND-04 の「全 route Kernel 経由化」/ FND-05 の「実 R2 イベント全件の prev_hash 常時連結」/ FND-18 の「real parquet(現状 JSON バケット append で冪等マージを代替)」/ FND-15 の「全 FeatureNode への系譜メタ retrofit」は本波では**再利用可能な部品 + 決定論 TC** までを納品し、全面移行は後波(各要件 remaining が「C5 単波を超える可能性」と自認)。upgrade path=部品が既に緑なので配線のみ。

#### K7 批評家指摘(実装時反映・verdict=pass)

1. **[minor]** §1.3/§2 の FND-15 は「既存 canonicalJson + sha256(contracts.ts)を再利用・新規ハッシュ実装禁止」と指示するが、contracts.ts の sha256 は module-private(export されているのは canonicalJson/deriveActorId/deriveTransferCode/cosineSimilarity のみ・index.ts の export 一覧で確認)で、しかも Uint8Array を返し hex 化しない。computeLineageMeta は content_hash/lineage_hash を SHA-256 hex(64文字)で要求するため、そのままでは再利用不能。§2 の MODIFY 一覧に contracts.ts/index.ts への sha256Hex export 追加が含まれておらず、指示と repo 実態が齟齬する。
   - 反映: §2 MODIFY に『packages/truth/src/contracts.ts: sha256Hex(またはbytes→hex)を export 追加、index.ts の export 追加』を明記するか、computeLineageMeta 内で既存 crypto.subtle.digest + deriveActorId と同じ hex 変換を用いる旨を確定値に書く。『新規ハッシュ実装禁止』は digest アルゴリズムの新規実装禁止の意で、hex ラッパ追加は許容する旨を一文添える。
2. **[minor]** §2 NEW(schemas) は各 schema に『$schema + $id + x_ihl_req 必須(validate-schemas GATE)』と記すが、実 scripts/validate-schemas.mjs は $schema と $id の存在のみを検査し x_ihl_req は一切強制しない(scripts/ 全走査で x_ihl_req のenforcementヒットゼロを確認)。x_ihl_req は既存 schema の慣習であって GATE ではない。GATE が強制する、という repo ツーリングについての事実誤認。
   - 反映: 『x_ihl_req は既存 schema 慣習に倣い付与(GATE 強制ではない・validate-schemas は $schema+$id のみ検査)』へ表現を修正する。x_ihl_req を実際に GATE 化したいなら validate-schemas.mjs への検査追加を MODIFY 一覧に加える(任意)。

### K8 AI運用/開発プロセス(機械ガード化)

> 設計契約(実装エージェント向け正本)。参照: `docs/planning/c5/c5-cluster-table.md` §K8・`02-design/constitution.md` §4.4(機械 GATE)・§5(AI ファースト10ルール)・`docs/planning/c4/design-c4.md`(契約書式)。C2〜C4 の規約を全て引き継ぐ。コミット参照 ID = REPORT-ver3-phase-c5-2026-07-11。
> **性格**: K8 は「機械ガード化」クラスタ。**新 API route は 0 本**(サーフェス追加なし)。成果物は単一 mjs ガード + 既存 lint/CI チェーン結線・スキーマ・純投影/純書込ヘルパ・生成器・公開文書。過剰設計禁止(cluster 指示)。消化順は最後 — RTM 閉包は全クラスタ TC 確定後に enforce。
> **批評家修正反映(第1ラウンド)**: ①intent/culture-template の append パスを「`envelope.id === domain_id`(intent_id / version_id)規約 + `POST /events` 再利用」に一本化し §1.1/§1.2/§1.4 の矛盾を解消(新 route 0 本を維持)。②新イベント型 2 種の `envelope.ts`/`codegen-validators.mjs` 登録 + 再生成を必須手順として §2/§4 に明記。③market/ledger E2E に依存未達 skip 条項を追加(spec-thread と対称)。④rtm.csv/md 生成器(`gen-rtm-views.mjs`)を追加。⑤ai-view.machine_view の各フィールド型を確定値化。

#### 0. 対象要件 ID 一覧(13 件・1件も落とさない)

V3-AIP-05 / V3-AIP-22 / V3-AIP-32 / V3-AIP-34 / V3-AIP-35 / V3-AIP-36 / V3-AIP-40 / V3-AIP-45 / V3-AIP-49 / V3-AIP-50 / V3-AIP-68 / V3-AIP-76 / V3-AIP-80

#### 1. 確定値

##### 1.1 route 表(新規 0 本 — 既存 `POST /events` 再利用で確定)

| method | path | access | handler |
|--------|------|--------|---------|
| （新規なし） | — | — | — |

K8 は API サーフェスを増やさない。intent/culture-template の append は既存の汎用 `POST /events`(`apps/api/src/index.ts:103`・put-if-absent は storage 層強制・provenance.actor_id を session 主体へ force-stamp)を**そのまま**ネットワーク経路とする。

**append パスの一本化(批評家 F1 解消・案 A 採用)**:
- Truth キーは `POST /events` → `TruthStore.putEvent` が `truth/<type>/<envelope.id>.json` で確定する(`packages/truth/src/store.ts:56-64` 実測)。異なる `envelope.id` は異なるキーになるため、intent_id 単位の 409(二重登録拒否)を得るには **`envelope.id === data.intent_id`(両者 ULID)を必須規約**とする。この規約下で `POST /events` のキーは `truth/ihl.process.intent.v1/<intent_id>.json` に一致し、二重 intent_id は同一キー → put-if-absent で 409 になる。`putEventAt` は使わない(汎用 `putEvent` で足りる)。
- `appendIntent(s, actorId, data)` / `appendTemplateVersion(s, actorId, data)`(§1.4)は **route ハンドラではなく、envelope 構築 + `s.putEvent()` を行う純書込ヘルパ**。用途は (a) CI/ツール(意図台帳を打つ Node スクリプト)からの import、(b) tests からの直接呼び出し。両ヘルパは `envelope.id = data.intent_id`(または `data.version_id`)をヘルパ内で単一設定し `provenance.actor_id = actorId` を stamp する。V3-AIP-35 の「同一 intent_id 二重 append→409・Intent 追記のみ」はこのヘルパ経由でも `POST /events` 経由でも同一キーに収束し構造担保される(TC は appendIntent を 2 回呼び 2 回目 conflict を確認)。
- culture-template も同型: `envelope.id === data.version_id` 規約。

ai-profile は screen-defs と同じ「バンドル JSON をクライアントが読む」データ方式(BYOK 鍵はサーバ非保持=V3-SEC・LLM 既定 OFF=不変条項①)のため route 不要。reference_counter は投影関数(内部)で route 化しない。

##### 1.2 新イベント型(2 型・INSERT ONLY で append-only を構造担保)

| type 名 | schema ファイル | Truth キー構造 | 用途 |
|---------|----------------|----------------|------|
| `ihl.process.intent.v1` | `schemas/events/intent.schema.json` | `truth/ihl.process.intent.v1/<intent_id>.json`(= `envelope.id === intent_id` 規約により `putEvent` が導出) | V3-AIP-35/36 意図台帳。二重 intent_id=同一キー=409、UPDATE/DELETE 不能=追記のみ |
| `ihl.culture.template.v1` | `schemas/events/culture-template.schema.json` | `truth/ihl.culture.template.v1/<version_id>.json`(= `envelope.id === version_id` 規約) | V3-AIP-76 文化テンプレの版。fork=forked_from、diff/restore=版イベント列の投影 |

**envelope 形状**: 両型とも `dataschema` は `events/<name>.schema.json`(= `schemas/events/intent.schema.json` / `schemas/events/culture-template.schema.json`)を指す。`envelope.data` に下記 data を格納。`validateEnvelope` は `eventSchemaFor` が `EVENT_NAMES` に含む型のみ inner data を検証する(`packages/truth/src/envelope.ts:80-83` 実測)。**両型の `envelope.ts`/`codegen-validators.mjs` 登録 + validators 再生成が §2/§4 の必須手順**(批評家 F2 解消)。未登録なら inner data が無検証で R2 へ INSERT される。

`intent.schema.json` の data 必須キー: `intent_id`(ULID)・`spec_version`(string)・`intent_summary`(string)・`problem_statement`(string)・`expected_effect`(string)・`created_at`(date-time)・`schema_version`(string)。任意キー: `rejected_alternatives`(string 配列)・`decision_source`(string)・`commit_id`(string nullable — commit は intent 後に打たれるため)・`post_id`(string nullable — 知の広場 post_id は K6 BBS 依存)。`additionalProperties:false`・`$id`・`$schema`(draft 2020-12)・`x_ihl_req:"V3-AIP-35"` 付与。

`culture-template.schema.json` の data 必須キー: `template_id`(string)・`version_id`(ULID)・`kind`(enum `["ui_theme","board_structure","eval_axis"]`)・`body`(object)・`author_actor_id`(string)・`created_at`(date-time)・`schema_version`(string)。任意: `forked_from`(親 version_id・string nullable)・`note`(string)。`kind:"eval_axis"` の `body` は §1.3 evaluation-axis 構造に一致させる。`additionalProperties:false`・`x_ihl_req:"V3-AIP-76"`。

##### 1.3 新スキーマ(非イベント・validate-schemas GATE 対象)

| schema ファイル | 内容 | 要件 |
|----------------|------|------|
| `schemas/ai-profile.schema.json` | AI 機能ごとの差替可能プロファイル。必須: `feature_id`(string)・`provider`(string)・`model`(string)・`compute_tier`(enum `["low","medium","high","max"]`=UI ラベル 低/中/高/最高)・`byok`(bool・既定 true)。任意: `capabilities`(string 配列)・`cost`(object)・`latency`(string)・`rag`(object)・`prompt`(string・ユーザー編集可)。サーバ既定 API 鍵フィールドは**持たない**(BYOK のみ)。`additionalProperties:false` | V3-AIP-40 |
| `schemas/defs/ai-view.schema.json` | 二層ビュー再利用 def。他クラスタの要約/知識スキーマが `$ref` する。フィールド型は §1.3.1 で確定 | V3-AIP-45 |
| `schemas/evaluation-axis.schema.json` | 評価軸 3 層。`common`(満足度/再利用など既定軸)・`purpose`(用途別)・`custom`(野生の天才定義)の 3 配列(各 string 配列)。culture-template `kind:"eval_axis"` の body 契約でもある。`additionalProperties:false` | V3-AIP-76 |

`schemas/frozen/` は**一切変更しない**(CL-01〜13 形式凍結・対応 TC 緑化前変更禁止)。ai-view / 3 層タグは新規 def として追加し、既存 frozen スキーマに派生フィールドを注入しない。

###### 1.3.1 ai-view.schema.json フィールド型確定(批評家 F5 解消)

- ルート必須: `human_view`・`machine_view`・`tags`。`additionalProperties:false`。
- `human_view`: `string`(人間向け要約 1 本)。
- `machine_view`: object・必須 `sections`・`keypoints`、任意 `entities`・`topics`・`rag_chunk`・`importance`。`additionalProperties:false`。
  - `sections`: `string[]`(H2 見出しチャンク)。
  - `keypoints`: `string[]`。
  - `entities`: `object[]`(各要素 `{ "name": string(必須), "type": string(任意) }`・`additionalProperties:false`)。
  - `topics`: `string[]`。
  - `rag_chunk`: `string`(RAG 投入用連結本文)。
  - `importance`: `number`(範囲 `0`〜`1`・`minimum:0`・`maximum:1`)。
- `tags`: object・必須 `system`・`ai`・`user`(各 `string[]`)。`additionalProperties:false`。

##### 1.4 純関数(都度再計算・不変条項①)

| 関数 | 置場 | 種別 | 返却 | 要件 |
|------|------|------|------|------|
| `appendIntent(s, actorId, data)` | `apps/api/src/intent.ts` | 純書込ヘルパ(envelope 構築→`s.putEvent`) | `PutEventResult`(inserted/conflict/invalid) | V3-AIP-35 |
| `projectIntentChain(s, intentId)` | `apps/api/src/intent.ts` | 純投影(prefix scan) | `{intent_id, spec_version, commit_id, post_id}`(一意) | V3-AIP-35 |
| `projectReferenceCounter(s, targetRef)` | `apps/api/src/reference-counter.ts` | 純投影 | `number`(targetRef を参照する既存イベント数を prefix scan で都度カウント。**保存しない**) | V3-AIP-45 |
| `appendTemplateVersion(s, actorId, data)` | `apps/api/src/culture.ts` | 純書込ヘルパ(envelope 構築→`s.putEvent`) | `PutEventResult` | V3-AIP-76 |
| `projectTemplateDiff(s, verA, verB)` / `projectTemplateRestore(s, versionId)` | `apps/api/src/culture.ts` | 純投影 | diff=body の key 差分 object / restore=当該版 body | V3-AIP-76 |

- 書込ヘルパは `envelope = { id: data.intent_id|data.version_id, type, source, time, dataschema: "…/events/<name>.schema.json", data, provenance:{ actor_id: actorId } }` を組み立て `s.putEvent(envelope)` を呼ぶ(§1.1 の `envelope.id === domain_id` 規約をヘルパ内で単一設定)。route ハンドラではない。
- 置場は既存パターン踏襲(`projectLedger` が `apps/api/src/ledger-routes.ts`・`tests/ledger.test.ts` が `../apps/api/src/…` で import・確認済)。route を持たない純モジュールのため `*-routes.ts` でなく単独モジュール。

##### 1.5 screen-defs 追加(1 枚・Renderer 再利用・コード追加なし)

| file | 内容 | 要件 |
|------|------|------|
| `screen-defs/ai-profile-settings.json` | 計算資源目安 select(低/中/高/最高)+ BYOK 鍵入力 field + プロンプト編集 textarea。既存 Renderer ノード型のみ使用・「未実装/WIP」表記なし(V3-UIX-01) | V3-AIP-40 |

文化テンプレ fork UI(V3-AIP-76)・知の広場スレッド画面(V3-AIP-34)・market/ledger 画面(V3-AIP-49 の E2E 対象)は所有クラスタ K3/K4/K6 の screen-def。K8 はスキーマ・投影・ガードのみ提供(車輪の再発明回避)。K8 の E2E はこれら未産出時 skip する(§3・§5)。

##### 1.6 ガードスクリプト(各 単一 mjs + 既存チェーン結線)

| script | 結線先 | 内容 | 要件 |
|--------|--------|------|------|
| `scripts/check-rtm.mjs` | `npm run lint` 末尾 | `04-traceability/rtm.json` を読み、全実装対象要件 ID が ≥1 TC へ閉包しなければ fail。**5 点ゲート機械判定** = 各 ID の `test`(TEST 層)参照が空なら必ず fail(テスト設計ゲート免除不可)。他 4 ゲート(req/det/trn_ui/retrofit)は参照存在チェック。`rtm.json` の `mode:"warn"`(既定・C5 実装中)では違反を警告出力し exit 0、`mode:"enforce"`(C5 完了時に flip)で exit 1 | V3-AIP-05 |
| `scripts/check-req-freeze.mjs` | ci.yml PR step | `01-requirements/` の FR 本文が PR で変更されたのに同 PR が `docs/planning/rulings/` を触っていなければ fail(裁定参照必須)。base/head SHA は CI 環境変数。ロジックは既存「Frozen schema change gate」(ci.yml:29)の mjs 化・再利用 | V3-AIP-32 |
| `scripts/check-commit-msg.mjs` | ci.yml step | コミットメッセージが `[post_id] 変更理由 → 変更内容 → 影響範囲` 形式かつ意図メタ trailer(`intent_summary`/`problem_statement`/`expected_effect`/`rejected_alternatives`/`decision_source`)を持つか検証。**`BASELINE_REF`(=C6 開始コミット)より前の過去コミットは対象外**・C6 以降へ適用。post_id は K6 BBS 未実装の間 nullable 許容の warn。`.github/` git hook でなく CI ステップ | V3-AIP-36 |
| `scripts/gen-screendef-snapshots.mjs` | `npm run codegen` + `codegen:check` | `screen-defs/*.json` を走査し、各画面を Renderer で描画するスナップショット TC(GENERATED ヘッダ付き)を生成。`--check` で正本乖離を fail(codegen-validators と同パターン) | V3-AIP-50 |
| `scripts/gen-rtm-views.mjs` | `npm run codegen` + `codegen:check` | `04-traceability/rtm.json`(正本)から `rtm.csv`・`rtm.md`(GENERATED ヘッダ付き・人間閲覧用トレーサビリティ表)を生成。`--check` で乖離 fail。手編集禁止(AGENTS.md 禁止事項)。批評家 F4 解消 = 生成物の出所を確定 | V3-AIP-05 |
| `scripts/check-danger-code.mjs` | ci.yml PR step + 単体 TC | PR 差分を分類し、金銭系 API 実行・DNS/ドメイン操作・自己権限変更パターンを含む変更を fail(危険コードの物理ゲート=V3-AIP-68 の staging 昇格ガード)。判定関数を export し guards.test.ts が敵対サンプルで検証 | V3-AIP-68 |

全 mjs は Node 標準のみ(依存追加なし)・GATE ロジックを export 関数化(`check-ui-tokens.mjs` の `scanColors` 先例)し vitest から検証。

##### 1.7 データ・生成物・文書(新規)

| path | 種別 | 要件 |
|------|------|------|
| `04-traceability/rtm.json` | 正本(手書き・要件 ID→TC 参照) | V3-AIP-05 |
| `04-traceability/rtm.csv`・`04-traceability/rtm.md` | 生成物(`gen-rtm-views.mjs`・GENERATED ヘッダ・手編集禁止) | V3-AIP-05 |
| `ai-profiles/image-analysis.json`・`ai-profiles/rag.json`・`ai-profiles/newspaper.json`・`ai-profiles/translation.json`・`ai-profiles/market.json` | ai-profile 実体(5 機能・全 BYOK・LLM OFF) | V3-AIP-40 |
| `apps/web/src/renderer/screendef-snapshots.test.tsx` | 生成物(`gen-screendef-snapshots.mjs`・GENERATED ヘッダ・手編集禁止) | V3-AIP-50 |
| `docs/planning/c5/e2e-design.md` | 機能別 E2E 設計書(条件分岐網羅) | V3-AIP-49/50 |
| `docs/public/whitepaper.md`・`docs/public/protocol.md`・`docs/public/oss-release-plan.md` | 技術思想書・公開プロトコル構造・段階制公開計画。MANIFESTO/README/CONTRIBUTING/CODE_OF_CONDUCT/LICENSE は K2(V3-SEC-31)所有 — 重複回避 | V3-AIP-80 |

##### 1.8 凍結定数

- `rtm.json` の `mode`("warn"→"enforce" を C5 完了時に flip)= RTM 警告モードフラグ(cluster 指示の「警告モード」実体)。
- `check-commit-msg.mjs` の `BASELINE_REF`(C6 開始コミット・これ以前は不適用)。
- `ai-profile.schema.json` の `compute_tier` enum = `["low","medium","high","max"]`(UI 低/中/高/最高)。
- `culture-template.schema.json` の `kind` enum = `["ui_theme","board_structure","eval_axis"]`。
- `intent`/`culture-template` の `envelope.id === domain_id` 規約(§1.1)= append-only キー一意性の構造前提。
- `schemas/frozen/` は不変更(K8 は frozen 凍結定数を新設せず、上記は非 frozen 設定値)。

#### 2. 実装ファイル計画

**new:**
- `schemas/events/intent.schema.json`・`schemas/events/culture-template.schema.json`
- `schemas/ai-profile.schema.json`・`schemas/defs/ai-view.schema.json`・`schemas/evaluation-axis.schema.json`
- `apps/api/src/intent.ts`・`apps/api/src/reference-counter.ts`・`apps/api/src/culture.ts`
- `screen-defs/ai-profile-settings.json`
- `ai-profiles/image-analysis.json`・`rag.json`・`newspaper.json`・`translation.json`・`market.json`
- `scripts/check-rtm.mjs`・`scripts/check-req-freeze.mjs`・`scripts/check-commit-msg.mjs`・`scripts/gen-screendef-snapshots.mjs`・`scripts/gen-rtm-views.mjs`・`scripts/check-danger-code.mjs`
- `04-traceability/rtm.json`(正本)
- `04-traceability/rtm.csv`・`04-traceability/rtm.md`(生成物)
- `apps/web/src/renderer/screendef-snapshots.test.tsx`(生成物)
- `tests/intent.test.ts`・`tests/ai-profile.test.ts`・`tests/ai-view.test.ts`・`tests/culture-template.test.ts`・`tests/spec-thread.test.ts`・`tests/guards.test.ts`
- `apps/web/e2e/market.spec.ts`・`apps/web/e2e/ledger.spec.ts`
- `docs/planning/c5/e2e-design.md`・`docs/public/whitepaper.md`・`docs/public/protocol.md`・`docs/public/oss-release-plan.md`

**modify:**
- `packages/truth/src/envelope.ts`(批評家 F2 — `VALIDATOR_NAME` に `"intent":"intent"`・`"culture-template":"cultureTemplate"`、`EVENT_NAMES` に `"intent"`・`"culture-template"` を追加。これで `POST /events` が両型の inner data を検証)
- `scripts/codegen-validators.mjs`(批評家 F2 — `SCHEMAS` 表へ `["intent","events/intent.schema.json"]`・`["cultureTemplate","events/culture-template.schema.json"]` を追加。「Must stay in sync with envelope.ts」の対応維持)
- `packages/truth/src/generated/validators.cjs`(生成物 — 上記 2 スキーマ登録後 `npm run codegen` で再生成。手編集禁止)
- `package.json`(`lint` に `check-rtm.mjs` を追加、`codegen`/`codegen:check` に `gen-screendef-snapshots.mjs` と `gen-rtm-views.mjs` を追加)
- `.github/workflows/ci.yml`(V3-AIP-22: setup-python 3.12 + `pytest -q`(components/*/tests・.venv 除外)+ `npm run build -w apps/web` + `npm run typecheck -w apps/web` + design-gate step として `check-req-freeze`/`check-commit-msg`/`check-danger-code` を PR 実行)
- `apps/api/wrangler.toml`(V3-AIP-68: `[env.staging]` 追記・`ihl-ver3-truth-dev` バケット・workers.dev/dev サブドメインのみ。本番 route/ドメインは書かない)

**触らない:** `schemas/frozen/**`・`docs/generated/**`・既存 CL TC。

#### 3. TC 計画

- `tests/intent.test.ts`(V3-AIP-35): `appendIntent` を 2 回(同一 intent_id)→ 1 回目 inserted・2 回目 conflict(`envelope.id===intent_id` → 同一キー put-if-absent 409)/ `TruthStore` に UPDATE・DELETE 経路が非存在(CL-12 パターン再利用)/ `projectIntentChain` が intent_id→spec_version→commit_id を一意返却 / `POST /events` に intent envelope を投げた場合も同一キー・同一 409 挙動(ヘルパ経路とネットワーク経路の収束確認)。
- `tests/ai-profile.test.ts`(V3-AIP-40): `ai-profile.schema.json` で `ai-profiles/*.json` 全件 validate / AI 機能 5 件(image-analysis/rag/newspaper/translation/market)全てに profile ファイルが存在する(機能ごと profile 必須)/ 各 profile に既定サーバ鍵フィールドが無い(BYOK のみ)。
- `tests/ai-view.test.ts`(V3-AIP-45): `ai-view.schema.json` validate(human_view+machine_view の sections/keypoints/entities/topics/rag_chunk/importance §1.3.1 型 + 3 層タグ system/ai/user が string[])/ `importance` の 0〜1 範囲外を reject / `projectReferenceCounter` がイベント列から再計算した値と期待一致(保存値でなく都度再計算)。
- `tests/culture-template.test.ts`(V3-AIP-76): `evaluation-axis.schema.json` 3 層 validate / `appendTemplateVersion`→fork(forked_from 付き版 append)→`projectTemplateDiff`→`projectTemplateRestore` 往復一致 / 同一 version_id 二重 append→409。
- `tests/spec-thread.test.ts`(V3-AIP-34): 知の広場スレッド spec(K6 正本)を screendef スキーマ validate + route-matrix のナビ/権限整合(cl-04-route-matrix パターン再利用)。**K6 成果物依存** — spec ファイル未達なら本 TC は `test.skip` で明示し停止報告(§5)。
- `tests/guards.test.ts`(V3-AIP-05/32/36/68): check-rtm(合成 rtm に TEST 空 ID を入れて fail・全 ID 閉包で pass)/ check-req-freeze(FR 変更 & 裁定参照無しで fail)/ check-commit-msg(不正形式で fail・正形式で pass・`BASELINE_REF` 前コミットは pass)/ check-danger-code(金銭/DNS/権限変更サンプル diff で fail・無害 diff で pass)。各 mjs の export 関数を import。
- `apps/web/src/renderer/screendef-snapshots.test.tsx`(V3-AIP-50・生成物): 全 screen-def のスナップショット + `codegen:check`(gen-screendef-snapshots `--check`)GATE。
- `apps/web/e2e/market.spec.ts`・`ledger.spec.ts`(V3-AIP-49): dev-login→ScreenDef Renderer 実 UI で「入力→実行→保存」を通貫(observation.spec.ts ハーネス再利用・FakeR2 in-memory mock・テスト名 ASCII)。**依存 screen-def(K3 market.json / K4 ledger.json)未産出なら `test.skip` で明示し停止報告(§5)** — spec-thread と対称のガード(批評家 F3 解消)。
- V3-AIP-22: CI 実行(pytest/next build/tsc --noEmit/design-gate)緑を完了条件(vitest ファイルでなく `.github/workflows/ci.yml` 自体が GATE)。
- V3-AIP-05 の RTM 閉包 lint(`04-traceability/rtm.json` 全 ID→TC 閉包)+ `gen-rtm-views --check` は K8 最後に populate し `mode:"enforce"` へ flip。
- V3-AIP-80: 機械 TC なし(公開文書の起草・実公開は人間ゲート)。

#### 4. クラスタ内実装順序

1. スキーマ 5 本(intent/culture-template/ai-profile/ai-view/evaluation-axis)— 葉・依存なし。**続けて批評家 F2 の登録**: `envelope.ts`(VALIDATOR_NAME + EVENT_NAMES に intent/culture-template)と `codegen-validators.mjs`(SCHEMAS に 2 本)を修正 → `npm run codegen` で `validators.cjs` 再生成 → `codegen:check` 緑を確認。
2. 純書込/投影(intent.ts/reference-counter.ts/culture.ts)+ ai-profiles/*.json + ai-profile-settings.json。
3. 契約 TC(intent/ai-profile/ai-view/culture-template)緑化。
4. ガード 4 本(check-req-freeze/check-commit-msg/check-danger-code/check-rtm)+ guards.test.ts。check-rtm は `mode:"warn"` で導入(lint を赤で放置しない)。
5. 生成器 2 本(gen-screendef-snapshots.mjs / gen-rtm-views.mjs)+ 生成物 + `codegen`/`codegen:check` 結線。
6. E2E(market/ledger)+ e2e-design.md。K3/K4 の screen-def/route が緑なら実走、未産出なら skip + 停止報告(§5)。
7. spec-thread.test.ts(K6 成果物を参照。未達は skip + 停止報告)。
8. ci.yml 拡張(pytest/build/tsc/design-gate)+ wrangler.toml `[env.staging]`。staging 実デプロイ・dev worker secret 投入は実行直前に一言報告(承認済み・対外操作)。
9. `04-traceability/rtm.json` 正本 populate(全クラスタ TC 確定後)→ `gen-rtm-views` で csv/md 生成 → 全 ID 閉包確認 → `mode` を warn→enforce に flip・check-commit-msg の `BASELINE_REF` を確定。
10. 公開文書 3 本(whitepaper/protocol/oss-release-plan)起草。

#### 5. 分母除外・停止報告(人間ゲート由来)

- **V3-AIP-80(公開の実施)**: whitepaper/protocol/release-plan を完成品まで起草するが、OSS 公開の**実施**は人間ゲート(公開)。機械 TC なし・分母除外。
- **V3-AIP-68(運用ゲート)**: staging 昇格の物理ガード(check-danger-code)は自動 TC 化するが、**10 人規模レビュー・約 1 ヶ月試験運用・正式採用判断**は人間運用ゲート・分母除外。staging 実デプロイと dev worker への secret 投入(承認済み)は対外操作のため実行直前に一言報告。
- **V3-AIP-36(post_id 連携)**: `[post_id]` の実 post_id 採番は K6 知の広場(BBS)実装依存。K6 未達の間 post_id nullable の warn 運用・enforce は C6+。
- **V3-AIP-34(スレッド spec)**: スレッド spec 正本は K6 成果物。K8 は validate/整合 TC を用意し、K6 未達なら spec-thread.test.ts を `test.skip` で明示。
- **V3-AIP-49(market/ledger E2E)**: 実 UI E2E の描画対象 screen-def は K3(market)/K4(ledger)成果物。未産出なら market.spec.ts / ledger.spec.ts を `test.skip` で明示し停止報告(spec-thread と対称・批評家 F3)。K8 単独では E2E ハーネスと FakeR2 mock まで用意。
- **V3-AIP-40(BYOK 実鍵)**: 実 LLM 呼び出しは不変条項①で既定 OFF。BYOK 鍵はサーバ非保持(V3-SEC)。ライブ配線は opt-in まで対象外(未実装を「動く」と書かない)。
- **V3-AIP-05 warn→enforce flip / commit-msg baseline 確定**: C5 全クラスタ TC が緑化し RTM 閉包 100% を実測してから flip(それまで lint は warn で緑)。

#### K8 批評家指摘(実装時反映・verdict=fail)

1. **[major]** Intent/culture-template の append パスが自己矛盾。§1.1 は「新規 route なし・汎用 POST /events を再利用」と宣言するが、POST /events は putEvent 経由で Truth キーを truth/<type>/<envelope.id>.json(CloudEvents の ULID)で確定する(packages/truth/src/store.ts:56-64 実測)。一方 §1.2/§1.4 は Truth キー = truth/ihl.process.intent.v1/<intent_id>.json・put-if-absent で intent_id 二重登録=409 と主張し、これは putEventAt(§1.4 appendIntent の domain キー)でしか実現できない。V3-AIP-35 の核心 TC「同一 intent_id 二重 append→409・Intent 追記のみ」は、契約が明記した『POST /events 再利用・route なし』の配線では満たせない(異なる ULID→異なるキー→両方 inserted)。appendIntent() は定義されるが呼ぶ route が『新規なし』のため本番未配線で TC でしか動かない。
   - 反映: append パスを一つに確定せよ。案A: envelope.id === data.intent_id(両者 ULID)を必須規約とし POST /events のキーが intent_id で 409 になる旨を明記(この場合 appendIntent は不要か envelope 構築ヘルパである旨明記)。案B: appendIntent/appendTemplateVersion を putEventAt(truth/<type>/<intent_id|version_id>.json)で実装しそれを叩く route を追加(『route 0 本』宣言を撤回)。三者(§1.1/§1.2/§1.4)を無矛盾に書き直す。
2. **[major]** 新イベント型 2 種(ihl.process.intent.v1 / ihl.culture.template.v1)を POST /events で validate するには packages/truth/src/envelope.ts の VALIDATOR_NAME + EVENT_NAMES(L16-46)と scripts/codegen-validators.mjs のエクスポート表(L34「Must stay in sync」)の双方へ登録し validators を再生成する必要がある(実測: eventSchemaFor は EVENT_NAMES.has() で gating、未登録なら null を返し inner data 検証をスキップ)。しかし §2 の modify 一覧は package.json / ci.yml / wrangler.toml のみで envelope.ts と codegen-validators.mjs が欠落。このままでは intent/culture-template データが無検証で R2 へ INSERT される(または validatorFor が Unknown schema を throw)。
   - 反映: §2 modify に packages/truth/src/envelope.ts(VALIDATOR_NAME に intent/culture-template、EVENT_NAMES に "intent"・"culture-template" 追加)と scripts/codegen-validators.mjs(エクスポート表へ 2 スキーマ追加)+ npm run codegen 再生成を必須手順として明記。§4 のスキーマ工程にこの登録・再生成を組み込む。
3. **[minor]** apps/web/e2e/market.spec.ts・ledger.spec.ts(V3-AIP-49)は market/ledger の screen-def を Renderer で描画する前提だが、現 screen-defs/ には home/login/obs 系のみで market.json・ledger.json は無く K8 は追加しない(§1.5)。所有は K3/K4 だが cluster-table 上も market/ledger screen-def の産出は明示されず。spec-thread.test.ts には『K6 未達なら skip 明示・停止報告』があるのに market/ledger E2E には同等の依存未達ガードが無く非対称。
   - 反映: market/ledger E2E にも『依存 screen-def(K3/K4)未産出なら skip 明示 + 停止報告』条項を追加するか、K3/K4 成果物一覧に market/ledger screen-def 産出を明記して依存を確定させる。
4. **[minor]** §1.7 は『rtm.csv/md ビューは生成』と述べ AGENTS.md 禁止事項も rtm.csv|md を生成物扱いするが、§2 実装ファイル計画に csv/md を生成する generator が無い(check-rtm.mjs は閉包判定のみ)。生成物として参照される csv/md の出所が未定義。
   - 反映: csv/md を必要とする消費者が無いなら記述を削除(rtm.json 正本のみ)。必要なら gen-rtm-views.mjs を codegen 一覧へ追加し GENERATED ヘッダ付与を明記。
5. **[minor]** schemas/defs/ai-view.schema.json の machine_view(sections/keypoints/entities/topics/rag_chunk/importance)の各フィールド型・必須/任意・配列かオブジェクトかが未確定で『object: …』列挙のみ。実装者がそのまま書けない粒度。
   - 反映: machine_view 各キーの型(例 sections=string[] / entities=object[] / importance=number)と required 集合を確定値化。3 層タグ(system/ai/user)は string[] と型付け。
