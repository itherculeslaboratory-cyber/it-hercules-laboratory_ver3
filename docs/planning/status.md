---
id: V3-STATUS
title: 本番状態・直近タスク・人間ゲート
date: "2026-07-17"
status: draft
---

# ステータス（spine #5）

> 更新のたびに「今どこ / 次 / 人間ゲート」の 3 節を最新化する。設計正本の永久配置はしない（Working）。

## 今どこ

**Phase C8 全機能実装完了ラン 進行中**（`docs/planning/c8/PLAN-c8-full-run.md`・台帳 T-38）。**第16回ユーザー裁定 反映完了**（2026-07-17 — `docs/planning/rulings/user-ruling-2026-07-17-round-16.md`）: 質問シート全49問クローズ、新規採番14件（決済P2P二方式 V3-MKT-62/63/65・クラッチ二層アイデンティティ V3-IND-36・magic-link数字コードverify V3-AUT-46・Truthバックアップ二重化 V3-CST-09 他）+ 既存18件patch（うち V3-FND-13 は確定→**棄却**・第1波→対象外で round-3 ruling_note を formalize、V3-AIP-61 は close/hold解除）。**決済方針が確定**: GMOあおぞら銀行は退役（個人事業主に本番API非提供・公式一次情報）、ユーザー間決済はP2Pユーザー選択二方式（①銀行振込直接・IHL非関与 ②PAY.JP Platformカード決済・5%自動控除）、IHL宛システム維持費徴収にPayPay OPAを追加、PayPay個人間送金機能は規約で利用禁止（PayPay残高規約第7条）。フォーク10%は金銭還元でなく貢献度(karma)分配と意味確定。PTチャージ（金銭でのPT購入）は廃止。総数 **735 → 749**（確定659/確定(修正)87/棄却3・保留0）。registry.json / srs.md（v1.9→**v1.10**）へ機械反映済み・検算恒等式2本とも実測一致。

**C8 進捗（2026-07-17 実測・wave-3反映・`docs/planning/c8/progress.json` 集計）**: 全体 334件中 done 128(38%)・in_progress 23・blocked 3・todo 180。**第1波必達(required) 184件中 done 125(67.9%)**・in_progress 23・blocked 3・todo 33。**第2波ベストエフォート(best-effort) 150件中 done 3(2.0%)**・todo 147。前回実測(同日朝・commit 5c30b9b)比 required done 122→125(+3)は `6b38140`(IND系progress実態同期・wave-2報告欠落の修復)による既存実装の状態訂正で、新規実装コミットはゼロ。詳細は `docs/planning/c8/progress.md`(生成物)。要件ID↔TCカバレッジは `docs/planning/c8/tc-coverage-c8.md` に機械集計（必達doneのうち機械的にTC根拠を確認できた分＝94/125=75.2%、根拠付きgreen率100%。前回版の2箇所の誤り—best-effort 3件のTC根拠有無・rtm.json重複8件のstatus内訳—も本版で訂正済み）。本ラン実測: `npm run lint` 21 GATE 全OK／`npm test` 165 files・1395 passed・0 failed（前回と同一・テストコード無変更を確認）／`pytest -q` 49 passed・1 skipped（前回と同一）／`npm run e2e` は本ランでは完走前に集計を確定・前回実測60/60 greenは`HANDOFF-c8-session2.md`§0参照。

**裁定待ち(blocked) 3件**（`docs/planning/c8/progress.json`・詳細は `progress.md` §blocked一覧）:
- **V3-AIP-92**（Builder文明編集ツール）: round-16でBuilder中心アーキ棄却済みのため、既存codegenパイプラインを機能的等価物として充足扱いにする裁定を推奨(未裁定)。
- **V3-AUT-15**（観測系routeの未ログイン公開READ）: CL-04 route-matrix凍結契約（auth系3route以外は全protected）と直接矛盾。将来波でのCL-04契約緩和裁定待ち。
- **V3-SEC-03**（外部API鍵のサーバー側非保持）: 現行`device-routes.ts`はAPI鍵をサーバー側AES-GCM暗号化保持しており要件と矛盾。ユーザー側管理への一本化裁定待ち。

