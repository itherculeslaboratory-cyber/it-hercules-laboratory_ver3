---
id: cl-07-thumbnail-options
title: CL-07 thumbnail 経路 裁定材料 — wasm / Cloudflare Images / client canvas / VPS 残置の比較
date: "2026-07-11"
status: draft
---

# CL-07 thumbnail 経路 裁定材料（C3 冒頭・第6回裁定⑤で予約済み）

> 目的: Phase C3 冒頭の人間裁定（`../rulings/user-ruling-2026-07-10-round-6.md` ⑤ = 「CL-07 png vs JPEG は thumbnail 経路の実装方式と不可分。C3 冒頭で裁定」）のための調査材料。
> **本書は調査のみ。実装しない・`schemas/frozen/` に触らない。** frozen スキーマの変更（format const 追加・description 訂正）は対応 TC 緑化ゲートを通す別作業（AGENTS.md 禁止事項）。
> 【事実】= 一次情報・repo 実物の確認。【提案】= 本書の推論・推奨。Web 出典はすべて 2026-07 取得。

## 0. 契約の実体（先に事実を確定する）

裁定の前提として、CL-07 の「既存契約」を repo 実物で照合した。**通説と実装が 2 点食い違う。**

### 0.1 EXIF transpose は「要件」であって「ver2 実装済み挙動」ではない 【事実・重要】

frozen スキーマ `schemas/frozen/thumbnail.schema.json` の description は「生成不変条件: **リサイズ前に EXIF transpose を適用**し、長辺を 512px に縮小する（`libs/ihl/observation/image.py resize_long_edge`）」と書く。
しかし ver2 実物 `ihl-ver2/libs/ihl/observation/image.py` の `_resize_image()` は **EXIF transpose を一切呼んでいない**（`ImageOps.exif_transpose` 不使用。処理は「LANCZOS リサイズ → `save(format="PNG")`」のみ）。`grep` で `exif`/`ImageOps`/`transpose` は libs 全体でヒット 0。

- 帰結: **ver3 が EXIF transpose を入れるのは「互換破壊」ではなく「要件(CL-07/FR-18-06)への実装追従（=挙動改善）」**。ver2 側に「EXIF 補正済み出力」という守るべき既存挙動は存在しない。
- 出典（repo）: `ihl-ver2/libs/ihl/observation/image.py:46-58`（`_resize_image`）/ `schemas/frozen/thumbnail.schema.json:5`（description）。

### 0.2 ver2 の実出力は PNG（要件文は JPEG） 【事実】

`ihl-ver2/components/thumbnail_builder/run.py:46-61` は `thumbnail_png_bytes()`（PNG bytes）を書き出し、manifest に `"format": "png"`、ファイル名 `.png` を記録。ver3 の fixture `tests/fixtures/cl-shape-samples.json` の `cl-07` も `"format": "png"`。要件 CL-07/FR-18-06 は「JPEG」を規定。frozen スキーマは意図的に `const` を付けず、C1 の TC も「format は string(const 非存在)」だけを assert（`tests/cl-07-thumbnail.test.ts:34-37`）。**png/JPEG は未確定のまま C3 に持ち越されている（本裁定の対象）。**

### 0.3 リサンプリング 【事実】

ver2 は Pillow `Image.Resampling.LANCZOS`（`image.py:54`）。

### 0.4 ver3 は greenfield — 守るべき「本番 thumbnail 実体」は存在しない 【事実】

ver3 は新 repo・新バケット（`ihl-ver3-truth-dev`、C1 レポート）。**本番稼働中の ver3 thumbnail は 1 枚も無い。** thumbnail は派生・再生成可能な artifact であり、append-only Truth の「不可逆な原本」ではない（原本は取り込み元画像）。C3 完了条件（開発計画 §3.1）の「比較 TC」が突き合わせる相手は **ver2 の“契約”（長辺512px・format・EXIF）** であって、**保存済みバイト列ではない**。

## 1. 比較表（6 軸）

対象4候補。(a) wasm は Workers 上で動く実用 2 ライブラリ（photon / jSquash）を併記。

