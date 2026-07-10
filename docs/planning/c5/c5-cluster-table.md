---
id: c5-cluster-table
title: C5 クラスタ分割表+3点見積改訂(A帯153+S帯残余37=190件実測)
date: "2026-07-11"
status: active
---

# C5 クラスタ分割表(第1波 Tier S+A・開発計画 §3.1 C5 手順1)

> 生成根拠: `01-requirements/registry.json` 実測(2026-07-11)+ repo 実態突合(Workflow 計42 エージェント・批評家 11 群全 pass・minor 指摘全反映)。
> 参照: `docs/planning/c5/REPORT-ver3-phase-c5-2026-07-11.md` / kickoff = `HANDOFF-c5-c6-2026-07-11.md`

## 0. 母集合の確定(計画値との差分)

- 第1波 × Tier A = **153 件**(開発計画 §3.1 の「149 件」は B3 時点値。第8〜11回裁定で V3-AIP-99 / V3-BBS-36 / V3-PPR-30 / V3-UIX-81 が追加)
- 加えて **Tier S 37 件を同分析に掛けた**: 開発計画 §3.1 C5 は A 帯に加え Tier S の未実装残余(V3-BBS-01・V3-PPR-01 等を明記)を含むため。S 帯は C0〜C4 で 8 件 implemented・13 件 process 済みで、**未実装残余 16 件**(todo 3 + partial 13)が C5 対象に編入
- hold=True の **2 件は保留 → 分母除外・停止報告**: V3-FND-13(確定階層)・V3-AIP-61(技術選定 DR)
- 分析母集合 190 件の disposition 実測(批評家反映後): todo-code 70 / partial 61 / todo-tc 7 / todo-doc 1 / process 36 / implemented 12 / human-gate 3
- **C5 実装対象 = todo-code + partial + todo-tc + todo-doc = 139 件**(human-gate/process/implemented は分母除外し §3 で列挙)

## 1. クラスタ一覧(8 クラスタ・消化順)

消化順序: **K2→K1→K3→K4→K5→K6→K7→K8(依存: K2 の role/capability を K3/K6 が使用。K8 RTM 閉包は全 TC 確定後)**

| K | クラスタ | 件数 | 実装対象 | L/M/S | 概要 |
|---|----------|------|----------|-------|------|
| K1 | 観測拡張+個体/ブリーディング | 38 | 35 | 22/11/2 | route-matrix 012〜027 の観測系 planned route・テンプレート(OBS-18)/辞書/カタログ/upload・home/summary・個体系(親子/QR/ブリーディング)・5ドメインラベル整合。C2/C3 の観測コア・梯子・thumbnail 資産の上に積む |
| K2 | 認証/ロール+セキュリティ/法務 | 17 | 13 | 5/5/3 | role ゲート・Capability・pii-session(045)+PII マスク(SEC-07)・onboarding(006/010)。他クラスタの保護 route が依存するため先行 |
| K3 | カルマ/経済+マーケット取引 | 32 | 29 | 21/8/0 | カルマ付与イベントフック(design-c4 §1 持ち越し)・market 取引遷移 030-032+マルチチャネル(MKT-01)・維持費税(MKT-10)・GMO 投影系 route 052-057(読み取り/sunabar のみ・金銭実行なし・Webhook は署名検証+TC まで) |
| K4 | UI/UX+設定+i18n | 15 | 13 | 4/8/1 | me/preferences・settings・theme-packs route 041-051・screen-defs 追加(コードでなく JSON)・草案バッジ・UGC 原文 append+閲覧側翻訳骨格(I18-06) |
| K5 | 論文/研究+wiki/知識 | 15 | 14 | 13/1/0 | 論文照合 V3-PPR-01(Tier S・条件P×観測 JSON 突合)・Data Descriptor テンプレ(PPR-30)・provenance 拡張(PPR-09)・wiki 連携 |
| K6 | 知の広場+ガバナンス(PROTECTED) | 13 | 13 | 11/1/1 | V3-BBS-01(Tier S)3柱+V3-BBS-36(Zulip型topic+Polis型投影・第8回裁定)・汎用引用(BBS-20)・判例DB(GOV-12)・二人部屋 dispute(GOV-01・route 038-040)・route 033-040。全て保護 route 配下・G1〜G6 材料同時作成。HG-KN-01〜08 は分母除外 |
| K7 | 基盤/インフラ+コスト/運用 | 22 | 9 | 6/2/1 | コンポーネント構造 lint(OTH-02)・.env 層整理(CST-05)・lineage 系譜メタ(FND-15)・運用手順 |
| K8 | AI運用/開発プロセス(機械ガード化) | 38 | 13 | 5/7/1 | RTM 閉包 GATE(check-rtm)・commit-msg 意図メタ・TC 自動生成器(AIP-50)・E2E 拡充(AIP-49)。process 群は条文化済みで成果物なし。RTM GATE は全クラスタの TC が揃う最後に結線 |

## 2. クラスタ別 全件表