**外部照会 送信済み・回答待ち**: PAY.JP／PayPay OPA の両照会は送信済み（`docs/planning/c8/inquiry-drafts.md`）。回答受領後にPlatform自動控除（PAY.JP）実装ゲートが解除される（受領10-3）。

**Phase C7 完了**（2026-07-12 — `docs/planning/c7/`）。重要5画面ワイヤー（`wireframes-core5.md`）+ usecase-driven 設計 grilling（`usecase-driven-design.md`）+ 実画面検証（下記）。

**Phase C6 完了(cutover 直前で停止 — 実施は人間ゲート)**(2026-07-11 — `docs/planning/c6/REPORT-ver3-phase-c6-2026-07-11.md`)。突合ハーネス(`scripts/reconcile-harness.mjs`・GET 限定強制・TC10)+66 route readiness 表+**staging 実機稼働**(`ihl-api-ver3-staging.…workers.dev`・dev R2・cron 無効・deny-by-default/dev token を実測)。**P0 所見: 旧 API は保護 route 12 本を未認証開放**(新側が正・`cutover-readiness.md` §3)。E2E 実走で結合実バグ(form→confirm 値引き継ぎ欠落)を検出し汎用 draft 機構で根治 → `npm run e2e` 3/3 green。批評家 FAIL 指摘(§0 過大主張)を反映して納品。**残る cutover 5 手順は全て人間ボタン**(`cutover-readiness.md` §4)。

**Phase C5 完了・納品**（2026-07-11 — `docs/planning/c5/REPORT-ver3-phase-c5-2026-07-11.md`）。第1波 S+A 帯の実装対象 **139 件を 8 クラスタ(K1〜K8)で消化**(分析母集合 190 件・hold 2 件停止報告)。**wave 受入 PASS: 自動化可能 TC 145 本中 green 142 = 97.9% ≥ 80%**（`docs/planning/c5/tc-coverage.md`・deferred-e2e 3 本は C6 staging 実走・missing 0）。知の広場は **PROTECTED のまま実装完了**(Zulip型topic+Polis型投影・第8回裁定準拠)+ G1〜G6 判定材料完成（`plaza-gate-materials/`・HG-KN-01〜08 は帰宅後裁定）。第12回裁定で LICENSE=Apache 2.0 確定・トークン目標 4500k。**納品前 再走実測**: `npm run lint` **20 GATE 全 OK**(C4 の 9 → +11) / `npm test` = **851 passed・3 skipped**(C4 215 → +636) / `pytest -q` = **11 passed・1 skipped**。批評家実績: 分析11群+設計8+実装16+広場6+横断監査2 — 横断監査 major 1(GATE数誇張)・minor 1(生NULバイト)は納品前に修正済み。

**Phase C4 完了（完了条件 (ii) は第11回裁定で受入クローズ — 残余1点は本番初入金で確定）**（2026-07-11 — `docs/planning/c4/REPORT-ver3-phase-c4-2026-07-11.md`）。完了条件 (i)(iii) 成立・(ii) は設計どおり「実疎通実測 + 擬似入金実行のみ停止報告」で成立。台帳+カルマ二層（投影で残高/カルマ都度再計算・`GET /me/ledger` 本人スコープ・Fibonacci カルマ判定 V3-KRM-02）+ GMO sunabar 照合（接続層 `sunabar`/`live` 分離・名前照合ポーリング・実 sunabar 疎通 HTTP 200 実測・擬似入金の作成 API 機構を契約確定・振込実行は権限分類器が拒否し停止報告）+ マーケット骨格（`ihl.mkt.listing.v1`・出品/一覧/詳細 route）。批評家 2 観点/1 ラウンドで major（人間ゲート正本表への反映漏れ）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK（codegen 19 files in sync）/ `npm test` = apps/api 1 + tests 199 + apps/web 15 = **215 passed / 0 failed**（C3 183→+32）/ `pytest -q` = **4 passed, 1 skipped**（C3 から変化なし）。