| 軸 | (a) wasm on Workers | (b) Cloudflare Images | (c) client 側 canvas | (d) VPS 残置（部分ハイブリッド） |
|---|---|---|---|---|
| **1. 機能適合**（512px + EXIF transpose + JPEG/PNG出力） | ◯ 可。photon: `resize(w,h,SamplingFilter)` + PNG `get_bytes()`/JPEG `get_bytes_jpeg(q)`、**EXIF 補正は無し→手実装要**。jSquash: `@jsquash/resize`(rust-resize/hqx/magic-kernel)+`@jsquash/jpeg`(MozJPEG, **`preserveOrientation`で EXIF 自動回転**)+`@jsquash/png` | ◎ URL/API で `fit=scale-down,width=512,height=512`。**EXIF 回転を自動適用**（metadata 破棄時も適用）。出力 jpeg/png/webp/avif | △ `drawImage`+`toBlob('image/jpeg'|'png')`。EXIF は `createImageBitmap({imageOrientation:'from-image'})` で対応可。出力形式可 | ◎ ver2 Pillow そのまま（LANCZOS+PNG/JPEG）。EXIF transpose は 1 行追加で完全対応 |
| **2. Workers 制約**（bundle/CPU/mem） | ✕〜△ wasm は gzip 後 **single-digit MB → Free 3MB 枠に入らない・Paid 10MB でも窮屈**。decode は 4000×3000 で ~48MB RGBA。**Free の 10ms CPU/req では画像処理は不可 → Paid 前提** | ◎ 自 isolate の bundle/CPU/128MB を**一切消費しない**（CF エッジ側で処理） | ◎ サーバ資源ゼロ（クライアント実行） | — 該当なし（画像 ingest だけ VPS FastAPI に残す） |
| **3. コスト**（不変条項①=10年最小） | ライブラリは OSS 無料だが **Workers Paid $5/月 ≒ $600/10年(約¥9万)** が実質必須（CPU/bundle 制約） | Free **5,000 unique transform/月まで $0**。超過 $0.50/1,000。stored $5/10万・delivered $1/10万（Paid のみ）。**小規模なら $0 圏内・従量で青天井化するリスクは残る** | **$0**（クライアント負担）。不変条項①に最強 | VPS さくら512MB **≒¥7.7万/10年**（研究レポ根拠6）。W4「FastAPI全停止」を遅延させる |
| **4. バイト級互換**（ver2 との TC） | ✕ 不可能（リサンプラも PNG/JPEG エンコーダも Pillow と別実装） | ✕ 不可能（CF 独自エンコーダ・出力を制御できない） | ✕ 不可能かつ**非決定的**（ブラウザ/OS の canvas エンコーダ依存で端末ごとに差） | △ **唯一バイト一致し得る**（同一 Pillow LANCZOS+PNG）。ただし EXIF transpose を足すと ver2 出力とは変わる（§0.1）ので「バイト一致」と「仕様準拠」は同時不成立 |
| **5. png vs JPEG 裁定への影響** | 両対応。裁定を狭めない | 両対応（+webp/avif）。裁定を狭めない | 両対応。裁定を狭めない | 両対応。裁定を狭めない |
| **6. メンテナンスリスク** | photon: upstream sync **2026-05-30**・`@cf-wasm/photon` 活発。jSquash: Squoosh 派生・335 commits、上流 Squoosh は停滞気味＝**codec 更新の追従は個人メンテ依存** | ◎ CF 公式 GA プロダクト。低メンテ。ただし**ベンダーロック深化**（既に CF 全依存） | ◎ プラットフォーム標準・依存ゼロ。ただし**信頼境界問題**（クライアント生成物は改竄可能＝サーバ側で寸法/形式再検証必須）・**非ブラウザ ingest(collector/CLI)では使えない** | ✕ 消したい VPS(SSH/certbot/Docker) を存置＝不変条項② fork 文化・SPOF に逆行 |

出典（Web, 2026-07）: photon README/npm（https://github.com/fineshopdesign/cf-wasm/blob/main/packages/photon/README.md ・ https://www.npmjs.com/package/@cf-wasm/photon ）/ photon-rs docs（https://docs.rs/photon-rs/latest/photon_rs/transform/index.html ）/ jSquash（https://github.com/jamsinclair/jSquash ・ https://www.npmjs.com/package/@jsquash/jpeg ・ https://github.com/jamsinclair/jSquash/issues/79 ）/ wasm-on-Workers bundle・CPU 実測考察（https://sph.sh/en/posts/cloudflare-workers-wasm-image-resize/ ）/ CF Images 料金（https://developers.cloudflare.com/images/pricing/ ）/ CF Images transform+EXIF（https://developers.cloudflare.com/images/transform-images/transform-via-url/ ）/ Workers 枠（https://developers.cloudflare.com/workers/platform/limits/ ）。

## 2. バイト級互換についての結論 【提案】

**バイト級互換は「不可能」かつ「不要」。**

