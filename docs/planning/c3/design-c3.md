---
id: DESIGN-ver3-phase-c3
title: C3 設計契約 — 観測拡張 + 類似検索梯子(CL-07 は裁定待ちで実装対象外)
date: "2026-07-11"
status: active
---

# C3 設計契約(実装エージェント向け正本)

> 計画正本: `ihl-ver2/docs/planning/ver3/b3/ver3-開発計画-v1.md` §3.1 C3・§5.2(順序: CL-06/10 → CL-08 → CL-09 → CL-07)。
> C2 の共通規約(`../c2/design-c2.md` §6)を全て引き継ぐ。コミット参照 ID = REPORT-ver3-phase-c3-2026-07-11。

## 0. 完了条件(機械検証)と分母除外

- (i) 既存 R2 埋め込み(384)に対する類似検索 TC green(CL-08 回帰維持・既存 156 テストを割らない)
- (ii) ruri-v3-70m backend の PyTorch/ONNX cosine 一致検証ログ(§4 の時間ガード超過時は「未達+理由」の停止報告 — 捏造禁止)
- (iii) **CL-07 thumbnail 比較 TC は分母除外**: 第6回裁定⑤で C3 冒頭 = 人間裁定。材料は提出済み(`cl-07-thumbnail-options.md`)。実装・frozen 変更は裁定が下りるまで禁止

## 1. 類似検索の決定論梯子(V3-OBS-10・CL-08)

- 3 段: ① whitelist(種/ドメイン等の完全一致 filter)→ ② subset(計測値レンジ等の決定論 filter)→ ③ embedding(cosine・`packages/truth` の凍結 `cosineSimilarity`)。LLM/Vision は使わない(既定 OFF・不変条項①)。
- route: `POST /api/v1/observation/search`(保護・route matrix 24 行目に対応)。応答に `ladder_stage`(どの段まで使ったか)を含め決定論を可視化。
- embedding 段: `embedding-manifest`(frozen・embedding_dim=384 const)+ `embeddings.bin` の R2 読取投影。**manifest の embedding_dim ≠ 384 は検索対象から遮断**(ver2 scoring.py:44 相当 — CL-08 negative TC を search 層でも張る)。
- 常駐 index なし。R2 list→都度計算(O(n) 天井は `// ponytail:` 明記。FAISS 等は導入禁止)。
- fixture: 384 次元 L2 正規化ベクタ数本 + 意図的 768 次元 1 本(遮断確認)。

## 2. CL-06/10 実サンプル TC(開発計画 §5.1 検証方法)

- ihl-ver2(参照専用・読取のみ)から**実データサンプル**を探す: 個体レコード(individual_id/sire_id/dam_id 実値)と発行済み QR トークン実値。候補: ihl-ver2 リポジトリ内 fixtures・ローカル truth store・schemas 例。**PII(メール等)を含むレコードは fixture 化しない**。
- 見つかった実サンプルを `tests/fixtures/` に固定し、(a) 既存個体 ID での親子参照 TC(CL-06) (b) 実 QR トークン形式のスキャン→解決 TC(CL-10・env_qr_token_v1 形式検証)を追加。
- **実データが存在しない場合は捏造せず**、探索した場所を列挙して「実サンプル入手不可・合成 fixture で形式検証のみ」と報告(受け入れの分母除外理由)。

## 3. collector ingest + SwitchBot 連携(CL-09・V3-OBS-28)

- route: `POST /api/v1/collector/ingest`(保護 or 署名自体を認証とする — ver2 契約に従う。CL-09: 鍵形式・プロトコル無変更・検証は WebCrypto Ed25519、C1 fixture で verify 済み)。検証成功→観測イベント append(actor_id = collector 帰属)。改竄署名 401/400 negative TC。
- `components/collector-switchbot/`(Python・フォルダ設計 §2.4 の components 規約): SwitchBot Cloud API から温湿度等を取得し ingest へ署名付き POST する常駐しない単発 run.py。鍵・トークンは `.env`(D:\env 参照)から。**トークン実値のコミット・出力禁止**。TC は fixture 応答での dry-run(pytest)。実 API smoke は 1 回だけ試行し、失敗しても TC green なら可(結果を正直に記録)。

## 4. wiki ingest ruri backend(`b2/research-wiki-integration-v1.md` §1-2)

- `components/wiki-ingest/` に text embedding backend として ruri-v3-70m(384 次元・ONNX)を追加。PyTorch 版と ONNX 版で同一入力 5 本以上の cosine ≥ 0.999 一致検証を実測しログを `docs/planning/c3/ruri-parity-evidence.md` に逐語保存。
- **時間ガード**: モデル取得+環境構築が合計 30 分を超えて難航したら中断し、到達点と失敗理由を記録して残課題化(他ステージを止めない)。Python は `C:/Users/sawad/AppData/Local/Programs/Python/Python312/python.exe`。venv は component 内。torch 等の巨大依存は venv 限定・repo にコミットしない。

## 5. 共通

- 各ステージ: `npm run lint` + `npm test`(+Python 分は `pytest -q`)全 green 実測→ commit(`feat(c3): ... — 自律実行(ultracode C3)・参照 REPORT-ver3-phase-c3-2026-07-11`)。
- schemas 追加が要る場合(search リクエスト/collector ingest)は `schemas/` 正本→ codegen。frozen には触らない。
