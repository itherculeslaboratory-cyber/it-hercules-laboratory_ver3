---
id: REPORT-ver3-phase-c3-2026-07-11
title: Phase C3 実行レポート — 類似検索梯子 + CL-06/10 実サンプル + collector ingest(SwitchBot) + wiki-ingest ruri backend(CL-07 は裁定待ちで分母除外)
date: "2026-07-11"
status: active
---

# REPORT: ver3 Phase C3

> 自律実行（ultracode C3）。設計正本: `docs/planning/c3/design-c3.md`。計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C3・§5.2。
> 本レポートは feat(c3) 全コミットが参照する `REPORT-ver3-phase-c3-2026-07-11`。

## 状態

**完了条件 (i)(ii) 成立。(iii) は設計どおり分母除外(CL-07 は C3 冒頭の人間裁定待ち — 材料提出済み・実装未着手)。** 本レポートは実装は行わず、既存 feat(c3) 5 コミット + docs(c3) 1 コミットの実測検証・GATE 再走・報告文書の起票のみを担当。

最終 GATE 統合ラン(2026-07-11 本レポート起票時点・再走・ログ捏造なし・逐語):

```
$ npm run lint
filename lint OK
generated-file guard OK
agents-sync OK
schema validation OK
frontmatter check OK
codegen --check OK (18 files in sync)
codegen-validators --check OK
ui-tokens GATE OK
check-contrast OK (all ThemePack text pairs >= 4.5:1, both themes)

$ npm test              # npm test -w apps/api -w tests -w apps/web
@ihl/api           : Test Files 1 passed (1)   / Tests   1 passed (1)
@ihl/contract-tests: Test Files 19 passed (19) / Tests 167 passed (167)
@ihl/web           : Test Files 1 passed (1)   / Tests  15 passed (15)
  → 合計 183 passed / 0 failed(C2 納品時 156 → C3 で +27: contract-tests 140→167)

$ pytest -q              # repo 直下(bare CI・torch 無し)
....                                                                     [100%]
4 passed, 1 skipped in 0.15s
  → 4 passed = components/collector-switchbot/tests/test_collector.py(canonical_json 実 fixture 一致 + 署名 roundtrip、cryptography 実在で発火)
  → 1 skipped = components/wiki-ingest の parity TC(importorskip("torch") — bare 環境に torch 未インストールのため。§4 参照)
```

- `npm run lint` = **9 GATE 全 OK**。
- `npm test` = apps/api 1 + tests 167(19 files)+ apps/web 15 = **183 passed / 0 failed**(C2 の 156 から contract-tests が 140→167 に +27。内訳は下表「C3 で実装したもの」参照)。
- `pytest -q`(repo 直下・bare)= **4 passed, 1 skipped**。skip は torch 依存の parity TC(component venv でのみ発火する設計。§4 参照)。CI を割らない意図的 skip。

## 完了条件(design-c3.md §0)達成実測

| 条件 | 内容 | 判定 | 実測根拠 |
|---|---|---|---|
| (i) | 既存 R2 埋め込み(384)に対する類似検索 TC green(CL-08 回帰維持・既存 156 テストを割らない) | **成立** | `tests/observation-search.test.ts`(8 tests, green): 3 段梯子(whitelist→subset→embedding)+ `ladder_stage` レスポンス, 768 次元候補の遮断(結果集合から除外を厳密 assert), 768 次元クエリ→400 `QUERY_DIM_MISMATCH`, 同一入力2回で結果同一(決定論), 未認証→401, embedding manifest 不在→400 `QUERY_EMBEDDING_NOT_FOUND`。既存 CL-01〜13 削除ゼロ(`tests/cl-01`〜`cl-13` 全 13 ファイル green 維持)。既存 156 テスト起点から破壊なし(183 全 green) |
| (ii) | ruri-v3-70m backend の PyTorch/ONNX cosine 一致検証ログ | **成立** | `docs/planning/c3/ruri-parity-evidence.md` — 入力 6 本すべて cosine=1.000000(worst/mean とも 1.000000 ≥ 閾値 0.999)。所要 206s(時間ガード 30 分に余裕)。component venv 内 `pytest -q` で 2 passed(実 assert)。bare CI では `importorskip("torch")` で 1 skipped(機械 GATE を割らない設計・本レポート起票時の pytest 再走でも同結果を再確認) |
| (iii) | CL-07 thumbnail 比較 TC は分母除外 | **成立(停止報告)** | 下記「CL-07 — 人間ゲート待ち」節。材料 `docs/planning/c3/cl-07-thumbnail-options.md` 提出済み。**実装・`schemas/frozen/thumbnail.schema.json` の変更は一切なし**(`git diff` で確認 — C3 期間中 frozen ディレクトリへの変更コミットはゼロ) |

