---
id: c5-tc-coverage
title: C5 要件↔TC 対応表・wave 受入判定
date: "2026-07-11"
status: active
---

# C5 tc-coverage — 要件 ID ↔ TC 対応・受入判定(srs 生成規約 1453-1460 準拠)

> 生成: tc_map(設計契約・批評家帰属修正反映)× 実ファイル存在 × 実行状態(2026-07-11 実測)。
> green = `npm test` で実走し全緑のスイートに属する TC。deferred-e2e = ファイル実在するが実走は C6 staging E2E(依存 skip 明示)。

## 0. 受入判定(wave 受け入れ規約: 自動化可能 TC の 80% 以上 green)

- 自動化可能 TC: **145** 本(tc_map 180 行中・manual/human-gate 35 本は分母除外)
- green(実走全緑): **142 本 = 97.9%** ≥ 80% → **受入 PASS**
- deferred-e2e(実在・C6 staging で実走): 3 本 — apps/web/e2e/market.spec.ts, apps/web/e2e/ugc-translate.spec.ts, tests/spec-thread.test.ts
- missing: 0 本
- 要件カバレッジ(green TC ≥1 本の要件 / tc_map 収載要件): **133 / 140**(TC 単位と区別して報告 — srs:1460)
- 実測エビデンス: lint 20 GATE 全 OK(監査批評家の検算で 21→20 訂正・screendef snapshot 検査は codegen:check/npm test 側)/ `npm test` 851 passed・3 skipped(=deferred-e2e)/ `pytest -q` 11 passed・1 skipped(torch 依存の意図的 skip)

## 1. 対応表(180 行・クラスタ順)

