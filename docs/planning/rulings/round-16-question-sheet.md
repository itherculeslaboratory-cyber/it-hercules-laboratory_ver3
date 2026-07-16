---
id: round-16-question-sheet
title: 第16回裁定 質問シート(52問)
date: "2026-07-16"
status: draft
---

# 第16回裁定 質問シート(全52問)

> 回答はHTML版(同名 `round-16-question-sheet.html`)で。未回答=推奨採用。

## A. 方向を決める(最重要)

回答済み3問を除去済み: Q-PAY-01(PayPay統一で確定)・Q-PAY-05(P2P=買主→売主は銀行振込直接・IHL非関与・P2P送金機能の使用禁止を規約明記)・Q-PAY-06(PTチャージ=廃止・pt_topupコード削除)。残りは決済2問+既存3問。

### [Q-PAY-02] 決済まわりの外部アクション(人間)の最終リスト: ①PAY.JP本番アカウント申込(個人事業主・業態=昆虫マーケット運営+システム維持費5%徴収) ②PayPay OPAへの照会+並行申請(固定店舗なし個人事業主の契約可否・実料率1.98%か3.8%か・審査期間の確認)。

横断調査の結果、前回リストのうちPayPay銀行Open API照会とPTコイン前払式該当性の弁護士確認は不要になりました(P2P=銀行直接で確定・PTチャージ廃止のため)。

- **★推奨** AIが申込・照会の文面/入力内容を起草→ユーザーが送信・申込
- ユーザーが後日自分で対応
- 本番契約直前まで先送り(設計+sandboxだけ進める)

推奨理由: 起草まで自走し、送信・申込だけ人間ゲートに残すのが最速。

材料: `docs/planning/b2-research/research-payment-service-scan.md`

### [Q-PAY-03] IHL徴収層(5%システム維持費)の決済サービスの最終選定。

横断調査の結論(5軸=①支払者が自動で分かる ②ランニング最小 ③規約を誠意をもって説明できる ④個人事業主で今すぐ契約可 ⑤10年存続): 本命=PAY.JP(3.3%・月額0円・禁止商材規定が『昆虫のうち適法に販売できるものは認める』と名指しで許可=規約適合が全候補中最強・決済ID+Webhookで自動照合)。次善=KOMOJU(3.5%・即日契約・昆虫規約は要最終確認)。PayPay OPA直接(料率1.98%は要確認・審査約2ヶ月・固定店舗なし個人事業主の可否未確認)は並行申請にすれば『私の方へはPayPayで』の希望を後から反映可能。Stripe=禁止業種(動物・Connect外C2C)明記で除外。PayPal Business=固定40円/件が少額徴収で実質7〜17%になり不利。

- **★推奨** PAY.JPで即立ち上げ + PayPay OPAを並行申請(承認後にPayPay併用または主副入替)
- PAY.JP単独(PayPay申請はしない)
- KOMOJUで即立ち上げ + PayPay OPA並行申請
- PayPay OPA単独(審査約2ヶ月を待ってからローンチ)

推奨理由: PAY.JPは昆虫を名指しで許可する唯一の候補。PayPayの希望は並行申請で温存できる。

材料: `docs/planning/b2-research/research-payment-service-scan.md §B,§C`

### [Q-PAY-04] round-15裁定記録77行目『PayPay送金・郵便局機能を手動誘導すれば商用利用OK』の撤回。

追加調査で一次情報により反証: PayPay残高利用規約第7条が営利目的利用を禁止し、公式ヘルプ(b0861)が個人間送金での商品代金受取を明示禁止。違反時は無催告のアカウント停止。元記述は出典不明のAI回答テキストの転記でした。裁定記録は履歴として残し、round-16で撤回記録を追加する形で修正します(不変条項③準拠)。郵便局側の主張は未検証のため別途裏取りします。

- **★推奨** 撤回を承認(round-16で撤回記録を追加)
- 保留(自分でも確認したい)

材料: `docs/planning/b2-research/research-paypay-unification.md 付録(P2P規約)` / `docs/planning/rulings/user-ruling-2026-07-15-round-15.md L77`

### [Q-SCOPE-01] 今回ラン(T-38)の実装スコープをどこまでにするか。

全735要件の現状(Opus敵対検証済): 実装済57・部分71・設計のみ96・未着手277・制約/思想216(実装対象外)・hold14・人間ゲート2・棄却2。第1波の実装対象は残170件、第2波の実装対象は約173件(うち未着手126)。g08動画系(35件)はvideo-prepブランチ管轄のため本ランから除外します。

- **★推奨** 第1波残170件を必達+第2波は余力でベストエフォート
- 第1波のみで完了
- 第1波+第2波の全実装対象を必達(18時間枠では未達リスクあり)
- S/Aティアのみ優先

推奨理由: 第1波必達が『全部』の実質。第2波を必達にすると検証(批評家ゲート)が薄くなるリスク。

材料: `docs/planning/c8/PLAN-c8-full-run.md §2(インベントリ)`

### [Q-UI-01] ihl-ver2 の ihl-ui-catalog + ui-parts-lab-w2(D:\mockups の31枚を1:1実装済みのスタイル済みReact部品約30枚+civ.cssトークン=ver3の--civ-*の直接の祖先)を ver3 へ fork 移植し、全画面の見た目の正本にしてよいか。

調査の結論: mockup水準の視覚作り込みは ver2 側に完成品として既に存在する。ver3レンダラは語彙(table/badge/stepper等)を実装済みなので、残るのは視覚的な作り込み(スペーシング・階層・アイコン)を各screen-defへ移植する作業。reuse-first・フォーク文化(Component単位fork)に合致。

- **★推奨** 採用: ver2部品の視覚作り込みをver3へ移植して見た目正本にする
- 不採用: ver3独自CSSを磨く

推奨理由: 自作の劣化コピー回避の最短距離。

材料: `D:\claude\systems\ihl-ver2\packages\ihl-ui-catalog` / `docs/planning/c7/ui-parity-map.md`