**Phase C3 完了（CL-07 裁定待ちを除く）**（2026-07-11 — `docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md`）。完了条件 (i)(ii) 成立・(iii) は設計どおり分母除外（CL-07 は C3 冒頭の人間裁定待ち — 材料 `docs/planning/c3/cl-07-thumbnail-options.md` 提出済み・実装未着手）。類似検索の決定論梯子（whitelist→subset→embedding・`ladder_stage`・768次元遮断）+ CL-06/10 実サンプル TC（ihl-ver2 UAT サインオフ実個体ID + 実QRコードパス）+ collector ingest（Ed25519 署名認証）+ SwitchBot 単発コレクタ + wiki-ingest ruri-v3-70m backend（PyTorch/ONNX cosine=1.0 一致検証済み）。批評家 2 観点/1 ラウンドで major（design-c3.md 未追跡）解消。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 167 + apps/web 15 = **183 passed / 0 failed**（C2 156→+27）/ `pytest -q` = **4 passed, 1 skipped**（skip は torch 依存 parity TC・bare CI の意図的挙動）。SwitchBot 実 API smoke（`--fetch-only`）は成功（実機 13 台検出）。

**Phase C2 完了・納品**（2026-07-11 — `docs/planning/c2/REPORT-ver3-phase-c2-2026-07-10.md`）。受け入れ **(a)(b)(c)(d) 全成立**・批評家 4 観点/3 ラウンド通過（第3パス fix3 で §7 実ブラウザ通貫 E2E を Chromium 実機で実走・green 実測して (c) を解消）。認証（署名付きステートレスセッション）+ 観測コア API 8 route + ScreenDef Renderer（データ束縛ランタイム）+ CL-04 57route 照合 + CL-08 vector_length=384 訂正。**納品前 再走実測**: `npm run lint` 9 GATE 全 OK / `npm test` = apps/api 1 + tests 140 + apps/web 15 = **156 passed / 0 failed** / `npm run e2e -w apps/web` = 実ブラウザ **2 passed / 0 failed**（`docs/planning/c2/e2e-evidence.md`）。要件 ID↔TC = `docs/planning/c2/tc-coverage.md`（自動化可能 16/16 green = 100%・V3-FND-02 のみ否定的アーキ制約で分母除外）。

**Phase C1 完了**（2026-07-10 — `docs/planning/c1/REPORT-ver3-phase-c1-2026-07-10.md`）。

- CL-01〜13 negative TC 全 green（`tests/cl-01`〜`cl-13`・13 ファイル / 101 テスト。RED→GREEN 逐語ログ = `docs/planning/c1/tc-red-green-log.md`）。以降これが回帰条件 — 1 本でも赤に転じた PR は fail（開発計画 R-03）。
- R2 put-if-absent は**実機検証済み・mode=storage**（実バケット `ihl-ver3-truth-dev` で 2 重 put → 先勝ち・後発 null。証跡 = `docs/planning/c1/r2-put-if-absent-evidence.md`）。append-only はストレージ層強制。
- append-only 基盤 = `packages/truth`（envelope 検証 / TruthStore put-if-absent / contracts 移植）+ `apps/api` deny-by-default + `POST /events`。
- schemas/ → TS 型 codegen（`scripts/codegen-schemas.mjs`）が root lint チェーン = CI で回る（完了条件③）。

## 次（最優先）

**C8 全機能実装完了ラン（`docs/planning/c8/PLAN-c8-full-run.md`）**: 第1波残 170 件（partial 68 + design_only 46 + not_started 56）を必達、第2波 約173件はベストエフォート（Q-SCOPE-01・進捗機械追跡機構=`docs/planning/c8/progress.json`/`progress.md` で必須成果物化済み）。