| 要件 ID | K | TC ファイル | 内容 | 区分 | 状態 |
|---------|---|------------|------|------|------|
| V3-IND-01 | K1 | tests/individual.test.ts | cross-parent append→buildPedigree 多世代ツリー再構成・欠損親 known:false・循環遮断 | 自動 | 🟢 green |
| V3-IND-02 | K1 | tests/individual.test.ts | individual master を R2 に INSERT・成長データ枠を持たない・subject_ref が実 record に解決 | 自動 | 🟢 green |
| V3-IND-04 | K1 | tests/individual.test.ts | name_event 複数 append→projectName 最新名/at= 当時名再現/brand_template active=false 後も過去名再現 | 自動 | 🟢 green |
| V3-IND-07 | K1 | tests/match.test.ts | preference append→w←w+α·y·x 後 ranking が内積降順・score 非露出・単一 preference_event kind 分岐 | 自動 | 🟢 green |
| V3-IND-12 | K1 | tests/individual.test.ts | projectCross が死亡率/完品率/羽化不全率を決定論計算・?metric= 差替・個体経由のみ到達 | 自動 | 🟢 green |
| V3-IND-13 | K1 | tests/individual.test.ts | getIndividual が 6 文化 + timeline(誕生〜標本〜マーケット)を 1 レスポンスに集約 | 自動 | 🟢 green |
| V3-IND-15 | K1 | tests/individual.test.ts | bio-card 生成・qr-batch は {100,500,1000} のみ受理・QR 中身=個体 URL | 自動 | 🟢 green |
| V3-IND-15 | K1 | (manual) | 名刺型番 91×55mm の 100%等倍・切込位置ズレは物理印刷実測(物理治具・人間ゲート) | 手動/人間G | ⏸ manual |
| V3-IND-19 | K1 | tests/taxon.test.ts | species/morph put-if-absent 409・fork forked_from・aliasCandidates(Levenshtein/Jaro-Winkler)… | 自動 | 🟢 green |
| V3-IND-21 | K1 | tests/individual.test.ts | 画像 hash/event 連続性スコア・登録数vs実在数照合・出品文血統矛盾検知ロジック | 自動 | 🟢 green |
| V3-IND-21 | K1 | (manual) | 透明性文化・購入者確認行動自体は運用観察(manual) | 手動/人間G | ⏸ manual |
| V3-OBS-01 | K1 | tests/observation-ext.test.ts | obs-domain-select ラベル要件準拠(生物/器物/デジタル/環境/カスタム)・domain が obs-entry に引き継がれる配線 | 自動 | 🟢 green |
| V3-OBS-02 | K1 | tests/targets.test.ts | 学名/yes-no 二分探索/ツリー 3 経路が QID+taxonomy 返却・7〜12 問収束(ローカルカタログ slice) | 自動 | 🟢 green |
| V3-OBS-03 | K1 | tests/targets.test.ts | 候補提示と確定分離・AI が species_confirmed を書けない不変(確定は user 経路のみ) | 自動 | 🟢 green |
| V3-OBS-06 | K1 | tests/observation-ext.test.ts | 各 measurement に value_origin 必須・欠落/不正で 400・imputed と estimated を別値保持 | 自動 | 🟢 green |
| V3-OBS-07 | K1 | tests/tags.test.ts | confidenceGrade が 自動>手入力>後日編集 順で ◎/○/△ 決定論スコア・再測定タグ付与 | 自動 | 🟢 green |
| V3-OBS-08 | K1 | components/obs-manifest/tests/test_manifest.py | output_manifest/errors.jsonl 出力・同 run_id 出力先既存で fail・不正 1 行で continue+errors 追記 | 自動 | 🟢 green |
| V3-OBS-09 | K1 | components/obs-manifest/tests/test_manifest.py | dummy image backend が sha256→L2 正規化 384 次元・NaN 無し・同入力同出力(決定論) | 自動 | 🟢 green |
| V3-OBS-09 | K1 | (deferred) | DINOv2 vits14 実バックエンド実推論は後波(torch/GPU・費用 defer) | 手動/人間G | ⏸ manual |
| V3-OBS-10 | K1 | tests/observation-ext.test.ts | search で query 自身除外・prototype 平均ベクトル・次元不一致(≠384)遮断 | 自動 | 🟢 green |
| V3-OBS-11 | K1 | tests/observation-ext.test.ts | compositeScore が 0.50/0.20/0.20/0.10 + 欠測既定で決定論・aggregateIndividual 3 方式(max/mean_top3/wei… | 自動 | 🟢 green |
| V3-OBS-18 | K1 | tests/observation-ext.test.ts | item_hash 未登録検出→dictionary-extensions(はい/今回だけ/常に)・template scope 別・fork 系譜・項目タイプ別バリデーション | 自動 | 🟢 green |
| V3-OBS-20 | K1 | tests/observation-ext.test.ts | QR resolve→前回値 prefill と entry_mode=qr が capture に記録(棚→個体→種→テンプレ連鎖) | 自動 | 🟢 green |
| V3-OBS-21 | K1 | tests/home-insights.test.ts | computeNextObservationAt→observation_schedule INSERT・home/summary が近接/超過個体を列挙 | 自動 | 🟢 green |
| V3-OBS-23 | K1 | tests/observation-ext.test.ts | detail が thumbnail(512px JPEG)を配信・raw 一括 DL エンドポイント不在 | 自動 | 🟢 green |
| V3-OBS-25 | K1 | tests/observation-ext.test.ts | 確認画面を経ずに保存不可(save-and-done 禁止)・確認画面 submit CTA が 1 つ(commit 経由のみ) | 自動 | 🟢 green |
| V3-OBS-28 | K1 | tests/upload-conditions.test.ts | 撮影時 photo_conditions 自動埋込・閾値超過アラート発火・プレースホルダ値偽装拒否 | 自動 | 🟢 green |
| V3-OBS-28 | K1 | (human-gate) | 間隔ポーリング(5/10/30/60 分)cron 常駐配線は常駐トークン消費開始=人間ゲート | 手動/人間G | ⏸ manual |
| V3-OBS-31 | K1 | tests/devices.test.ts | Device を placement 紐付け・個体紐付けは 400・api_key 暗号化保存(平文非露出)・display_name 表示・開始日のみ入力 | 自動 | 🟢 green |
| V3-OBS-31 | K1 | (human-gate) | 各 Provider の実 API キー投入は実鍵投入=人間ゲート | 手動/人間G | ⏸ manual |
| V3-OBS-43 | K1 | tests/home-insights.test.ts | insights が空白検出(超過/データ欠落個体)を決定論出力(観測 JSON→insight) | 自動 | 🟢 green |
| V3-OBS-44 | K1 | tests/cusb.test.ts | POST /cusb が validate→lineage/semantic 付与→保存を通し不正 schema 400・payload_hash 改ざん検知 | 自動 | 🟢 green |
| V3-OBS-45 | K1 | tests/observation-ext.test.ts | スケール紙規格 const + 数値のみ送信契約(画像非送信・value_origin=image_derived)を検証 | 自動 | 🟢 green |
| V3-OBS-45 | K1 | (deferred) | ブラウザ WASM/WebGL 四隅検出→射影変換→mmPerPixel 実寸換算(±0.1-0.2mm)は後波・物理実測 | 手動/人間G | ⏸ manual |
| V3-OBS-46 | K1 | tests/obs-annotations.test.ts | annotation AST append/round-trip・postMessage AST 契約 | 自動 | 🟢 green |
| V3-OBS-46 | K1 | (manual) | LabelMe OSS iframe+flexlayout+Canvas 頂点編集は視覚/手動 UI(後波) | 手動/人間G | ⏸ manual |
| V3-OBS-47 | K1 | tests/obs-annotations.test.ts | 自動計測値は修正不可(edit route 不在)・手入力は value_origin タグ付与 | 自動 | 🟢 green |
| V3-OBS-47 | K1 | (deferred) | ローカル HSV/Lab/輪郭/サイズ推定/ダメージ検出の実クライアント解析は後波 | 手動/人間G | ⏸ manual |
| V3-OBS-48 | K1 | tests/observation-ext.test.ts | reanalyze が新 analysis_id で append(既存非上書き)・delta + correction_semver 記録・元画像非削除 | 自動 | 🟢 green |
| V3-OBS-52 | K1 | tests/tags.test.ts | 元画像が R2 に 1:N・上書き不可・再測定タグ付与(RAW append-only) | 自動 | 🟢 green |
| V3-OBS-56 | K1 | tests/observation-ext.test.ts | searchable_capture_set 固定列順 const + latest pointer(上書きされない・snapshot_id 版管理)契約 | 自動 | 🟢 green |
| V3-OBS-56 | K1 | (deferred) | Polars join による Parquet 実生成はバッチ波(メンテはバッチ化) | 手動/人間G | ⏸ manual |
| V3-OBS-62 | K1 | tests/observation-ext.test.ts | 亜種未確定で commit 400(必須ゲート・AI 自動確定禁止)・固定順フロー各段通過を E2E | 自動 | 🟢 green |
| V3-OBS-63 | K1 | tests/tags.test.ts | tag_event append→aggregateTags が strong/weak/disputed 導出・ai_tags/user_tags 両層欠落で 400・inver… | 自動 | 🟢 green |
| V3-AUT-04 | K2 | tests/auth.test.ts | magic-link→verify→session の dev E2E(既存 green・PUBLIC_APP_URL 固定リンク) | 自動 | 🟢 green |
| V3-AUT-04 | K2 | (manual) | 実 Resend 鍵での本番 送信→クリック→セッション確立 E2E | 手動/人間G | ⏸ manual |
| V3-AUT-06 | K2 | apps/web/src/renderer/renderer.test.tsx | 規約 checkbox 未チェック時 submit が初期描画から disabled・email 入力+チェックで enable(初期妥当性を同期算出) | 自動 | 🟢 green |
| V3-AUT-11 | K2 | tests/check-navigation.test.ts | 不正構造(entry欠落/edges非配列) fail・dangling edge fail・screendef transition 欠落 fail・完全な navigation… | 自動 | 🟢 green |
| V3-AUT-22 | K2 | tests/authz.test.ts | requireRole が roles 無し→403・有り→通過、roles claim が session を往復(taxonomy 非依存・caps は本波対象外) | 自動 | 🟢 green |
| V3-AUT-22 | K2 | (deferred) | admin route ロールゲート 403 + Capability チャネル(caps claim+requireCapability+読取専用表示)を統一ロール裁定後・呼び手… | 手動/人間G | ⏸ manual |
| V3-SEC-02 | K2 | tests/derive-collector-pubkey.test.ts | deriveSpki(秘密鍵)===SPKI 公開鍵・秘密鍵署名を導出公開鍵で verify 成功 | 自動 | 🟢 green |
| V3-SEC-03 | K2 | components/collector-switchbot/tests/test_collector.py | 署名経路(サーバは公開鍵のみ保持・SwitchBot 秘密を持たない)既存 green | 自動 | 🟢 green |
| V3-SEC-03 | K2 | tests/check-secrets.test.ts | SwitchBot/API トークン様パターンが repo/config に混入しないことを secret GATE が担保 | 自動 | 🟢 green |
| V3-SEC-03 | K2 | (future) | WEB 手入力/CSV/GUI 鍵インポート経路 | 手動/人間G | ⏸ manual |
| V3-SEC-04 | K2 | tests/check-secrets.test.ts | scanText が PEM/re_/sk-/AKIA を検出し .env.example プレースホルダを誤検出しない | 自動 | 🟢 green |
| V3-SEC-06 | K2 | tests/gmo-accrual.test.ts | projectReconciliation.accrued_total===Math.round(confirmed_total*0.08) | 自動 | 🟢 green |
| V3-SEC-06 | K2 | tests/gmo-reconcile.test.ts | reconcileOnce が transfer_code 一致時のみ台帳 append(既存 green) | 自動 | 🟢 green |
| V3-SEC-06 | K2 | (deferred) | X/Facebook OAuth 本人紐付け連携 | 手動/人間G | ⏸ manual |
| V3-SEC-07 | K2 | tests/pii.test.ts | detectPii が各型検出・maskPii が {{PII:TYPE}} 置換・route 045 が生 email を R2 に残さない(マスク前非保存)・await der… | 自動 | 🟢 green |
| V3-SEC-07 | K2 | tests/pii.test.ts | pii-scan.mjs が masked コピー+候補一覧+差分レポートを生成し原本を変更しない | 自動 | 🟢 green |
| V3-SEC-13 | K2 | tests/pii.test.ts | redactForPublic が構造化ID(TRK-/ULID/trade_event)を保持し住所末尾4桁を残し他 PII をマスク | 自動 | 🟢 green |
| V3-SEC-13 | K2 | (deferred) | 画像 QR/バーコード復号・OCR 検出住所の自動マスク(画像処理・公開実施=人間ゲート) | 手動/人間G | ⏸ manual |
| V3-SEC-31 | K2 | tests/check-public-docs.test.ts | MANIFESTO/README/CONTRIBUTING/CODE_OF_CONDUCT/LICENSE の1つ欠落で GATE fail・全存在で pass | 自動 | 🟢 green |
| V3-SEC-31 | K2 | (human-gate) | Apache 2.0 最終確定 + 公開日の実施 | 手動/人間G | ⏸ manual |
| V3-SEC-45 | K2 | (deferred) | サンドボックス隔離実行(本番DB read-only/外部通信不可/資源超過→400)・別波・新依存+フェーズ裁定待ち | 手動/人間G | ⏸ manual |
| V3-SEC-52 | K2 | tests/check-cron.test.ts | scanWranglerCron が未同意 cron を fail・cron 無しで pass | 自動 | 🟢 green |
| V3-KRM-03 | K3 | tests/karma-recovery.test.ts | 25日基準で count≥1→count-1・count=0完遂月のみ value+10(上限100)・月内count≥1発生月は+10なし を時刻注入で検証 | 自動 | 🟢 green |
| V3-KRM-04 | K3 | tests/karma-ban.test.ts | karma_value≤-100 で verify 403・profile に永久BAN公開表示・R2イベント保持(削除なし)・免罪符非適用を検証 | 自動 | 🟢 green |
| V3-KRM-05 | K3 | tests/indulgence-shop.test.ts | 1購入で count-1(count=0不可)・value/Fib逆操作しない・価格 fib(stage)(購入+1/暦月-1)・用語プラチナコインショップ を検証 | 自動 | 🟢 green |
| V3-KRM-06 | K3 | tests/karma-recovery.test.ts | value 正増加が monthly_batch 以外で throw・貢献付与が karma_event でなく contribution/coin_event に落ちる inva… | 自動 | 🟢 green |
| V3-KRM-10 | K3 | tests/contribution.test.ts | Contribution Score 非負累積・減算拒否・5概念別台帳分離(PT非公開/Supporterは Research非影響)を検証 | 自動 | 🟢 green |
| V3-KRM-11 | K3 | tests/contribution.test.ts | applyContributionDelta 子Δ→祖先10%重み配分・累計100で issueCoin1+端数繰越・称号10000到達を検証 | 自動 | 🟢 green |
| V3-KRM-12 | K3 | tests/contribution.test.ts | 各軸100→1PT鋳造・2枚目以降 fib(n)*100・当月無ミントで Fib1段降下(下限100・残高非減衰)・UTC月境界を検証 | 自動 | 🟢 green |
| V3-KRM-13 | K3 | tests/github-webhook.test.ts | HMAC不正署名拒否・同一 github_delivery_id 再送べき等409・config weights 変更が換算に反映を検証 | 自動 | 🟢 green |
| V3-KRM-16 | K3 | tests/economy-policy.test.ts | policy_key+policy_int 参照解決(定数直読でない)・付与履歴が append-only であることを検証 | 自動 | 🟢 green |
| V3-KRM-20 | K3 | tests/social-eval.test.ts | 社会イベント集計が layer0-3のみ対象・layer4除外・本人自己評価拒否・公式ランキング非生成を検証 | 自動 | 🟢 green |
| V3-KRM-21 | K3 | tests/profile.test.ts | profile が3指標個別返却・研究スコアが Contribution配下・public_safety(カルマ/取引/悪レビュー)非公開設定拒否・intl_trust 0-100… | 自動 | 🟢 green |
| V3-KRM-24 | K3 | tests/proposal.test.ts | 改善案 fork で rank=beginner 自動・rank昇格遷移・hypothesis が支持/否定信頼度で supported/rejected 収束しアーカイブを検証 | 自動 | 🟢 green |
| V3-KRM-25 | K3 | tests/platinum-vote.test.ts | 1票=1coin 積上げ公開合計値・投票者内訳全公開・閾値到達で公式昇格候補化+通知を検証 | 自動 | 🟢 green |
| V3-KRM-25 | K3 | tests/platinum-vote.test.ts | 公式デフォルト/本番への実昇格(明示 Promote)は人間ゲート=自動検証外 | 手動/人間G | ⏸ manual |
| V3-MKT-01 | K3 | tests/market-state-machine.test.ts | 固定/オークション/抽選/プラチナ優先/オファー各チャネルの成立ルール・trade-event append・非エスクロー(資金非預り)不変を検証 | 自動 | 🟢 green |
| V3-MKT-02 | K3 | tests/market-state-machine.test.ts | 許可辺遷移が反映・不正遷移409・reduceMarket が末尾状態を集計(遷移マトリクス網羅)を検証 | 自動 | 🟢 green |
| V3-MKT-03 | K3 | tests/market-stage.test.ts | matched 後 private board は当事者2人のみ・第三者403・落札は stage=Stage2直行を検証 | 自動 | 🟢 green |
| V3-MKT-04 | K3 | tests/market-settlement.test.ts | 受取申告+評価で成立し fee_unpaid 起算・配送完了+30日無評価が自動 good 化(時刻注入・境界29/30/31日)を検証 | 自動 | 🟢 green |
| V3-MKT-06 | K3 | tests/market-offer.test.ts | ラブレター応募が値段非開示で集約→出品者選択で成立・拒否ポリシー個体はオファー拒否(409/403)を検証 | 自動 | 🟢 green |
| V3-MKT-10 | K3 | tests/market-settlement.test.ts | 8%税負債計上・30日境界・fibPenalty連動 Δcount・全額消込月で当該取引由来Δcount停止(他事由と加算)を検証 | 自動 | 🟢 green |
| V3-MKT-12 | K3 | tests/gmo-fifo.test.ts | 義務3件(同一code同額・due_date昇順)+入金1件→振込日時優先で最古未払いへFIFO消込・残2件 pending を検証 | 自動 | 🟢 green |
| V3-MKT-12 | K3 | tests/gmo-fifo.test.ts | live 口座の実入金に対する消込確定は実鍵(人間ゲート)=自動検証外 | 手動/人間G | ⏸ manual |
| V3-MKT-14 | K3 | tests/gmo-webhook-hmac.test.ts | verifyGmoWebhookHmac 正/改竄・match_pending 再送二重防止(冪等)を検証 | 自動 | 🟢 green |
| V3-MKT-14 | K3 | tests/gmo-webhook-hmac.test.ts | 実 webhook 受信・実 subscribe・live昇格・実入金確認は GMO本番契約+実鍵(人間ゲート)=自動検証外 | 手動/人間G | ⏸ manual |
| V3-MKT-20 | K3 | tests/market-pricing.test.ts | 個体観測+送/受局ID→梱包サイズ→推定送料算出・住所フィールド非保持を検証 | 自動 | 🟢 green |
| V3-MKT-22 | K3 | tests/market-template.test.ts | ランキング=利用率40+継続率20+評価20+Fork10+改善10 の重み算出・fork で forked_from 連結を検証 | 自動 | 🟢 green |
| V3-MKT-23 | K3 | tests/market-pricing.test.ts | 個体ID選択だけで観測データ引用付き listing draft 生成+推奨価格自動入力(相場スタブ)を検証 | 自動 | 🟢 green |
| V3-MKT-25 | K3 | tests/market-pricing.test.ts | 類似個体の過去成約価格集合から重み付き平均/中央値の推奨価格が計算元込みで算出(embedding OFF経路)を検証 | 自動 | 🟢 green |
| V3-MKT-27 | K3 | tests/market-rating.test.ts | good/normal/bad 件数集計・bad の reason 必須バリデーション・低評価フィルタ(bad≥5/karma≤0/≤2★)除外を検証 | 自動 | 🟢 green |
| V3-MKT-29 | K3 | tests/market-ownership.test.ts | 取引成立→A個体をBへ移転し系譜(引継観測データ)連結・external フラグ時は非引継を検証 | 自動 | 🟢 green |
| V3-MKT-36 | K3 | tests/market-fees.test.ts | 売上に対する3%/8%/10%の各拠出額算出・OSS非商用=拠出0・定数スナップショット凍結を検証 | 自動 | 🟢 green |
| V3-MKT-39 | K3 | tests/economy-policy.test.ts | 同一 policy_key に古/新 timestamp 2行を投入し resolvePolicyInt(tradePolicyResolver) が最新行の値を返すことを検証 | 自動 | 🟢 green |
| V3-I18-06 | K4 | tests/i18n-ugc.test.ts | market listing の description が原文のまま保存されサーバ翻訳が走らない不変（data.description===入力・data.lang==actor… | 自動 | 🟢 green |
| V3-I18-06 | K4 | apps/web/e2e/ugc-translate.spec.ts | 閲覧者locale=enでUGCに翻訳アフォーダンス表示・押下でlib/ugc-translate.ts端末側オンデマンド翻訳のみ発火し常駐サーバ翻訳APIを叩かない | 自動 | 🟡 C6 実走 |
| V3-I18-06 | K4 | (human-gate) | UGC共有テキストの公開/公開解除は人間ゲート『公開の実施』 | 手動/人間G | ⏸ manual |
| V3-I18-08 | K4 | apps/web/src/lib/i18n.test.ts | fallbackチェーンexact→lang→ja→keyで解決し空文字を返さない（未対応localeでもja文言） | 自動 | 🟢 green |
| V3-I18-08 | K4 | tests/check-i18n-keys.test.ts | screen-def参照キーがja.jsonに欠落すると検知しfail・screen-def props生CJK直書きを検知 | 自動 | 🟢 green |
| V3-I18-08 | K4 | tests/settings-preferences.test.ts | PATCH /me/preferences で locale 設定→GET が LWW 反映・本人スコープ・enum外/余剰キーは400(schema配線検証) | 自動 | 🟢 green |
| V3-UIX-01 | K4 | tests/check-ui-copy.test.ts | 禁止語(未実装/WIP等)混入をscreen-defs/apps-webで検出しGATE落とす(positive)・正常文言は0(negative) | 自動 | 🟢 green |
| V3-UIX-01 | K4 | apps/web/src/renderer/renderer.test.tsx | props.draft で『草案』バッジをrole/aria維持のまま描画 | 自動 | 🟢 green |
| V3-UIX-02 | K4 | tests/nav-reachability.test.ts | transitions[]+navigate actionグラフをBFSし実在screen_id(観測保存=obs-detail/設定=settings/テーマ=theme-gal… | 自動 | 🟢 green |
| V3-UIX-03 | K4 | apps/web/src/renderer/renderer.test.tsx | list0件でempty_text描画・401/403/409を日本語表示・rawエラー非露出 | 自動 | 🟢 green |
| V3-UIX-03 | K4 | apps/web/src/lib/error-messages.test.ts | mapError code→日本語+未知コード汎用fallback・raw文字列を見せない | 自動 | 🟢 green |
| V3-UIX-05 | K4 | tests/check-screendef-structure.test.ts | section≤3/card≤3/末尾next_step存在/説明text3行以内を検証、全screen-def PASS | 自動 | 🟢 green |
| V3-UIX-14 | K4 | tests/theme-packs.test.ts | theme-pack fork→parent_pack_id系譜・GET/{id}がlineage[]をbuilt-inまで返す・同一pack_id(ULID)二重POST409(… | 自動 | 🟢 green |
| V3-UIX-16 | K4 | tests/theme-codegen.test.ts | config/design-tokens.json→tokens.generated.css+theme-packs/*.json の一方向codegenが冪等(--check)・… | 自動 | 🟢 green |
| V3-UIX-16 | K4 | tests/settings-preferences.test.ts | ユーザー theme_pack_id 上書きが pref 投影に反映(伝播) | 自動 | 🟢 green |
| V3-UIX-17 | K4 | apps/web/src/renderer/renderer.test.tsx | 全10 screen-defが単一Rendererで描画・POST/builder/canvasでUIをnodeとして保存/fork | 自動 | 🟢 green |
| V3-UIX-25 | K4 | tests/nav-reachability.test.ts | homeが観測開始1クリック・現在地カード(source_path /me/ledger)・主要FeatureNode入口(theme-gallery/ui-templates/s… | 自動 | 🟢 green |
| V3-UIX-32 | K4 | (design-review) | Next15+ScreenDef採用/shadcn不採用の方針適合と掲示板/描画OSSのGPL/AGPLライセンス実適合は設計レビュー人手(掲示板は知の広場クラスタ) | 手動/人間G | ⏸ manual |
| V3-UIX-45 | K4 | tests/ui-template.test.ts | template fork系譜・like/platinum投票(/events経由)加算・同一(actor,target,kind)二重投票後も票は1(投影dedup冪等・409期… | 自動 | 🟢 green |
| V3-UIX-45 | K4 | (human-gate) | テンプレ/パックの公開実施・公開解除は人間ゲート『公開の実施』 | 手動/人間G | ⏸ manual |
| V3-UIX-81 | K4 | apps/web/src/renderer/renderer.test.tsx | 7状態/reduced-motion/44px/ariaのRenderer共通層(既存green維持) | 自動 | 🟢 green |
| V3-UIX-81 | K4 | (SEC/VID cluster) | 重要文書の多媒体マトリクス(法的版/小5版×読み上げ/動画×字幕)はV3-SEC-21/22・V3-VID-23接続で本クラスタ範囲外 | 手動/人間G | ⏸ manual |
| V3-PPR-01 | K5 | tests/paper-match.test.ts | 条件P×観測JSON突合: 全一致/部分/違反ケースで satisfied/missing/violated 分類と match_rate=一致条件数/必要条件数 が決定論一致 | 自動 | 🟢 green |
| V3-PPR-01 | K5 | tests/paper-match.test.ts | 不足キー静的ヒントは既定OFF(RESEARCH_LLM_MODE=off)で1行返却・LLM助言経路は実APIキー投入(人間ゲート)でのみ有効 | 手動/人間G | ⏸ manual |
| V3-PPR-03 | K5 | tests/paper-sections.test.ts | PaperSectionsV1: 6節(目的/仮説/条件/検証/フェーズ/ギャップ)必須・filled/completeness_pct∈[0,100]・LaTeX(\ や $)混… | 自動 | 🟢 green |
| V3-PPR-06 | K5 | tests/paper-match.test.ts | missing perspectives: 注入固定ベクトルの近傍論文差分軸→欠観点ラベル安定列挙(全種族横断・species非フィルタ)・data gap はキー差分決定論・ベク… | 自動 | 🟢 green |
| V3-PPR-06 | K5 | components/wiki-ingest | ruri 384次元 実埋め込み生成はオフライン・既定OFF(不変条項①)・TS側はembedding-manifestを読むのみ | 手動/人間G | ⏸ manual |
| V3-PPR-09 | K5 | tests/project-hub.test.ts | reanalysis-manifest: 同一 imageR2Key/scaleTemplateId→同一マニフェスト(画像バイナリ非含)・observed_at(data)≠co… | 自動 | 🟢 green |
| V3-PPR-13 | K5 | tests/research-canonical.test.ts | mapping_event append-only: Q番号→外部ID(GBIF/NCBI等)対応の再put=409(決定論キーはstorage key・envelope.idはu… | 自動 | 🟢 green |
| V3-PPR-16 | K5 | tests/project-hub.test.ts | bestVersion: Ver別/lot別の観測集計から決定論選定・projectId 中心に paper/blog/citation/market/observation/ta… | 自動 | 🟢 green |
| V3-PPR-17 | K5 | tests/research-agent-batch.test.ts | ResearchTaskNode: 同一 limitations/next_questions/失敗クラスタ入力→同一 task_id(決定論キー=storage key・enve… | 自動 | 🟢 green |
| V3-PPR-17 | K5 | tests/research-agent-batch.test.ts | 毎朝6時(UTC 21:00)の scheduled Cron 定期配線の有効化=常駐トークン消費開始(人間ゲート)。手動 POST /research/agent/run までを… | 手動/人間G | ⏸ manual |
| V3-PPR-18 | K5 | tests/project-hub.test.ts | 検証ループ: 観測マッチ→Citation Entity 自動生成(貢献ポイント・匿名/実名)→不足キー充足で status=updated 追記が冪等(同一キー再put=409)… | 自動 | 🟢 green |
| V3-PPR-30 | K5 | tests/paper-match.test.ts | Data Descriptor: 観測イベント投影で節自動充填・充足キー→claim証拠自動リンク(status=evidenced)・未検証claimは仮説ラベル(status=… | 自動 | 🟢 green |
| V3-WIK-01 | K5 | tests/research-agent-batch.test.ts | 蒸留バッチ: 同一入力→同一 wiki_node(決定論キー=storage key・envelope.idはulid)・board_summary→big_wiki 階層・app… | 自動 | 🟢 green |
| V3-WIK-01 | K5 | tests/research-agent-batch.test.ts | 日次蒸留 Cron 定期配線の有効化=常駐トークン消費開始(人間ゲート)。runBatchOnce 手動トリガまでを納品 | 手動/人間G | ⏸ manual |
| V3-WIK-13 | K5 | tests/research-content.test.ts | 投稿=検索可能: content append 直後に fulltext/tag/user/node 4本柱(=prefix scan投影)へ即ヒット・維持型二次index無し・D… | 自動 | 🟢 green |
| V3-WIK-14 | K5 | tests/research-content.test.ts | 3層タグ: ai_tags(tag_type=ai)がuser_tagsを上書きしない・RAG優先度 system→ai→user→summary→payload→embeddin… | 自動 | 🟢 green |
| V3-WIK-14 | K5 | tests/research-content.test.ts | AI自動タグはユーザー確認必須: suggestTags は非永続提案のみ・確認 POST /content/:id/tags でのみ tag_event(frozen再利用・ta… | 自動 | 🟢 green |
| V3-WIK-16 | K5 | tests/research-content.test.ts | content INSERT ONLY: 同一キー再put=409・content_type enum(article/blog/paper)共通CMS基盤・citations(c… | 自動 | 🟢 green |
| V3-WIK-17 | K5 | tests/research-content.test.ts | 共有1タップ→R2保存→chat-index: POST /research/shared が content_type=chat_log で Markdown整形 append・… | 自動 | 🟢 green |
| V3-WIK-17 | K5 | apps/web/src/app/manifest.ts | PWA share_target(manifest)配線: 実機の共有ボタン動作確認はブラウザ操作で自動化不可。manifest+受信route+投影TCまでを納品 | 手動/人間G | ⏸ manual |
| HG-KN-01..08 | K6 | (human-gate) | 知の広場 IA の人間裁定8点(推奨 C/C/B/A/A/A/A/B を screendef に仮置き・裁定確定後 JSON 差替でコード不変反映) | 手動/人間G | ⏸ manual |
| V3-BBS-01 | K6 | tests/knowledge-screens.test.ts | knowledge-hub が3柱カードのみ(タブ/カード重複禁止)・home→hub→各柱主要操作が ≤3クリック・4 screendef が schema 妥当 | 自動 | 🟢 green |
| V3-BBS-01 | K6 | (human-gate) | /knowledge 一般公開・公開解除の実施は「公開の実施」ゲート(機械は停止報告) | 手動/人間G | ⏸ manual |
| V3-BBS-03 | K6 | tests/plaza-posts.test.ts | channel=screen_id への3板(guide/complaint/improvement)投影・改善サイクル(Fork公開→signal収集→projectRankin… | 自動 | 🟢 green |
| V3-BBS-05 | K6 | tests/plaza-posts.test.ts | post append-only・projectThread の materialized view・correction_of 追記共存・permalink 不変・欠落 cite… | 自動 | 🟢 green |
| V3-BBS-10 | K6 | tests/plaza-summary.test.ts | block_index=floor(通番/100)・4層(post emb/block emb/current_summary+open_questions/diff履歴)投影・要… | 自動 | 🟢 green |
| V3-BBS-20 | K6 | tests/plaza-cite.test.ts | cite_refs[] が [ihl:cite] token より優先・token パースを cite_refs に統合・citeUrl が全 type で安定 URL・通知/検索… | 自動 | 🟢 green |
| V3-BBS-29 | K6 | tests/plaza-fork.test.ts | public fork→rank=beginner 自動・gov.vote で昇格・FORK_RANK_ORDER 表示順・minor は検索のみ・全 fork 非削除共存・con… | 自動 | 🟢 green |
| V3-BBS-36 | K6 | tests/plaza-consensus.test.ts | topic 必須・Agree/Disagree/Pass append-only 収集・同 actor 最新採用・consensus/divisive を閾値算術で決定論分類(LL… | 自動 | 🟢 green |
| V3-GOV-01 | K6 | tests/gov-dispute.test.ts | 二人部屋 open→message→close の projection・participants 2名限定(第三者拒否)・TTL 超過で expired・不服申立 route 不… | 自動 | 🟢 green |
| V3-GOV-01 | K6 | (human-gate) | 開発者/創世者が裁判官にならない統治スタンス(思想部分・人間裁定) | 手動/人間G | ⏸ manual |
| V3-GOV-09 | K6 | tests/gov-flag.test.ts | 不使用フラグ event が R2 DELETE せず append・対象 owner に grantKarmaCountIncrease(steps=10) で Δcount+1… | 自動 | 🟢 green |
| V3-GOV-09 | K6 | (human-gate) | 行政命令に従うかの意思決定自体は人間ゲート(V3-AIP-31・自動 poll せず operator 明示操作時のみ) | 手動/人間G | ⏸ manual |
| V3-GOV-12 | K6 | tests/gov-precedent.test.ts | dispute close で precedent が R2 append・projectPrecedents の q/tag 検索・precedent が CiteRef(typ… | 自動 | 🟢 green |
| V3-GOV-13 | K6 | tests/gov-no-automod.test.ts | apps/api/src に auto-moderation endpoint / NGワード表が存在しないことを assert する negative 回帰(実装ゼロ) | 自動 | 🟢 green |
| V3-GOV-19 | K6 | tests/gov-vote-threshold.test.ts | threshold_adjust vote→projectThreshold が投票結果値を返す(無投票時 economy-constants 既定)・ルールも fork 対象 | 自動 | 🟢 green |
| V3-GOV-23 | K6 | tests/plaza-fork.test.ts | os/screen/component fork+gov.vote os_merge+signal 自然淘汰で projectOsPromotion が /os/main 昇格判定… | 自動 | 🟢 green |
| V3-CST-05 | K7 | docs/ops/runbook.md | nginx+certbot/pm2/HTTPS/VPS 再構築は本番 VPS 手動検証(CI 外)。.env 2 層 example の存在/frontmatter/非 ASCII… | 手動/人間G | ⏸ manual |
| V3-FND-04 | K7 | tests/fnd-04-kernel.test.ts | reduce 決定論(同一入力→同一 snapshotVersion)・OCC 衝突(prevSnapshotVersion 不一致→conflict)・timestamp 単調ガ… | 自動 | 🟢 green |
| V3-FND-05 | K7 | tests/fnd-05-hash-chain.test.ts | prev_hash 連結の正当性 + event_hash 再計算不一致による改竄検知(brokenAt)+ worldHash 順序独立/空 world 番人 | 自動 | 🟢 green |
| V3-FND-11 | K7 | tests/fnd-11-cors.test.ts | CORS ヘッダが 200/401/onError 500 含む全応答に一貫付与・OPTIONS preflight 204・非許可 origin は ACAO 無し(API 直応… | 自動 | 🟢 green |
| V3-FND-12 | K7 | scripts/lint-deps.mjs | apps→apps / libs→apps / */shared/ / nested npm / wrangler 常駐 binding(d1/kv/durable_objects… | 自動 | 🟢 green |
| V3-FND-15 | K7 | tests/fnd-15-lineage-meta.test.ts | lineage-meta 必須フィールド検証(欠落/null で fail)+ content_hash/lineage_hash 決定論算出 + 系譜(ancestor_chai… | 自動 | 🟢 green |
| V3-FND-18 | K7 | tests/fnd-18-source.test.ts | Tier B マージの written/skipped_duplicate/skipped_invalid カウント・1 分→5 分バケット集約・未終了 device-bindin… | 自動 | 🟢 green |
| V3-FND-21 | K7 | tests/fnd-21-ai-kernel.test.ts | A90 経由で LLMClient 実装をモックに差替可能(機能別 AI 切替)・provider 未設定既定は AI_DISABLED(501) | 自動 | 🟢 green |
| V3-OTH-02 | K7 | scripts/lint-components.mjs | components/* に manifest(entrypoint 実在)/tests/golden/README が揃わなければ lint fail。補完後の現 repo で緑 | 自動 | 🟢 green |
| V3-AIP-05 | K8 | tests/guards.test.ts | check-rtm: 合成 rtm.json に TEST 層(test)参照が空の要件 ID を入れると fail(テスト設計ゲート免除不可)・全 ID 閉包で pass。04-… | 自動 | 🟢 green |
| V3-AIP-22 | K8 | .github/workflows/ci.yml | CI に pytest -q + apps/web next build + tsc --noEmit + design-gate(check-req-freeze/check-c… | 自動 | 🟢 green |
| V3-AIP-32 | K8 | tests/guards.test.ts | check-req-freeze: 01-requirements/ の FR 本文が PR で変更されたのに docs/planning/rulings/ 参照が同 PR に無け… | 自動 | 🟢 green |
| V3-AIP-34 | K8 | tests/spec-thread.test.ts | 知の広場スレッド spec(K6 正本)を screendef schema validate + route-matrix のナビ/権限整合 contract。K6 未達なら t… | 自動 | 🟡 C6 実走 |
| V3-AIP-35 | K8 | tests/intent.test.ts | appendIntent(envelope.id===intent_id 規約で putEvent)を同一 intent_id 二重呼び→409 / TruthStore に UP… | 自動 | 🟢 green |
| V3-AIP-36 | K8 | tests/guards.test.ts | check-commit-msg: [post_id]変更理由→変更内容→影響範囲 形式 + 意図メタ trailer 必須を検証。BASELINE_REF(C6)より前の過去コミ… | 自動 | 🟢 green |
| V3-AIP-40 | K8 | tests/ai-profile.test.ts | ai-profile.schema.json で ai-profiles/*.json 全件 validate + AI 機能 5 件(画像解析/RAG/新聞/翻訳/マーケット)全… | 自動 | 🟢 green |
| V3-AIP-45 | K8 | tests/ai-view.test.ts | ai-view.schema.json validate(human_view:string + machine_view: sections/keypoints:string[]… | 自動 | 🟢 green |
| V3-AIP-49 | K8 | apps/web/e2e/market.spec.ts | Playwright 網羅 E2E: market/ledger を dev-login→ScreenDef Renderer 実 UI で 入力→実行→保存 通貫(スモークでない… | 自動 | 🟡 C6 実走 |
| V3-AIP-50 | K8 | apps/web/src/renderer/screendef-snapshots.test.tsx | gen-screendef-snapshots.mjs が screen-defs/*.json から生成したスナップショット TC が緑 + codegen:check GATE… | 自動 | 🟢 green |
| V3-AIP-68 | K8 | tests/guards.test.ts | check-danger-code: 金銭系 API 実行/DNS ドメイン操作/自己権限変更を含む PR 差分を fail する物理ゲート(staging 昇格ガード)・無害 d… | 自動 | 🟢 green |
| V3-AIP-68 | K8 | docs/planning/c5/HANDOFF-c5-c6-2026-07-11.md | 10 人規模レビュー・約 1 ヶ月試験運用・正式採用判断は人間運用ゲート(分母除外・停止報告)。staging 実デプロイ/secret 投入は承認済だが実行直前一言報告 | 手動/人間G | ⏸ manual |
| V3-AIP-76 | K8 | tests/culture-template.test.ts | evaluation-axis.schema.json 3層(common/purpose/custom)validate + appendTemplateVersion(enve… | 自動 | 🟢 green |
| V3-AIP-80 | K8 | docs/public/whitepaper.md | 技術思想書 Whitepaper・公開プロトコル・段階制公開計画を起草(protocol.md/oss-release-plan.md)。実公開は人間ゲート・機械 TC 不要 | 手動/人間G | ⏸ manual |

## 2. manual / 人間ゲート TC の内訳(分母除外・停止報告)

| 要件 ID | K | 理由 |
|---------|---|------|
| V3-IND-15 | K1 | 名刺型番 91×55mm の 100%等倍・切込位置ズレは物理印刷実測(物理治具・人間ゲート) |
| V3-IND-21 | K1 | 透明性文化・購入者確認行動自体は運用観察(manual) |
| V3-OBS-09 | K1 | DINOv2 vits14 実バックエンド実推論は後波(torch/GPU・費用 defer) |
| V3-OBS-28 | K1 | 間隔ポーリング(5/10/30/60 分)cron 常駐配線は常駐トークン消費開始=人間ゲート |
| V3-OBS-31 | K1 | 各 Provider の実 API キー投入は実鍵投入=人間ゲート |
| V3-OBS-45 | K1 | ブラウザ WASM/WebGL 四隅検出→射影変換→mmPerPixel 実寸換算(±0.1-0.2mm)は後波・物理実測 |
| V3-OBS-46 | K1 | LabelMe OSS iframe+flexlayout+Canvas 頂点編集は視覚/手動 UI(後波) |
| V3-OBS-47 | K1 | ローカル HSV/Lab/輪郭/サイズ推定/ダメージ検出の実クライアント解析は後波 |
| V3-OBS-56 | K1 | Polars join による Parquet 実生成はバッチ波(メンテはバッチ化) |
| V3-AUT-04 | K2 | 実 Resend 鍵での本番 送信→クリック→セッション確立 E2E |
| V3-AUT-22 | K2 | admin route ロールゲート 403 + Capability チャネル(caps claim+requireCapability+読取専用表示)を統一ロール裁定後・呼び手が出る波で追加 |
| V3-SEC-03 | K2 | WEB 手入力/CSV/GUI 鍵インポート経路 |
| V3-SEC-06 | K2 | X/Facebook OAuth 本人紐付け連携 |
| V3-SEC-13 | K2 | 画像 QR/バーコード復号・OCR 検出住所の自動マスク(画像処理・公開実施=人間ゲート) |
| V3-SEC-31 | K2 | Apache 2.0 最終確定 + 公開日の実施 |
| V3-SEC-45 | K2 | サンドボックス隔離実行(本番DB read-only/外部通信不可/資源超過→400)・別波・新依存+フェーズ裁定待ち |
| V3-KRM-25 | K3 | 公式デフォルト/本番への実昇格(明示 Promote)は人間ゲート=自動検証外 |
| V3-MKT-12 | K3 | live 口座の実入金に対する消込確定は実鍵(人間ゲート)=自動検証外 |
| V3-MKT-14 | K3 | 実 webhook 受信・実 subscribe・live昇格・実入金確認は GMO本番契約+実鍵(人間ゲート)=自動検証外 |
| V3-I18-06 | K4 | UGC共有テキストの公開/公開解除は人間ゲート『公開の実施』 |
| V3-UIX-32 | K4 | Next15+ScreenDef採用/shadcn不採用の方針適合と掲示板/描画OSSのGPL/AGPLライセンス実適合は設計レビュー人手(掲示板は知の広場クラスタ) |
| V3-UIX-45 | K4 | テンプレ/パックの公開実施・公開解除は人間ゲート『公開の実施』 |
| V3-UIX-81 | K4 | 重要文書の多媒体マトリクス(法的版/小5版×読み上げ/動画×字幕)はV3-SEC-21/22・V3-VID-23接続で本クラスタ範囲外 |
| V3-PPR-01 | K5 | 不足キー静的ヒントは既定OFF(RESEARCH_LLM_MODE=off)で1行返却・LLM助言経路は実APIキー投入(人間ゲート)でのみ有効 |
| V3-PPR-06 | K5 | ruri 384次元 実埋め込み生成はオフライン・既定OFF(不変条項①)・TS側はembedding-manifestを読むのみ |
| V3-PPR-17 | K5 | 毎朝6時(UTC 21:00)の scheduled Cron 定期配線の有効化=常駐トークン消費開始(人間ゲート)。手動 POST /research/agent/run までを納品 |
| V3-WIK-01 | K5 | 日次蒸留 Cron 定期配線の有効化=常駐トークン消費開始(人間ゲート)。runBatchOnce 手動トリガまでを納品 |
| V3-WIK-17 | K5 | PWA share_target(manifest)配線: 実機の共有ボタン動作確認はブラウザ操作で自動化不可。manifest+受信route+投影TCまでを納品 |
| HG-KN-01..08 | K6 | 知の広場 IA の人間裁定8点(推奨 C/C/B/A/A/A/A/B を screendef に仮置き・裁定確定後 JSON 差替でコード不変反映) |
| V3-BBS-01 | K6 | /knowledge 一般公開・公開解除の実施は「公開の実施」ゲート(機械は停止報告) |
| V3-GOV-01 | K6 | 開発者/創世者が裁判官にならない統治スタンス(思想部分・人間裁定) |
| V3-GOV-09 | K6 | 行政命令に従うかの意思決定自体は人間ゲート(V3-AIP-31・自動 poll せず operator 明示操作時のみ) |
| V3-CST-05 | K7 | nginx+certbot/pm2/HTTPS/VPS 再構築は本番 VPS 手動検証(CI 外)。.env 2 層 example の存在/frontmatter/非 ASCII 無しは既存 filename/frontmatter lint が機械確認 |
| V3-AIP-68 | K8 | 10 人規模レビュー・約 1 ヶ月試験運用・正式採用判断は人間運用ゲート(分母除外・停止報告)。staging 実デプロイ/secret 投入は承認済だが実行直前一言報告 |
| V3-AIP-80 | K8 | 技術思想書 Whitepaper・公開プロトコル・段階制公開計画を起草(protocol.md/oss-release-plan.md)。実公開は人間ゲート・機械 TC 不要 |