## CL-07 — 人間ゲート待ち(実装未着手・裁定材料のみ提出)

第6回裁定⑤により CL-07(png vs JPEG)は「thumbnail 経路の実装方式と不可分」として C3 冒頭の人間裁定に予約されている。本パスは**調査のみ**を行い、`docs/planning/c3/cl-07-thumbnail-options.md`(4 候補比較・6 軸表・Web 出典 2026-07 取得)を起票した。frozen スキーマ・実装コードへの変更はゼロ。

裁定が必要な **4 点**(同ドキュメント §5 より):

1. **形式 = JPEG で確定してよいか**(推奨: JPEG。ver2 実出力は PNG・要件文は JPEG・4 候補すべて両対応で裁定を狭めない)。
2. **実装経路の第1手 = (a) jSquash on Workers でよいか**($0 硬制約なら (b) Cloudflare Images に切替。(d) VPS 残置は fallback として文書に残す承認のみ求める)。
3. **受け入れ条件を「バイト級互換」→「契約級互換」に読み替えてよいか**(バイト級はどの候補でも成立不能・ver3 は greenfield で守るべき本番バイト列が存在しないため)。
4. **EXIF transpose を ver3 の正しい挙動として採用してよいか**(【事実】ver2 実装は EXIF transpose を一切呼んでいない — `ihl-ver2/libs/ihl/observation/image.py` に `exif_transpose` 呼び出しなし。frozen description の「実装済み」表現は実体と不一致 — 訂正は裁定後の別作業)。

上記 2 は経路選択(不可逆でない)。1・3・4 は契約確定(frozen `format` const 付与・description 訂正を伴う可能性があり、対応 TC 緑化ゲート必須の別作業)。裁定後の実装・スキーマ変更は本レポートの範囲外。

### 追記(2026-07-11 第10回裁定 → 実装完了)

第10回ユーザー裁定(`docs/planning/rulings/user-ruling-2026-07-11-round-10.md`)で 4 点すべて YES 確定(形式=JPEG / 経路=jSquash on Workers / 比較=契約級互換 / EXIF transpose=採用)。これを受け CL-07 を実装完了(完了条件 (iii) の分母除外を解消):

- `apps/api/src/thumbnail.ts` — `@jsquash/jpeg`(decode/encode・`preserveOrientation` で EXIF transpose)+ `@jsquash/resize`(長辺512px lanczos3)で JPEG thumbnail を生成。PNG/JPEG 入力両対応。wasm 初期化は Node(vitest、fs→`WebAssembly.Module`)/ Workers(静的 `*.wasm` import=`thumbnail-wasm-workers.ts`・@vite-ignore で分離)両対応。Workers 経路は C6 デプロイ人間ゲートまで未実測(Node 経路は TC で実測)。
- upload 経路(`observation-routes.ts` POST `/observation/upload`)に**ベストエフォート**統合: R2 `media/thumbnail/<photo_id>` に put-if-absent + frozen 準拠 manifest(`ihl.obs.thumbnail.v1`)を append。非画像は decode 失敗を握りつぶし upload は 202 継続(原本 blob + photo event が append-only truth)。
- frozen `schemas/frozen/thumbnail.schema.json` の `format` に `const:"jpeg"` 付与 + description に本裁定を追記(frozen 変更ゲート準拠 — 同一コミットで TC 書き換え)。codegen 再実行(schema-types / validators.cjs)。
- TC: `tests/cl-07-thumbnail.test.ts` を「png invalid・jpeg valid の negative TC」へ書き換え。契約級比較 TC `tests/cl-07-thumbnail-pipeline.test.ts` 新設(EXIF Orientation=6 のスクリプト生成 JPEG を実 upload → 出力の JPEG マジック/長辺512px/orientation 適用寸法/manifest validate green を assert・PNG 入力両対応・非画像ベストエフォートも検証)。
- 実測: `npm run lint` green / `npm test` green(215 → 225 tests・既存 215 は無傷)。参照 REPORT-ver3-phase-c3-2026-07-11。

## C3 で実装したもの(feat(c3) コミット群)