0. **決済スタック実装**: P2Pユーザー選択二方式（V3-MKT-62 銀行振込直接/PAY.JP Platform）+ 5%ゆる請求（V3-MKT-63）+ PayPay OPA連携 + プリペイド案内（V3-MKT-64）。GMO connector・gmo webhook route 6本は実装せず廃止（OQ-ROUTE-02）。旧 pt_topup（PTチャージ）コード削除。
1. **machines-environment-io 統合**（別セッション成果を本ランへ統合済み・Q-META-02）: V3-OBS-32 汎用CSVインポート（機器選択→CSV→期間重複put-if-absent自動スキップ）+ series改名LWW投影 + source-count最充足のbucketキー拡張。
2. **market 残route再設計**: onboarding系2route(status/complete)は廃止（locale+handle 2ゲート収束済）。market transfer/match 2routeはV3-IND-35（割り出し予約自動マッチング）の実装先として再設計。
3. **重要5画面の残り2画面**（market-trade / knowledge-thread）を `docs/planning/c7/wireframes-core5.md` §3/§5 準拠で再構築（UIレーン先頭）。
4. **UI方針**: usecase-driven（画面ごとに「なぜユーザーが来るか」から出発）× reuse-first（既製OSS/GitHub資産を広く収集してカスタマイズ・一から作らない）。ver2 `ihl-ui-catalog` の丸ごと移植は不採用。
5. 余力枠: 動画システム準備(V3-VID-33/34)・技術記事/SNS パック(V3-AIP-102/103)・検索グラフビュー(V3-UIX-82)・写真解析/embedding実行場所設計(V3-AIP-104)。
6. **cutover 実行**(第13回裁定: 技術手順 1〜4 は AI・各不可逆ボタン直前一言報告・ユーザー在席時推奨。VPS 解約のみ人間)。P0(旧API未認証開放)は cutover 前倒しで自然解消と裁定済み。
7. 残人間ゲート: 下記表参照(hold 2 件 V3-FND-13/V3-AIP-61 は第16回裁定でクローズ済・もう残らない)。

### C3 からの持ち越し

- CL-07 裁定 4 点（下記人間ゲート表）。裁定後の実装・スキーマ変更は別作業。
- collector ingest 実鍵・本番投入（Ed25519 鍵ペア生成・登録・本番 Workers ingest 実 POST）は未実施 — 人間ゲート「実鍵・本番鍵の投入」に該当（`docs/planning/c3/REPORT-ver3-phase-c3-2026-07-11.md` 参照）。

## 人間ゲート一覧（AI では確定しない）