### [Q-UI-02] 指示にあった『clodedesign』は Anthropic Labs の Claude Design(claude.ai/design・ブラウザ上で複数ビジュアル案を対話生成→選択するツール)と特定しました。どう使いますか。

既製デザイン資産の置き場ではなくワークフローツールのため『丸ごと採用』はできません。ihl-ver3への反映はエクスポート/手動移植になります。

- **★推奨** ihl-ui-catalog移植を主軸にし、Claude Designはユーザーが任意でキー画面の案出しに使う(採用案はD:\mockupsへ追加)
- Claude Designでの案出しを本ランの必須工程にする(ユーザーのブラウザ操作が必要)
- 使わない

推奨理由: 本ランを人間操作でブロックしない形が自走と両立。

材料: `https://claude.com/product/design`

## B. アーキ整合・HOLD

不変条項と衝突している設計論点(load-bearing矛盾)と、保留中の大型アーキ要件2件。

### [OQ-HOLD-01] V3-FND-13(World→FeatureNode→Kernel(MiniKernel)→Component→SubComponentの確定階層・画面概念廃止・Kernel UUIDルーティング・MiniKernel最大14種)をver3で採用するか。

registry上hold=true。conflict: IHLはMiniScreenKernel非採用(#39)で「画面廃止/Kernel UUIDルーティング」の適用可否が未決。レイヤー命名(K/B/F/A/C→V/P/G/K/B/Xなど)がver1内で複数回揺れ、ver2の01-要件体系との対応が未定義。FeatureNode数も12/25等で揺れている。ambiguity: World→FeatureNode→Kernel階層とC-USBをver3で継承するか要判断。現行ver3実装は実質「画面(ScreenDef)」概念で進んでおり、本要件を字義通り採用すると大規模なアーキテクチャ変更になる。

- **★推奨** 採用しない(現行ScreenDef/画面ベースのアーキテクチャを正とし、本要件はver1時代の未整理構想として棄却または対象外化)
- 部分採用(Kernel UUIDルーティングの思想だけ将来検討課題として残し、具体的な14種MiniKernel/FeatureNode階層は不採用)
- 全面採用してアーキテクチャを再設計(大規模差分・非推奨)

推奨理由: 不採用を推奨(C1〜C7で実装済みのScreenDefベースのアーキテクチャが既に動いており、いまさら画面概念を廃止するのは不変条項①=10年コスト最小・②=フォーク文化の少数固定骨格に反する後戻りコストが大きい。棄却または対象外化が妥当)

材料: `01-requirements/registry.json (id: V3-FND-13)` / `02-design/constitution.md` / `docs/architecture.md`

### [OQ-HOLD-02] V3-AIP-61(技術選定をdeep researchでゼロから行い設計・実装を作り直す。既存資産は参考資料程度に格下げ)は既に確定済み裁定と矛盾する。この要件をどう扱うか。

registry上hold=true・human_confirm=true。conflict: 既存資産(ver1/ver2)を『参考資料程度』に格下げしゼロから作り直す方針(グリーンフィールド)と、既存資産への最小差分統合という現方針DESIGN-science-os-integration(ブラウンフィールド)が対立。ただしstatement内には既に『【裁定確定】ver3は新リポジトリに新しいフォルダへクリーンなフォルダ設計で構築する。コードはゼロベース、データ・思想・要件は本リポジトリから継承』という追記があり、事実上はver3のrepo自体がこの裁定の実行結果(クリーンrepo・データ/思想/要件は継承)である可能性が高い。

- **★推奨** 現行ver3 repoの存在自体をこの要件の充足完了とみなしclose(確定・hold解除)
- 『さらに深いdeep research(業界最高技術選定)』の未実施部分が残っているとみなし、追加調査タスクとして継続

推奨理由: ver3 repo自体が充足結果とみなしclose推奨(データ/思想/要件は継承されており、技術選定はC1〜C6で個別裁定(GMO/Cloudflare Workers/R2等)を通じて実質完了している)

材料: `01-requirements/registry.json (id: V3-AIP-61)`

### [OQ-LB-01] [load-bearing矛盾] series改名(clutchレコードのseriesトークン差し替え)操作は、不変条項③(R2 append-only・UPDATE/DELETE禁止)とどう両立させるか。

独立批評家がqr-physical-label-opsクラスタを`still_shallow`判定した理由の1つ。設計文書は『リネームはclutchレコードのseriesトークンを差し替えるだけ』と記述しているが、これは他の全変異(訂正・是正・昇格)がappend-onlyパターン(新レコード追記+LWW投影)であるのに対し、seriesだけ実質UPDATE前提になっている点で正面から矛盾する。個体側の不変序数(seq,year,clutch_id)は焼き付け(不変)、series文字列はclutch側で可変という設計自体は正しいが、「可変」の実現方法がappend-onlyパターンから逸脱している。

- **★推奨** settingsクラスタのpref-setと同じLWW投影パターン(新clutchレコード追記+seriesは最新値を都度投影)に修正
- clutchレコードは例外的にUPDATE可能な非Truthテーブル(投影キャッシュ)と位置付けて割り切る
- series改名機能自体を初期リリースから外し、常に既定自動導出値のみとする

推奨理由: pref-set同様のLWW投影パターンへの修正を推奨(既に同一文書内でsettings/preferencesが確立した解法をそのまま流用でき、不変条項③との矛盾を構造的に消せる)

材料: `docs/planning/c7/usecase-driven-design.md#L1213(still_shallow表・qr-physical-label-ops②)` / `docs/planning/c7/usecase-driven-design.md#L795-796(該当設計記述)`

### [OQ-LB-02] [load-bearing矛盾] 環境テレメトリの「source-count最充足採用」(collectorの不完全bucketよりCSVの完全bucketを優先表示)は、全経路が課す「同一bucketキーへのput-if-absent」の上でどう実現するか。

独立批評家がmachines-environment-ioクラスタを`still_shallow`判定した理由の1つ。put-if-absentは先着1件のみを確定させ後着を弾く機構であり、「後着の重ね書き・snapshot比較の余地を残さない」。一方で設計は「各bucketに集約元件数(source-count)を保持し、read-back投影は同一bucketキーに重なったsnapshotのうちsource-count最大を採用」と要求しており、単純なput-if-absent(先着勝ち)ではこの重ね書き自体が起きない=物理的に実行不能な組み合わせ。

- **★推奨** bucketキーにsource(collector/CSV)を含めて複数snapshotを共存させ、read-back時にsource-count最大を選ぶ投影に変更(put-if-absent自体は維持しつつキー設計を拡張)
- source-count最充足の要求を撤回し、単純な先着優先(put-if-absent)で妥協する
- put-if-absentでなく別の書き込み機構(条件付き上書き)を環境テレメトリにのみ導入する(他ドメインのappend-only原則からは例外化)

推奨理由: bucketキーにsource種別を含める形でのキー設計拡張を推奨(append-only原則を破らずに複数snapshot共存を実現できる。CL-01由来のput-if-absent機構自体は変更不要)

材料: `docs/planning/c7/usecase-driven-design.md#L1212(still_shallow表・machines-environment-io①)` / `docs/planning/c7/usecase-driven-design.md#L731,#L746(該当設計記述)`

### [OQ-LB-03] [load-bearing矛盾] BYOK鍵5本+振込口座番号のパスフレーズ暗号バンドルについて、パスフレーズを忘れる・全端末を同時紛失する場合の復旧をどう扱うか(復旧不能を仕様として受容するか)。

独立批評家がaccount-settings-privacyクラスタを`still_shallow`判定した理由の1つ。設計は『パスフレーズは本人しか知らない=忘れると復元不能』を明示しているが、これは最重要ペルソナ(菜緒・非技術者のset-and-forget)において『5鍵+口座が同時に恒久喪失し得る』ことを意味し、クラスタが殺すと宣言した『恐怖』の一種が復旧不能な形で残存している。zero-knowledge(サーバが中身を一切読めない)を守る限り、原理的にサーバ側からの救済は不可能。

- 復旧不能をゼロ知識の対価として明示的に受容し、初回設定時に強い警告(バックアップコード印刷等)を必須にする
- **★推奨** リカバリコード(オフライン保管用の1回限り復旧鍵)を別途発行する仕組みを追加する(セキュリティ設計の変更を伴う)
- 口座番号のみサーバ本人スコープTruthへの平文保持を将来解禁する道を残し、鍵と口座で復旧可能性を分離する(V3-SEC-06の再解釈が必要)

推奨理由: リカバリコード発行方式を推奨(zero-knowledgeを崩さずに『本人が別途安全に保管する第2の鍵』で復旧不能問題を緩和できる。1Password/Bitwarden等の既製パターンと同型)

材料: `docs/planning/c7/usecase-driven-design.md#L1215(still_shallow表・account-settings-privacy①)` / `docs/planning/c7/usecase-driven-design.md#L976(該当設計記述・パスフレーズ復元不能の明示)`

### [OQ-LB-04] [人間裁定に分離済み・未回答] パスフレーズ暗号バンドル(zero-knowledge blob)をサーバに置いてよいか、それとも端末間直接転送(QR/パスフレーズ)に限るか。

account-settings-privacyクラスタの設計自身が『真の新規事項』として人間裁定に明示的に分離した項目。V3-SEC-06(口座を一切保持しない)の“保持”に、IHLが復号鍵を持たない暗号化ciphertextが該当するかどうかの解釈次第で、UXが根本的に別物になる(サーバ経由なら端末を問わず復元可能・端末間転送のみなら旧端末が手元にないと復元不能)。現状bank/payout平文schemaはrepoに存在せず、既定は端末保持+暗号バンドルで出荷されている。

- **★推奨** サーバにzero-knowledge blobとして保持を許可(復元性が高い。V3-SEC-06の“保持”はplaintextのみを指すと解釈)
- 端末間直接転送(QR/ファイル)のみに限定(サーバに一切データを置かない。より厳格だが旧端末紛失時に復元不能)

推奨理由: サーバでのzero-knowledge blob保持を許可(暗号化されIHLが復号不能なciphertextは実質的に“保持”に当たらないという解釈は妥当で、菜緒ペルソナのset-and-forgetを大きく改善する)

材料: `docs/planning/c7/usecase-driven-design.md#L972,#L976,#L998(『真の新規事項』明記箇所)`

## C. CL-07 サムネイル(4点)

C3から持ち越しの凍結スキーマ裁定。材料: docs/planning/c3/cl-07-thumbnail-options.md

### [OQ-CL07-01] [CL-07裁定4点-①] thumbnail形式をJPEGで確定してよいか。

ver2実装はPNG出力だが要件文(CL-07/FR-18-06)はJPEG規定。frozen schemaはconstを付けず未確定のままC3から持ち越されている。ver3はgreenfieldで守るべき本番thumbnail実体が存在しない。

- **★推奨** JPEG確定(推奨)
- PNG継続

推奨理由: JPEG採用(PNG比で配信/保存コストが数倍小さく不変条項①=10年コスト最小に有利。要件文とも一致)

材料: `docs/planning/c3/cl-07-thumbnail-options.md §3,§5-1`

### [OQ-CL07-02] [CL-07裁定4点-②] 実装経路の第1手を(a) jSquash on Workersでよいか($0硬制約ならb) Cloudflare Images、d) VPS残置はfallbackとして残置承認)。

4候補(wasm on Workers/CF Images/client canvas/VPS残置)を6軸(機能適合/Workers制約/コスト/バイト級互換/裁定への影響/メンテリスク)で比較済み。経路選択は不可逆でなく後から差替可能。

- **★推奨** (a) jSquash on Workers(推奨・$600/10年)
- (b) Cloudflare Image Transformations($0硬制約時の代替)
- (d) VPS残置をfallbackとして文書に残す(承認のみ・第1推奨にはしない)

推奨理由: (a) jSquash on Workersを第1推奨として承認(サーバ側決定論生成を維持でき、thumbnail_manifestモデルとズレない)

材料: `docs/planning/c3/cl-07-thumbnail-options.md §1,§4`

### [OQ-CL07-03] [CL-07裁定4点-③] 受け入れ条件を「バイト級互換」から「契約級互換」(①長辺512px等式 ②decode可能な正当画像 ③EXIF orientation視覚的正立 ④formatフィールド確定値一致)に読み替えてよいか。

バイト級互換はどの候補でも技術的に不可能(リサンプラ・エンコーダがライブラリごとに異なる)かつ不要(greenfieldで守るべき本番バイト列が存在しない)。この読み替え自体が裁定事項。

- **★推奨** 契約級互換に読み替え承認(推奨)
- バイト級互換を維持(事実上VPS Pillow一択に候補が潰れる)

推奨理由: 契約級互換への読み替えを承認(バイト級はEXIF追加時点でVPSですら不成立になる達成不能条件のため)

材料: `docs/planning/c3/cl-07-thumbnail-options.md §2`

### [OQ-CL07-04] [CL-07裁定4点-④] EXIF transposeをver3の正しい挙動として採用してよいか(ver2実装は未適用)。

frozen schemaのdescriptionは『EXIF transpose適用』を謳うが、ver2実物はこれを一切呼んでいない(grep該当0件)。ver3でのEXIF transpose採用は互換破壊でなく要件(CL-07/FR-18-06)への追従=挙動改善。

- **★推奨** 採用(推奨)。frozen description の『実装済み』表現を訂正対象とする
- ver2互換を優先しEXIF transpose非適用のまま踏襲

推奨理由: 採用(縦横逆転画像を正しく表示するための本来の要件で、ver2側に守るべき既存挙動が存在しない)

材料: `docs/planning/c3/cl-07-thumbnail-options.md §0.1`

## D. 市場・残route

市場画面の正本反映・制裁パラメータと、cutover前に処置が必要なplanned残route。

### [OQ-MKT-01] 正本usecase-driven-design.md §3必須(行215)の文言を更新するか、裁定記録だけに留めるか。

現行正本の文言「相違・死着でreceive確定でなくdisputeへ分岐」を「重大相違(死着/性別/系統違い)=dispute強制・軽微な計測値相違=append-only相違記録つき受取確定(事後dispute化可)」に改める案。ワイヤーは3出口のまま(正本と実装の整合)。[minor7]

- **★推奨** 正本の文言を新しい3出口ルールに合わせて更新
- 正本は現状維持・裁定記録にのみ新ルールを残す

推奨理由: 正本を更新(実装と正本が食い違ったまま放置するとフォーク文化での参照時に混乱する)

材料: `docs/planning/c7/wireframes-core5.md#L1285` / `docs/planning/c7/usecase-driven-design.md §3 market L215付近`

### [OQ-MKT-02] 成立方式2方式(既定=即決・承諾制オプトイン)と状態機械5脚(同時申込択一/24h自動辞退/48h自動キャンセル+再出品/申込中の表示継続/受取確定放置→自動good)を正本の収束フロー・状態機械へ反映するか。

market第4稿(批評家R4 major7件反映済み)で構造は解消済みだが、正本ドキュメントへの反映はまだ裁定事項として保留。[minor8][major1][major2][批評R4]

- **★推奨** 正本へ反映
- ワイヤーのみを正としてしばらく維持

推奨理由: 正本へ反映(実装フェーズの参照ズレを防ぐ)

材料: `docs/planning/c7/wireframes-core5.md#L1286`

### [OQ-MKT-03] no-payマーク(未入金放置の申込制限)のパラメータ承認: 仮既定「30日内2回で7日間申込不可」でよいか。

48h未入金→自動キャンセル+再出品+no-payマークという機構自体はワイヤーで確定済み。制裁ポリシーとして人間裁定が必要な数値パラメータのみ未確定。[major2脚③]

- **★推奨** 仮既定どおり承認(30日内2回で7日間)
- 回数/日数を変更
- 制限なし(no-payマークのみで制限は課さない)

推奨理由: 仮既定を承認(グリーフィング対策として妥当な軽さ)

材料: `docs/planning/c7/wireframes-core5.md#L1155,#L1287`

### [OQ-MKT-04] 猶予キャンセル(成立後60分)の回数上限パラメータ。

ワイヤーは回数表示のみを実装しており、上限・制限内容は未確定。例:30日内3回で即決申込前に警告/制限、などのグリーフィング防止ポリシーが人間裁定事項。[批評R4]

- **★推奨** 例示どおり30日内3回で警告/制限
- 別の回数・期間で設定
- 上限を設けず表示のみに留める

推奨理由: 例示値(30日内3回で警告/制限)をno-payマークと対に承認するのが運用上わかりやすい。

材料: `docs/planning/c7/wireframes-core5.md#L1288`

### [OQ-ROUTE-01] planned残route「onboarding系」2本(GET /api/v1/onboarding/status, POST /api/v1/onboarding/complete)を実装するか廃止するか。

cutoverリハーサル前に処置が必要な残route。旧APIではこれらのroute状態が未認証開放(P0所見)されている。現行ver3設計はauth-onboarding-localeクラスタで『必須は表示言語(locale)+@id(handle)の2ゲートのみ・onboardingComplete=trueをV3-I18-02/V3-AUT-08で管理』という別の完了管理方式に収束しており、この2 routeが新設計でも必要かは要確認。

- 新設計(locale+handle 2ゲート)にこの2 routeを合わせて実装
- **★推奨** 新設計では不要と判断し廃止(旧ver2の概念の残骸として処理)

推奨理由: 廃止を推奨(新設計はlocale+handle確定をPATCH /me/preferences等の既存機構で管理しており、専用onboarding/status・complete routeは重複実装になりうる。要再確認の上での廃止判断)

材料: `docs/planning/c6/cutover-readiness.md#L34,#L38` / `docs/planning/status.md#L40` / `docs/planning/c7/usecase-driven-design.md §auth-onboarding-locale(L1036-1116)`

### [OQ-ROUTE-02] planned残route「gmo webhook系」6本(GET reconciliation/meta, GET transfer-code, GET va-deposit/unsent, POST expected-payment, POST va-deposit/subscribe, POST webhook)を実装するか廃止するか。

GMO本番契約・live昇格(人間ゲート・未実施)に紐づく実装。C4完了時点でGMO sunabar照合の契約は確定済み(接続層sunabar/live分離・名前照合ポーリング)だが、実際のroute実装(特にwebhook受信)は本番契約前提でplanned止まり。cutoverリハーサル前に実装するか、GMO本番契約後に着手する既定路線のままにするか。

- cutoverリハーサル前に実装まで完了させる(本番契約が来たら即稼働できる状態にする)
- **★推奨** GMO本番契約(人間ゲート)後に着手する既定路線を維持(現状のまま)

推奨理由: GMO本番契約後着手を維持(本番鍵投入前に実装しても実地検証できず、人間ゲート=金銭に紐づく機能を前倒しで作り込むリスクの方が大きい)

材料: `docs/planning/c6/cutover-readiness.md#L80-85` / `docs/planning/status.md#L40,#L56`

### [OQ-ROUTE-03] planned残route「market transfer/match」2本(GET /market/transfer/{listing_id}, POST /market/listings/{listing_id}/match)を実装するか廃止するか。

2026-07-15第15回裁定でV3-IND-35(割り出し予約システム・親個体♂♀/単価/匹数指定→割り出し後自動マッチング)が新規採番された。このmatch routeが予約自動マッチング機能の実装先になる可能性が高く、廃止でなく新要件に合わせた再設計が必要になった可能性がある。

- **★推奨** V3-IND-35の自動マッチング機能の実装先としてこの2 routeを再設計・実装
- V3-IND-35とは別に新routeを設計し、この2 routeは旧概念として廃止

推奨理由: V3-IND-35の実装先として再設計を推奨(round-15裁定は第1波・S tierの優先度が高い新機能であり、既存plannedルートの名前・意図とも近い。ゼロから別routeを起こすより流用効率が良い)

材料: `docs/planning/c6/cutover-readiness.md#L58-59` / `docs/planning/status.md#L40` / `docs/planning/rulings/user-ruling-2026-07-15-round-15.md(V3-IND-35新規採番)`

## E. 検索・観測・個体

重要5画面ワイヤーの残りopen_questions。

### [OQ-IND-01] 個体詳細のtriage判定(■要対応/▲様子見/●順調)の閾値既定を、テンプレのstage別設定として編集可能にするか、システム固定既定で開始するか。

判定式はユーザーの飼育方針に依存するため、固定にすると合わない飼育者が出る一方、初期実装は固定の方が単純。

- テンプレstage別に編集可能
- **★推奨** システム固定既定(将来編集可能に拡張)

推奨理由: 初期はシステム固定既定で単純に開始し、テンプレstage別編集は第2波で拡張。

材料: `docs/planning/c7/wireframes-core5.md#L1675`

### [OQ-IND-02] 個体詳細dueの範囲は、テンプレstage間隔由来の世話予定のみか、IoT環境逸脱(温度/湿度アラート)も■要対応dueに含めて〔本日due〕送り列に乗せるか。

2026-07-12フィードバック第1陣で「due/超過を■要対応(赤)にしない・■は異常専用」の確定裁定があるため、環境逸脱を■に含めるなら『異常』カテゴリとして扱う整合が必要。

- 世話予定duesのみ(中立トーン「そろそろ」)
- **★推奨** IoT環境逸脱も■要対応に含める(異常カテゴリとして)

推奨理由: 環境逸脱は『異常』カテゴリとして■要対応に含め、世話予定dueは中立トーン(第1陣裁定と整合)。

材料: `docs/planning/c7/wireframes-core5.md#L1676` / `docs/planning/c7/wireframes-core5.md#L2097-2102(第1陣裁定=追い立てない温度感)`

### [OQ-IND-03] QR/NFC直着のハード方式: スマホカメラのQR読取のみで開始するか、NFCタグ物理ラベルまで初期対応するか。

コストと運用に関わるため裁定要。qr-physical-label-opsクラスタは現状QRのみで設計されている。

- **★推奨** QR読取のみ(初期リリース)
- NFCタグも初期対応

推奨理由: QR読取のみ(NFCタグ購入・貼付の物理コストと運用複雑性が増すため。カメラQRで十分な代替になる)

材料: `docs/planning/c7/wireframes-core5.md#L1678`

### [OQ-OBS-01] 観測登録「取り消す」(ステージ後退・死亡取消)に遡及期限を設けるか。

F4/F5の取消操作は誤操作の実害が大きいイベント(ステージ後退・死亡取消)。直近保存分のみ即時取消可とし以前は個体詳細から手動記録のみとするか、無期限で許可するか未確定。[批評R4]で追加された論点。

- **★推奨** 直近保存分のみ即時取消可・それ以前は個体詳細からの手動記録のみ
- 無期限で即時取消を許可
- 件数閾値(例:直近N件 or 直近X時間)で線引き

推奨理由: 直近保存分のみ即時取消可(件数が積み上がるほど誤操作の実害が大きいイベントのため、無制限取消は事故コストが高い)

材料: `docs/planning/c7/wireframes-core5.md#L611`

### [OQ-OBS-02] (メタ注記)観測登録の open_questions は画面一覧表で「3件」と記載されているが、本文に明記されているのは1件(OQ-OBS-01)のみ。フィードバック第1陣(commit e26e28f)で「通知手段」1件がクローズ済みと分かるが、残る3件目の内容がmarkdown本文に書き出されていない(見出し自体が「open_questions は StructuredOutput 参照」であり、生成時のworkflow構造化出力にのみ存在し本文に転記されなかった可能性)。

作成コミット6b0b045の時点から一貫してこの状態(通知手段を含め2件しか実体を確認できない)。データ欠落であり、新規の設計論点ではない。

- **★推奨** 3件目は失われたとみなし2件(1closed+1open)を正とする
- 元のworkflow構造化出力(ログ等)が別途保存されていないか確認し復元を試みる

推奨理由: 実害は小さいため2件を正としてクローズ扱いで進めてよい(復元コストが見合わない)

材料: `docs/planning/c7/wireframes-core5.md#L609-616` / `git show 6b0b045:docs/planning/c7/wireframes-core5.md`

### [OQ-SRCH-01] 類似検索(バスケット/F3)の既定スコープは「在庫全体」か「現在のフィルタ内」か。

現行ワイヤーは「在庫全体」既定+トグルでフィルタ内に切替。フィルタ内既定の方が良い作業が支配的なら変更が必要。

- **★推奨** 在庫全体を既定(現行案)
- フィルタ内を既定に変更

推奨理由: フィルタ内はトグルで到達できるため、既定は探索範囲が最大の在庫全体が安全。

材料: `docs/planning/c7/wireframes-core5.md#L900`

### [OQ-SRCH-02] バスケット出口[→血統照合(近交チェック)]の遷移先ビューをC7(本フェーズ)の産出対象に含めるか。

出口ボタン自体は検索画面(obs-navigator)の担当として確定済みだが、遷移先の血統照合ビューの実装帰属(このフェーズでやるか後続か)が未定。

- **★推奨** C7で血統照合ビューまで産出
- 出口ボタンのみC7・照合ビューは後続フェーズ

推奨理由: 本ランは全機能実装が目標のため血統照合ビューも産出対象に含める。

材料: `docs/planning/c7/wireframes-core5.md#L901`

### [OQ-SRCH-03] 保存検索の保存先は端末ローカルか、Truth(append-only設定record)か。

複数端末同期が必要かどうかで決まる。Truthを選ぶ場合は改名=新record追記・削除=論理無効化フラグで実現(UPDATE/DELETE不使用・不変条項③)し、UI操作は保存先に依らず同一にする制約付き[m13採用]。

- 端末ローカルのみ
- **★推奨** Truth(append-only・複数端末同期可)

推奨理由: account-settings-privacyクラスタのpref-set機構(LWW投影・append-only)と同一パターンで実装できるため、Truth保存を推奨(菜緒ペルソナの複数端末運用と整合)

材料: `docs/planning/c7/wireframes-core5.md#L639,#L902`

### [OQ-SRCH-04] F1L(ライト層既定表示)の収束ピル「成虫のみ表示中 ✕」の表出しきい値(在庫何件からピルを出すか)。

m12コールドスタートの閾値(在庫>20件)を流用するか、ライト層独自の閾値を新たに裁定するか。[批評R4]

- **★推奨** m12と同じ閾値(在庫>20件)を流用
- ライト層独自の閾値を新設

推奨理由: m12の閾値流用(二重定義を避け不変条項②のfork文化=少数固定骨格に整合)

材料: `docs/planning/c7/wireframes-core5.md#L903`

## F. 知の広場

昇格閾値・権限・票の重みなど統治パラメータ。

### [OQ-PLZ-01] 知の広場スレの昇格閾値定数一式の確定: 「✔裏取り済み」昇格=実観測cite≥何件・追試≥何件か / 「⚠反証あり」=「再現せず」+cite≥何件か / 「未収束の論点」のstance母数閾値。

ワイヤーの例値(4/2/5/12)は仮置き。

- **★推奨** 仮値(4/2/5/12)を承認
- 個別に値を変更
- コミュニティ規模に応じて可変にする

推奨理由: 仮値(4/2/5/12)で開始し運用データで調整。

材料: `docs/planning/c7/wireframes-core5.md#L2059`

### [OQ-PLZ-02] 票の重み係数: 認定飼育者と一次観測者(観測cite添付・追試実施者)のそれぞれの係数値。

昇格判定=重み付き票・表示=生数+内訳、という機構自体はワイヤーで確定済み。係数の具体値のみ未確定。

- 係数を明示指定(例: 認定飼育者=2倍・一次観測者=1.5倍等)
- **★推奨** AIに設計を委任し初期値を試行運用で調整

推奨理由: 初期値は認定飼育者2.0倍・一次観測者1.5倍で開始し試行運用で調整。

材料: `docs/planning/c7/wireframes-core5.md#L2060,#L1764`

### [OQ-PLZ-03] 解決マーク([✔解決した]/[取り消す])の権限はスレ主のみか、認定飼育者にも開放するか。

権限範囲は知の広場の統治構造に関わる裁定事項。

- **★推奨** スレ主のみ
- スレ主+認定飼育者

推奨理由: 初期はスレ主のみ(荒れ防止)。後から開放は可逆。

材料: `docs/planning/c7/wireframes-core5.md#L2061`

### [OQ-PLZ-04] 論点の昇格([⤴])・fork起票・論点切り出しの権限範囲、および遡及態度依頼の通知対象範囲(全返信者か当該返信者のみか)。

仮置き=⤴とfork起票はスレ主+認定飼育者、F2切り出しトグルは全員(自分の返信からのみ)。

- **★推奨** 仮置きどおり承認
- 権限範囲を変更

推奨理由: 仮置きを承認(スレ主+認定飼育者への限定は不変条項④=人間ゲート文化・過度な民主化による荒れを防ぐ設計思想と整合)

材料: `docs/planning/c7/wireframes-core5.md#L2062`

### [OQ-PLZ-05] カード発行の委譲: スレ主無応答N日で発行導線を認定飼育者/最多cite観測者のどちらへ(または両方へ)委譲するか、Nは何日か。

R4-4解消: 質問者が答えを得て離脱するQ&Aの常態により、閾値到達済みスレが永久にカード化されず知見のプールが痩せる欠陥への対処。自動発行はしない(opt-in規律維持)。

- 認定飼育者のみへ委譲
- 最多cite観測者のみへ委譲
- **★推奨** 両方へ委譲
- Nの日数を別途指定

推奨理由: 両方へ委譲・N=14日を初期値に。

材料: `docs/planning/c7/wireframes-core5.md#L2063,#L2007`

## G. 新規採番・オンボーディング

新規要件IDの採番可否と認証まわりの新route。

### [OQ-NEWID-01] 検索のグラフビュー+ホバー簡易カード(新規採番候補)を実装対象に追加してよいか。

近さ(画像類似/形質/血縁)のエンティティ紐づき図表示。ノードホバーで簡易ビュー・クリックで個体詳細へ。論文クラスタのギャップ可視化(3.6-5)と部品を共有できる可能性がある。まだ新規要件ID未採番。

- **★推奨** 新規ID採番して第1波/第2波へ組み込み
- 見送り(将来検討)

推奨理由: 紐づき図はユーザー高評価軸。既製グラフレイアウト(graphify等)の活用を前提に採番して本ランに含める。

材料: `docs/planning/c7/usecase-driven-design.md#L1222`

### [OQ-NEWID-02] SwitchBot CSV importer(新規採番候補)を実装対象に追加してよいか。

2026-07-12フィードバック第1陣で「環境データはCSVファースト」が確定裁定となったことに伴う具体機能。機器選択→CSV投入→期間重複はput-if-absent自動スキップ。machines-environment-ioクラスタの設計は完了しているが要件IDは未採番。

- **★推奨** 新規ID採番して実装
- 見送り

推奨理由: 採番を推奨(CSVファースト裁定の実体化に必須で、既にwireframes/usecase設計は収束済み)

材料: `docs/planning/c7/usecase-driven-design.md#L1223,#L698-770(machines-environment-ioクラスタ全体)`

### [OQ-NEWID-03] Docker collectorの配布・設定設計(新規採番候補)を実装対象に追加してよいか。

任意レイヤーとしての配布場所(repo/イメージ)・.envへのSwitchBotキー格納手順・観測登録(棚join)との連携ドキュメント。既定はあくまでCSVファーストで、collectorは「あれば使う」任意機能。

- 新規ID採番して実装
- **★推奨** ドキュメントのみ整備しコード配布は見送り
- 完全に見送り

推奨理由: 優先度低(第2波以降でよい。CSVファーストが既定のため必須ではない)

材料: `docs/planning/c7/usecase-driven-design.md#L1224,#L732,#L748`

### [OQ-ONB-01] 国(country)の永続受け皿schema(仮 ihl.profile.country.v1)を新設し、国情報をUserプロフィールに永続保持してよいか。

V3-AUT-35は逐語で『国(country)は保持しない(FR-REG-06/06a・本人の葛藤を優先)。将来配慮目的で国情報が必要になった場合のみ再検討』+human_confirm:trueと明記。V3-I18-17のconflictフィールドも『国情報を何に使いどこまで保持するかは未裁定』と明記。ゆえに新schema新設は既存確定要件と正面衝突する裁定案件。既定は国を保持しなくてもオンボーディングは完全成立する。ただし2026-07-15第15回裁定でV3-GOV-35(違法出品ユーザー自治)向けに国選択が『内部属性(非表示)として必須化』される例外がV3-I18-02に追記済みで、状況が変化している可能性がある。

- 永続受け皿schemaを新設(国際信頼スコア・文化タグ用途に活用)
- **★推奨** 新設せず、V3-GOV-35用途に限定した最小限の内部属性のみ(既存の例外条項の範囲内で運用)

推奨理由: 第15回裁定でV3-GOV-35向けの国選択必須化が既に例外承認されているため、その運用に必要な最小限のフィールドのみ新設し、汎用の国際信頼スコア/文化タグ用途への拡張は別途裁定に回すのが穏当

材料: `docs/planning/c7/usecase-driven-design.md#L1113` / `docs/planning/rulings/user-ruling-2026-07-15-round-15.md(V3-I18-02修正・V3-GOV-35拡張)`

### [OQ-ONB-02] handle-availability(入力中の可用性予告)routeを新設するか。

打鍵中にhandle→userIdの存在を照会して『使えそう/すでに使われています』を予告表示する新規API。一意性の権威的担保は確定時put-if-absent(409)で成立するため、advisoryが無くても動線は縮退成立する(UX向上の実装波であり必須ではない)。

- 新設する(UX向上)
- **★推奨** 見送り(確定時409のみで運用)

推奨理由: 見送り推奨(確定時409で一意性は担保済み・実装コストに見合う優先度が低い。将来必要になれば追加できる)

材料: `docs/planning/c7/usecase-driven-design.md#L1114,#L1067`

### [OQ-ONB-03] 数字コード(別端末フォールバック)のverify routeを新設するか。

magic-link発行時に同一OTPを数字コードとしても返し、code入力→検証する経路。現verifyはtoken前提ゆえ小さな新規追加で済む。別端末/webviewの『普遍の逃げ道』として送信成功画面と/loginの両方に入力欄を常設する設計。auth-onboarding-localeクラスタはこの項目自体をstill_shallow指摘②で『必須項目が未実装機構に依存する自己矛盾』と名指ししている。

- **★推奨** 新設する(推奨・別端末フォールバックの必須動線として)
- 見送り(magic-linkのみで運用しフォールバックを持たない)

推奨理由: 新設を推奨(送信成功画面が『届かない全経路の受け皿』を謳う以上、数字コード経路が無いとその主張自体が成立しない設計上の必須ピース)

材料: `docs/planning/c7/usecase-driven-design.md#L1115,#L1216(still_shallow②)`

## H. 要件改善バッチ(批評トップ10より)

Opus批評家による要件定義の穴。10年運用の耐久性に直結。

### [Q-REQ-01] Truth(R2)自体のバックアップ要件が存在しない(10年存続の最大穴)。バックアップ先をどこにするか。

現行要件は『投影を捨てTruthから再生成』のみで、Truth正本消失は救えない。かつDNS・R2・メールを単一Cloudflareアカウントに集約(V3-CST-04)しているため、アカウント凍結・侵害・誤削除でTruth全損。無料/低額の一度きりセットアップ=設備投資型で解決可能。

- **★推奨** 別プロバイダ(Backblaze B2等)への複製+ローカルD:\バックアップへの定期pullの二重化
- 別Cloudflareアカウントへの複製
- ローカル定期pullのみ
- 見送り

推奨理由: 同一プロバイダ内複製はアカウント凍結に無力なため二重化を推奨。

材料: `01-requirements/srs.md §5.3` / `docs/planning/c8/PLAN-c8-full-run.md §4`

### [Q-REQ-02] 『クラッチ=匿名プール(個体識別不能な幼虫のcount層)』を要件として新規採番し、V3-IND-02(全個体UID一貫識別)に但し書きを入れてよいか。

設計文書(usecase-driven-design.md §4.2)は最優先ペルソナ(100匹一括)の最重要オペとして二層アイデンティティ(匿名count層/識別individual層+昇格+attrition照合)を確定済みだが、srs.mdに該当要件IDが1件も無く、V3-IND-02と正面衝突したまま。

- **★推奨** 承認: 二層アイデンティティ/sample計測/昇格+attrition照合を新規採番し、V3-IND-02に『アドレスは個別容器分割/QR発行時に発生』の但し書き
- 見送り

材料: `docs/planning/c7/usecase-driven-design.md L317-343` / `01-requirements/srs.md §2.02`

### [Q-REQ-03] BAN/行政命令の即時失効とステートレスJWT(TTL30日・デニーリスト後付け)が未整合。失効方式をどれで確定するか。

純ステートレスのままではBAN済み・行政命令対象ユーザーの既発行トークンが最大30日有効=詐欺者を即座に締め出せない(V3-KRM-04/V3-GOV-09と衝突)。

- **★推奨** KVデニーリスト(BAN/失効者のみ格納・毎リクエスト照会)をMVP必須へ格上げ
- 毎リクエストのユーザー状態投影照合
- 後付けのまま(第2波送り)

推奨理由: デニーリストは対象者のみ格納で小さく、Workers KVで低コスト。

材料: `01-requirements/srs.md V3-AUT-03/V3-KRM-04/V3-GOV-09`

### [Q-REQ-04] 料率5%の母数を『成約額(売上全体)』で固定し、商用3%・フォーク10%との重複計上不可を明文化してよいか。

round-15は率のみ5%に変更し、母数・重複計上・端数・月起算の下流が未確定のまま(registry.json ambiguityに残存)。srs §2.05ヘッダの旧8%残存は誤記のため裁定不要で自走修正します。コード側定数(economy-constants.ts=0.08)の5%追従も自走修正します。

- **★推奨** 承認: 母数=成約額・3%/10%との重複計上不可を明文化
- 母数を別の定義にする(コメント欄で指定)
- 保留

材料: `01-requirements/srs.md §2.05` / `apps/api/src/economy-constants.ts`

### [Q-REQ-05] 2FA(TOTP)の採否(V3-AUT-32で未裁定のまま滞留中)。

V3-AUT-01=マジックリンクのみと衝突懸念があり『別途裁定』のまま第2波に滞留。乗っ取り対策の設計が止まっている。

- **★推奨** 重要操作(メール変更・アカウント削除・大口取引)限定のopt-in TOTPとして第2波採番(V3-AUT-01と非衝突化を明文化)
- 全面採用
- 見送り(マジックリンクのみ継続)

材料: `01-requirements/srs.md V3-AUT-32/V3-AUT-01`

### [Q-REQ-06] 外部依存(決済=GMO/配送=日本郵便URL/メール=Resend/IoT=SwitchBot)の『交換可能な薄いアダプタ+依存ごとに縮退動作1行』のNFR新設を承認するか。

中核フローが単一外部プロバイダに固着しており、10年内の仕様変更・サービス廃止時の代替経路が要件に無い。PayPay移行検討そのものがこのリスクの実例。

- **★推奨** 承認
- 決済のみ先行して他は見送り
- 見送り

材料: `docs/planning/c8/PLAN-c8-full-run.md §4`

### [Q-REQ-07] 批評トップ10のうち裁定不要と判定した4点を推奨どおり自走反映してよいか: ①書込系レート制限+ユーザー別クォータ ②バッチ/cron失敗の監視・ハートビート通知 ③『憲法』用語の分離+5%倫理宣言の正本パス確定 ④データエクスポート二層(事実CSV/画像分離)の採番+grilling確定事項→要件への環流CRフロー追加。

いずれも可逆な要件/設計追加で、批評家が『設計で追加可能・裁定不要』と判定した項目。まとめて自走に含めるかの確認のみ。

- **★推奨** 一括承認
- 個別に確認したい(コメント欄で指定)
- 見送り

材料: `docs/planning/c8/PLAN-c8-full-run.md §4(批評トップ10)`

## I. 運用メタ

本ランの進め方の確認2問。

### [Q-META-01] 質問シートの未回答項目は推奨案を採用して自走してよいか。

回答後は人間ゲート(公開・金銭・実鍵・物理・撤回台帳)以外ノンストップで完走します。

- **★推奨** 未回答=推奨案採用で自走
- 未回答項目は保留として人間ゲート扱い

### [Q-META-02] 別Claudeセッションが実装中の V3-OBS-32(CSVインポート)とその周辺(machines-environment-ioクラスタ・device画面・tests/fixtures/csv-import-golden)には本ランでは触れない棲み分けでよいか。

同一ファイルの同時編集とmainへの競合コミットを避けるため。OQ-LB-02(put-if-absent vs source-count)の裁定結果は別セッションにも影響するため、裁定内容はコミットメッセージ経由で共有します。

- **★推奨** 触れない(棲み分け)
- 本ランに統合する(別セッションの停止はユーザーが実施)