| commit | 内容 |
|--------|------|
| ca952ee | 類似検索の決定論梯子 `POST /observation/search`(whitelist→subset→embedding・`ladder_stage`・768次元遮断・384クエリ不一致 400) |
| 9608069 | `components/wiki-ingest` に ruri-v3-70m backend 追加 + PyTorch/ONNX 一致検証(cosine=1.0・`ruri-parity-evidence.md`) |
| dd382e3 | CL-06 親子参照 + CL-10 実トークン解決 TC(`tests/fixtures/cl-06-10-lineage-samples.json` — individual_id は ihl-ver2 2026-06-26 UAT サインオフ実 capture_id 由来の実値、lineage リンクは合成配線、qr_token は ver2 実コードパス出力を再利用。実サンプル発見状況を `_meta.provenance` に正直に記載) |
| 4fd21cf | collector ingest `POST /api/v1/collector/ingest`(Ed25519 署名認証・改竄/未登録/リプレイ negative TC 込み)+ `components/collector-switchbot`(SwitchBot Cloud API 単発コレクタ) |
| 95c9592 | `docs/planning/c3/design-c3.md` を追跡化(それまで untracked のまま参照されていた — clone 不能を解消。批評家 major 指摘への修正) |

## SwitchBot 実 API smoke(design-c3 §3「実 API smoke は 1 回だけ試行」)

本レポート起票時に 1 回だけ実行(`--fetch-only` = 一覧取得のみ・署名/POST なし・冪等な読み取り専用呼び出し)。

```
$ python components/collector-switchbot/run.py --fetch-only --env-file D:\env\local.env
[collector] SwitchBot API OK: 13 device(s)
[collector]   Plug Mini (JP)  id=0C4EA0...
[collector]   Plug Mini (JP)  id=0C4EA0...
[collector]   Humidifier  id=30C922...
[collector]   Plug Mini (JP)  id=58E6C5...
[collector]   Hub 3  id=B0E9FE...
[collector]   Standing Fan  id=B0E9FE...
[collector]   WoIOSensor  id=E77643...
[collector]   WoIOSensor  id=E85500...
[collector]   WoIOSensor  id=E85503...
[collector]   WoIOSensor  id=E876C0...
[collector]   WoIOSensor  id=E876C1...
[collector]   WoIOSensor  id=E876C4...
[collector]   Hub Mini  id=F24D50...
```

**結果: 成功。** `SWITCHBOT_TOKEN`/`SWITCHBOT_SECRET` は `D:\env\platform.env`(design-c3 §3 の既定 env ファイル)には無く、`D:\env\local.env` に実在した(design-c3 §3 の記述と実配置が食い違うが、実値は存在し疎通確認できた)。実デバイス 13 台のうち `WoIOSensor`(温湿度計)6 台を検出 — CL-09 ingest 経路の実 device_id ソースとして使用可能。**署名付き ingest への実 POST は未実施**(`COLLECTOR_PRIVATE_KEY_PEM`/`INGEST_URL` は本サンドボックスに実鍵が無く、実鍵投入・ワーカー本番デプロイは人間ゲート範囲のため対象外。design-c3 §3 の「1 回だけ試行」はこの `--fetch-only` 疎通確認で充足したと判断し、2 回目の試行はしない)。

## 批評家ゲート通過記録(AGENTS.md 不変条項⑤ / 既定契約 1)

独立批評家を **2 観点**で通し、**修正 1 ラウンド**で major を解消した。

| 観点 | 判定 | 主な指摘・検証内容 |
|---|---|---|
| ① 仕様適合(design-c3 §0〜§4 突合・出典実在・独立再実行) | fail→**解消** | 第1パス指摘(major): `docs/planning/c3/design-c3.md` が untracked のまま参照され、クローンでは正本が存在しない(トレーサビリティ欠落)。修正: 95c9592 で追跡化。再検証(pass): feat(c3) 実装を design-c3.md §0〜§4 と突合し主要な主張を独立再実行で検証、全6観点で実質適合を確認 — (1) 梯子3段+`ladder_stage` は契約どおりで決定論 TC も実在・緑、(2) dim≠384 遮断 TC は実在(768次元候補の遮断を結果集合で厳密 assert + 768クエリ 400)、(3) CL-06/10 fixture の出自(実 ID/合成リンク/実コードパス QR)が `_meta` に正直に記載され実体と一致、その他 collector ingest の署名検証・wiki-ingest の parity ログが design 通りであることを確認 |
| ② 回帰・機械 GATE(CL-01〜13 回帰／lint・test 実測) | **pass** | 回帰・GATE 観点の実測結果は全て green。`npm run lint` = 9 GATE 全 OK(filename/generated/agents-sync/schema/frontmatter/codegen 18 files in sync/validators/ui-tokens/contrast)。`npm test` = api 1 + contract-tests 167(19 files)+ web 15 = 183 passed / 0 skipped。既存 156 テストから削除ゼロで純増 27 本(C2 156→C3 183)。CL-01〜13 negative TC は全 13 ファイル green 維持で回帰なし |

