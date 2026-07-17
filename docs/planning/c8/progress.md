<!-- GENERATED FILE — do not edit by hand. -->
<!-- source: docs/planning/c8/progress.json -->
<!-- regenerate: node scripts/render-c8-progress.mjs -->

# C8 ラン進捗（正本: progress.json）

- 正本: `docs/planning/c8/progress.json`（本表は生成物・手編集禁止）
- status 語彙: todo(未着手) / in_progress(着手中) / done(完了) / verified(検証済)
- scope: required(第1波必達) / best-effort(第2波)

## サマリー

- 全体: █████████░░░░░░░░░░░ 45%（150/334）
- 第1波必達(required): ████████████████░░░░ 80%（147/184）
- 第2波(best-effort): ░░░░░░░░░░░░░░░░░░░░ 2%（3/150）

| status | 件数 |
|---|---|
| 未着手(todo) | 158 |
| 着手中(in_progress) | 23 |
| ブロック中(裁定待ち/照会待ち/人間ゲート)(blocked) | 3 |
| 完了(done) | 150 |
| 検証済(verified) | 0 |

## blocked 一覧(裁定待ち/照会待ち/人間ゲート)

- 件数: 3

| id | title | lane | note |
|---|---|---|---|
| V3-AIP-92 | Builder(文明編集ツール)をOSDefinition/Component/… | L4 | 裁定待ち—実質解消提案: V3-AIP-92が前提とするBuilder(文明編集ツール)経由のKernel編集/OSDefinition差し替え一本道パイプラインは、round-16裁定で棄却済みのBuilder中心アーキテクチャに依拠している。推奨=(a) 既存codegenパイプライン(schemas/→generated一方向・npm run codegen:check GATE・scripts/codegen-*.mjs群)を『危険なDiffの拒否・検証・再現性』の機能的等価物として充足扱いとし、Builder UIそのものの新設は不要と裁定する。 |
| V3-AUT-15 | 本番はWRITE(commit/upload等)のみログイン必須(IHL_AUT… | L3/L4-auth | 裁定待ち: V3-AUT-15が求める Scope A(観測search/list/detail/imageの未ログイン公開READ)は、CL-04 route-matrix(tests/fixtures/route-matrix.csv・cl-04-route-matrix.test.ts、現行73行)が凍結する『auth系3route+verify-code+payjp-webhook以外は全protected(deny-by-default)』契約と矛盾する。観測系routeをpublic化するとCL-04凍結契約・関連TC群の全面作り直しが要る。推奨=(a) 当面は全ログイン必須(現行route-matrix)を正としV3-AUT-15のScope A公開READ要件は将来波(CL-04契約緩和が別途承認された時点)へ先送り。 |
| V3-SEC-03 | SwitchBot等の外部サービスAPIキー・秘密はサーバー側に一切保持・使用せ… | L4-gov | 裁定待ち: device-routes.ts(POST/GET /devices・apps/api/src/device-routes.ts:38-156)が provider api_key を AES-GCM 暗号化のうえ R2(api_key_ciphertext)にサーバー側保持し、/devices/{id}/test route で復号使用しており、V3-SEC-03『外部サービスAPIキー・秘密はサーバー側に一切保持・使用せず』と直接矛盾する。推奨=(a) サーバー側保管/復号を廃止しユーザー側(Docker/.env/ブラウザlocalStorage)管理のみに一本化(WEB版は手入力/CSVインポートのみへ縮小)。影響範囲: device-routes.tsのAES-GCM実装+tests/devices.test.tsの作り直し。 |

## lane 別内訳

| lane | 進捗 |
|---|---|
| CSV | ████████████████████ 100%（1/1） |
| L1/PAY | ███████████░░░░░░░░░ 56%（34/61） |
| L3/L4-auth | ██████████░░░░░░░░░░ 52%（14/27） |
| L4 | ███████████░░░░░░░░░ 57%（29/51） |
| L4-gov | ██████░░░░░░░░░░░░░░ 29%（10/35） |
| L4-knowledge | █████████░░░░░░░░░░░ 46%（25/54） |
| L4-obs | ██████████░░░░░░░░░░ 48%（32/66） |
| L6-ui | ███░░░░░░░░░░░░░░░░░ 13%（5/39） |

## lane 別明細

### CSV

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-OBS-32 | デバイス測定データのCSVインポート機能を提供する。SwitchBot限定ではな… | required | done | 9eeea25 |

### L1/PAY

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-KRM-03 | 毎月25日(クレジット締め日同型)を基準日に、カルマカウント≥1ならcount-… | required | done | 039a4c5 |
| V3-KRM-04 | カルマ値≤-100で永久BAN(ログイン拒否)とし、アカウント・R2データは削除… | required | done | 3631352 |
| V3-KRM-05 | 免罪符『黄金ヘラクレス教の免罪符』をプラチナコインマーケットで販売し、1購入=カ… | required | done | 3631352 |
| V3-KRM-06 | カルマは『信用の残高』であり減少のみ・能動的上昇なし・時間経過(問題を起こさず生… | required | done | 3631352 |
| V3-KRM-10 | 貢献度(Contribution Score)はいいね・コピー・組み込み等のKe… | required | done | 3631352 |
| V3-KRM-11 | applyContributionDeltaで子ノードにΔを反映後、依存グラフの… | required | done | 3631352 |
| V3-KRM-12 | 貢献度をADR-H-38の3軸(research 研究/capital 資本(維… | required | done | 9b5d1fa |
| V3-KRM-18 | (旧設計/legacy経済カーネル) カルマ計算(通常違反+1/重大違反+5)、… | required | done | a6d90e7 |
| V3-KRM-19 | 全付与イベント(プラチナ・カルマ・貢献・称号)をAppend-only履歴として… | required | done | 9229c57 |
| V3-KRM-20 | 使用率・投票・いいね・悪いね・お気に入り・作者フォロー・フォーク数・改善案数の総… | required | done | 3631352 |
| V3-KRM-21 | プロフィールではKarma(善良/取引/BAN)・Contribution(貢献… | required | done | 3631352 |
| V3-KRM-24 | 文化サイクル(使う→不便→改善案を見る→採用→フォーク→評価→RAG学習→Bui… | required | done | 3631352 |
| V3-KRM-28 | 観測commit成功時に研究貢献度フックを発火する(observation_sa… | required | done | 7591a5f |
| V3-KRM-32 | 経済システム(Economy)としてプラチナコイン(通貨でなく貢献を示すメダル)… | required | in_progress | 4cf360b |
| V3-MKT-02 | Listingは状態機械(unlisted→listed_*→sold/deli… | required | done | 3631352 |
| V3-MKT-03 | 取引ステージモデルを採用: マッチング前は公開(商品詳細+公開Q&A+ほめボード… | required | done | 0a868da |
| V3-MKT-04 | 取引成立を『配送完了確認(買い手受取申告) かつ 評価確定』と定義し、マッチング… | required | done | 3631352 |
| V3-MKT-05 | オークションは締切(ends_at)経過でsettleDueAuctionsが自… | required | done | 31fc4f9 |
| V3-MKT-06 | オークション以外に、未出品個体への直接オファー(欲しい意思表示、拒否設定は現観測… | required | done | 8a40adf |
| V3-MKT-10 | 取引成立時に売上5%を(旧8%から引き下げ)『システム維持費税』として売り手に負… | required | done | 674a5dc, 1c5d912, bff1b98, 9d14f02 |
| V3-MKT-12 | 振込コードはuserIdから決定的に生成(SHA-256→uint24先頭3バイ… | required | done | 887bb12 |
| V3-MKT-18 | マーケット争いは当事者opt-inの『公開して投票』を提供する。7日・1票=1P… | required | done | adae1e9 |
| V3-MKT-20 | 取引の配送では自社DBに送り手ID/受け手ID(システム内ニックネーム)と取引ス… | required | done | b070403 |
| V3-MKT-22 | テンプレート(論文/UIスキン/グラフ/重み付け設定/AI設定パック/プロンプト… | required | done | 3631352 |
| V3-MKT-23 | 出品は個体ID一覧の複数選択で9割完成させ、個体を選ぶだけで親個体画像・血統・成… | required | done | 3631352, b01847d |
| V3-MKT-25 | 観測データ(種・血統・サイズ・性別・産地・環境ログ)を素材に特徴量ベクトルの高次… | required | in_progress | — |
| V3-MKT-27 | マーケット評価は自前スコアを発明せずADR-H-08の『良い/普通/悪い』件数モ… | required | done | 3631352 |
| V3-MKT-29 | 取引成立後は所有者移転と観測データ(温度/重量/齢/成長速度/画像/取引履歴)引… | required | done | 3631352, 5d11d74 |
| V3-MKT-35 | プラチナコインを投票通貨とし、認証ユーザーが/economy/voteで対象・枚… | required | done | c21bc00 |
| V3-MKT-36 | 経済層を3層構造とする: (1)IT.Hercules.Laboratoryマー… | required | in_progress | 674a5dc, 1c5d912, bff1b98 |
| V3-MKT-40 | 市場台帳(ledger)を複式簿記(Σdebit=Σcredit一致・残高非負・… | required | done | dbbb506, 1d472b1 |
| V3-MKT-45 | 研究成果(projectId)に紐づく商品を出品し外部EC(BASE/Shopi… | required | done | 1d472b1 |
| V3-MKT-47 | Docker観測拡張をフォーク管理(parent_extension_id/li… | required | done | 0958f97 |
| V3-MKT-49 | ランニングコスト(R2・さくらVPS等)をAPIで取得して透明に表示する。ただし… | required | todo | — |
| V3-MKT-61 | ブロックしたユーザーとは金銭・成体・標本の取引(オファー送信・購入確定・予約マッ… | required | done | 3d21ba6 |
| V3-MKT-62 | P2P決済ユーザー選択制: 買主→売主決済を取引ごとに①銀行振込(既定・無料・I… | required | in_progress | 5d11d74 |
| V3-MKT-63 | 5%システム維持費ゆる請求徴収: 取引完了後「計算して振り込んでね」方式でゆるく… | required | in_progress | 5d11d74, 9d14f02 |
| V3-MKT-64 | カード非保有ユーザー向けプリペイドカード案内: PAY.JP Platform選… | required | done | a06fc66 |
| V3-MKT-65 | P2P送金アプリの取引利用禁止の規約明記: ユーザー間代金決済にPayPay送金… | required | done | 2cf67e0 |
| V3-KRM-09 | 指摘の二者が1ヶ月以内に合意しなければ強制クローズとし、未解決強制クローズをユー… | best-effort | todo | — |
| V3-KRM-14 | 貢献度を『直接貢献』(論文投稿・生体登録・記事・アフィリエイト等、例paper5… | best-effort | todo | — |
| V3-KRM-15 | embedding空間の密度や視点タグ(failure_case/ethics/… | best-effort | todo | — |
| V3-KRM-17 | 称号システムを実装しカルマ・貢献度・投票など行動条件/貢献パターンに応じて自動付… | best-effort | todo | — |
| V3-KRM-22 | 評価/フィードバックのモデルを定義する: 取引評価はカルマ制で『相手が悪いと言っ… | best-effort | todo | — |
| V3-KRM-29 | 参加者を『プロ研究者(承認権限)』『市民科学者/ブリーダー(データ提供・PR)』… | best-effort | todo | — |
| V3-MKT-07 | 抽選出品(TX-LOTTERY)は締切後にCSPRNG均等乱数で当選者1名を確定… | best-effort | todo | — |
| V3-MKT-08 | プラチナコイン優先(TX-PLATINUM-PRIORITY)は定員超過時に累計… | best-effort | todo | — |
| V3-MKT-09 | マーケット既定ソートは好みを反映した『好み新着順』とし、価値観スコア score… | best-effort | todo | — |
| V3-MKT-13 | 部分入金は累積未払額(残債)のみ減算し義務は全額消込まで消えない。過入金は維持費… | best-effort | done | b070403 |
| V3-MKT-16 | 代金支払期限はマッチング後2週間とし、振込未確認なら売り手が取引をクローズできる… | best-effort | todo | — |
| V3-MKT-17 | 双方が『合意キャンセル』を押した取引は中止・悪い・レビュー義務を一切記録しない特… | best-effort | todo | — |
| V3-MKT-21 | 国際配送・通関は『送り国×受け国』の2次元構造(from×to)でR2 JSON… | best-effort | todo | — |
| V3-MKT-24 | 落札されなかった出品は自動で再出品(値下げ方向のみ)を繰り返す。再出品回数(無制… | best-effort | todo | — |
| V3-MKT-26 | 商品詳細に公開Q&A掲示板(スレッド形式・質問は即全ユーザー公開、質問ボタンでま… | best-effort | todo | — |
| V3-MKT-34 | 年間最高傑作の標本/象徴(Symbol)や研究標本は、プラチナ100枚での『購入… | best-effort | todo | — |
| V3-MKT-41 | 市場出品の未認証(unauthenticated)閲覧境界を明示的に定義し(マー… | best-effort | todo | — |
| V3-MKT-42 | マーケット・掲示板・論文は独立画面/独立Featureではなく検索の『プリセット… | best-effort | todo | — |
| V3-MKT-44 | 広告を一切表示せず(利益ゼロでも許容)、収益化目的化を避けるため行動リンクを広告… | best-effort | todo | — |
| V3-MKT-52 | マーケット検索/フィルタAPIは複合インデックス(country+intlOnl… | best-effort | todo | — |
| V3-MKT-56 | マーケットUIをW2で整理する: 販売方式タブを3(オークション/抽選/プラチナ… | best-effort | todo | — |
| V3-MKT-59 | IHL 商標マーク使用許諾プログラム: 外部がシステムのデータ登録・信頼性確保を… | best-effort | todo | — |

### L3/L4-auth

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-AUT-01 | 認証はメール宛マジックリンク方式のみ（パスワードレス）とし、パスワード・OAut… | required | done | 1409b6b |
| V3-AUT-03 | ver3のセッションは署名付きステートレストークン(HMAC/JWT系・サーバ側… | required | done | a49ca1c |
| V3-AUT-06 | ログイン画面はメールアドレス入力と利用規約同意チェックを必須とし、未同意/未入力… | required | done | 4295494 |
| V3-AUT-08 | @ユーザーID（handle）は3〜30文字の限定文字種で一意・不変（確定後変更… | required | done | e9db7f7 |
| V3-AUT-09 | 新規登録は独立サインアップ画面を持たず、ログイン画面のマジックリンク初回検証時に… | required | done | eda9946 |
| V3-AUT-10 | オンボーディング未完了(onboardingComplete===false)の… | required | done | eda9946, 2126232, 8e792cb |
| V3-AUT-11 | 認証→初期設定フロー（登録→国/言語→利用規約→ホーム）を明示的に定義し、全画面… | required | done | 4295494 |
| V3-AUT-12 | 保護ルートはProtectedApp/middlewareでガードし未ログイン時… | required | done | db2bc69, 3f5012a, 2126232 |
| V3-AUT-15 | 本番はWRITE(commit/upload等)のみログイン必須(IHL_AUT… | required | blocked | — |
| V3-AUT-19 | 保護APIはBearer JWTを要求し、無Bearer/不正=401 UNAU… | required | in_progress | 987c5c3 |
| V3-AUT-20 | APIエラーは機械可読なerrorコードで返し、クライアントはそれをユーザー向け… | required | done | 987c5c3 |
| V3-AUT-46 | magic-link数字コードフォールバック: magic-link発行時に同一… | required | done | a49ca1c |
| V3-I18-01 | 翻訳/i18n(#21)の横断機能を認証・UI・掲示板・裁判・マーケット・カルマ… | required | done | d59fb61 |
| V3-I18-02 | 新規登録/オンボーディングで表示言語(locale)を必須選択させ、国籍・国コー… | required | in_progress | — |
| V3-I18-03 | 表示言語(locale)を設定/プロフィールからいつでも変更でき、保存成功後は製… | required | done | d59fb61 |
| V3-I18-06 | UGC(掲示板投稿・二人部屋メッセージ・出品説明・自由記述等)は作者言語の原文の… | required | done | b3cd929 |
| V3-I18-08 | UI文言リソースをキー化({screen}.{component}.{field… | required | done | — |
| V3-AUT-26 | 世界全体にowner/editor/viewer等のロール(role)を定義し、… | best-effort | todo | — |
| V3-AUT-28 | 投稿・観察記録・研究・プロフィールなど各コンテンツ種別ごとにデフォルト公開範囲(… | best-effort | todo | — |
| V3-AUT-31 | メールアドレス乗っ取り時はアカウントを即時凍結(freeze=true)し、元の… | best-effort | todo | — |
| V3-AUT-32 | 乗っ取り対策として弱い秘密の質問は採用せず、バックアップメール・端末信頼・ログイ… | best-effort | todo | — |
| V3-AUT-38 | GitHubユーザー名とIHLユーザーIDの対応表(world/economy/… | best-effort | todo | — |
| V3-AUT-40 | ログイン/認証はuserIdを全APIに伝搬でき、admin/memberロール… | best-effort | todo | — |
| V3-AUT-41 | マイページ/サイドメニューでカルマ・プラチナコイン所持枚数・貢献度・「相手を良い… | best-effort | todo | — |
| V3-I18-09 | 全UI JSONを走査して翻訳対象となるテキストキー全般(label/title… | best-effort | todo | — |
| V3-I18-10 | 翻訳解決順を user > country > official > auto … | best-effort | todo | — |
| V3-I18-11 | 翻訳辞書はLLMで初期自動生成(英語をハブ言語に日本語→英語→他言語)し、変な翻… | best-effort | todo | — |

### L4

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-AIP-07 | FR/NFRの100%をRTM行に紐づけreq_id↔test_case_idを… | required | done | 8e00920 |
| V3-AIP-104 | 写真解析/embedding計算の実行場所設計: 撮影後の写真解析・embedd… | required | done | 912941e, ed2c13a |
| V3-AIP-22 | GitHub ActionsでpytestとApps/webのtest/buil… | required | done | 124027b(既存) |
| V3-AIP-23 | CONTRIBUTINGのcloneパスをrepoルート相対に統一しdesign… | required | done | 567a554 |
| V3-AIP-28 | 成果物はスコアカードで加重機械採点する(例: STRUCTURAL25%・DES… | required | done | 3d21a73, 8e00920(cwd依存バグ修正) |
| V3-AIP-31 | 人間ゲート/human-in-the-loopを必須とする：ワンクリック全自動を… | required | done | b88a0f6 |
| V3-AIP-34 | コードより仕様書が先に存在する仕様書中心設計(Spec-Driven)を採り、憲… | required | in_progress | 124027b, fc2fada |
| V3-AIP-49 | テスト文化を全レイヤー緑前提で運用する：backend unit/fronten… | required | in_progress | 124027b, a0c631d |
| V3-AIP-50 | テストを要件・詳細設計から体系的に生成する(要件→TC表→pytestの正統な流… | required | in_progress | 124027b |
| V3-AIP-57 | 繰り返し使うワークフロー・手順はまず1回手動で正しさを確認してからスキル/ルール… | required | done | b1511e4 |
| V3-AIP-60 | ver1・ver2のコード・設計書・過去のAIとの要件整理やり取りを全て資料とし… | required | done | 91e2e17 |
| V3-AIP-67 | GitHub Issues(label=improvement/feature-… | required | done | 55f7fc7 |
| V3-AIP-78 | 大量タスクを夜間overnight/週次実行パックとしてAI(Auto余力)に切… | required | done | 4883f25 |
| V3-AIP-90 | RAG検索基盤を文明の脳とし全データ(観測・論文・掲示板・UI・テンプレート)を… | required | done | 91a782f |
| V3-AIP-92 | Builder(文明編集ツール)をOSDefinition/Component/… | required | blocked | — |
| V3-AIP-93 | 各正本Markdown/画面1ファイルに開発掲示板スレ1本を1:1で紐づけ(fi… | required | done | 2219a99 |
| V3-AIP-96 | 就寝中など人間不在の時間帯に、Claude Code の余剰セッション/スケジュ… | required | done | 26bbb23 |
| V3-AIP-97 | D:\claude を Claude の本拠地（HQ）とするワークスペース階層を… | required | done | 4ac0d40 |
| V3-AIP-98 | 夜間限定の自動運転(V3-AIP-96)を時間帯予約式スケジューラへ拡張し、夜間… | required | done | 3388451 |
| V3-CST-01 | 10年間ユーザーが増えなくてもコストを賄える構造を最優先とし、ユーザー数に比例し… | required | done | 831f14f |
| V3-CST-02 | Sakura VPS(サーバー費)+Cloudflare R2(ストレージ費)等… | required | done | f3ebe59 |
| V3-CST-09 | Truth(R2)バックアップ二重化: Truth正本を別プロバイダ(Backb… | required | done | fed43fb |
| V3-FND-01 | R2/Truth への書き込みは INSERT ONLY(append-only… | required | done | 8fbcc49 |
| V3-FND-02 | 永続正本は Cloudflare R2 のみとし、常駐DB(Postgres/S… | required | done | e4e79ee |
| V3-FND-03 | システムを「個体の一生と再解析可能性を守るファイルベース研究データレイク」として… | required | done | 32099ac |
| V3-FND-04 | 世界状態の更新は Command → 純粋関数 Reducer(Kernel) … | required | done | 8271f49 |
| V3-FND-05 | 文明の同一性を Genesis Hash + 連続したR2イベント列(各イベント… | required | done | 8271f49 |
| V3-FND-12 | 依存方向を apps→libs/ihl\|packages\|components … | required | done | e4e79ee |
| V3-FND-14 | システムの同期・接続・管理の最小単位を C-USB(Civilization-U… | required | done | 07fda74 |
| V3-FND-18 | データ取得元管理を Placement/DeviceBinding/Occupa… | required | done | 9eeea25 |
| V3-FND-20 | WASM(Extism/Spin)ドライバで中間APIサーバーを不要化し、既存フ… | required | in_progress | df69bc9 |
| V3-FND-21 | AI呼び出しを集約する AI Kernel(A90)を新設し全機能のAI利用(翻… | required | done | 8271f49 |
| V3-FND-34 | バッチ/cron失敗の監視・ハートビート通知: 月次Fibonacci消込等のバ… | required | done | c5ecd17 |
| V3-FND-35 | 外部依存の交換可能アダプタNFR: 決済(PAY.JP/PayPay/銀行)・配… | required | done | 8eb8358, f3ebe59 |
| V3-AIP-100 | 使用者もAIファーストにする: エンドユーザーの代理AIエージェント(ボット)が… | best-effort | todo | — |
| V3-AIP-102 | 技術記事投稿パック: システム案・思想を複数技術サイトへ投稿できる「コピペ完結」… | best-effort | todo | — |
| V3-AIP-103 | マルチ SNS 自動投稿オーケストレーション: 1 コンテンツを Instagr… | best-effort | todo | — |
| V3-AIP-62 | 実装をフェーズ0(要件確定)→1(プロトタイプ)→2(条件リクエスト/フォーク)… | best-effort | todo | — |
| V3-AIP-71 | 非エンジニアでも実行できるワンクリック/コピペ起動を用意する：ホストにNodeを… | best-effort | todo | — |
| V3-AIP-75 | 生成物(画像・字幕・タイトル・タグ・台本等)はすべてユーザーのOK/NG評価と理… | best-effort | todo | — |
| V3-AIP-82 | AIはUIコードや世界を直接書かず(World/UIのJSON(AST)またはC… | best-effort | todo | — |
| V3-AIP-86 | コンテンツ生成AI(要約・モデレーション・司法アシスタント・判例生成等)のプロン… | best-effort | todo | — |
| V3-AIP-87 | 現状の実装から現在の仕様書をJSONで自動生成し(実装/過去HTML→設計の逆流… | best-effort | todo | — |
| V3-AIP-95 | AI推論の切替をAI_MODE=stub\|prod/LOCALAI_ENABLE… | best-effort | todo | — |
| V3-CST-03 | AI運用コストを最適化する:調査タスクは上位モデルで直接回さず下位モデルで実行、… | best-effort | todo | — |
| V3-FND-07 | 文明全体の状態を定期(四半期等)に Era Snapshot として R2 へ保… | best-effort | todo | — |
| V3-FND-08 | ユーザーが自分のデータ(個体・観察・研究・設定・デバイス等)を範囲選択して多形式… | best-effort | todo | — |
| V3-FND-22 | APIは統一エンベロープ形式(data/meta{requestId,times… | best-effort | todo | — |
| V3-FND-23 | OpenTelemetry/Prometheus によるHTTPミドルウェア計装… | best-effort | todo | — |
| V3-FND-31 | 全認証ユーザーが本番の写しから安全に試験し改善テンプレートとして昇格できる Pe… | best-effort | todo | — |
| V3-FND-33 | 観測画面だけを先行してWeb公開し、画面のボタン等を止めずに後からシステム(掲示… | best-effort | todo | — |

### L4-gov

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-GOV-07 | プラチナ投票は当事者が「公開して投票」を選んだ場合のみ開始し、7日間・1票=1P… | required | done | adae1e9 |
| V3-GOV-10 | 掲示板・マーケットの指摘は30回ごとにプラチナ1枚を消費し(クールダウンなし)、… | required | in_progress | 0c866ff |
| V3-GOV-11 | ホームは司法インボックスのプレビュー(最大5件)と環境IoT due予定(最大3… | required | done | 837b314 |
| V3-SEC-03 | SwitchBot等の外部サービスAPIキー・秘密はサーバー側に一切保持・使用せ… | required | blocked | — |
| V3-SEC-14 | ログイン系エンドポイントにレート制限(magiclink 20回/60秒/IP、… | required | done | 7c28a03 |
| V3-SEC-20 | 利用規約(ToS)機能はサービスの性質・データの扱い・禁止行為をユーザーが理解し… | required | done | 067fd1d |
| V3-SEC-41 | ValueCheck/好みセッションは本人JWTと組み合わせた検索ブーストのみに… | required | done | ec51ada |
| V3-SEC-42 | 画像・解析データにSHA-256(元画像・ROIマスク・解析結果JSON)/Me… | required | done | ca52bb8 |
| V3-SEC-45 | ユーザーコード/ドライバー実行はサンドボックス境界(Extism/Docker/… | required | in_progress | 6db3dd9 |
| V3-SEC-56 | 出品状態書込・テンプレ公開・GMO等は認可(requireMarketListi… | required | done | 6bcd976 |
| V3-SEC-57 | 鍵バンドルのサーバzero-knowledge保管+オフラインリカバリコード: … | required | done | 290c33d |
| V3-SEC-58 | 書込系レート制限+ユーザー別クォータ: R2書込経路にレート制限とユーザー別クォ… | required | done | c3a907e |
| V3-GOV-02 | 争い入口を一本化し、単一のdispute-roomコンポーネントがanchor_… | best-effort | todo | — |
| V3-GOV-03 | 指摘の仕様: 入口は指摘のみ(通報UIを置かない)、タグ+理由テキストを必須。同… | best-effort | todo | — |
| V3-GOV-05 | 合意時は削除せずR2 append-onlyで新版を追加し、被指摘側の修正提案→… | best-effort | todo | — |
| V3-GOV-06 | 合意しなければ1ヶ月で強制クローズする。合意の自動検知・強制合意はスコープ外(判… | best-effort | todo | — |
| V3-GOV-08 | 指摘カルマΔcountルール: 市場紛争カテゴリ(Y01-Y15/虚偽出品・配送… | best-effort | todo | — |
| V3-GOV-15 | モデレーション/違反履歴の透明性を階層化する: 本人は全文・スコア・カテゴリ・カ… | best-effort | todo | — |
| V3-GOV-17 | 管理者は権限付与アカウントのみに管理者管理画面(A9000系)を表示し、GUIか… | best-effort | todo | — |
| V3-GOV-24 | OSフォーク権限を文明ごとの政治制度(封建制=Creator/Adminのみ/共… | best-effort | todo | — |
| V3-GOV-26 | 世界観ガード(Worldview Guardian/G50)がAI生成物・投稿を… | best-effort | todo | — |
| V3-GOV-27 | 四半期ごとに文明全体のスナップショット(プロンプト/評価/UI文化テンプレ/文化… | best-effort | todo | — |
| V3-GOV-34 | マーケットの不適切な出品は、ワードフィルタ等の事前防止に頼らず(抜け道が無数にあ… | best-effort | todo | — |
| V3-GOV-35 | 違法/規約違反の疑いがある出品への指摘は、国により合法/違法の基準が異なり時代で… | best-effort | done | b070403 |
| V3-SEC-08 | 公開データのユーザーIDは public_user_id=SHA256(user… | best-effort | todo | — |
| V3-SEC-10 | サンドボックス用にユーザーIDを1,2,3...へ連番再割り当てし、変換表(ルー… | best-effort | todo | — |
| V3-SEC-12 | 個人情報を掲示板・公開チャット・公開ボードに打ち込ませず、取引前に局留め氏名(フ… | best-effort | todo | — |
| V3-SEC-21 | 利用規約を『法的版(binding・単一正本)』と『やさしい読み版(小学5年生向… | best-effort | todo | — |
| V3-SEC-22 | 利用規約の各条にはその条を設けた意図を解説するYouTube動画を紐づけ、改定時… | best-effort | todo | — |
| V3-SEC-23 | 法的版に版ID(terms_version・agreedTermsVersion… | best-effort | todo | — |
| V3-SEC-39 | コンテンツ本文はMarkdownとしXSSフィルタを適用してsanitize済み… | best-effort | todo | — |
| V3-SEC-43 | 投稿画像はhash(perceptual/difference/wavelet)… | best-effort | todo | — |
| V3-SEC-44 | QRコードは公開用(標本・展示向け・暗号化なし・誰でも読み取り可)と観測/管理用… | best-effort | todo | — |
| V3-SEC-47 | 価値操作をサーバー側で強制する: コイン増減はサーバー(role=system)… | best-effort | todo | — |
| V3-SEC-48 | ストレージから読み込んだデータ・APIで受け取ったJSONはKernelに渡す前… | best-effort | todo | — |

### L4-knowledge

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-BBS-03 | 全ファイル・全コンポーネント・全画面テンプレートに『説明掲示板(使い方)・愚痴掲… | required | in_progress | e61f50b, 0bf56a8, 640fa3b |
| V3-BBS-05 | 掲示板スレ・投稿は上書き・削除せず、訂正は追記セクションで行う(INSERT O… | required | done | e61f50b, 0bf56a8 |
| V3-BBS-14 | 掲示板への改善要求はvoteable(積み投票/プラチナコイン)方式で扱い、AI… | required | done | 814c648 |
| V3-BBS-28 | 公開Q&A・称賛・未出品オファー・ラブレター一括募集などのEngagement(… | required | done | d005f3a |
| V3-PPR-01 | 論文照合(Paper Match)機能: 論文が要求する条件P(JSON)とユー… | required | done | 0bf56a8 |
| V3-PPR-02 | 論文の条件P(P⇒Qの前提)のJSON Schemaを単一正本としてファイル化し… | required | done | 2678d20 |
| V3-PPR-03 | 論文をPaperSectionsV1の6節(目的/仮説/条件/検証/現在のフェー… | required | in_progress | 0bf56a8 |
| V3-PPR-06 | 論文全文(sections+conditions+tags)をembedding… | required | done | 33b8a6d |
| V3-PPR-07 | 研究の空白領域を、観測データの4象限モデル(P∧Q=n11/P∧¬Q=n10/¬… | required | done | 41600e4 |
| V3-PPR-09 | 全派生成果物にrun_id・model_name/version・input_h… | required | done | e61f50b, 9eeea25, 33b8a6d |
| V3-PPR-12 | 解析は端末CPU/GPUをフル活用した完全ローカル計算(マルチスレッド/SIMD… | required | done | f2ac74c |
| V3-PPR-13 | 科学OSの世界接続層(3要素: Wikidata正規ID・使用時発行の内部Ind… | required | done | 33b8a6d, 52cef86 |
| V3-PPR-16 | 研究プロジェクトをprojectId中心(研究の最小単位=背骨)に、プロフィール… | required | done | 33b8a6d |
| V3-PPR-17 | 研究テーマ(温度・容器サイズ・湿度・振動等がヘラクレス成長に与える影響)を洗い出… | required | done | 33b8a6d |
| V3-PPR-18 | 追検証は『データ提供のみ』で完了できるようにし、グラフへの自動追加・相関係数の自… | required | done | 33b8a6d |
| V3-PPR-20 | 論文の観察項目・測定単位・条件・写真動画・修正履歴を統一データフォーマットとして… | required | done | ffa8eb1 |
| V3-PPR-23 | 論文管理を章構成+引用管理(observation/paper/url/book… | required | done | c4af847 |
| V3-PPR-30 | 研究者でない一般ユーザーが論文級の成果物を簡単に作れる仕組みを提供する: Dat… | required | done | 33b8a6d |
| V3-WIK-01 | エージェント維持型の永続Wiki(サブブレイン)を情報源(掲示板/論文/観測)の… | required | done | 33b8a6d |
| V3-WIK-03 | 検索は決定論の梯子(キーワード抽出→index.mdスコアリングでファイルを開か… | required | done | de5376e |
| V3-WIK-04 | 決定論ingest CLI(tools/knowledge_ingest.py)… | required | done | b902af9 |
| V3-WIK-07 | 月次Lint(矛盾・孤立ページ・古い記述・リンク切れ)を実行しlog.mdに記録… | required | done | 7c2049a |
| V3-WIK-13 | 統合検索を全文/タグ/ユーザー/ノードの4本柱で提供し、投稿(ノード)作成時にR… | required | done | 0bf56a8 |
| V3-WIK-16 | 記事・ブログ機能を論文(#09)とほぼ同じ共通CMS基盤で提供する。記事とブログ… | required | done | 33b8a6d |
| V3-WIK-17 | 会話ログ・AIチャット・観測データ・行動履歴を『共有』ボタン1タップ(PWA共有… | required | done | 33b8a6d |
| V3-WIK-20 | 設計書・コード・掲示板・修整理由・世界観・動画/記事メタ・フォーク系統・種(血統… | required | done | 783b38f |
| V3-WIK-28 | Cursor等のAIセッションを全て閲覧できるようにし、サブ脳として情報を整理・… | required | todo | — |
| V3-WIK-29 | 論文/研究のためにanthropics/life-sciences等の外部知識(… | required | done | bc4f513 |
| V3-BBS-02 | 製品掲示板の主入口を『愚痴・改善・論文・その他』の4つのみに限定し、独立Rese… | best-effort | todo | — |
| V3-BBS-04 | 全画面分の掲示板スレッド(公式説明スレ+愚痴スレ、125画面×2=250スレ)を… | best-effort | todo | — |
| V3-BBS-06 | 掲示板の紛争解決は『通報』ではなく『指摘』ボタンとし、指摘タグ選択と理由記入を必… | best-effort | todo | — |
| V3-BBS-08 | 指摘への合意が得られた場合、被指摘者が修正表現を提案し指摘者が了承すると元発言の… | best-effort | todo | — |
| V3-BBS-11 | 掲示板は自然言語検索で先に既存の適合掲示板へ誘導・提案し(複数候補)、結果が十分… | best-effort | todo | — |
| V3-BBS-12 | 掲示板作成はAIがタイトル・タグ・説明・目的のたたき台を自動記入し、ユーザーがク… | best-effort | todo | — |
| V3-BBS-16 | 開発掲示板はOS/システムのフォルダ構造・ファイル構成と同じ階層・同粒度で用意し… | best-effort | todo | — |
| V3-BBS-18 | 文明のあらゆる行動(カルマ変動・プラチナ付与・貢献度・称号・レビュー・取引・DM… | best-effort | todo | — |
| V3-BBS-19 | DM/メッセージ機能をスレッド一覧+バブル表示で提供しR2(dm/{thread… | best-effort | todo | — |
| V3-BBS-25 | 掲示板(BBS)はフルDiscourse実装ではなくスレッド/投稿をJSONLイ… | best-effort | todo | — |
| V3-BBS-26 | GitHub掲示板柱は自前掲示板UIを作り込まず、GitHub Discussi… | best-effort | todo | — |
| V3-BBS-32 | 思想・構造・哲学を公知化する技術宣言書(Technical Manifesto)… | best-effort | todo | — |
| V3-BBS-33 | 掲示板統計(投稿数推移・アクティブユーザー・文化スコア・時間帯ヒートマップ・タグ… | best-effort | todo | — |
| V3-PPR-05 | AI査読パイプラインの段階1〜5(構造・欠損・再現性・整合性・統計)を決定論コー… | best-effort | todo | — |
| V3-PPR-08 | 引用(Citation)を独立エンティティとして扱い、掲示板↔論文↔観測↔論文↔… | best-effort | todo | — |
| V3-PPR-11 | R2上の画像・解析データを研究目的でAPI経由取得可能(CC0推奨・利用制限なし… | best-effort | todo | — |
| V3-PPR-15 | 論文/仮説の信頼度を、データ量補正f_data=1-e^(-k・n)、一貫性補正… | best-effort | todo | — |
| V3-PPR-21 | 個体データ蓄積の研究枠を事業内に恒常的に確保し、毎年温度・マット配合・容器サイズ… | best-effort | todo | — |
| V3-PPR-25 | 研究循環レイヤー(paper/review/hypothesis/replica… | best-effort | todo | — |
| V3-WIK-08 | サブブレインの自己検証(同じ質問セットをwiki経由vsベタ読みでトークン・時間… | best-effort | todo | — |
| V3-WIK-18 | 会話ログ・掲示板・R2ログ・観測データを、mini_chunk(1〜2往復・思考… | best-effort | todo | — |
| V3-WIK-21 | すべての進化・変更・判断を時系列で保存し、いつでも読み返せる記録庫(アーカイブ)… | best-effort | todo | — |
| V3-WIK-23 | 検索・embedding計算をユーザー端末上でローカル実行する。テキスト用(Mi… | best-effort | todo | — |
| V3-WIK-24 | RAGをBase Index(全ノード検索・MVP必須)/Culture Ind… | best-effort | todo | — |
| V3-WIK-32 | テンプレート(スケール紙・QRラベル・研究ノート・生体カード・UIテンプレ・台本… | best-effort | todo | — |
| V3-WIK-35 | 論文データ・観測データ・種族/市場文化から初心者向け情報(買う場所・種族名の読み… | best-effort | todo | — |

### L4-obs

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-IND-02 | individual masterの保存先をIHL R2のindividualテ… | required | done | e61f50b |
| V3-IND-04 | 個体名のリネーム/改名・昇格・テンプレ更新はUPDATEせずname_event… | required | done | e61f50b |
| V3-IND-08 | マチアプの数式エンジンは計算量O(nタグ数)・GPU不要・深層学習/ブラックボッ… | required | done | 145d78d |
| V3-IND-12 | 血統(Cross)画面は非常に重要な機能として、齢別平均体重(初令/二令/三令初… | required | done | e61f50b, 3f941f2 |
| V3-IND-13 | 個体詳細(A2)を「個体のホーム画面」とし、観測(最新観測・履歴・成長曲線グラフ… | required | done | e61f50b, d49dcd9, 3d89c63, 57cc941 |
| V3-IND-15 | 生体カード(種・形態・サイズ・特徴・QRコード)を生成し、印刷用テンプレートをf… | required | in_progress | e61f50b |
| V3-IND-20 | スケジュール(飼育タスク)ノードを個体・観測テンプレに紐付け、AIが種族・成長ス… | required | in_progress | 57cc941 |
| V3-IND-21 | 個体・血統情報の登録数と実在数を照合できる透明性プラットフォームを作り水増… | required | done | e61f50b, 8b05247, 57cc941 |
| V3-IND-34 | 血統管理は複数系統(A:体格重視、C:色重視等)を並行してインライン累代させ、理… | required | in_progress | 3f941f2, 57cc941 |
| V3-IND-35 | 割り出し前に、親個体(♂/♀)・希望単価・希望匹数を指定して事前予約できる予約シ… | required | done | b5fd006 |
| V3-IND-36 | 割り出し前の幼虫は個体識別せず匿名count層(プール数のみ)で扱い、sampl… | required | done | 65d7a00 |
| V3-OBS-02 | 観測対象ナビゲータはテキストのみ(画像・サムネイル非表示)で、学名検索・アキネー… | required | done | ee79efd |
| V3-OBS-06 | 全ての計測・特徴値にvalue_origin(direct_observed/i… | required | done | e61f50b |
| V3-OBS-07 | 観測の信頼度モデルを設け、自動取得>手入力>後日編集の順で信頼度を明示スコア化し… | required | done | e61f50b, aa9dee3 |
| V3-OBS-08 | 観測パイプラインはITO構造(IN:写真・env・metadata → Tran… | required | done | e61f50b, 35e555e |
| V3-OBS-09 | 画像埋め込みはEmbeddingBackend Protocolで一本化し、本番… | required | done | e61f50b, 35e555e |
| V3-OBS-11 | 類似検索の最終rerankスコアはembedding+color+size+li… | required | done | e61f50b |
| V3-OBS-14 | 撮影特徴量は部位別平均L*a*b*(頭部/胸角/前胸/上翅)+分散+色ヒストグラ… | required | done | 426c2ca |
| V3-OBS-17 | 観測commit時にデバイス(devices[])を宣言するとDeviceBin… | required | done | ce81dd5 |
| V3-OBS-19 | 種族+発育段階を1度決めて観測画面に引き継ぐWorkflowContext(観測… | required | done | f728a06 |
| V3-OBS-20 | 個体ID・棚・場所からQRコードを発行/スキャンし、スキャンで該当個体の新規観測… | required | done | 890f079 |
| V3-OBS-22 | MVP v1観測コアスコープを「観測データ収集・写真登録・詳細ビュー・親個体連携… | required | done | — |
| V3-OBS-23 | 観測セッションに写真を1枚以上アップロードしてR2に保存し、thumbnailは… | required | done | e3d5aa5 |
| V3-OBS-24 | 観測詳細ビューは高忠実度モック準拠で、大型写真・構造化撮影条件・由来タグ付き測定… | required | done | f728a06 |
| V3-OBS-25 | 観測登録は3画面フロー(対象を選ぶ→入力→確認)とし、入力画面単体での即時保存(… | required | done | — |
| V3-OBS-26 | 観測計測入力の1行UIは(項目)ドロップダウン選択or新規追加/数値入力/(単位… | required | done | f728a06 |
| V3-OBS-27 | 測定行・撮影条件行・環境スナップショット行を単一のStructuredRowコン… | required | done | f728a06 |
| V3-OBS-43 | 観測を文明OSの中心Input(全機能の一次データ/機能の中心)と位置づけ、固体… | required | done | — |
| V3-OBS-45 | スケール紙/計測台を標準化(A4方眼19×26cm+四隅マーカー10mm角+QR… | required | in_progress | 2dcf396 |
| V3-OBS-46 | LabelMe相当の画像アノテーション(点/線/ポリゴン/ラベル)を統合し、観測… | required | in_progress | e61f50b |
| V3-OBS-47 | 写真を撮った瞬間に大きさ・角の長さ・色などをローカル解析(HSV/Lab色空間・… | required | in_progress | e61f50b |
| V3-OBS-48 | 観測詳細画面に「この観測を再解析する」ボタンを1つ置き、新しい画像なしで既存画像… | required | done | e61f50b |
| V3-OBS-53 | 写真1枚からmm単位精度で色・光度・湿度・温度を取得・記録できる観測システムと設… | required | in_progress | 2dcf396 |
| V3-OBS-56 | searchable_capture_setを検索中核Parquetとし、cap… | required | done | 2dc42f8 |
| V3-OBS-57 | 写真解析で個体観測画像から種候補・形態特徴・タグ・taxonomyを導く。種候補… | required | done | b7078e5 |
| V3-OBS-61 | 観測入力を自然言語のフリーテキスト欄1つ+「解析する」ボタンで受け付け、日付・個… | required | done | 4ab0135 |
| V3-OBS-62 | 観測フローを固定順で定義する: userId/auth→種族確定(taxonom… | required | in_progress | — |
| V3-OBS-72 | 研究室環境コンテキストの紐付け: 部屋・棚の配置、エアコン等の空調環境、センサー… | required | done | 23a4064 |
| V3-OBS-73 | データエクスポート二層+要件CRフロー: ユーザーデータを二層(事実CSV/画像… | required | done | 65d7a00, cc21229 |
| V3-IND-03 | 観測登録時に個体をindividual_id+display_nameで扱い、ユ… | best-effort | todo | — |
| V3-IND-05 | 血統(親子)表示で最良個体のみ次世代シリーズ名(例「玉」→「王」)へ昇格させる仕… | best-effort | todo | — |
| V3-IND-06 | 親表示はハイブリッド(Q7 C): truthはADR-H-11のparent_… | best-effort | todo | — |
| V3-IND-09 | マチアプに、価値観の精度を上げるPairwise比較画面(記載済み②)の前段とし… | best-effort | todo | — |
| V3-IND-11 | 色などの見た目を画像解析しユーザーの好みを統計学習して「理想個体に近づくにはどの… | best-effort | todo | — |
| V3-IND-14 | 個体一覧(A1)はキーワード・種族・形態・状態(生体/蛹/幼虫/死亡/標本)・テ… | best-effort | done | 65d7a00 |
| V3-IND-16 | 生体の一生をイベントログ(bio.created/moved/scheduled… | best-effort | todo | — |
| V3-IND-23 | 研究プロジェクト(projectId/P100)を中心に論文・個体・マット・製造… | best-effort | todo | — |
| V3-IND-26 | 成体の成長を追う4D Viewerは3D(体重X/体長Y/成長速度Z)+時間(s… | best-effort | todo | — |
| V3-IND-28 | 個体にlocation_history(場所×期間)を持たせ、Workerが期間… | best-effort | todo | — |
| V3-IND-29 | 棚の揺れイベント(ジャイロ閾値超過)を検出し、その時棚にいた個体に自動で紐づけて… | best-effort | todo | — |
| V3-OBS-12 | ヘラクレス標準撮影チャンバー(40×40cm級マットグレー箱・CRI/Ra95以… | best-effort | todo | — |
| V3-OBS-30 | デバイスのデータ取得間隔をデフォルト/一括上書き/複数選択/個別デバイスの4階層… | best-effort | todo | — |
| V3-OBS-33 | 環境観測は2層とし、Tier A(ガバナンスイベント)はINSERT ONLYを… | best-effort | todo | — |
| V3-OBS-34 | 占有(Occupancy)参照モデルとして個体・観測対象ごとに環境ファイルを増殖… | best-effort | todo | — |
| V3-OBS-38 | 画像表示のパフォーマンス・コストを段階的に最適化する。まず低コスト改善(サムネイ… | best-effort | todo | — |
| V3-OBS-40 | 観測登録APIはフロントの偽sessionId生成でなく、バックエンドが実際のs… | best-effort | todo | — |
| V3-OBS-42 | 検索/好み学習を連携する。好み学習(pairwise投票)で得た数値prefer… | best-effort | todo | — |
| V3-OBS-50 | 観測データ構造をSpecies(種)→Form(形態)→Individual(個… | best-effort | todo | — |
| V3-OBS-51 | 観測データを1次〜4次変換で再利用する層構造(0次=そのまま/1次=構造化・マー… | best-effort | todo | — |
| V3-OBS-58 | QC builderがblur/exposure/scale/backgroun… | best-effort | todo | — |
| V3-OBS-64 | 外部API/センサーを domain=datasource のDataSourc… | best-effort | todo | — |
| V3-OBS-66 | 変化の理由を残す観測ログレイヤー(logs/{timestamp}.json: … | best-effort | todo | — |
| V3-OBS-67 | 観測はライトユーザーが撮影だけで完結でき、研究者は観測項目を自由に追加できる二層… | best-effort | todo | — |
| V3-OBS-69 | 観測データを自動で統計化(成長率・生存率・湿度/温度相関・Ver別/ロット別比較… | best-effort | todo | — |
| V3-OBS-70 | Docker 中間層(C-USB 観測拡張)を介した外部ゲーム等からの観測データ… | best-effort | todo | — |
| V3-OBS-71 | 観測データ印刷: 個体詳細から、欲しいデータ項目(チェックボックス)と期間指定で… | best-effort | todo | — |

### L6-ui

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-UIX-04 | 色は意味のみに用いる(緑=成功/生存、赤=失敗、青=情報、黄=注意)。装飾的な多… | required | todo | — |
| V3-UIX-21 | ユーザーの好み・価値観を離散信号として記録し検索rerankに反映するマチアプ機… | required | todo | — |
| V3-UIX-24 | stub段階のMatchApp/画面は『サンプルデータ』と分かる表示にし本番デー… | required | todo | — |
| V3-UIX-25 | ホーム画面を認証後に着地するWorldレイヤーの司令塔とし、今日の状態(現在地カ… | required | done | 3f5012a |
| V3-UIX-26 | ホームの文明ミニマップは非PII集計(観測ペース/信頼度平均/テンプレ文化成長の… | required | done | 3f5012a |
| V3-UIX-27 | 次回観測upcoming/overdueをホームのtoday_linesへ最大3… | required | done | 3f5012a |
| V3-UIX-28 | 全画面共通のブランドクロムを採用する:ヘッダーに観測対象ナビゲータ・マイページ・… | required | done | 3f5012a |
| V3-UIX-32 | UIはOSSベース(Next.js 15 + shadcn/ui、掲示板は5ch… | required | todo | — |
| V3-UIX-43 | 設定機能を/me/settingsに集約し、AI接続(OpenAI互換BYOK)… | required | todo | — |
| V3-UIX-50 | 観測入力の操作フローを観測対象選択画面・テンプレート入力画面・条件リクエスト画面… | required | todo | — |
| V3-UIX-68 | マイページはシンプルにし、透明性の文化としてその人の作品を相手のマイページで全て… | required | todo | — |
| V3-UIX-80 | 取引前PII設定(局留め受取・配送先・銀行振込口座)が未完の場合、取引フロー内で… | required | todo | — |
| V3-UIX-81 | ScreenDef Renderer の共通層で WCAG 2.2 AA 相当の… | required | done | f565128 |
| V3-UIX-82 | 検索グラフビュー+ホバー簡易カード: 近さ(画像類似/形質/血縁)のエンティティ… | required | todo | — |
| V3-UIX-09 | UIビルダーはWeb版を簡易版(forkテンプレ/ボタン宣言的操作)、Docke… | best-effort | todo | — |
| V3-UIX-10 | 任意の編集可能画面から『この画面を編集』でUIビルダーを開き、現在の画面を対象に… | best-effort | todo | — |
| V3-UIX-11 | UIビルダーのパネル(Canvas/LayerPanel/Inspector/T… | best-effort | todo | — |
| V3-UIX-12 | 各機能コンポーネントに『編集』ボタンを付け、C-USB経由で改善案(フォーク)一… | best-effort | todo | — |
| V3-UIX-22 | 好み記録の正本をpreference_event(pairwise_choice… | best-effort | todo | — |
| V3-UIX-23 | 好み入力の一次UIをpairwise(2画像・左右1タップ+任意neither、… | best-effort | todo | — |
| V3-UIX-29 | ホーム画面のリンク密度を下げ、主要導線5個+その他は折りたたみ(progress… | best-effort | todo | — |
| V3-UIX-31 | 行き止まり(dead-end/trap)画面には戻る/ホーム導線を必ず設置する。… | best-effort | todo | — |
| V3-UIX-33 | OSSテンプレ(MIT/CC0/Apache2.0)を貼付/URL取込しAIがU… | best-effort | todo | — |
| V3-UIX-35 | モックはpx-perfectに近づけて再現するが、モックの見た目をそのまま本番採… | best-effort | todo | — |
| V3-UIX-36 | モックだけでなく画面遷移を網羅し、何をクリックするとどのモックへ遷移するかを含め… | best-effort | todo | — |
| V3-UIX-38 | UIをレスポンシブ(mobile/tablet/desktop)かつフレキシブル… | best-effort | todo | — |
| V3-UIX-40 | 自然言語検索+ファセット/オートコンプリート(種名/場所/個体ID/タグの即候補… | best-effort | todo | — |
| V3-UIX-42 | 全レイヤー通知(karma/platinum/dm/trade/system等1… | best-effort | todo | — |
| V3-UIX-44 | UIテーマ(light/dark/system・アクセントカラー・角丸・影・密度… | best-effort | todo | — |
| V3-UIX-46 | テンプレの必須機能チェック(REQUIRED_FEATURES: ログイン/観測… | best-effort | todo | — |
| V3-UIX-47 | 認証後3クリック以内で到達できる一般ユーザー向けUI選択画面を設ける(現状は/d… | best-effort | todo | — |
| V3-UIX-51 | 分類・対象の絞り込みUIはWikidataの階層構造(生物→昆虫→カブトムシ→ヘ… | best-effort | todo | — |
| V3-UIX-55 | UIのビジュアルトークンを黒基調ダーク(#0D0D0D/#1A1A1A)・角丸1… | best-effort | todo | — |
| V3-UIX-58 | 対話・生成物・進化ログ・仕様変更・系譜・世界データ変化を2D空間マップ(ノード+… | best-effort | todo | — |
| V3-UIX-59 | 各画面にpage_info要約パネル(目的/哲学/AI要約/使い方/FAQ/改善… | best-effort | todo | — |
| V3-UIX-61 | ユーザーが自然言語で画面名・目的を言うだけでUIガイドライン準拠のUI JSON… | best-effort | todo | — |
| V3-UIX-71 | ログイン/マイページ/マーケット/ダッシュボード等の初期テンプレート(ワイヤーフ… | best-effort | todo | — |
| V3-UIX-78 | 価値観テンプレート(タグセット、ユーザーが追加/削除/変更/フォーク可能)で各項… | best-effort | todo | — |
| V3-UIX-79 | pairwise好み入力は既定Nラウンド(N=10)で収束させ、現在ラウンド/上… | best-effort | todo | — |