- **不可能**: リサンプリングカーネル（Pillow LANCZOS vs rust-resize/magic-kernel vs CF 独自 vs canvas）と PNG/JPEG エンコーダ（zlib 設定・フィルタ選択・MozJPEG 量子化）がライブラリごとに異なる。同一入力でも出力バイト列は一致しない。これはどの候補でも同じ。
- **不要**: §0.4 のとおり ver3 は greenfield で守るべき本番バイト列が無く、thumbnail は再生成可能な派生物。C1 の CL-07 TC もバイトではなく契約（`max(w,h)===512`・format が string）だけを見ている。

→ **C3 完了条件（開発計画 §3.1「thumbnail 新経路出力と既存契約の比較 TC green」/ 研究 §R4）の“比較”を「バイト級互換」から「契約級互換」へ読み替える**ことを提案する。契約級 = ①長辺=512px の等式 ②出力が decode 可能な正当画像 ③EXIF orientation が視覚的に正立 ④format フィールドが確定値と一致。これは全候補で機械検証可能。

> 注: 「バイト級互換」を要求として残すと、成立し得る候補は (d) VPS Pillow 一択に潰れる。しかもその (d) ですら EXIF transpose を足した瞬間 ver2 バイトと不一致になる（§0.1）ため、実質的に達成不能な条件。**この読み替え自体が裁定事項**（下記③）。

## 3. png vs JPEG への影響 【提案】

- 4 候補すべてが PNG/JPEG 双方を出力できる → **形式選択はどの候補も狭めない**（表 軸5）。
- 写真サムネイルは JPEG が妥当（PNG は同一絵で数倍サイズ＝配信/保存コストで不変条項①に不利）。要件文(CL-07/FR-18-06)も JPEG。
- バイト互換が消えた以上、ver2 の PNG を温存する動機は無い。
- → **JPEG 採用を推奨。** 確定後は frozen スキーマ `format` に const 付与 + description 訂正が可能になる（**別作業・TC 緑化ゲート必須**。本書はスキーマ未変更）。

## 4. 推奨 【提案】

**第1推奨: (a) jSquash on Workers（JPEG 出力・`@jsquash/jpeg` preserveOrientation で EXIF 補正）。**

理由:
1. thumbnail を**サーバ側で決定論的に生成**でき、CL-07 の `thumbnail_manifest`(append-only 記録) モデルをそのまま維持できる（(b)(c) は生成箇所がエッジ/クライアントに逃げ、マニフェスト記録モデルとズレる）。
2. **新ベンダー不要**（既存 Cloudflare スタック内・OSS）。EXIF は MozJPEG デコーダ標準機能で賄え、手実装(photon)より堅い。
3. コストは Workers Paid $5/月。**不変条項①の「$0」からは外れる**が、研究 §R2 が既に「枠縮小時 Paid $5/月でも VPS 比同水準・裁定影響は小」と許容範囲に置いている。$600/10年は VPS(¥7.7万) と同オーダーで、SPOF/常駐運用の無い分こちらが上位。

**代替（$0 を硬制約にする場合）: (b) Cloudflare Image Transformations。** Free 5,000 transform/月・**Workers CPU/bundle をゼロ消費**・EXIF 自動補正。ただし thumbnail が「配信時変換」になり CL-07 のマニフェスト記録モデルを設計変更する必要（=より大きな裁定）＋従量の将来リスク＋ベンダーロック深化。

**却下（第1推奨にはしない）:**
- (c) canvas: 出力が端末依存で非決定的・信頼境界で再検証必須・非ブラウザ ingest(collector/CLI)を賄えない。補助（アップロード前プレビュー）には有用だが正本生成経路には不適。
- (d) VPS 残置: 消したい VPS を延命し不変条項②・SPOF に逆行。**ただし開発計画 §5.1/研究 §R4 の公式 fallback として文書に残す**（第1推奨が Workers 上で難航した場合の退避先）。

## 5. 人間はこの 4 点だけ裁定すればよい

1. **形式 = JPEG で確定してよいか。**（推奨: JPEG。確定後、frozen `format` const 付与＋description 訂正を TC 緑化ゲート付きで別作業化）
2. **実装経路の第1手 = (a) jSquash on Workers でよいか。**（$0 硬制約なら (b) CF Images に切替。(d) VPS は fallback として残置を承認）
3. **受け入れ条件を「バイト級互換」→「契約級互換」に読み替えてよいか。**（バイト級はどの候補でも不成立・greenfield ゆえ不要。§2）
4. **EXIF transpose を ver3 の正しい挙動として採用してよいか。**（ver2 実装は未適用＝§0.1。採用なら frozen description の「実装済み」表現も訂正対象）

> 上記のうち 2 は経路選択（不可逆でない・後から差替可能）。1・3・4 は契約の確定。いずれも実装・スキーマ変更は裁定後の別作業で、本書では未着手。