> 批評家は feat(c3) 4 コミット(ca952ee/9608069/dd382e3/4fd21cf)時点で走行し①で major 1 件(design-c3.md 未追跡)を検出。95c9592 で解消し再検証、両観点とも **pass**。本レポート起票時に `npm run lint` / `npm test` / `pytest -q` を独立に再走し同結果を再確認済み(上記「状態」節)。rubber-stamp なし。

## 成果物一覧

- **新規スキーマ**: `schemas/api/observation-search.schema.json`(search リクエスト正本 → codegen。`schemas/frozen/` は無変更)。
- **API**: `apps/api/src/observation-routes.ts`(`POST /observation/search`)・`apps/api/src/collector-routes.ts`(`POST /collector/ingest`)・`apps/api/src/index.ts`(PUBLIC_ROUTES に collector/ingest 追加・自己ゲート)。
- **TC 新規**: `tests/observation-search.test.ts`(8)・`tests/collector-ingest.test.ts`(7)・`tests/cl-06-10-real-sample.test.ts`(12)— 計 +27(140→167)。
- **components**: `components/wiki-ingest/`(ruri-v3-70m backend + `parity_check.py` + `tests/test_parity.py`)・`components/collector-switchbot/`(`run.py` + `tests/test_collector.py`)。
- **fixtures**: `tests/fixtures/cl-06-10-lineage-samples.json`(実個体ID+合成リンク+実QRコードパス、出自を `_meta` に記載)。
- **文書**: `docs/planning/c3/cl-07-thumbnail-options.md`(裁定材料)・`docs/planning/c3/ruri-parity-evidence.md`(parity 逐語ログ)・本レポート。
- **`.env.example`**: collector ingest 用キー 8 種を型のみ追記(`COLLECTOR_PUBLIC_KEYS`/`SWITCHBOT_TOKEN`/`SWITCHBOT_SECRET`/`COLLECTOR_ID`/`COLLECTOR_PRIVATE_KEY_PEM`/`INGEST_URL`/`COLLECTOR_USER_ID`/`COLLECTOR_PLACEMENT_ID`。実値なし)。

## 残課題

### 人間ゲート待ち(AI では確定しない)

- **CL-07 裁定 4 点**: 上記「CL-07 — 人間ゲート待ち」節。材料提出済み・実装未着手。
- **Resend 実鍵投入**: C2 から持ち越し。`RESEND_API_KEY` は D:\env に依然不在(本レポート起票時に platform.env のキー一覧を再確認 — 値行はあるが空欄)。投入時期は AI 委任済み(第6回裁定④)だが鍵自体が未取得のため投入不能。
- **collector ingest 実鍵・本番投入**: `COLLECTOR_PRIVATE_KEY_PEM`・`COLLECTOR_PUBLIC_KEYS`・`INGEST_URL`(本番 Workers URL)の実配線は「実鍵・本番鍵の投入」ゲートに該当。SwitchBot トークン自体は D:\env\local.env に実在し疎通確認済み(上記節)だが、Ed25519 コレクタ鍵ペアの生成・登録・本番 ingest への実 POST は未実施。

### 後続(可逆・次フェーズ)

1. CL-07 裁定が下り次第、frozen `format` const 付与 + description 訂正(対応 TC 緑化ゲート必須の別作業)+ 選定経路(jSquash on Workers 等)の実装。
2. wiki-ingest ruri backend は既定 OFF のまま(不変条項①)。実用化配線(wiki ingest CLI から実際に呼ぶ経路)は C3 スコープ外・別判断。
3. `pytest -q` の 1 skip(wiki-ingest parity)は bare CI の意図的挙動(component venv 限定で実 assert)。CI に torch を足す予定なし(10年コスト最小 — 不変条項①)。