| ゲート | 内容 | 状態 |
|--------|------|------|
| LICENSE 確定 | **Apache 2.0 に確定**(第12回裁定 2026-07-11・`rulings/user-ruling-2026-07-11-round-12.md`)。公開の実施は別ゲートのまま未 | 済 |
| CL-07 裁定 4 点 | 第16回裁定で確定: ①形式=JPEG確定 ②実装経路第1手=jSquash on Workers（$0硬制約時のCF Images代替・VPS残置はfallback文書残置のみ） ③受け入れ条件を「契約級互換」に読み替え(バイト級互換は放棄) ④EXIF transpose を ver3 の正しい挙動として採用。**schemas/frozen の実変更は対応TC緑化を伴う実装フェーズで実施**（本裁定は記録のみ） | 済(設計) |
| Resend DNS（CF トークン権限） | DNS 検証完了・`auth@it-hercules.uk` 実送信確認済（2026-07-11）。`RESEND_API_KEY` は D:\env\platform.env に格納済み | 済 |
| GMO 本番契約・live 昇格 | **第16回裁定でゲート消滅**: 個人事業主に本番APIが提供されないため GMO あおぞら銀行 API を退役。決済照合は P2P二方式（V3-MKT-62/63）へ移行。C4 (ii) 残余1点（U-code remarks文字変換）は GMO 廃止に伴い確定不要化 | 消滅(退役) |
| PAY.JP 本番アカウント申込 | 個人事業主・昆虫マーケット運営+システム維持費5%徴収の用途で申込。AI申込文面の起草までは自走可（Q-PAY-02推奨）・**照会は送信済み(受領10-3)・回答待ち** | 送信済み・回答待ち |
| PayPay OPA 照会・並行申請 | 固定店舗なし個人事業主の契約可否・実料率・審査期間を照会のうえ並行申請。IHL宛システム維持費徴収へPayPay追加用途。**照会は送信済み(受領10-3)・回答待ち** | 送信済み・回答待ち |
| 郵便局デジタルアドレス商用可否の裏取り | V3-MKT-20（匿名配送）が用いる外部URL中継方式の商用利用可否・一次情報の法務裏取り | 未 |
| 弁護士確認（資金移動業/前払式・旧PTコイン前払式該当性） | **不要化(受領8・PAY.JP照会質問⑥で代替)**: PTチャージ（金銭でのPT購入）廃止（Q-PAY-06）で前払式論点は消滅。資金移動業の整理も、最終構成でIHLが買主→売主資金に非接触（銀行振込直接）・Platform型の資金保持者はPAY.JP（登録済み決済業者）であるため、弁護士への正式相談は実施せず`docs/planning/c8/inquiry-drafts.md`ドラフト1の質問⑥（PAY.JPへの資金移動業整理の照会）で代替する。将来必要なら法テラス等の無料相談窓口で足りる | 不要化(受領8) |
| PayPay銀行Open API照会 | **第16回裁定で不要化**: PTチャージ廃止+P2P銀行振込直接確定によりPayPay銀行(旧ジャパンネット銀行)API連携の必要性が消滅 | 消滅 |
| collector ingest 実鍵投入 | `COLLECTOR_PRIVATE_KEY_PEM`（Ed25519 秘密鍵）生成・`COLLECTOR_PUBLIC_KEYS` 登録・本番 `INGEST_URL` 配線 | 未 |
| Truthバックアップ先セットアップ | V3-CST-09: 別プロバイダ(Backblaze B2等)アカウント契約+ローカル`D:\バックアップ`定期pull。設備投資型で可逆operationとして進めてよいが、対外契約・課金開始のみ実行直前に一言報告 | 未 |
| GOV-09 admin ゲート | **クローズ(2026-07-11)**: K2 実装済みの `requireRole("operator","admin")` を `POST /api/v1/gov/flags` に配線(fail-closed)。非 operator(DEV_TOKEN roles=[]/member セッション)→403+副作用ゼロの negative TC 3 本緑化(`tests/gov-flag.test.ts`)。統一ロール taxonomy の人間裁定は別途(この 2 role 名は運用者ゲートとして据置可能) | 済 |
| 知の広場 HG-KN-01〜08 + 本採用 Go | **第13回裁定で確定**: 8 論点 = g1 推奨案どおり(包括承認)・**本採用 Go 承認**。PROTECTED 解除=一般公開のみ cutover 後に別途裁定 | 済(公開のみ未) |
| hold 2 件(V3-FND-13/V3-AIP-61) | **第16回裁定でクローズ**: V3-FND-13(Kernel階層)=確定→**棄却**(現行ScreenDefベースV3-UIX-18を正・round-3 ruling_noteをformalize)・V3-AIP-61(グリーンフィールド)=close(hold解除・確定維持)。もう人間ゲートに残らない | 済 |
| 月次経済 cron の実デプロイ | wrangler.toml `[triggers]` 配線+`config/consented-crons.json`(consented_by=pending-human-gate)まで済。デプロイ=常駐実行開始=人間ゲート | 未 |
| KV namespace 作成(wrangler) | `AUTH_DENYLIST`/`AUTH_CODE_STATE` の実 Cloudflare KV namespace 作成・Binding配線。実インフラ投入=人間ゲート | 未 |
| cutover 実行(VPS解約含む) | 第13回裁定: 技術手順1〜4はAI・各不可逆ボタン直前一言報告・ユーザー在席時推奨。VPS解約のみ人間 | 未 |
| 最終画面打鍵チェック | 全画面のUI目視・実クリック確認(ブラインド納品禁止規約に基づく人間の最終確認) | 未 |
| 公開の実施 | repo / OSS スナップショットの実際の公開 | 未 |