### K1 観測拡張+個体/ブリーディング(38 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-IND-04 | A | 機能要件 | 未・コード | M | 改名/昇格/テンプレ更新をname_event/brand_template等INSERT ONLYで追記し投影で最新名… | name_event/brand_template/rename historyイベント(append-only put)・最新表示名のprojection/reduce算出・時点指定での当時名再現・brand_template論理削除(active=false)。append-only subst… — TC: contract: 複数name_event INSERT後projectionが最新名を返し、時点指定で当時名を再現、brand_template active=false後も過去生成名が再現可能なことを検証 |
| V3-IND-07 | A | 機能要件 | 未・コード | L | マチアプ/ValueCheck: 画像YES/NO直感評価でオンライン線形学習し内積スコアでランキング(非表示) | /matchroute/導線・単一preference_event列(kind分岐)・オンライン線形学習(w←w+α·y·x)・内積(w·x)ランキング(スコア非表示)・主UX2枚並べ左右1タップ/副どちらも×/詳細ValueCheck・MatchApp本番UI昇格。既存資産なし — TC: contract: preference_event append→重み更新(w←w+α·y·x)後のアイテム順序が内積降順になり、スコアが応答に露出しないことを検証 |
| V3-IND-12 | A | 機能要件 | 未・コード | L | 血統(Cross)画面: 齢別平均体重/サイズ極値/死亡率完品率羽化不全率等の失敗率系を個体経由で表示 | 血統(Cross)route+screendef新設・齢別平均体重(初/二/三令)/サイズ極値/死亡率完品率羽化不全率(drill-down)/生存率孵化率性比色再現性の決定論投影計算・率カード共通コンポーネント(?metric=差替)・個体詳細→この個体の血統遷移。sire_id/dam_idは任… — TC: contract: 血統投影が死亡率/完品率/羽化不全率を決定論計算し、個体特定経由でのみ到達(ホーム直接遷移不可)することを検証 |
| V3-IND-19 | A | 機能要件 | 未・コード | L | 種/形態/系統のCRUD管理(R2 species/{speciesId})+統計自動計算+fork+AI表記揺れali… | species/morph CRUD route(R2 species/{speciesId})・種形態系統(lineage)標準化・統計自動計算(平均サイズ/体重/市場平均価格)・ユーザー作成/fork・AI表記揺れ検出(embedding類似度+Levenshtein/Jaro-Winkler+… — TC: contract: species/morph CRUD(put-if-absent 409)・fork(forked_from)・別名候補の類似度検出→承認後のalias統合を検証 |
| V3-OBS-02 | A | 機能要件 | 未・コード | L | 観測対象ナビゲータをテキストのみ(学名検索/アキネーター式yes-no/分類ツリーの3経路)で構成しWikidata Q… | ナビゲータ機能一式が未着手。学名検索・yes/no二分探索・分類ツリーの3経路、Wikidata QID+taxonomy 返却、7〜12問収束ロジックを新規実装 — TC: 3経路(学名/yes-no/ツリー)が Wikidata QID+taxonomy を返し 7-12問で収束することを検証 |
| V3-OBS-07 | A | 機能要件 | 未・コード | M | 観測信頼度モデル(自動取得>手入力>後日編集をスコア化)を◎/○/△の視覚文化で見せ、再測定には必ず再測定タグを付与 | 信頼度スコアリング・◎○△視覚表現・再測定タグ が未着手(screendef/コードに該当なし) — TC: 信頼度が 自動>手入力>後日編集 の順で決定論スコア化され再測定タグが付与されることを検証 |
| V3-OBS-21 | A | 機能要件 | 未・コード | L | 観測入力時に次回観測日(next_observation_at)を決めテンプレのstage別固定間隔をappend-on… | next_observation_at 算出・テンプレ stage別ルーティン間隔・observation_schedule イベント INSERT・ホーム『今日の要約』(近接/超過/観測中/定期取得状況)一覧 が未着手(旧60日nudge も不在) — TC: next_observation_at をテンプレ stage間隔から算出し observation_schedule を INSERT・近接/超過個体をホーム要約に列挙することを検証 |
| V3-OBS-31 | A | 機能要件 | 未・コード | L | 計測機器を環境(placement)に紐付け(個体には紐付けない)・Provider選択/APIキー暗号化保存/接続テス… | 機器管理API/画面が未着手。Provider選択・APIキー暗号化保存・接続テスト・APIキーからのデバイス自動発見・display_name表示・placement紐付け(個体不可)・開始日のみ入力(終了日暗黙確定)を新規実装 — TC: Device を placement に紐付け個体に紐付け不可・APIキー暗号化保存・display_name表示・紐付けは開始日のみ入力を検証 |
| V3-OBS-45 | A | 機能要件 | 未・コード | L | スケール紙/計測台を標準化し四隅自動検出+射影変換でrealLength=pixelLength×mmPerPixel換… | スケール紙規格・四隅マーカー検出・射影変換・mmPerPixel換算・ブラウザWASM/WebGL(Canny/Hough/射影変換自前実装)・数値のみ送信・スケール紙テンプレ/fork/等倍印刷 が未着手 — TC: 四隅マーカー検出→射影変換→mmPerPixel実寸換算(±0.1-0.2mm)を検証し画像を送らず数値のみ送信することを検証 |
| V3-OBS-46 | A | 機能要件 | 未・コード | L | LabelMe相当のアノテーションをflexlayout iframe並列で統合しpostMessageでAST共有・A… | LabelMe OSS の iframe 統合・flexlayout 別パネル・postMessage AST 共有・AI bbox/polygon の人間頂点編集・選択物のみAST反映 が未着手 — TC: manual: LabelMe OSS iframe+Canvas頂点編集は視覚/手動UI。postMessage の AST 往復のみ E2E で自動化可 |
| V3-OBS-47 | A | 機能要件 | 未・コード | L | 撮影瞬間に大きさ/角長/色をローカル解析(HSV/Lab/輪郭/サイズ推定/ダメージ検出/labelme計測)し数値化・… | ローカル画像解析(HSV/Lab色空間・輪郭・サイズ推定・ダメージ検出・labelme計測)・目視ダブルチェックUI・ユーザー作成アルゴリズム・自動値修正不可/手入力タグ が未着手 — TC: 撮影画像から HSV/Lab色抽出・輪郭・サイズ推定を算出し数値化・自動計測値は修正不可で手入力はタグ付与されることを検証 |
| V3-OBS-48 | A | 機能要件 | 未・コード | L | 観測詳細に『再解析』ボタンを1つ置き既存画像から全解析を最新ロジックで再実行・既存を上書きせず新レコード(analysi… | 再解析route/ボタン・新 analysis_id 追記(非上書き)・isManualEdit/editedAt/再解析ログ/delta差分・補正式/ROI/色補正の semantic version 管理 が未着手(元画像非削除は append-only で構造的に担保) — TC: 再解析が新 analysis_id で追記(既存非上書き)し delta差分と補正式 semantic version を記録・元画像を削除しないことを検証 |
| V3-OBS-56 | A | 機能要件 | 未・コード | L | searchable_capture_setをParquet検索中核とし captures+thumbnail+embe… | searchable_capture_set Parquet・Polars join・固定列順(capture/individual/measurement縦持ち/lineage/…)・latest pointer方式・snapshot_id版管理・個体画像レイク新repo が未着手 — TC: captures+thumbnail+embedding manifest の Polars join で固定列順 Parquet を生成し latest pointer が上書きされない(snapshot_id版管理)… |
| V3-IND-01 | S | 機能要件 | 一部 | M | 観測を親個体に紐付け父sire母dam記録・観測入力/個体詳細から親設定・個体詳細→観測履歴・buildPedigree… | buildPedigree(任意個体からの系譜ツリー再構成)route/関数、個体詳細から親(sire/dam)設定UI。現状は capture の sire_id/dam_id フィールド、subject_ref=individual/{id}、GET /individuals/{id}/obse… — TC: buildPedigree の系譜ツリー再構成(多世代・欠損親)TC、親子リンケージ整合 TC(根拠: apps/api/src/observation-routes.ts:100-110) |
| V3-IND-02 | A | 制約 | 一部 | M | individual master保存先をIHL R2 individual正本とし、成長データを持たせずUID(QR)… | individual-keyは識別足場(成長データ非保持)・QR一貫識別・subject_ref紐付けは設計/実装済だが、individual master実体recordをR2に書く生成pathが無く個体はsubject_ref参照のみの幽霊。individual正本の書込route新設・環境ログ… — TC: contract(cl-06拡張): individual master正本がR2に書かれ成長データフィールドを持たず、QR/subject_refが幼虫〜標本をUID一貫識別することを検証(根拠: schemas/frozen/individual-key.schema.json:11; apps/api/src/observation-routes.ts…) |
| V3-IND-13 | A | 機能要件 | 一部 | L | 個体詳細(A2)を個体ホーム化し6文化+誕生〜標本〜マーケットの1画面タイムラインに集約 | 現状は観測履歴listとQR発行のみ。6文化集約(スケジュール自動生成/成長曲線グラフ/DataSource棚温度計照度計/マーケットオファー/改善文化)・誕生→観測→移動→死亡→標本→マーケットの1画面時系列タイムライン・所有者履歴・種形態・生体カード・統計・環境時系列の統合UI+投影APIが未実… — TC: apps/web e2e + contract: 個体詳細レスポンスが6文化とタイムラインイベント(誕生〜標本〜マーケット)を1画面に集約することを検証(根拠: screen-defs/individual-detail.json:1; apps/api/src/observation-routes.ts:341) |
| V3-IND-15 | A | 機能要件 | 一部 | L | 生体カード生成(種/形態/サイズ/特徴/QR)+名刺型番等倍印刷+A4 3パターン連番QR自動生成 | 単一QR発行とqr-code描画node/解決pageのみ実在。生体カード生成(種/形態/サイズ/特徴/QR)・印刷テンプレfork/外部素材取込/UIビルダー編集・A-one/コクヨ名刺型番91×55mm等倍対応・A4 3パターン(QRのみ/QR+情報/QR+情報+名刺切込)・連番QR 100/5… — TC: 生体カード生成/連番QR枚数/QR中身=個体URLは自動contract TC。名刺型番の100%等倍・切込位置ズレは manual: 物理印刷実測が必要(根拠: apps/api/src/observation-routes.ts:352; screen-defs/individual-detail.json:33; a…) |
| V3-IND-21 | A | 思想 | 一部 | L | 登録数と実在数を照合する透明性PF: 生体データ連続性を真正性の唯一証拠とし詐称を検知する思想 | 画像sha256hash・append-only event履歴という連続性証拠の基盤は在るが、登録数vs実在数照合・生体データ連続性(成長曲線/温湿度ログ/hash/state履歴)による真正性判定・アカウント売買/すり替え/血統詐称検知(引き継ぎ連続性)・取引出品文の血統説明矛盾照合を購入者が確… — TC: 画像hash/event連続性チェックと出品文血統矛盾検知ロジックは自動contract TC。透明性文化・購入者確認行動自体は manual: 運用観察(根拠: apps/api/src/observation-routes.ts:157; packages/truth/src/store.ts:45) |
| V3-OBS-01 | S | 機能要件 | 一部 | S | 観測を5ドメイン(生物/器物/デジタル/環境/カスタム)に分岐・ナビゲータ・非生物はタグ方式・汎用EntityDataN… | 5ドメインのラベルが要件(生物/器物/デジタル/環境/カスタム)と実装(生き物/鉱物/デジタル/場所/カスタム)で2件乖離・裁定出典なし → K1 で整合(裁定材料化 or ラベル修正)。obs-domain-select の選択が obs-entry に引き継がれない(実質cosmetic)配線も… — TC: obs-domain-select が5ドメイン選択ナビ提供、capture が domain フィールドで汎用構造(observation-routes.ts:100)。ドメイン別taxonomy差別化は tag方式=…(根拠: screen-defs/obs-domain-select.json:20-24) |
| V3-OBS-03 | S | 制約 | 一部 | M | 種同定候補はAI/GBIF/Wikidata提示可だが種/亜種/個体ラベル確定は常にユーザー・AIは亜種を自動確定しない… | GBIF/Wikidata候補提示の統合(候補ソース)。制約の核(AIが確定せずユーザーが species_confirmed_by で確定)はフィールドで構造的に担保済・AI自動確定経路は存在しない — TC: AIが species_confirmed 相当を書けない(確定は人間経路のみ)不変の TC、候補提示と確定分離の TC(根拠: apps/api/src/observation-routes.ts:100-110) |
| V3-OBS-06 | A | 制約 | 一部 | M | 全計測/特徴値にvalue_origin(direct_observed/image_derived/…/imputed… | enum語彙は凍結済だが必須化されていない。obs-capture の measurement item に value_origin 欄が無く『必ず併記』が未強制。imputed と estimated の区別 enforcement も未 — TC: 各 measurement に value_origin 必須・欠落/不正値を400・imputed と estimated を別値保持することを検証(根拠: schemas/frozen/provenance.schema.json:30-44 (value_origin enum を direct_observed…) |
| V3-OBS-08 | A | 機能要件 | 一部 | L | 観測パイプラインをITO構造の component契約(input/output manifest・run_info/e… | ITO component契約本体(input/output manifest・run_info/errors.jsonl・output_manifest必須出力・同run_id出力先が既存ならfail・失敗行はerrorsへ追記し継続)が未構築。TS書込路の provenance付与のみで、派生 … — TC: 最小 component で output_manifest/errors.jsonl を出力し、run_id 出力先既存で fail・不正1行で continue+errors追記 を検証(根拠: apps/api/src/observation-routes.ts:187-207 (thumbnail manifest に run_id/schema_v…) |
| V3-OBS-09 | A | 機能要件 | 一部 | L | 画像埋め込みをEmbeddingBackend Protocolで一本化(本番DINOv2 384/L2、既定dummy… | manifest契約+読取/検索/384遮断は実装済だが画像 EmbeddingBackend 生成側が無い。DINOv2 vits14 backend・dummy決定論(sha256→正規乱数→L2正規化/NaN禁止)backend・IHL_EMBEDDING_BACKEND切替・撮影時生成(色ヒ… — TC: dummy backend が sha256→L2正規化384次元・NaN無し・同入力同出力(決定論)を返すことを検証(根拠: schemas/frozen/embedding-manifest.schema.json:31-51 (embedding_dim=384/vector_of…) |
| V3-OBS-10 | S | 非機能要件 | 一部 | M | 類似検索は決定論梯子(whitelist→subset→embedding cosine→重み付きrerank top-… | 重み付きrerank、prototype(選択群平均ベクトル)/二モーダル検索、query自身除外、Parquet manifest DuckDB/Polars表検索。whitelist→subset→embedding(384次元遮断)決定論梯子+ladder_stage+Phase1 subse… — TC: 重み付きrerank順位、prototype平均ベクトル検索、query除外、次元不一致遮断(≠384)の TC(根拠: apps/api/src/observation-routes.ts:249-309) |
| V3-OBS-11 | A | 機能要件 | 一部 | M | 類似検索rerankをembedding+color+size+lineageの重み付き合成(0.50/0.20/0.2… | embedding 単体 cosine のみ。final=0.50e+0.20color+0.20size+0.10lineage の合成rerank・欠測既定・個体単位 max/mean_top3/weighted_latest 集約 が未 / evidence の cosine は OBS-10… — TC: 合成スコアが 0.50/0.20/0.20/0.10 重みと欠測既定で決定論的に算出され個体集約3方式が正しいことを検証(根拠: apps/api/src/observation-routes.ts:290-303 (embedding cosine rank ③段のみ)) |
| V3-OBS-18 | S | 機能要件 | 一部 | L | 計測テンプレ完全自由項目(数値/text/選択/画像注釈/API/計算)・雌雄令齢置場別・fork/プラチナ投票淘汰・未… | item_hash未登録項目検出+追加確認(はい/今回だけ/常に)、雌雄別/令齢別/置き場所別テンプレ、画像アノテーション/API/計算項目タイプ、プラチナ投票による自然淘汰。現状は title/items/forked_from の追記/一覧のみ — TC: item_hash 突合で未登録検出、fork(forked_from)系譜、項目タイプ別バリデーションの TC(根拠: apps/api/src/observation-routes.ts:216-241) |
| V3-OBS-20 | A | 機能要件 | 一部 | M | 個体/棚/場所QRを発行/スキャンしスキャンで新規観測セッション開始(前回値prefill・entryMode:qr・棚… | QR発行/解決のみ実装。スキャン→新規観測セッション開始・前回値prefill・entryMode:qr記録・棚→個体→種→前回テンプレ自動入力チェーン・研究マット matId/lotId QR 取込 が未実装 — TC: QR resolve→capture の前回値prefill と entryMode=qr が capture に記録されることを検証(根拠: apps/api/src/observation-routes.ts:352-385 (POST /individuals/:id/qr 発行・GET /qr/…) |
| V3-OBS-23 | A | 機能要件 | 一部 | S | 写真1枚以上をR2保存しthumbnail(EXIF transpose/長辺512px/JPEG)生成・詳細にサムネイ… | thumbnail生成/保存/R2 upload は実装済。ただし thumbnail 配信 GET エンドポイントが無く obs-detail は raw /image/ を表示している(UI が thumbnail に未差替)。raw全件DL禁止の enforcement も未 — TC: detail が thumbnail(512px JPEG)を表示し raw 一括DLエンドポイントが存在しないことを検証(根拠: apps/api/src/observation-routes.ts:175-210 (upload→R2 putBlob→generateThumbnail …) |
| V3-OBS-25 | A | 機能要件 | 一部 | M | 観測登録を3画面フロー(対象を選ぶ→入力→確認)にし入力単体の即時保存を禁止・確認画面の主CTAを『登録する』1つに限定… | 確認画面(pre-save・主CTA『登録する』1つ)が無く、obs-entry が即時保存(save-and-done)している=要件違反。確認画面追加・save-and-done廃止・walkId で設計書↔実物の結び付けが未 — TC: 確認画面を経ずに保存不可(save-and-done禁止)かつ確認画面の submit CTA が1つであることを E2E で検証(根拠: screen-defs/obs-domain-select.json (対象選択) と screen-defs/obs-entry.json:19,44-46 …) |
| V3-OBS-28 | S | 機能要件 | 一部 | L | SwitchBot等IoTセンサーAPI連携・5/10/30/60分間隔取得→R2 append・撮影時snapshot… | 間隔poll(5/10/30/60分)スケジューリング、撮影ボタン押下時の気温湿度スナップショット→photo_conditions自動埋込、閾値超過アラート、計測行ごとの個別デバイス選択UI。現状は collector ingest(Ed25519署名→R2 append)+ components… — TC: 間隔スケジューリング、photo_conditions自動埋込、閾値アラート発火、プレースホルダ値偽装拒否 の TC(根拠: apps/api/src/collector-routes.ts:36-95) |
| V3-OBS-43 | S | 機能要件 | 一部 | L | 観測を文明OS中心Input(全機能一次データ)と位置づけ・R2文明史INSERT・全KernelをObservatio… | Transform→Insight/Generate 下流パイプライン、観測データを基盤とした仮説生成/空白検出/引用ネットワーク。現状は観測セッション→R2 INSERT(入力)まで — TC: 仮説生成/空白検出/引用ネットワークの各Transform出力 TC(観測JSON→insight)(根拠: apps/api/src/observation-routes.ts:115-130) |
| V3-OBS-44 | A | 制約 | 一部 | L | input取得はDocker拡張側に寄せ本体はC-USB Lite共通API(POST /cusb: validate/… | 汎用 POST /cusb(validate→lineage/semantic付与→保存→Twin通知)未実装。input6分類・schema.json宣言からの拡張GUI自動生成/.env自動生成・fork/いいね/プラチナ/ハッシュ改ざん検知 が未着手 — TC: POST /cusb が validate→lineage/semantic付与→保存 を通し不正schemaを400・ハッシュ改ざんを検知することを検証(根拠: apps/api/src/collector-routes.ts:36-95 (取得ロジック外部化・署名済み値のみ受入の先例)) |
| V3-OBS-52 | A | 制約 | 一部 | M | RawData/元画像はRDBに入れずR2に保存しObservationと1:N紐付け・データ本体は捨てず・観測画像は必… | 元画像の R2 保存・1:N・append-only は実装済(そもそも RDB 非採用)。再測定タグ・音声/センサー生データの RAW append-only ログ化 が未 — TC: 元画像が R2 に置かれ Observation と 1:N・上書き不可・再測定タグ付与を検証(根拠: apps/api/src/observation-routes.ts:135-213 (元画像を R2 media/photo へ putBlob・captur…) |
| V3-OBS-62 | A | 機能要件 | 一部 | L | 観測フローを固定順(auth→種族→亜種必須(AI自動確定禁止)→QR/手動→テンプレ→撮影→ローカル解析→API入力→… | 固定順フロー全体は未組成。亜種確定必須ゲート(AI自動確定禁止)・ローカル解析・LabelMe適用・タグ編集(緑赤評価)・個体/bio/project/market/AI/文化への自動反映・約10秒目標 が未 — TC: 亜種未確定で保存を400(必須ゲート)にし固定順フローの各段通過を E2E で検証(根拠: apps/api/src/observation-routes.ts:115-213 (capture→撮影upload→R2 INSERT ONLY の一部セ…) |
| V3-OBS-63 | A | 機能要件 | 一部 | L | タグをappend-onlyなtag event(誰/いつ/system_raw/human_added/invert/… | schema+append-only+TC は実装済だが、専用 tag route・aggregator投影(strong/weak/disputed→tag_aggregate/merged_tags)・ai_tags/user_tags 二層必須(片方保持禁止)・invert/review_ne… — TC: 同一 target への tag_event 追記から aggregator が strong/weak/disputed を導出し ai_tags/user_tags 両方欠落で拒否することを検証(根拠: schemas/frozen/tag-event.schema.json (append-only tag_event 契約) と tests/cl-13-ta…) |
| V3-OBS-05 | A | 制約 | 実装済 | - | 観測はappend-onlyで編集UI禁止・修正は新規追記・R2/TruthのUPDATE/DELETE禁止・AI解析結… | (根拠: apps/api/src/observation-routes.ts:124 (全書込が putEvent で put-if-absent・編集route不在)…) |
| V3-OBS-22 | S | 機能要件 | 実装済 | - | MVP v1観測コアを収集/写真登録/詳細ビュー/親個体連携/QR(FR-MVP-01〜05)に限定・観測が画面で動きR… | TC: 観測コア全route(captures/upload/detail/individuals-observations/qr)実装済+ apps/web/e2e/observation.spec.ts が画面→R2書込を実…(根拠: apps/api/src/observation-routes.ts:115-373) |
| V3-OBS-29 | A | 制約 | 実装済 | - | IoT秘密鍵をサーバ/R2/gitに持たずユーザー端末側のみに置き署名付き測定値だけ送る2ゾーン分離・サーバ自動poll… | (根拠: components/collector-switchbot/run.py:145-160 (秘密はローカル env のみ・値は非出力) と apps/api/…) |

### K2 認証/ロール+セキュリティ/法務(17 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-SEC-13 | A | 機能要件 | 未・コード | L | 公開エクスチェンジ移行時PIIをredactし構造化IDのみ許可・住所(末尾4桁以外)/QR/バーコード/OCR住所を自… | PII redact/自動マスク処理が完全未実装(apps/api/src に redact/mask/ocr コード無し)。要: 公開化時に住所(末尾4桁以外)・QR/バーコード・OCR検出住所を自動マスクし構造化ID(追跡番号/観測画像ID/trade_event ID)のみ許可するパイプライン… — TC: 住所/QRを含む取引メッセージ・画像が公開化時に自動マスクされ構造化IDのみ残ることのTC(実装後) |
| V3-SEC-45 | A | 非機能要件 | 未・コード | L | ユーザーコード/ドライバーをサンドボックス(Extism/Docker/WASM/vm)隔離実行・本番DB読取専用/テス… | サンドボックス実行基盤が完全に未着手(env.ts/gmo-connector.tsのsandbox言及はsunabar環境の意で無関係)。要: 隔離実行ランタイム・本番DB read-only/テストDB破壊可の二層・外部通信遮断・CPU/mem制限・失敗時400・GrapesJS+Blockly… — TC: 隔離実行が本番DBへ書込不可/外部通信不可/資源超過で400を返すことのTC(実装後) |
| V3-AUT-04 | A | 制約 | 一部 | M | マジックリンク本番SMTP鍵=人間ゲート・実送信はWorkers外・リンク先はPUBLIC_APP_URL固定・送信→ク… | 実RESEND鍵投入は人間ゲート・本番の送信→クリックE2E未実施。送信はResend HTTP API経由(Workers単独SMTP完結はしていない=intent充足)だが、要件が『VPSでSMTP実送信』を厳密要求するならVPS中継を追加要 — TC: tests/auth.test.ts が magic-link→verify→session の dev E2E を自動化済。実メール送信→クリックは manual: 実鍵投入(人間ゲート)が前提で自動化不能(根拠: apps/api/src/mail.ts:11 (RESEND_API_KEY未設定でskip=実鍵は人間ゲート), apps/api/src/mail.ts:…) |
| V3-AUT-06 | A | 機能要件 | 一部 | M | ログインはメール入力+利用規約同意チェック必須・未同意/未入力で送信ボタン無効化(規約全文スクロール完了で同意可は将来) | 利用規約同意チェックボックスがlogin.jsonに存在しない+rendererにcheckbox variant無し。送信ボタンの無効化はloading時のみ(renderer.tsx:220)で、未入力/未同意でのreactive無効化は未実装(submit時ブロックのみ)。規約全文スクロール完… — TC: login描画で規約未チェック時に送信ボタンがdisabled・チェック後enableになることのTC(実装後)(根拠: screen-defs/login.json:22 (emailフィールドrequired:true), apps/web/src/renderer/rende…) |
| V3-AUT-11 | A | 制約 | 一部 | M | 認証→初期設定フロー(登録→国/言語→利用規約→ホーム)を明示定義し全画面遷移をnavigation.jsonで一元管理 | 中央 navigation.json が未作成(全画面遷移の一元管理ファイル欠落)。国/言語選択・利用規約のオンボーディング画面が未作成(screen-defsはlogin/home/obs系のみ・country/language/terms screendef無し)。登録→国/言語→利用規約→ホー… — TC: 全screendefのtransitionsを集約したnavigation.json生成とフロー到達性を lint/TC で検証(実装後)(根拠: screen-defs/login.json:37 (画面ごとにtransitions配列を保持=遷移の部分定義)) |
| V3-AUT-22 | A | 機能要件 | 一部 | L | admin系ルートroleゲート・devツール既定off・Capability読取専用表示・MagicLink→JWTセ… | admin系ルートのroleゲート・Capability(economy_master_propose/judicial_resolve等)の読取専用表示が未実装(role/admin/capability実装が一切なし)。要件自身がロール体系3案不整合→ver3で統一1案確定(人間裁定)まで配線保… — TC: admin系ルートが非adminロールを弾く(403)TCとCapability読取専用表示のTC(統一ロール体系確定後)。MagicLink→session連結は tests/auth.test.ts で担保(根拠: apps/api/src/auth-routes.ts:74(dev-login は DEV_TOKEN 未設定で 404)+ apps/api/src/ind…) |
| V3-SEC-02 | A | 非機能要件 | 一部 | S | collector秘密鍵はcollector/.envのみ・ingestはEd25519署名付き・公開鍵は秘密鍵から自動… | 公開鍵を秘密鍵から自動導出してAPI側COLLECTOR_PUBLIC_KEYSへ同期するスクリプトが未実装(現状 .env.example は手動コピペ前提)—手動由来の鍵ミス排除という指定成果物が欠落 — TC: derive-sync スクリプトが秘密鍵→SPKI公開鍵を導出しCOLLECTOR_PUBLIC_KEYSと一致することのTC(実装後)。署名認証経路は components/collector-switchbot/t…(根拠: components/collector-switchbot/run.py:176 (秘密鍵PEMはenvファイルのみ・非印字で署名), apps/api/sr…) |
| V3-SEC-03 | A | 制約 | 一部 | M | SwitchBot等外部APIキーはサーバ非保持・ユーザー側(env/localStorage)のみ・WEBは手入力/C… | WEB版の手入力/CSVインポート鍵登録経路が未実装(現状は collector Docker 経由のみ)。将来のユーザー別GUI鍵追加・写真取得と同一タイミング一括取得(時刻ズレ防止)は明示的future。核となる『サーバに秘密を持たない』境界は充足 — TC: API応答/設定にSwitchBotトークンが一切現れないことの検証TC(現状 components/collector-switchbot/tests/test_collector.py が署名経路を担保)。CSV鍵イ…(根拠: components/collector-switchbot/run.py:145 (SWITCHBOT鍵はユーザーenvファイルからのみ読取・非印字), ap…) |
| V3-SEC-04 | A | 制約 | 一部 | S | 秘密値をrepo/docs/R2/フロント/ログに書かずenv_fileでランタイム注入・commit前scan・秘密平… | repo/docs/ログへの秘密混入を機械検出する secret-scan GATE が lint/CI に未追加(禁止事項では『commit前に手動 git log -p scan』の運用のみ)。scripts/ に secret スキャナ無し(check-ui-tokensは色専用) — TC: lint に .env 実値/APIキー様パターン(re_/sk-/PEM等)混入検出GATEを追加(todo-tc)。署名不一致401は既存 contract TC で担保済(根拠: apps/api/src/collector-routes.ts:70 (署名不一致は理由のみ短く返し401・秘密非出力), components/collec…) |
| V3-SEC-06 | A | 制約 | 一部 | L | PII/決済情報を非保持・送金はユーザー間銀行振込でOS不関与・売上一定割合(8%)を積立・一意振込名義コードで突合控除… | 売上一定割合(8%)の積立レートが economy-constants に未定義・積立/控除ロジック未実装。本人紐付けの外部連携(X/Facebook OAuth)未実装(認証はmagic-linkメールのみ)。非PII設計とU-code突合は充足 — TC: reconcileOnceがtransfer_code一致のみ台帳appendするTC(既存CL-11系)。8%積立レート・控除・外部連携突合は実装後にTC(根拠: apps/api/src/gmo-routes.ts:68 (一意transfer_codeで入金突合=reconcileOnce), apps/api/src…) |
| V3-SEC-07 | S | 制約 | 一部 | L | PII検出→マスク→保存順・平文PII保存/復元/ログ残留禁止・user_id_hashのみ・email_index S… | 観測/資料PIIの検出→マスク({{PII:TYPE}})→保存パイプライン、人間ゲート用候補一覧・クリーンデータセット・差分レポート生成、原本隔離保管。現状は認証側 user_id_hash(deriveActorId=sha256 salt:email)+ステートレスで平文email非永続まで。… — TC: PII検出→マスク→保存順序の強制(マスク前保存拒否)、{{PII:TYPE}}マスク網羅、差分レポート整合 TC(根拠: packages/truth/src/contracts.ts:37-45) |
| V3-SEC-31 | A | 思想 | 一部 | M | 特許非取得・公開日で先使用権を主張する公開宣言書(MANIFESTO/README/CONTRIBUTING/CODE_… | 公開宣言書5点のうち MANIFESTO/CODE_OF_CONDUCT/LICENSE の3ファイルが未作成(AIが草案作成可能)。Apache2.0の最終確定と公開日の実施は人間ゲート(公開の実施) — TC: 公開宣言書5点(MANIFESTO/README/CONTRIBUTING/CODE_OF_CONDUCT/LICENSE)の存在を lint でGATE化(実装後)(根拠: README.md (単一repo/フォーク文化宣言・存在), CONTRIBUTING.md (貢献規約・存在)) |
| V3-SEC-52 | A | 制約 | 未・TC | S | ユーザー不在時の無断cron情報取得を避け能動操作時にAPIを叩く・サーバcron自動取得時は事前に明示同意UI必須 | wrangler.toml の [triggers.crons] を走査し同意 UI/フラグ配線なしのサーバ側 cron 追加を fail にする lint GATE(批評家指摘反映・C5 で gmo reconcile cron を配線するため時宜) — TC: lint: wrangler.toml cron 走査 GATE(根拠: components/collector-switchbot/run.py:6 (NOT a daemon — one run・ユーザー起動), apps/ap…) |
| V3-AUT-01 | S | 制約 | 実装済 | - | 認証はメールmagic-link一本(password/OAuth/SMS/TOTP/social非サポート) | TC: tests/auth.test.ts が magic-link→verify→session フローを検証。password/OAuth route は存在しない(deny-by-defaultで404/401)(根拠: apps/api/src/auth-routes.ts:27-58) |
| V3-SEC-34 | S | 制約 | 規約 | - | 外部取込は共有ボタン/認証API/OAuth本人所有領域のみ許可(P0許可レイヤー)・スクレイピング/ログイン必須自動取… |  |
| V3-SEC-24 | A | 制約 | 人間G | - | 利用規約条文正本/法務文言はAI変更禁止・公開前に人間(専門家)レビュー証跡・運営者名/連絡先/準拠法/管轄/ToS法務… | TC: manual: ToS条文正本・運営者名/連絡先・準拠法/管轄・ToS法務翻訳は人間(専門家)裁定=#02 HUMAN-02-LEGAL。機械翻訳を正本にしない前提でAIが完成品を作れない。機械TC対象外 |
| V3-SEC-30 | A | 思想 | 人間G | - | 文明OSをOSS(Apache2.0/MIT検討)公開・LICENSEをorg確定版へ差替・公開時期は機を見て判断 |  |

### K3 カルマ/経済+マーケット取引(32 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-KRM-04 | A | 機能要件 | 未・コード | M | カルマ値≤-100で永久BAN(ログイン拒否)。R2データは保持しプロフィールに『永久BAN』を第三者閲覧可で表示、免罪… | auth-routes.ts のログイン経路にBANゲート未実装(karma_value≤-100 で拒否)。projectLedger は既にkarma_value算出可なので投影を参照する gate 追加+プロフィール投影に ban フラグ公開表示。免罪符(KRM-05)適用除外の連携。BAN … — TC: karma_value≤-100 の actor がログイン拒否・プロフィール投影に永久BAN公開表示・R2イベント保持(削除なし)を検証 |
| V3-KRM-05 | A | 機能要件 | 未・コード | M | 免罪符をプラチナコインマーケットで販売、1購入=カルマカウント-1(0未満不可)。効果はcount-1のみ(値直接購入/… | 免罪符購入 route 未実装。PT消費で karma count-1(0未満不可・値やFib逆操作はしない)・Fib段階価格(初回1PT/購入ごと段階+1/暦月ごと段階-1/上限なし)・プラチナコインショップUI。永久BAN(KRM-04)には非適用の連携 — TC: 免罪符1購入で count-1(count=0では不可)・値やFibペナルティを逆操作しない・価格が購入で段階+1/暦月で段階-1 する Fib 列であることを検証 |
| V3-KRM-11 | A | 機能要件 | 未・コード | L | 貢献度Δを子→祖先へ10%重み配分し、100到達ごとにissueCoin鋳造+端数繰越、フォーク収益を低レイヤー全員へ月… | applyContributionDelta 未実装。依存グラフ祖先探索+upstreamPercent(10%)重み配分・contributionPerPlatinum(100)到達でissueCoin+端数繰越・低レイヤー作者への月集計還元・称号閾値(10000/GUI可変)を新規実装。cont… — TC: applyContributionDelta で子Δ反映→祖先へ10%重み配分→累計100到達でissueCoin1枚+端数繰越、称号10000到達を検証 |
| V3-KRM-12 | A | 機能要件 | 未・コード | L | 貢献度をADR-H-38の3軸(research/capital/development)で独立追跡。各軸100ptで1… | 3軸貢献度追跡+軸別Fib鋳造閾値エンジン未実装。research/capital(維持費税1:1)/development(GitHub+掲示板採択+fork月次accrual+更新者)の accrual・Fib(n)*100 鋳造閾値・月次Fib降下(下限100/残高非減衰)・UTC月境界・fo… — TC: 各軸100pt→1PT鋳造・2枚目以降Fib(n)*100・当月ミント無しでFib1段降下(下限100・残高非減衰)・UTC月境界を検証 |
| V3-KRM-13 | A | 機能要件 | 未・コード | M | GitHub開発者貢献(PR/Issue/レビュー/push/release/star)をwebhook受信し貢献度Δ換… | GitHub webhook 受信 route 未実装。HMAC(X-Hub-Signature-256)署名検証・github_delivery_id べき等(重複put=409)・行動→ポイント換算表/条件→バッジ表を config/github-contribution-weights.jso… — TC: HMAC不正署名は拒否・同一 github_delivery_id 再送はべき等・config weights 変更が換算に反映されることを検証 |
| V3-KRM-16 | A | 機能要件 | 未・コード | L | プラチナ/カルマ/貢献度/称号の付与条件をtrigger/action/amount統一フォーマット(policy_ke… | 現状 economy-constants.ts はハードコード定数(policy table でない)。trigger/action/amount+domain の policy_key+policy_int テーブル・GUIノーコードCRUD(数式/閾値/免罪符初期価格/変換レート)・付与項目の実… — TC: policy table からの付与解決(定数直読でなく policy_key+policy_int 参照)・GUI編集後の反映・付与履歴が append-only であることを検証 |
| V3-KRM-20 | A | 機能要件 | 未・コード | L | 使用率/投票/いいね/悪いね/お気に入り/フォロー/フォーク数/改善案数の総合指標で自然淘汰。レイヤー4は投票・フォーク… | 総合指標集計の投影未実装。社会イベント(vote/like/dislike/favorite/follow/fork/proposal)台帳+コンポーネント単位評価投影・レイヤー0-3限定/レイヤー4除外ガード・他者評価強制(本人不可)・公式ランキング非生成(統計のみ)を新規実装 — TC: 社会イベント集計がレイヤー0-3のみ対象・レイヤー4除外・本人自己評価拒否・公式ランキングを出力しないことを検証 |
| V3-KRM-21 | A | 制約 | 未・コード | L | プロフィールでKarma/Contribution/Market評価の3指標を統合せず個別表示(研究スコアはContri… | プロフィール投影(3指標個別)未実装。研究スコアをContribution内訳に格納(独立4番目にしない・ADR-H-08)・取引実績/カルマ/悪レビュー/不服申立ての非公開設定不可ガード・国/言語/文化タグ/自己紹介/アイコンのみ公開設定可・国際信頼スコア(0-100)算出。screen-def … — TC: プロフィール投影が3指標を個別返却・研究スコアがContribution配下・公共安全情報(カルマ/取引/悪レビュー)の非公開設定を拒否することを検証 |
| V3-KRM-24 | A | 機能要件 | 未・コード | L | 文化サイクル(使う→改善案→採用→フォーク→評価→RAG→Builder反映)。改善案にrank(official/re… | 改善案rank enum(official/recommended/popular/beginner/minor)遷移・IT.Hercules.Laboratoryマーク・フォーク自動ブランチ生成+rank=beginner初期登録・社会機能(いいね/プラチナ/お気に入り/フォロー)・仮説論文状態機… — TC: 改善案フォークで rank=beginner 自動登録・rank昇格遷移・仮説論文が支持/否定票の信頼度で supported/rejected へ収束しアーカイブされることを検証 |
| V3-KRM-25 | A | 機能要件 | 未・コード | L | 改善要求は『プラチナ投票』。1票=1プラチナコインで任意枚数、誰が何枚積んだか公開の合計値方式。閾値到達で本人通知+公式… | プラチナ投票 route/台帳未実装。1票=1コイン積み上げ(全対象:論文/UI/イベント/プロンプト)・公開合計値+投票者内訳・閾値(用途別/GUI可変)到達で本人通知+公式昇格・A90/A95安全チェック連携・ソートロジックJSONのサンドボックス試行→使用率/評価統計で本番自動昇格を新規実装 … — TC: 投票コイン積み上げの公開合計値・閾値到達で公式昇格通知・投票者内訳が全員公開されることを検証 |
| V3-MKT-02 | A | 機能要件 | 未・コード | L | Listing状態機械(許可辺のみ遷移API・不正遷移409・reduceMarket純関数・transaction_e… | 状態機械が未実装。現 market-routes.ts は出品 append と一覧/詳細投影のみ(状態列なし)。unlisted→listed_*→sold/delisted/offer_* の遷移 API(許可辺以外は409)、イベント列末尾を集計する reduceMarket 純関数、mark… — TC: 許可辺の遷移が反映され不正遷移が409・reduceMarket が末尾状態を正しく集計することを検証する state-machine TC(遷移マトリクス網羅) |
| V3-MKT-03 | A | 機能要件 | 未・コード | L | 取引ステージモデル(マッチング前公開・後は当事者2人非公開ボード・stage stepper UI・落札はStage1省… | ステージモデル未実装。マッチング前=公開(商品詳細+公開Q&A+ほめボード)、マッチング後=当事者2人だけの非公開プライベートボード(送金/配送調整)、配送/振込=Stage2、stage=クエリの単一画面 stepper UI、オークション落札は Stage1 省略で Stage2 直行、を新設(… — TC: マッチング後は当事者2人のみ private board にアクセスでき第三者は403・落札時 stage が Stage2 から始まることを検証する trade-stage TC |
| V3-MKT-04 | A | 機能要件 | 未・コード | M | 取引成立=配送完了確認+評価確定と定義・1ヶ月無評価で自動良い・8%fee は成立後起算 | 取引成立定義が未実装。買い手受取申告+評価確定で成立(マッチング/settled/sold 単独では不成立)、配送完了から1ヶ月無評価でシステム自動『評価:良い』(無期限pending防止)、8% fee_unpaid を成立後にのみ起算、を新設。自動評価はバッチ(C5 の定期ジョブ配線と共通)。 — TC: 受取申告+評価で成立し fee_unpaid が起算・配送完了+1ヶ月経過の無評価が自動『良い』化することを検証する settlement TC(時刻注入) |
| V3-MKT-06 | A | 機能要件 | 未・コード | L | オークション以外に直接オファー/期限付きラブレター方式・オファーポリシー個体ごと(テンプレ+override・種族for… | オファー系取引モード未実装。未出品個体への直接オファー(拒否設定は現観測者)、期限付きラブレター/告白方式(金額+理由・値段開示なし一発勝負・出品者が思いで選ぶ)、個体ごとオファーポリシー(完全拒否/研究目的OK 等・基本テンプレ自動付与+個別override・種族ごと fork)を新設。拒否設定の… — TC: ラブレター応募が値段非開示で集約され出品者選択で成立・拒否ポリシー個体はオファー拒否(409/403)を検証する offer-mode TC |
| V3-MKT-10 | S | 機能要件 | 未・コード | L | 取引成立時 売上8%をシステム維持費税として負債計上・30日猶予後1:1資本貢献変換・未払いfee_unpaid月次Fi… | 取引成立イベント+8%税負債計上+30日猶予タイマ+1:1貢献度変換+fee_unpaid月次Fibonacci Δcount配線。カルマ側 reason_code 'fee_unpaid' は ledger-routes.ts:126 に器のみ存在(未接続)。取引遷移(MKT-01)前提 — TC: 税額8%計算・30日境界・fibPenalty連動の TC 一式(境界=29日/30日/31日、全額消込でΔcount停止) |
| V3-MKT-20 | A | 機能要件 | 未・コード | L | 匿名配送・局留め推奨・住所非保持(UUID/UserID/名のみ)・郵便局ID登録・送料自動推定(着払い前提) | 配送/送料推定が未実装。ユーザー住所を保持せず郵便局ID(複数登録・1デフォルト)を保持、観測データから梱包サイズ推定→郵便局間距離×サイズで推定送料算出、着払い前提で実送料入力させず全取引画面に推定値表示、を新設。住所非保持は PII 不使用方針(不変条項③)と整合させる。 — TC: 個体観測データ+送/受の郵便局IDから梱包サイズ→推定送料が算出され、住所フィールドが保持されないことを検証する shipping-estimate TC |
| V3-MKT-22 | A | 機能要件 | 未・コード | L | テンプレ出品/フォーク/投票の文化進化エンジン・forked_from系譜・ランキング式・公式昇格 | Template/Component Marketplace 全て未実装。テンプレ(論文/UIスキン/グラフ/重み/AI設定/プロンプト)の出品・発見・フォーク・投票、全テンプレの forked_from 系譜、ランキング=利用率40+継続率20+評価20+Fork数10+改善数10、累計コイン閾値… — TC: 既知メトリクス(利用率/継続率/評価/Fork数/改善数)を入力しランキング=40/20/20/10/10 の重みで算出されること・fork で forked_from が連結されることを検証する ranking TC |
| V3-MKT-23 | A | 機能要件 | 未・コード | L | 出品黄金フロー(個体選択で親画像/血統/履歴自動引用・テンプレ自動生成・推奨価格自動入力) | 黄金フロー未実装。現出品は title/description/price の手入力のみ(market-routes.ts:39)。個体ID複数選択→親個体画像/血統/成長履歴/温度重量ログ/類似価格/過去取引の自動引用添付、変数化テンプレ({{size}}{{bloodline}})からの説明文自… — TC: 個体ID を選ぶだけで観測データ引用付き listing draft が生成され推奨価格が入ることを検証する autofill TC(相場はスタブ) |
| V3-MKT-25 | A | 機能要件 | 未・コード | L | 観測データ由来の特徴量で類似個体の過去成約価格を集め推奨価格算出・計算元込み全公開・毎年投票でロジック選定 | 価格推奨エンジン未実装。観測データ(種/血統/サイズ/性別/産地/環境ログ)の特徴量ベクトルで類似個体の過去成約価格を集約(重み付け平均・中央値)し基準/推奨価格を計算元込みで全公開、透明性スコアT/ブリーダーB/ラインL/市場中央値M から算出、相場算出式公開+毎年プラチナコイン投票で公式ロジック… — TC: 類似個体の過去成約価格集合から重み付け平均/中央値の推奨価格が計算元データ込みで算出されることを検証する price-recommend TC(embedding OFF 経路) |
| V3-MKT-27 | A | 機能要件 | 未・コード | L | 評価はADR-H-08の良い/普通/悪い件数モデル準拠・カルマと非統合独立ドメイン・プロフィール公開・低評価フィルタ | 取引評価ドメイン未実装。ADR-H-08 の良い/普通/悪い件数モデル(取引成立後のみ・事実+複数選択タグ+任意コメント・悪い評価は理由必須・金額含め第三者公開/非公開不可)、カルマ・好み学習と統合しない独立ドメイン、取引回数/中止回数/言った言われた回数のプロフィール公開、検索フィルタで低評価出品… — TC: 良い/普通/悪い件数の集計と悪い評価の理由必須バリデーション・低評価フィルタ閾値(≥5件/カルマ≤0/≤2★)除外を検証する rating TC |
| V3-MKT-29 | A | 機能要件 | 未・コード | L | 取引成立後の所有者移転+観測データ引き継ぎを系譜として不可逆連結・プラットフォーム外は保証しない | 所有権移転と観測系譜連結が未実装。取引成立イベントに紐づけ現観測者→新観測者への所有権移転と、個体の観測データ(温度/重量/齢/成長速度/画像/取引履歴)引き継ぎを一本の系譜として append(血統詐欺不可能化)、プラットフォーム経由取引に限り有効・外部取引は引き継がない判定、オファー拒否設定を現… — TC: 取引成立→観測者A個体をBへ移転し系譜(A→B・引き継ぎ観測データ)が連結され、外部取引フラグ時は引き継がないことを検証する ownership-transfer TC |
| V3-MKT-36 | A | 機能要件 | 未・コード | L | 経済3層(商用3%文明拠出/取引成立8%維持費税/フォーク収益10%原作者還元)・OSS非商用は圏外 | 3層の会計ロジック全て未実装。economy-constants.ts はカルマ数値のみで手数料率(3%/8%/10%)定数が無い。売上3%拠出(観測に売値・売れた個数必須)・取引成立8%維持費税積立(fee_unpaid 起算)・フォーク収益10%原作者(レイヤー0/1)還元・OSS非商用の圏外判… — TC: 売上に対する3%/8%/10%の各拠出額算出と OSS非商用=拠出0 を検証する fee 計算 TC(定数はスナップショットで凍結) |
| V3-KRM-03 | A | 機能要件 | 一部 | M | 毎月25日基準にカルマcount≥1ならcount-1、count=0完遂月のみ値+10(上限100)、期間中1日でもc… | MONTHLY_RECOVERY(10)/RECOVERY_BASE_DAY(25) 定数のみ集約済。月次バッチ本体が未実装(index.ts に scheduled() ハンドラ無し)。25日基準の count-1・count=0完遂月判定(月内 count≥1 履歴なら+10なし)・value+… — TC: 25日基準で count≥1→count-1、count=0完遂月のみ value+10(上限100)、月内 count≥1 発生月は+10なし の月次バッチを検証(根拠: apps/api/src/economy-constants.ts:12) |
| V3-KRM-06 | A | 機能要件 | 一部 | M | カルマは信用の残高で減少のみ・能動上昇なし・時間経過(問題なし+生体登録)でのみ回復。いいね/Bot/金銭では増減せず問… | カルマ台帳(karma_event)とプラチナ功績章(coin_event)を別台帳で分離済=『貢献はプラチナで報いる』構造は実装。ただし『減少のみ・時間経過のみ回復』が未担保: appendKarma は +delta も通す・時間回復バッチ未実装(KRM-03 依存)。値上昇経路を月次救済+生体… — TC: カルマ値の増加が月次救済/生体登録経路以外で発生しないこと・貢献付与が karma_event でなく coin_event に落ちることを検証(根拠: apps/api/src/ledger-routes.ts:95) |
| V3-KRM-10 | A | 機能要件 | 一部 | L | 貢献度(活動量)はKernelイベント換算でレイヤー0-3ノードに非負累積(減算しないinvariant)。貢献度/Pl… | 5概念のうち Platinum功績章(grantPlatinum/coin_event)のみ存在。Contribution Score(非負累積・減算不可invariant)・Research Score・PT(消費型・非公開)・Supporter(金銭・研究と完全分離)台帳と換算式が未実装。fro… — TC: Contribution Score が減算を拒否し非負累積すること・5概念が別台帳で分離集計されること(PTは非公開・SupporterはResearchに影響しない)を検証(根拠: apps/api/src/ledger-routes.ts:136) |
| V3-MKT-01 | S | 機能要件 | 一部 | L | P2Pマーケット: 固定価格/オークション/抽選/プラチナ優先/オファー(ラブレター)・非エスクロー非決済・公開trad… | オークション/抽選/プラチナ優先/オファー各チャネル、公開trade-eventログ、カルマ/評価表示、取引成立フロー。現状は ihl.mkt.listing.v1 の出品/一覧/詳細のみ(非エスクローは設計どおり=決済ホールド無し) — TC: 各販売チャネルの成立ルール・trade-event append・非エスクロー(資金非預り)不変の TC(根拠: apps/api/src/market-routes.ts:39-78) |
| V3-MKT-12 | A | 機能要件 | 一部 | L | userIdから決定的な振込コード生成+同一コード同額の複数pendingを義務発生日以降FIFO消込 | FIFO消込モデルが未実装。現 reconcileOnce は code→actor の1対1突合のみで、義務(pending obligation=期待入金の義務発生日・未払い残)の概念、同一コード同額の複数pendingに対する『振込日時優先+義務発生日以降で最古の未払いへFIFO消し込む』ロジ… — TC: 義務台帳(期待入金3件・同一code同額・義務発生日昇順)+入金1件→振込日時優先で最古未払いへ消込・残2件はpendingのまま を検証する reconcile FIFO TC(根拠: packages/truth/src/contracts.ts:53 (deriveTransferCode: SHA-256→uint24→Base36→U-…) |
| V3-MKT-14 | S | 機能要件 | 一部 | M | GMO VA入金Webhook受信+HMAC署名検証+振込コード照合・冪等(match_pending)・通知優先/障害… | VA入金Webhook受信route+HMAC署名検証(現状はポーリング listDepositTransactions で Webhook未実装)、取引Stage3インライン決済UI。冪等性(itemKey put-if-absent 二重409)・振込コード照合・sunabar/live分離・s… — TC: Webhook HMAC署名検証(正/改竄)、再送二重マッチ防止(match_pending冪等)の TC(根拠: apps/api/src/gmo-routes.ts:68-112) |
| V3-MKT-39 | A | 制約 | 一部 | M | 経済データ全R2 JSON・DB不要・Kernel集約・market_governance.csv policy_key… | R2-only/DB不要は既に架構で充足だが、実質新規=(1)market_governance.csv と tradePolicyResolver(同一 policy_key の timestamp 最新行を正とする政策数値解決)、(2)マーケットの認可・状態遷移・会計ロジックの Kernel 集… — TC: 同一 policy_key に古/新 timestamp 2行を投入し tradePolicyResolver が最新行の値を返すことを検証する policy resolver TC(根拠: apps/api/src/market-routes.ts:16 (TruthStore=R2 のみ・DB binding 無し); apps/api/src/…) |
| V3-KRM-01 | S | 機能要件 | 実装済 | - | カルマ二層独立モデル(値[-100,+100]初期0/カウント別)・値増加は月次のみ・減少はカウント増時Fibペナルティ… | TC: tests/ledger.test.ts + cl-12-ledger.test.ts が二層投影/fibPenalty(0→5=12,5→10=131)/INSERT ONLY を検証。economy-constant…(根拠: apps/api/src/ledger-routes.ts:19-133) |
| V3-KRM-23 | A | 思想 | 規約 | - | 個人の人格/価値観/行動ログ/世界観は個人所有で非共有、文明層はシリーズ構造/掛け合い/UI知見/評価モデルの『構造だけ… | データ設計思想(個人層と文明共有層の分離境界・共有NGタグ・99/1黄金比)。単一成果物を持たず、各機能(RAG学習/共有知投影)実装時にこの境界を守る制約として反映する |
| V3-MKT-19 | A | 思想 | 規約 | - | 悪質排除でなく正直取引が儲かるインセンティブ設計で自然淘汰(思想) | 思想要件。単一成果物を持たず、カルマ人質化(ledger-routes.ts の二層カルマ)・全行動履歴 append-only 蓄積・取引チャット公開等の複数機能の設計方針として下位要件(MKT-02/22/27 等)に分解実装される。『使いにくい市場』の構造排除も設計判断であり単一 TC で機械… |

### K4 UI/UX+設定+i18n(15 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-I18-08 | A | 機能要件 | 未・コード | L | UI文言をキー化しR2のi18n JSON参照+fallbackチェーン、欠落キーをCI検知しSR可読を維持 | i18nシステム皆無(screen-defsは日本語直書き例: home.json "観測ホーム")。{screen}.{component}.{field}キー体系・R2 i18n JSON参照・next-intl最小ワイヤリング・fallbackチェーン(国別→言語別→en→key)・翻訳DOM… — TC: screen-def参照の文言キー欠落を検知しfallbackで空白文言を出さないことを検証するCI/TC |
| V3-UIX-14 | A | 機能要件 | 未・コード | L | スタイル(色/角丸/影/アニメ/余白/タイポ)自体をコンポーネント化し継承/fork/AI生成/系譜ツリーを持つ | globals.cssのThemePackは単一固定テーマ(継承/forkなし)。スタイルをC-USB互換コンポーネントとするschema・継承チェーン(MinimalTheme→MinimalBlue)・fork・AI自動生成・系譜ツリー・切替機構を新設(V3-UIX-45のテンプレ機構と共通基盤… — TC: スタイルコンポーネントの継承/fork系譜のschema+contract TC |
| V3-UIX-45 | A | 機能要件 | 未・コード | L | ユーザーがUI/OSテンプレを選択/差替/編集/fork/共有しlike/platinum投票と使用率で自然淘汰 | UI/OSテンプレ選択機構は未実装(obs-template.schema.jsonは観測項目テンプレで別物)。default/recommended/customの3レベル維持・author/socialメタ・like/platinum投票・使用率集計・閾値到達で採用候補・fork系譜・JSON塊… — TC: テンプレのfork系譜・投票加算・採用候補閾値到達を検証するcontract TC |
| V3-I18-06 | S | 機能要件 | 一部 | M | UGC(掲示板/二人部屋/出品説明/自由記述)は作者言語原文のみR2 append・翻訳は閲覧者localeで閲覧者端末… | 閲覧者locale応じたクライアント側UGC翻訳、新FeatureNode自由テキストへの翻訳契約デフォルト継承。現状は出品description等を原文のまま保存(part1充足)するのみでクライアント翻訳層(part2)未実装 — TC: 原文のみ保存(サーバ翻訳しない)不変の TC、クライアント翻訳が閲覧者localeで走る E2E(根拠: apps/api/src/market-routes.ts:54) |
| V3-UIX-03 | A | 非機能要件 | 一部 | M | 全経路でok/loading/empty/error+権限なし/409理由を表示、rawエラー隠蔽し正直な空状態を出す | loading/errorの機構はButton/Form層に存在。未対応: 各node/list の empty状態(obs-detail.json:34 photos listは0件で空描画=正直な『写真なし(commit時未保存)』無し)・権限なし(401/403)表示・409競合理由表示・ra… — TC: 各node ok/loading/empty/error 4状態とエラーコード→日本語マッピングのrender TC(根拠: apps/web/src/renderer/renderer.tsx:214 (ButtonNode loading/error state); apps/we…) |
| V3-UIX-16 | S | 機能要件 | 一部 | M | デザイン正本ThemePack(--civ-*/design_token.yaml/UI primitiveカタログ)・… | design_token.yaml 正本化(現状トークンは globals.css)、ユーザー個別上書き、フォーク系譜。--civ-* トークン+light/dark 2パック(prefers-color-scheme+data-theme)+全画面 var 参照+scripts/check-ui-… — TC: design_token.yaml→CSS変数生成の一方向codegen、ユーザー上書き伝播、fork系譜の TC。token直書き禁止は check-ui-tokens が担保済(根拠: apps/web/src/app/globals.css:12-85) |
| V3-UIX-17 | A | 思想 | 一部 | S | 思想:UIをデータ(ScreenDef/JSON)で宣言し単一React Rendererへ変換、素HTML/JSエンジ… | 中核(UI-as-data→単一React Renderer・ページ追加=JSON追加・素HTML/JSエンジン不採用でNext/React+ScreenDef)は実装済。未達は『UI自体をノードとして保存/fork可』の実行時保存/fork(=V3-UIX-45で担保予定)のみ。 — TC: 全screen-defが単一Rendererで描画されるTC(renderer.test.tsx:18で実装済) + UI-as-node保存はUIX-45側TC(根拠: apps/web/src/renderer/renderer.tsx:478 (単一React Renderer NodeView); apps/web/src…) |
| V3-UIX-25 | A | 機能要件 | 一部 | M | ホームをWorld司令塔とし現在地カード+次アクション1行+FeatureNode入口だけ置き詳細は委譲 | home.jsonは次アクション1行(lead)と観測開始1クリック(→obs-domain-select)を満たす。未達: 現在地カード(source_pathバインドの今日の状態card)・観測/個体以外のFeatureNode入口(市場/知の広場/論文)をhome.jsonに追加。 — TC: homeが観測開始1クリック・主要FeatureNode2クリック以内を満たすTC(V3-UIX-02と共通)(根拠: screen-defs/home.json:15 (heading+次アクション1行lead+観測CTA1クリック+個体入口)) |
| V3-UIX-32 | A | 機能要件 | 一部 | L | UIをOSSベース(Next.js15+shadcn/掲示板5ch型/tldraw等)で構築しciv-os UIは破棄 | Next.js15+React採用済。shadcn/uiは不採用でScreenDef+civ-catalog(V3-UIX-17裁定(修正)で自作宣言的方式に確定)に置換済 — 方針差分を明文化。掲示板5ch型テンプレ(知の広場・PROTECTED配下)・tldraw/flexlayout-reac… — TC: manual: OSS採用/ライセンス方針の適合は設計レビュー(掲示板テンプレ実装時にrender TCで担保) / boards系依存導入時に GPL/AGPL license-scan GATE を追加(批評家指摘)(根拠: apps/web/package.json (next ^15.5.0); apps/web/src/renderer/renderer.tsx:1 (Reac…) |
| V3-UIX-81 | A | 制約 | 一部 | M | 制約:Renderer共通層でWCAG2.2 AA(キーボード/SR/7状態/reduced-motion/44px/コ… | a11y中核(7状態列挙・reduced-motion尊重・44pxタップ・aria/セマンティックロール・キーボード完結・AAコントラスト)はRenderer共通層で実装+TC済。未達: 重要文書(利用規約等)の多媒体マトリクス(法的版/小5版×読み上げ/動画×字幕)は本repo未実装 — V3-… — TC: 7状態/reduced-motion/44px/ariaのrender TC(renderer.test.tsx実装済)、多媒体マトリクスはSEC/VID側TC(根拠: apps/web/src/app/globals.css:97 (.civ-interactive 7状態); apps/web/src/app/globals…) |
| V3-UIX-01 | A | 制約 | 未・TC | M | 制約:ユーザーUIに未実装/WIP表記を出さず事実に即した代替説明、法務系は確定前『草案』バッジ | 現状screen-defsに未実装/WIP文言は無く構文上は遵守だが機械ガード無し(check-ui-tokens.mjsは色トークン+schemaのみ)。screen-defs/**+apps/web/**に禁止語(未実装/WIP/準備中/TODO等)スキャンをlint GATEに追加。法務系テキ… — TC: 禁止語(未実装/WIP等)をscreen-defs/apps-webでスキャンして落とすlint GATE |
| V3-UIX-02 | A | 非機能要件 | 未・TC | M | 主要導線を機械計測で3クリック以内、3ホップ超はハブに最大2ショートカットチップ | 到達ホップ数の機械計測は未実装。screen-defs各*.jsonのtransitions[]をグラフ化しBFSで主要ターゲット(観測保存/抽選/取引/GMO振込)到達≤3クリックを検証するTCを新設。超過時のみハブ画面(home等)に最大2ショートカットチップnodeを追加。 — TC: transitions[]グラフをBFSし主要ターゲット到達ホップ数≤3を検証するTC |
| V3-UIX-05 | A | 非機能要件 | 未・TC | M | 非機能:認知負荷UI憲法(1画面1目的/3-5チャンク/section≤3/card≤3/余白/説明3行/編集右上/次の… | ThemePack(globals.css)は余白4/8/12/16/24/32・type scale≤4・weight300/400を数値定義済だが構造ルールは未強制。各screen-defのsection数≤3・card数≤3・トップ目的1・末尾『次の一歩』node存在・説明text≤3行をli… — TC: 各screen-defのsection/card数上限と『次の一歩』node存在を検証する構造TC |
| V3-UIX-08 | S | 制約 | 規約 | - | UIビルダー責務を配置+デザイン+既存機能紐づけに限定(REFRAME窄化)・catalog選択のみ・新Componen… |  |
| V3-UIX-76 | A | 思想 | 規約 | - | 思想:万人共通最適UIは無い前提で全コンポーネント化+カルマ自然淘汰+fork/共有/リアルタイム伝播 | (根拠: apps/web/src/renderer/renderer.tsx:478 (全nodeを統一Rendererで描画=コンポーネント化基盤); apps/ap…) |

### K5 論文/研究+wiki/知識(15 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-PPR-01 | S | 機能要件 | 未・コード | L | 論文照合(Paper Match): 条件P JSON×観測JSON フィールド突合・充足/不足/違反/一致率・観測ブリ… | Paper Match route(条件P×観測JSON突合→match率)、固体観測フローからのブリッジ(?solid=1/?auto=1)、仮説1行Project追記、不足キーの静的RAGヒント(LLM既定OFF)。route/画面とも未着手 — TC: 充足/不足/違反キー分類・match=一致条件数/必要条件数 の算出 TC(全一致/部分/違反ケース) |
| V3-PPR-03 | A | 機能要件 | 未・コード | L | 論文をPaperSectionsV1の6節(目的/仮説/条件/検証/フェーズ/ギャップ)で構造化・filled/comp… | paper-sections スキーマ(schemas/、6節+filledフラグ+completeness_pct)+ paper CRUD ルート(R2 INSERT ONLY)+ 文体スキン別ファイル。repo に paper 実体なし — TC: PaperSectionsV1 スキーマ検証TC(6節必須・completeness_pct 範囲・LaTeX禁止) |
| V3-PPR-06 | A | アイデア | 未・コード | L | 論文全文をembedding索引化しデータgap(キー不足)と意味gap(近傍差分軸)を分離統合しmissing per… | 論文embedding索引(sections+conditions+tags)+ gap分離エンジン(data gap/semantic gap→欠観点提示)+ 全種族横断ベクトル検索。埋め込み基盤(ruri 384次元)は components/wiki-ingest に有るが論文実体・gap算出… — TC: missing perspectives 決定論TC(近傍論文差分軸→欠キー列挙が安定) |
| V3-PPR-13 | A | 機能要件 | 未・コード | L | 世界接続層3要素(Wikidata正規ID/使用時発行内部Index/専門APIマッピング)統合・Q番号→GBIF/NC… | truth/canonical/mapping_event スキーマ+append-only 保存ルート+分野別専門API対応表(医学/AI/材料/気象/ゲーム)+ユーザー追加可能な学術分類階層。repo に wikidata/mapping 実体なし — TC: mapping_event append-only TC(Q番号→外部ID対応の再put=409) |
| V3-PPR-16 | A | 機能要件 | 未・コード | L | 研究をprojectId中心に束ねるProject Hub(プロフィール/タイムライン/parentVersion分岐/… | project エンティティ+project-routes(100番台)+ paper/bbs/market/観測/listing を projectId で集約する投影。parentVersion/lot/bestVersion 判定。repo に project 実体なし — TC: bestVersion 判定の投影TC(Ver別/lot別の観測集計から決定論選定) |
| V3-PPR-17 | A | 機能要件 | 未・コード | L | 研究ロードマップ/課題ツリー・limitations/失敗/愚痴からResearchTaskNode自動生成・難易度/優… | ResearchTaskNode エンティティ+自動生成バッチ(gap/失敗クラスタ抽出)+難易度/優先度算出+研究プログラム(goals/milestones/dependencies)+ 6時 Cron 新聞生成。repo に research task 実体なし(Cron 配線も未) — TC: ResearchTaskNode 生成の決定論TC(同一 limitations 入力→同一課題ノード) |
| V3-PPR-18 | A | 機能要件 | 未・コード | L | 追検証をデータ提供のみで完了・グラフ自動追加/相関係数自動算出・Citation Entity自動生成+貢献ポイント・不… | データ提供→Citation Entity 自動生成+貢献ポイント付与(匿名/実名)+相関/グラフ自動算出+充足時 Citation 更新ループ。paper/citation 実体が前提で未着手 — TC: 検証ループTC(観測マッチ→Citation生成→不足キー充足でCitation更新が冪等) |
| V3-PPR-30 | A | 機能要件 | 未・コード | L | 一般ユーザーが論文級成果物を作れるData Descriptorテンプレート節穴埋め+観測イベント投影で自動充填+主張-… | Data Descriptor テンプレート(節単位)+観測イベント投影による自動充填+claim-evidence 自動リンク(充足キー→証拠、未検証=仮説ラベル)+ PPR-01 条件P×観測JSON突合の機械 Stage1。LLM は既定OFFトグル。repo に template/claim… — TC: 自動充填+仮説ラベルTC(充足キーはclaim証拠に自動リンク・未検証は仮説固定) |
| V3-WIK-01 | A | 機能要件 | 未・コード | L | エージェント維持型の永続Wiki(サブブレイン)を日次バッチで掲示板/論文/観測の上に階層蒸留する横断知識レイヤー | Wikiエンティティ(R2 world/wiki/…)+日次蒸留バッチ(掲示板要約→大Wiki階層)+更新ルート。現状は components/wiki-ingest が ruri埋め込み384次元バックエンドのみで、蒸留/蓄積ロジックは無い。LLM/蒸留は既定OFFを維持(不変条項①) — TC: 蒸留バッチの決定論TC(同一入力→同一Wikiノード・append-only) |
| V3-WIK-13 | A | 機能要件 | 未・コード | L | 統合検索を全文/タグ/ユーザー/ノードの4本柱で提供し投稿時にR2索引を自動更新・DB不使用でR2だけで成立 | 4本柱索引(fulltext/tag/user/node)を R2 に持ち投稿時自動更新+統合検索ルート。observation-routes.ts:249 の類似梯子(whitelist→subset→embedding)は capture 専用で content 横断ではない。Entity統一構… — TC: 『投稿=検索可能』TC(ノード作成→即4索引ヒット) |
| V3-WIK-16 | A | 機能要件 | 未・コード | L | 記事・ブログを論文と同一CMS基盤(content_type enum article/blog/paper)で提供・R… | 共通 content スキーマ(content_type enum)+ Create/Read ルート(v1、Update/Deleteはv2)+ citations(cited_paper_ids/cited_session_ids)を R2 INSERT ONLY 記録。repo に conte… — TC: content INSERT ONLY + citation 生成TC(同一キー再put=409・引用append-only) |
| V3-WIK-17 | A | 機能要件 | 未・コード | L | 会話ログ/AIチャット/観測/行動履歴を共有1タップ(PWA共有ターゲット)でWorkerに送りR2にMarkdown保… | PWA share_target(manifest)+ 共有受信 Worker ルート+ R2 Markdown 整形保存+ chat-index.json 自動更新。apps/web に共有ターゲット実装なし・chat-index 無し — TC: 共有→R2保存→chat-index 追記の統合TC(整形保存が append・索引反映) |
| V3-PPR-09 | A | 非機能要件 | 一部 | L | 全派生物に再現性メタ(run_id/model/input_hash/schema_version/provenance… | 実装済=provenance 凍結スキーマ(run_id/schema_version/input_hash/created_at:11-26・value_origin enum:30・model_name/version:45)。未=全measurement行の source enum、obser… — TC: reanalysis-manifest 再実行TC(同一 imageR2Key/scaleTemplateId→同一結果)+ observed_at≠committed_at 分離検証(根拠: schemas/frozen/provenance.schema.json:11) |
| V3-WIK-14 | A | 機能要件 | 一部 | M | 検索タグ3層(system自動編集不可/ai最大10自動抽出/user自由)で人間タグとAIタグ分離・RAG優先度sys… | 実装済=tag-event 凍結スキーマに tag_type(:30)・confidence(:43)・source_type(:38)の器あり。未=3層(system/ai/user)分離の強制、RAG検索優先度順(system→ai→user→summary→payload→embedding)… — TC: 3層分離+優先度順TC(AIタグがuserタグを上書きしない・優先度順にヒット)(根拠: schemas/frozen/tag-event.schema.json:30) |
| V3-WIK-20 | A | 機能要件 | 規約 | - | 設計書/コード/掲示板/理由/世界観/系譜/種/プロトコルを同一細胞構造で持ちRAG1クエリで意図・歴史・議論・系譜を返… |  |

### K6 知の広場+ガバナンス(PROTECTED)(13 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-BBS-01 | S | 機能要件 | 未・コード | L | 知の広場(/knowledge)を掲示板改称の統合ハブ・3柱(公式掲示板/論文/GitHub掲示板)pillar並列・ハ… | /knowledge ハブ screendef + 3柱(掲示板/論文/GitHub)screendef + backend route + Truth型。screen-defs に knowledge/BBS 画面なし。公開・解除のみ human-gate(実装自体はPROTECTEDで完了まで進… — TC: 3柱ナビ1層・タブ/カード重複掲載禁止・ホーム→柱主要操作3クリック以内の到達 TC |
| V3-BBS-03 | A | 機能要件 | 未・コード | L | 全画面テンプレに3種掲示板(説明/愚痴/改善)必須付与+愚痴→AI分類→改善→Fork→公開→利用率→ランキングの自己修… | plaza event schema(post/thread/board)新設+ScreenDefへ3掲示板ノード必須付与(apps/web Renderer再利用)+愚痴AI分類/改善議論/Fork公開/利用率収集/ランキング投影+関連コンポ一覧/IDE導線+ポップアップタグ絞込UI。公開は人間ゲ… — TC: 各画面テンプレに3掲示板が付与され改善サイクル(Fork公開→利用率→ランキング更新)が投影されることを検証するTC群 |
| V3-BBS-10 | A | 機能要件 | 未・コード | L | 100投稿ごとAI要約/タグ/RAG整形+掲示板データ4層(投稿emb/ブロック要約emb/current_summar… | 100投稿ごとの要約/タグ/RAG整形(要約AIはLLM既定OFFと整合が必要)+4層構造(投稿embedding/ブロック要約embedding/current_summary+open_questions/diff履歴)+current_summary更新毎のdiff記録。embedding基盤… — TC: 100投稿ごと要約/タグ+4層(embedding/block/current_summary+open_questions/diff)構造を検証するTC |
| V3-BBS-20 | A | 機能要件 | 未・コード | L | 全エンティティを1クリック引用する汎用引用(Universal Cite):cite_refs構造化配列/CiteRef… | cite_refs構造化配列(インラインtokenより優先)+CiteRef共用型+安定URL+『引用』ボタン+[ihl:cite type=id]token。通知/検索チャネルと根拠/出典チャネルの分離。tag-event(target_type付き汎用参照)がパターン参考になるが cite 機構… — TC: cite_refs優先+安定URL+全エンティティ(スレ/投稿/ユーザー/タグ等)引用を検証するTC |
| V3-BBS-29 | A | 機能要件 | 未・コード | L | Fork前提文明:改善案は自動ブランチ・公開/個人コピー2操作・5段ランク表示・全Fork非削除共存・憲法もfork対象 | Fork自動ブランチ機構+『公開編集(rank=beginner自動登録)』/『個人コピー(非公開)』2操作+5段ランク(official>recommended>popular>beginner>minor)表示順(minorは検索のみ)+全Fork共存(削除・不採用・勝者を作らない)。fork基… — TC: Fork自動ブランチ+5段ランク表示順+全Fork非削除共存を検証するTC |
| V3-BBS-36 | A | 思想 | 未・コード | L | 知の広場設計目標=意見交換と化学反応最大化・topic第一級化(Zulip型)・Polis型合意/対立可視化(appen… | topic第一級化(Zulip型 channel=画面/機能+必須topic)+Polis型 Agree/Disagree/Pass を append-only イベントで収集+consensus/divisive statement を LLM 不要・決定論で都度算出(不変条項①の都度再計算と整合… — TC: topic必須+Agree/Disagree/Pass append-onlyイベント+consensus/divisiveの決定論的都度算出を検証するTC |
| V3-GOV-01 | S | 思想 | 未・コード | L | 争い処理: 開発者/創世者は裁判官にならず market/掲示板/バグ修正3区分・指摘→二人部屋対話→合意or期限切れ強… | 統治スタンス部分(開発者は裁判官にならず)は process。実装可能部分=二人部屋対話 route(038-040)+期限切れ強制close+合意record を todo-code として K6 で実装(批評家指摘で分離) |
| V3-GOV-12 | A | 機能要件 | 未・コード | L | 判例をR2 append-onlyに蓄積・争いクローズ時にAIが判例自動生成・検索可能な削除不可の判例DB+取引スレ自動… | 判例schema+争いクローズ時の判例append(R2 INSERT ONLY基盤/tag-event target_type を再利用)+全文/タグ検索+引用可能判例DB。AI自動生成はLLM既定OFF(不変条項①)と整合させる設計が必要。判例生成/クローズフロー未実装。 — TC: 争いクローズ→判例append(R2)→検索/引用可を検証するTC(判例生成のLLM扱いは要注意) |
| V3-GOV-19 | A | 思想 | 未・コード | L | 統治ルール群自体をfork・改善・投票可能にし『ルールが進化するOS』化(閾値もユーザー投票で調整) | ルール群(ProjectRules/Governance等)のfork+投票event型+governance route。カルマ/コイン/貢献度の閾値は投票結果から都度投影(現状 economy-constants.ts はハードコード固定値のみ)。fork/投票機構は未実装。 — TC: ルールfork+投票で付与閾値(カルマ/コイン条件)が変化する投影を検証するTC |
| V3-GOV-23 | A | 思想 | 未・コード | L | OS自体をfork可能(C-USB準拠)・マージは投票閾値・自然淘汰で/os/main昇格・機能/画面ハッシュ改変検知・… | OS fork(C-USB準拠ブランチ)+マージ投票閾値+使用率/投票/いいね/フォーク数/継続利用率の自然淘汰+/os/main昇格+機能・画面のハッシュ改変検知。R2不可侵(神域)はstore.tsのappend-onlyで既に担保済み、それ以外のOS-fork/昇格機構は未実装。 — TC: OS fork+マージ投票閾値+ハッシュ改変検知+/os/main昇格を検証するTC(R2神域はCL-01で既緑) |
| V3-BBS-05 | A | 非機能要件 | 一部 | L | 掲示板スレ/投稿はINSERT ONLY(追記訂正)・materialized view表示・permalink不変・t… | append-only強制(put-if-absent 409/UPDATE・DELETE禁止)はstore.tsで既実装だが、掲示板post/thread event型・最新eventのmaterialized view投影・permalink(ID紐付でURL不変)・tombstone mini… — TC: スレ/投稿のINSERT ONLY・permalink不変・tombstone表示・チャネル分離を検証するTC(append-only基盤はCL-01で既緑)(根拠: packages/truth/src/store.ts:45) |
| V3-GOV-09 | A | 制約 | 一部 | M | 行政指摘時に対象出品/データ/画像へ不使用フラグ(R2 DELETEしない)+対象へΔcount+10・開発者は行政命令… | count増分primitive(grantKarmaCountIncrease/count層delta投影)は既実装。未実装=不使用フラグevent型(R2 DELETEせず論理無効化)+行政指摘を受けてフラグ付与しΔcount+10を課すadmin route。行政命令に従うかの判断自体は人間ゲ… — TC: 不使用フラグevent(R2 DELETEなし)+Δcount+10課金を検証するTC(count増分はledger.testで既緑)(根拠: apps/api/src/ledger-routes.ts:122) |
| V3-GOV-13 | A | 思想 | 未・TC | S | AI違法性スコア自動モデレーション(NGワード表)は採用せず人間の指摘と対話を基本(文化差配慮) | 自動モデレーション route/NGワード表が導入されないことの negative 回帰ガード(批評家指摘反映) — TC: CI: apps/api に auto-moderation endpoint / NG ワード表が存在しないことを assert する回帰 TC |

### K7 基盤/インフラ+コスト/運用(22 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-FND-04 | A | 制約 | 未・コード | L | 世界更新をCommand→純粋関数Reducer(Kernel決定論・副作用ゼロ)→保存の一方向に固定しOCC(prev… | Kernel/Reducer層がコード未実装(現状は各routeがTruthStoreへ直append)。決定論Reducer・OCC prevSnapshotVersion一致必須・timestamp単調増加ガードを新設。大型・C5単波を超える可能性 — TC: Kernel決定論(同一Command→同一出力)とOCC衝突(prevSnapshotVersion不一致→拒否)を検証するTC |
| V3-FND-05 | A | 制約 | 未・コード | L | 文明同一性をGenesis Hash+R2イベント列のハッシュチェーン(prev_hash/event_hash=SHA… | ハッシュチェーン(prev_hash/event_hash)・Genesis Hash・fork_point_hash・worldHash(全ノードMerkle集約)のsnapshotVersionがコード未実装(現状はULID event id・連結ハッシュなし)。大型・C5単波を超える可能性 — TC: prev_hash連結の正当性とevent_hash再計算不一致による改竄検知を検証するTC |
| V3-FND-21 | A | 機能要件 | 未・コード | L | AI Kernel(A90)新設で全AI利用を集約・LLMClient/Storageを抽象化しLocalAI(LM S… | A90ルート・LLMClient/Storageインターフェース・LocalAI既定/OpenAI切替フラグがコード未実装(docsのみ・grep該当なし)。LLM既定OFF方針下では将来波。実装可能で人間ゲートなし — TC: A90経由でLLMClient実装をモックに差し替え可能なこと(機能別AI切替)を検証するTC |
| V3-CST-05 | A | 制約 | 一部 | L | デプロイ/運用整備(nginx+certbot/pm2常駐・3ステップリリース・VPS再構築手順書・.env2層分離・G… | .env.platform は .env.example line2 で言及済だが .env.local 層(ユーザー設定・SwitchBot)は未記載・2層分離未整備。nginx/certbot/pm2 相当の運用手順書も未整備(批評家指摘で正確化) — TC: manual: nginx+certbot/pm2/HTTPSは本番VPSでの手動検証。手順書はCI外(根拠: .env.example:2) |
| V3-FND-11 | A | 制約 | 一部 | M | 本番APIは api.it-hercules.uk 直叩きを正(暗黙同一オリジンfallback非依存)・CORSを50… | 現状webは同一オリジン/api/*のnext.config rewrite方式で、本要件が『依存するな』とする暗黙fallbackにむしろ依存。NEXT_PUBLIC_API_URL基底は存在。直叩きURL正への切替・API側CORS(500/502含む全応答一貫付与・現状apps/apiにCOR… — TC: CORSヘッダが500/502含む全応答に一貫付与されること(Pages経由でなくAPI直応答)を検証するTC(根拠: apps/web/src/lib/api.ts:3) |
| V3-FND-12 | A | 制約 | 一部 | M | 依存方向を apps→libs 一方向に固定・ツリー深度制限・nested npm禁止・schema正本はcodegen… | schema→codegen一方向はlintガード済・apps/packages/components構造も分離済。import方向(apps相互/libs→apps/deep import)違反検出lintと、ツリー深度・nested npm禁止のガードが未実装 — TC: apps→libs一方向のimport違反を検出するlint TC(逆流・apps相互importをfail)(根拠: package.json:scripts.lint(codegen-schemas.mjs --check)) |
| V3-FND-15 | S | 制約 | 一部 | L | 全進化データに系譜メタ(uuid/parent/ancestor_chain/lineage_hash/content/… | 系譜メタ共通付与(parent_uuid/ancestor_chain/lineage_hash/semantic_hash/generation)、ID prefix規約統一(ind_/cap_/run_等)、全派生物の再現性メタ(pipeline_version/model_version/in… — TC: 系譜メタ必須フィールド検証+lineage_hash/content_hash 決定的算出の schema/TC(根拠: apps/api/src/observation-routes.ts:187-199) |
| V3-FND-18 | A | 機能要件 | 一部 | L | データ取得元管理を Placement/DeviceBinding/Occupancy/TelemetryIngest … | collector ingest(Ed25519自己ゲート・SwitchBotコレクタ run.py)は実装済。4概念データモデル(Placement/Binding/Occupancy/TelemetryIngest)・単一POSTでの観測commit接続・Tier B series.parque… — TC: Tier Bマージのwritten/skipped_duplicate/skipped_invalid応答と未終了binding重複→409を検証するTC(根拠: apps/api/src/collector-routes.ts:36) |
| V3-OTH-02 | A | 思想 | 未・TC | S | OSS/フォーク文化中核・1コンポーネント=1ディレクトリ(manifest/run.py/tests/golden/R… | components/*/ の manifest+golden+README 必須構造を lint でガード(批評家指摘反映)(根拠: components/collector-switchbot/run.py:1) |
| V3-FND-01 | S | 制約 | 実装済 | - | R2/Truth は INSERT ONLY・UPDATE/DELETE/上書き禁止・同一キー再put 409 | TC: tests/cl-01-insert-only.test.ts が put-if-absent(etagDoesNotMatch:*→null=409)を検証。TruthStoreにupdate/delete metho…(根拠: packages/truth/src/store.ts:39-54) |
| V3-CST-01 | S | 非機能要件 | 規約 | - | 10年間ユーザー増無でもコスト賄う構造最優先・従量課金回避・計算資源はユーザー側・月300-1000円・サーバーレス+最… |  |
| V3-CST-04 | A | 制約 | 規約 | - | 最安インフラ選定(.uk TLD最安・Cloudflare集約・最安VPS・R2/B2でエグレス最小化) | (根拠: .env.example) |
| V3-FND-02 | S | 制約 | 規約 | - | 永続正本はR2のみ・常駐DBをSSOTにしない(投影/キャッシュのみ) | 任意: R2 以外の永続バインディング(D1/KV/DO storage)が wrangler.toml に追加されたら fail する lint は低コストで追加可(批評家 low-confidence 提案・K7 で判断) |
| V3-FND-10 | S | 制約 | 規約 | - | ver4負荷偏在回避: メインAPI/scale/R2バインドはWorkers・Sakura VPSはSMTP magi… |  |
| V3-FND-14 | S | 制約 | 規約 | - | 最小単位C-USB(core/rag/io/compat/security・IN→Transform→OUT)前提・Co… |  |
| V3-FND-16 | S | 制約 | 規約 | - | フォーク文化(R2=神域fork不可)承認・Kernel fork可否とOS差替単位2点は本人未決保留 |  |
| V3-FND-17 | S | 制約 | 規約 | - | it-hercules-laboratory唯一の新製品OSS正本・civ-osはlegacy salvageのみ・双方… |  |
| V3-FND-19 | A | 制約 | 規約 | - | 重い計算はユーザー端末へオフロードしサーバ変動費を近ゼロに(LLM/Vision/FAISS既定OFF・派生値都度再計算… | (根拠: apps/api/src/ledger-routes.ts:3) |
| V3-FND-30 | A | 制約 | 規約 | - | MVP v1スコープ明確化(市場#06/マチアプ#10/裁判#11はOUT・20機能定義・本体は観測テンプレ+C-USB… |  |
| V3-OTH-05 | A | 思想 | 規約 | - | 分類/観測スキーマは生物固定せず自由キー構造(表記揺れはAI統合)・ただしver3 MVPは昆虫(ヘラクレス)観測にスコ… | (根拠: packages/schema-types/src/generated/events/obs-template.ts:1) |
| V3-OTH-07 | A | 思想 | 規約 | - | 少人数×物量の思想(運営者一人が多役職兼任・研究の苦行部分を自動化し人間は方向性/美学のみ・物量投稿が精度支持) |  |
| V3-FND-13 | A | 制約 | 人間G | - | World→FeatureNode→Kernel階層・画面概念廃止しURL=Kernel UUID・MiniKernel… | hold:true(裁定保留中)。現行のScreenDef Renderer(screen-defs/*.json・URL=screen)と正面から矛盾するアーキ転換で、採否は人間裁定が本質。裁定後にtodo-code化 — TC: manual: hold:true 裁定待ち。既存ScreenDef方式との二者択一が人間ゲート |

### K8 AI運用/開発プロセス(機械ガード化)(38 件)

| ID | Tier | 種別 | 状態 | 規模 | 要旨 | 残作業 / TC |
|----|------|------|------|------|------|-------------|
| V3-AIP-35 | A | 制約 | 未・コード | L | 意図駆動ISP(Intent→Spec→Implementation)をプロトコル化、intent_id→spec_ve… | ISPプロトコル・intent台帳(intent_id→spec_version→commit_id同期)が未存在。Intent append-onlyストア+意図なき変更/仕様なき実装の禁止ガードを新設。知の広場投稿(post_id)連携に依存 — TC: intent_id→spec_version→commit_id の一意性・Intent追記のみ(UPDATE禁止)を検証するTC |
| V3-AIP-36 | A | 機能要件 | 未・コード | M | 全変更で意図↔仕様↔コミット↔R2を紐付け、意図メタ必須+[post_id]式コミット | intent_summary/problem_statement/expected_effect/rejected_alternatives 等の意図メタスキーマ未存在。現コミットは type(scope):理由—内容+参照レポートID 形式で[post_id]式でない。intentスキーマ+com… — TC: commit-msg lint: [post_id]変更理由→変更内容→影響範囲 形式と意図メタ必須キーを検証 |
| V3-AIP-40 | A | 機能要件 | 未・コード | L | AI機能ごとにai-profile(provider/model/cost/RAG)差替可、LLMはBYOKのみ・計算資… | ai-profileスキーマ・BYOK鍵管理・計算資源目安(低/中/高/最高)選択UI・ユーザー編集プロンプトが未存在(schemas/にもコードにも該当なし)。LLM/Vision は既定OFF(不変条項①)のため未配線。schemas/ai-profile + 機能↔profile紐付け + B… — TC: ai-profile.schema.json validate + 機能ごとにprofile必須の契約TC |
| V3-AIP-68 | A | 機能要件 | 未・コード | L | 本番同様サンドボックス+GitHub PR承認+10人レビュー+テストDBで約1ヶ月試験運用後に正式採用 | サンドボックス(本番同様テスト環境)+ PR承認ゲート付き昇格パイプライン+テストDB が未構築(C5 HANDOFF でstagingデプロイがC5スコープとしてユーザー承認済)。staging環境+昇格フローを実装。※10人レビュー/1ヶ月試験運用/正式採用判断は人間運用ゲート — TC: staging昇格パイプライン:危険コードを弾く物理ゲート(署名/権限分類)の判定TC |
| V3-AIP-76 | A | 機能要件 | 未・コード | L | プロンプト・評価軸・文化テンプレをfork可能な文化として扱いfork→AI diff→レビュー→merge、評価軸3層 | 文化テンプレ(UIテーマ/掲示板構造/評価軸)のfork/diff/復元機構・評価軸3層(共通+用途別+カスタム)構造が未存在。知の広場実装に連動。テンプレスキーマ+バージョン保存(diff/copy/restore)を新設 — TC: 評価軸3層スキーマ validate + テンプレfork/diff/restore の往復TC |
| V3-AIP-05 | A | 制約 | 一部 | M | 機能ごとV-model5点ゲート+テスト設計免除不可+RTM100%を機械チェックで担保 | 憲法§4.4 は RTM カバレッジ GATE(line137)を規定・5点ゲートは line61 で文化として継承宣言のみ(機械判定は未条文化)。rtm.json 正本+RTM閉包GATE(check-rtm.mjs)+5点ゲート機械判定を scripts に追加し lint へ結線(批評家指摘で… — TC: CI: rtm.json の全要件IDが≥1本のTCへ閉包しなければfail するcheck-rtm.mjs(根拠: 02-design/constitution.md:137) |
| V3-AIP-22 | A | 非機能要件 | 一部 | M | GitHub ActionsでpytestとApps/web test/build/tscを回しunit/contrac… | CIは npm run lint + npm test(apps/api・tests・apps/web vitest)のみ実行。pytest ステップ、apps/web の build/tsc typecheck、design-gate テスト層 がCI未結線。ci.yml に pytest -q … — TC: CI: pytest・next build・tsc --noEmit の各ステップが緑、push毎に全層グリーン(根拠: .github/workflows/ci.yml:25) |
| V3-AIP-34 | A | 思想 | 一部 | M | 仕様書中心設計(Spec-Driven)、データモデル/付与条件/ナビ/権限/スレッドをspec JSONで実装前に明文… | screen-defs/*.json(画面/ナビ)・schemas/(データモデル)・tests/fixtures/route-matrix.csv(権限deny-by-default)でspec先行は実践済だが、スレッド(知の広場)のspec JSON が未明文化(BBS未実装・PROTECTED… — TC: スレッドspec JSON の schema validate + ナビ/権限整合のcontract TC(根拠: screen-defs/home.json:1) |
| V3-AIP-45 | A | 機能要件 | 一部 | L | AI-first データ設計:要約/分類を二層化(human_view+machine_view)、3層タグ(syste… | 憲法§5 AI-first 10ルール(frontmatter/H2チャンク/ULID)は文書層で適用済だが、machine_view(sections/keypoints/entities/rag_chunk)・human_view二層化・3層タグ・reference_counter のデータモデ… — TC: machine_view/human_view/3層タグ の schema validate + reference_counter 投影の再計算TC(根拠: 02-design/constitution.md:142) |
| V3-AIP-49 | S | 非機能要件 | 一部 | M | テスト文化 全レイヤー緑(backend/frontend unit+E2E Playwright)・網羅E2E・回帰0… | 機能ごと網羅E2E(スモークでなく market/ledger/gmo/knowledge の入力→実行→保存をボタン画面レベルで)。現状は E2E=観測フロー1本(apps/web/e2e/observation.spec.ts)、backend/frontend unit+contract 21… — TC: 各機能の網羅E2E(Playwright)追加。回帰0%は CL-01〜13 negative TC がCIで担保済(根拠: tests/helpers.ts:11-18) |
| V3-AIP-50 | A | 機能要件 | 一部 | M | 要件・詳細設計からTC体系生成(要件→TC表→pytest)、機能別E2E設計書、DSL→テスト自動生成 | 要件ID↔TCマップ(tc-coverage.md)とcontract TCは手書きで存在するが、screen-def(DSL)→スナップショット/テスト自動生成 と 機能別E2E設計書 が未整備。C5でE2E設計書+screen-def起点のテスト生成器を追加 — TC: screen-defs/*.json から生成したスナップショットTCが緑、E2E設計書の条件分岐網羅がCIで走る(根拠: docs/planning/c2/tc-coverage.md:1) |
| V3-AIP-32 | A | 制約 | 未・TC | S | 要件凍結後の変更はCRのみ、§9未決追記→人間確認→採用→FR採番→RTM更新、候補と正本(accepted)分離 | registry.json(採用REQ正本)+ docs/planning/rulings/ 裁定台帳 + ruling-record スキルで昇格フローは運用されるが、01-requirements/ のFR本文変更に裁定参照を強制する機械ガードが未存在。check-req-freeze.mjs … — TC: CI: 01-requirements/ のFR本文がPRで変更されたのに対応する裁定(ruling)参照が無ければfail |
| V3-AIP-80 | A | 思想 | 未・文書 | M | 外側(UI Schema/思想/宣言書/Whitepaper/プロトコル)を段階制でOSS公開、本体は非公開 | 宣言書Manifesto・技術思想書Whitepaper・公開プロトコル文書が未執筆。段階制公開(稼働直後=思想/宣言書→1〜3ヶ月=UI/テンプレ/プロトコル→半年〜1年=マーケット仕様)の各成果物を起草。※公開の実施自体は人間ゲート |
| V3-AIP-11 | A | 制約 | 実装済 | - | 設計書憲法の不変原則C1〜C4(正本1つ/破棄禁止/層分離/凍結REQ/サイレントmove禁止)を守る | 機械ガード済は C4凍結=CI frozen-schema gate・命名=lint-filenames に限定。C2破棄禁止/サイレントmove/C3層分離DAG は lint 未結線・運用担保(批評家指摘で正直化)(根拠: package.json:11) |
| V3-AIP-37 | A | 制約 | 実装済 | - | 改善履歴はGitHub一本化・C-Sync全面不採用、本番データのみR2 INSERT ONLY保存 | (根拠: packages/truth/src/store.ts:50) |
| V3-AIP-61 | A | アイデア | 実装済 | - | deep researchで技術選定しゼロベース再構築、.envとお気に入り画像のみ残し新repoにクリーン構築(裁定確… | (根拠: 02-design/constitution.md:15) |
| V3-AIP-96 | S | 機能要件 | 実装済 | - | 人間不在時に夜間バッチ(台本生成/wiki ingest/メタ化/改善ループ)を自動実行し朝レビュースタックへ | TC: manual: ihl-ver3 repo外の HQ ops基盤。runner.ps1(slot判定+zero_result_stop+morning-review生成)/00-hq/night-tasks/night-…(根拠: D:/claude/ops/autorun/runner.ps1) |
| V3-AIP-97 | S | 機能要件 | 実装済 | - | D:\claudeをHQとするワークスペース階層設計・横断正本(規約/裁定/ダッシュボード/夜間タスク定義)をHQ・開発… | TC: manual: ihl-ver3 repo外のHQ構築物。D:/claude 直下に 00-hq(night-tasks/reports)/systems/knowledge/ops/yt-transcripts の階層…(根拠: D:/claude/00-hq) |
| V3-AIP-98 | S | 機能要件 | 実装済 | - | 夜間限定自動運転を時間帯予約式スケジューラへ拡張・週間グリッド(曜日×時間帯 dev/recovery/auto/nig… | TC: manual: HQ ops基盤。runner.ps1(slot判定 dev/recovery/auto/night-mandatory+-Now即時+zero_result_stop)+schedule-gui.py(…(根拠: D:/claude/ops/autorun/runner.ps1) |
| V3-AIP-01 | S | 制約 | 規約 | - | モデル分業制度化(計画設計レビュー=高effort・機械作業=Sonnet/Auto・批評家必須・Fable5は非実装) |  |
| V3-AIP-02 | A | 制約 | 規約 | - | タスク重要度でeffort/モデルTier動的ルーティング、2連続GATE FAILでTier A自動昇格 |  |
| V3-AIP-03 | S | 制約 | 規約 | - | 実装EXECと監査AUDITを分け批評家ゲート通過後のみ納品・実測エビデンスで完了マーク |  |
| V3-AIP-09 | A | 思想 | 規約 | - | 人間の完成宣言より機械GATE PASS優先(C6)、完了確認質問禁止、状態報告はgrep件数/pytest結果のみ |  |
| V3-AIP-10 | A | 制約 | 規約 | - | 設計DOC作業4段階(フォルダ→設計書構成→設計→網羅GATE→実装)、段4実装は契約写しのほぼ翻訳 |  |
| V3-AIP-26 | A | 制約 | 規約 | - | REQ→DET→UI→TRNオラクル階層で該当§逐語引用してから着手、プランナーは仕様改変禁止・分解のみ |  |
| V3-AIP-29 | A | 制約 | 規約 | - | 司令塔1体が計画分配し最大~25並列サブエージェント、1エージェント=1書込ファイル所有権台帳で衝突防止 |  |
| V3-AIP-31 | S | 制約 | 規約 | - | 人間ゲート/human-in-the-loop必須・ワンクリック全自動禁止・機械が[x]偽装せず停止報告 |  |
| V3-AIP-33 | A | 制約 | 規約 | - | 要件正本階層=憲法>採用REQ(registry)>実装コード、legacy仕様は参照アーカイブで根拠にしない |  |
| V3-AIP-41 | A | 思想 | 規約 | - | AI推論はエッジ/ローカル既定最優先、AIを小関数群として扱い全処理を最小単位(1枚/1段落/1観測)に分割 |  |
| V3-AIP-46 | S | 制約 | 規約 | - | OSS最大活用・機能ごとComponent化・薄くラップ(USB-C契約)・自作は接続ドライバに限定 |  |
| V3-AIP-48 | A | 制約 | 規約 | - | 完成の定義=実際に使え保管されエラー無くUX最低限。CI緑と完成を混同しない |  |
| V3-AIP-52 | A | 思想 | 規約 | - | 機能単位プチウォーターフォール(mini Phase0〜5)で疎結合に機能追加できる拡張安全枠 |  |
| V3-AIP-53 | A | 思想 | 規約 | - | ウォーターフォールで要件/設計/UI/テスト/CI/OSS選定を設計フェーズで詰め切り確定後に実装 |  |
| V3-AIP-55 | A | 制約 | 規約 | - | 自律実行運用:可逆は止まらず自律実行、確認まとめ、人間ゲートはスキップ列挙、自己検証、矛盾3連続で停止 |  |
| V3-AIP-57 | A | 機能要件 | 規約 | - | 繰返し手順は1回手動確認後スキル化しGO指示を不要化、全スキルをkeep/merge/rewrite/delete機械監… |  |
| V3-AIP-60 | A | 機能要件 | 規約 | - | ver1/2資料を日時新しさで信頼度分類、要約抽出書で理解確認後に要件定義、質問前RAG検索 |  |
| V3-AIP-66 | A | 制約 | 規約 | - | git運用:無指示commitしない/force push禁止/非ff rebase/論理単位commit/仕様変更前フ… |  |
| V3-AIP-99 | A | 制約 | 規約 | - | モデル階層ポリシー:自動運転は軽量(既定Sonnet)、最上位(Fable5級)はdev slot人間開発専用 |  |

## 3. 分母除外・非実装分(停止報告対象を含む)

### 3.1 human-gate(人間裁定が本質 — 停止報告)

| ID | 要旨 | ゲート内容 |
|----|------|-----------|
| V3-FND-13 | World→FeatureNode→Kernel階層・画面概念廃止しURL=Kernel UUID・MiniKernel… | hold:true(裁定保留中)。現行のScreenDef Renderer(screen-defs/*.json・URL=screen)と正面から矛盾するアーキ転換で、採否は人間裁定が本質。裁定後にtodo-code化 |
| V3-SEC-24 | 利用規約条文正本/法務文言はAI変更禁止・公開前に人間(専門家)レビュー証跡・運営者名/連絡先/準拠法/管轄/ToS法務… | manual: ToS条文正本・運営者名/連絡先・準拠法/管轄・ToS法務翻訳は人間(専門家)裁定=#02 HUMAN-02-LEGAL。機械翻訳を正本にしない前提でAIが完成品を作れない。機械TC対象外 |
| V3-SEC-30 | 文明OSをOSS(Apache2.0/MIT検討)公開・LICENSEをorg確定版へ差替・公開時期は機を見て判断 | none: OSS公開の実施・ライセンス最終確定(Apache/MIT選択)・公開時期判断はいずれも人間ゲート(公開の実施+法務判断)。AIは完成品を作れない。README.md に単一repo/フォーク文化宣言は既存だが公開判断自体は人間 |

- 加えて hold=True 保留 2 件: **V3-FND-13**(確定階層構造)・**V3-AIP-61**(技術選定 deep research)— 裁定待ちのため着手しない
- 知の広場 **HG-KN-01〜08**(実装は PROTECTED で進め、解除・公開のみ人間)

### 3.2 process(条文化済み規約・成果物なし)

| ID | Tier | 要旨 |
|----|------|------|
| V3-AIP-01 | S | モデル分業制度化(計画設計レビュー=高effort・機械作業=Sonnet/Auto・批評家必須・Fable5は非実装) |
| V3-AIP-02 | A | タスク重要度でeffort/モデルTier動的ルーティング、2連続GATE FAILでTier A自動昇格 |
| V3-AIP-03 | S | 実装EXECと監査AUDITを分け批評家ゲート通過後のみ納品・実測エビデンスで完了マーク |
| V3-AIP-09 | A | 人間の完成宣言より機械GATE PASS優先(C6)、完了確認質問禁止、状態報告はgrep件数/pytest結果のみ |
| V3-AIP-10 | A | 設計DOC作業4段階(フォルダ→設計書構成→設計→網羅GATE→実装)、段4実装は契約写しのほぼ翻訳 |
| V3-AIP-26 | A | REQ→DET→UI→TRNオラクル階層で該当§逐語引用してから着手、プランナーは仕様改変禁止・分解のみ |
| V3-AIP-29 | A | 司令塔1体が計画分配し最大~25並列サブエージェント、1エージェント=1書込ファイル所有権台帳で衝突防止 |
| V3-AIP-31 | S | 人間ゲート/human-in-the-loop必須・ワンクリック全自動禁止・機械が[x]偽装せず停止報告 |
| V3-AIP-33 | A | 要件正本階層=憲法>採用REQ(registry)>実装コード、legacy仕様は参照アーカイブで根拠にしない |
| V3-AIP-41 | A | AI推論はエッジ/ローカル既定最優先、AIを小関数群として扱い全処理を最小単位(1枚/1段落/1観測)に分割 |
| V3-AIP-46 | S | OSS最大活用・機能ごとComponent化・薄くラップ(USB-C契約)・自作は接続ドライバに限定 |
| V3-AIP-48 | A | 完成の定義=実際に使え保管されエラー無くUX最低限。CI緑と完成を混同しない |
| V3-AIP-52 | A | 機能単位プチウォーターフォール(mini Phase0〜5)で疎結合に機能追加できる拡張安全枠 |
| V3-AIP-53 | A | ウォーターフォールで要件/設計/UI/テスト/CI/OSS選定を設計フェーズで詰め切り確定後に実装 |
| V3-AIP-55 | A | 自律実行運用:可逆は止まらず自律実行、確認まとめ、人間ゲートはスキップ列挙、自己検証、矛盾3連続で停止 |
| V3-AIP-57 | A | 繰返し手順は1回手動確認後スキル化しGO指示を不要化、全スキルをkeep/merge/rewrite/delete機械監査 |
| V3-AIP-60 | A | ver1/2資料を日時新しさで信頼度分類、要約抽出書で理解確認後に要件定義、質問前RAG検索 |
| V3-AIP-66 | A | git運用:無指示commitしない/force push禁止/非ff rebase/論理単位commit/仕様変更前フルcommit/push前ローカル確認 |
| V3-AIP-99 | A | モデル階層ポリシー:自動運転は軽量(既定Sonnet)、最上位(Fable5級)はdev slot人間開発専用 |
| V3-CST-01 | S | 10年間ユーザー増無でもコスト賄う構造最優先・従量課金回避・計算資源はユーザー側・月300-1000円・サーバーレス+最小VPS・閲覧無認証/書込認証 |
| V3-CST-04 | A | 最安インフラ選定(.uk TLD最安・Cloudflare集約・最安VPS・R2/B2でエグレス最小化) |
| V3-FND-02 | S | 永続正本はR2のみ・常駐DBをSSOTにしない(投影/キャッシュのみ) |
| V3-FND-10 | S | ver4負荷偏在回避: メインAPI/scale/R2バインドはWorkers・Sakura VPSはSMTP magic-link+軽kickのみ・重いML/SwitchBot … |
| V3-FND-14 | S | 最小単位C-USB(core/rag/io/compat/security・IN→Transform→OUT)前提・CoreEntityBase/RAG検索可・OSS薄ラップ・差替… |
| V3-FND-16 | S | フォーク文化(R2=神域fork不可)承認・Kernel fork可否とOS差替単位2点は本人未決保留 |
| V3-FND-17 | S | it-hercules-laboratory唯一の新製品OSS正本・civ-osはlegacy salvageのみ・双方向ミラー禁止・単一cloneフルrepo・salvageはO… |
| V3-FND-19 | A | 重い計算はユーザー端末へオフロードしサーバ変動費を近ゼロに(LLM/Vision/FAISS既定OFF・派生値都度再計算) |
| V3-FND-30 | A | MVP v1スコープ明確化(市場#06/マチアプ#10/裁判#11はOUT・20機能定義・本体は観測テンプレ+C-USB受入+URL登録+議論のみで無限スコープ回避) |
| V3-KRM-23 | A | 個人の人格/価値観/行動ログ/世界観は個人所有で非共有、文明層はシリーズ構造/掛け合い/UI知見/評価モデルの『構造だけ』を共有。共有NGタグで本人固有資産のみ非共有、99%共有/… |
| V3-MKT-19 | A | 悪質排除でなく正直取引が儲かるインセンティブ設計で自然淘汰(思想) |
| V3-OTH-05 | A | 分類/観測スキーマは生物固定せず自由キー構造(表記揺れはAI統合)・ただしver3 MVPは昆虫(ヘラクレス)観測にスコープ据え |
| V3-OTH-07 | A | 少人数×物量の思想(運営者一人が多役職兼任・研究の苦行部分を自動化し人間は方向性/美学のみ・物量投稿が精度支持) |
| V3-SEC-34 | S | 外部取込は共有ボタン/認証API/OAuth本人所有領域のみ許可(P0許可レイヤー)・スクレイピング/ログイン必須自動取得/他人SNS/robots禁止サイト一切禁止 |
| V3-UIX-08 | S | UIビルダー責務を配置+デザイン+既存機能紐づけに限定(REFRAME窄化)・catalog選択のみ・新Component/API/routeはBuilder外(repo/CI/P… |
| V3-UIX-76 | A | 思想:万人共通最適UIは無い前提で全コンポーネント化+カルマ自然淘汰+fork/共有/リアルタイム伝播 |
| V3-WIK-20 | A | 設計書/コード/掲示板/理由/世界観/系譜/種/プロトコルを同一細胞構造で持ちRAG1クエリで意図・歴史・議論・系譜を返す(文明の図書館) |

### 3.3 implemented(C0〜C4 で充足済み)

| ID | Tier | 要旨 | 根拠 |
|----|------|------|------|
| V3-AIP-11 | A | 設計書憲法の不変原則C1〜C4(正本1つ/破棄禁止/層分離/凍結REQ/サイレントmove禁止)を守る | package.json:11 |
| V3-AIP-37 | A | 改善履歴はGitHub一本化・C-Sync全面不採用、本番データのみR2 INSERT ONLY保存 | packages/truth/src/store.ts:50 |
| V3-AIP-61 | A | deep researchで技術選定しゼロベース再構築、.envとお気に入り画像のみ残し新repoにクリーン構築(裁定確定) | 02-design/constitution.md:15 |
| V3-AIP-96 | S | 人間不在時に夜間バッチ(台本生成/wiki ingest/メタ化/改善ループ)を自動実行し朝レビュースタックへ | D:/claude/ops/autorun/runner.ps1 |
| V3-AIP-97 | S | D:\claudeをHQとするワークスペース階層設計・横断正本(規約/裁定/ダッシュボード/夜間タスク定義)をHQ・開発システムはsyste… | D:/claude/00-hq |
| V3-AIP-98 | S | 夜間限定自動運転を時間帯予約式スケジューラへ拡張・週間グリッド(曜日×時間帯 dev/recovery/auto/night-mandato… | D:/claude/ops/autorun/runner.ps1 |
| V3-AUT-01 | S | 認証はメールmagic-link一本(password/OAuth/SMS/TOTP/social非サポート) | apps/api/src/auth-routes.ts:27-58 |
| V3-FND-01 | S | R2/Truth は INSERT ONLY・UPDATE/DELETE/上書き禁止・同一キー再put 409 | packages/truth/src/store.ts:39-54 |
| V3-KRM-01 | S | カルマ二層独立モデル(値[-100,+100]初期0/カウント別)・値増加は月次のみ・減少はカウント増時Fibペナルティのみ・全ミューテーシ… | apps/api/src/ledger-routes.ts:19-133 |
| V3-OBS-05 | A | 観測はappend-onlyで編集UI禁止・修正は新規追記・R2/TruthのUPDATE/DELETE禁止・AI解析結果も新Observa… | apps/api/src/observation-routes.ts:124 (全書込が putEvent で put-if-absent・編集route不在) と tests/c… |
| V3-OBS-22 | S | MVP v1観測コアを収集/写真登録/詳細ビュー/親個体連携/QR(FR-MVP-01〜05)に限定・観測が画面で動きR2書込がリリース絶対… | apps/api/src/observation-routes.ts:115-373 |
| V3-OBS-29 | A | IoT秘密鍵をサーバ/R2/gitに持たずユーザー端末側のみに置き署名付き測定値だけ送る2ゾーン分離・サーバ自動poll禁止 | components/collector-switchbot/run.py:145-160 (秘密はローカル env のみ・値は非出力) と apps/api/src/collec… |

## 4. 3点見積改訂(開発計画 §4.3 の義務 — 見積の生存期間は C5 開始まで)

### 4.1 較正材料(実測)

| 実績 | 内容 |
|------|------|
| C0〜C4 実消化 | 5 マイルストーンを ultracode 実質 約4 セッション(2026-07-10〜11)で完走。1 マイルストーン ≒ 実装対象 20〜30 件規模 |
| C5 実測分母 | 実装対象 139 件(A帯 + S帯残余 16)・8 クラスタ・規模 L 87 / M 43 / S 9 |
| partial 61 件の性質 | C0〜C4 資産(観測コア・台帳・market 骨格・Renderer)の上に積む増分 — 新規 L より軽い |

### 4.2 改訂 3点見積(セッション = +1000k〜1500k トークン基準・旧表と同一単位)

| 対象 | 旧(B3) | 楽観 | **中央** | 悲観 | 根拠 |
|------|---------|------|---------|------|------|
| C5 S+A帯消化 | 3/6/12 | 3.5 | **5** | 9 | 139 件 ÷ (25〜30 件/セッション・C2〜C4 実測) ≒ 4.5〜5.5。悲観は K6 知の広場(新規設計 Zulip+Polis)と K1/K3 の L 帯設計手戻り |
| C6 切替準備 | 1/2/4 | 1 | **1.5** | 3 | 57 route 突合は機械的。悲観は新旧レスポンス差分の whitelist 潰し込み |
| 第1波完了(C0〜C6 合計) | 10/18/36 | 消化済4+4.5 | **消化済4+6.5** | 消化済4+12 | C0〜C4 が旧中央 10 に対し実績 約4 で完了 — 全体中央 18→**約10.5** に短縮 |

- 分散の主因は依然 K6(知の広場)と K1(観測 L 帯)・K3(マーケット取引 L 帯)。カレンダー律速は変わらず人間ゲート(GMO 本番契約・HG-KN-01〜08・cutover 裁定)。
- 本ラン(+3000k ≒ 2 セッション相当)の到達目標: C5 全クラスタ+受入判定、続けて C6 を cutover 直前まで。未達分は正直に残課題へ。
