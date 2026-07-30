<!-- GENERATED FILE — do not edit by hand. -->
<!-- source: docs/planning/c8/progress.json -->
<!-- regenerate: node scripts/render-c8-progress.mjs -->

# C8 ラン進捗（正本: progress.json）

- 正本: `docs/planning/c8/progress.json`（本表は生成物・手編集禁止）
- status 語彙: todo(未着手) / in_progress(着手中) / done(完了) / verified(検証済)
- scope: required(第1波必達) / best-effort(第2波)

## サマリー

- 全体: █████░░░░░░░░░░░░░░░ 27%（158/587）
- 第1波必達(required): █████████░░░░░░░░░░░ 43%（155/364）
- 第2波(best-effort): ░░░░░░░░░░░░░░░░░░░░ 1%（3/223）

| status | 件数 |
|---|---|
| 未着手(todo) | 400 |
| 着手中(in_progress) | 26 |
| ブロック中(裁定待ち/照会待ち/人間ゲート)(blocked) | 3 |
| 完了(done) | 158 |
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
| L1/PAY | ████████░░░░░░░░░░░░ 39%（35/89） |
| L3/L4-auth | ███████░░░░░░░░░░░░░ 33%（14/42） |
| L4 | ████░░░░░░░░░░░░░░░░ 22%（29/130） |
| L4-gov | ███░░░░░░░░░░░░░░░░░ 13%（10/75） |
| L4-knowledge | ███████░░░░░░░░░░░░░ 34%（26/76） |
| L4-obs | ███████░░░░░░░░░░░░░ 35%（32/92） |
| L5-video | ░░░░░░░░░░░░░░░░░░░░ 0%（0/24） |
| L6-ui | ████░░░░░░░░░░░░░░░░ 19%（11/58） |

## lane 別明細

### CSV

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-OBS-32 | デバイス測定データのCSVインポート機能を提供する。SwitchBot限定ではな… | required | done | 9eeea25 |

### L1/PAY

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-KRM-01 | カルマは『カルマ値([-100,+100]、登録直後0)』と『カルマカウント(別… | required | todo | — |
| V3-KRM-02 | カルマカウントが n-1→n に増加するたびカルマ値を -Fib(n) 減点し(… | required | todo | — |
| V3-KRM-03 | 毎月25日(クレジット締め日同型)を基準日に、カルマカウント≥1ならcount-… | required | done | 039a4c5 |
| V3-KRM-04 | カルマ値≤-100で永久BAN(ログイン拒否)とし、アカウント・R2データは削除… | required | done | 3631352 |
| V3-KRM-05 | 免罪符『黄金ヘラクレス教の免罪符』をプラチナコインマーケットで販売し、1購入=カ… | required | done | 3631352 |
| V3-KRM-06 | カルマは『信用の残高』であり減少のみ・能動的上昇なし・時間経過(問題を起こさず生… | required | done | 3631352 |
| V3-KRM-10 | 貢献度(Contribution Score)はいいね・コピー・組み込み等のKe… | required | done | 3631352 |
| V3-KRM-11 | applyContributionDeltaで子ノードにΔを反映後、依存グラフの… | required | done | 3631352 |
| V3-KRM-12 | 貢献度をADR-H-38の3軸(research 研究/capital 資本(維… | required | done | 9b5d1fa |
| V3-KRM-13 | GitHub上の開発者貢献(PRマージ・Issueクローズ・レビュー・コメント・… | required | todo | — |
| V3-KRM-16 | プラチナ・カルマ・貢献度・称号の付与条件を『何が起きたか(イベント/API)をキ… | required | todo | — |
| V3-KRM-18 | (旧設計/legacy経済カーネル) カルマ計算(通常違反+1/重大違反+5)、… | required | done | a6d90e7 |
| V3-KRM-19 | 全付与イベント(プラチナ・カルマ・貢献・称号)をAppend-only履歴として… | required | done | 9229c57 |
| V3-KRM-20 | 使用率・投票・いいね・悪いね・お気に入り・作者フォロー・フォーク数・改善案数の総… | required | done | 3631352 |
| V3-KRM-21 | プロフィールではKarma(善良/取引/BAN)・Contribution(貢献… | required | done | 3631352 |
| V3-KRM-23 | 個人の人格・価値観・判断癖・行動ログ・世界観は完全にユーザー個人のものとし他ユー… | required | todo | — |
| V3-KRM-24 | 文化サイクル(使う→不便→改善案を見る→採用→フォーク→評価→RAG学習→Bui… | required | done | 3631352 |
| V3-KRM-25 | 改善要求は『プラチナ投票』制度とし、1票=1プラチナコインで任意枚数積める(誰が… | required | todo | — |
| V3-KRM-28 | 観測commit成功時に研究貢献度フックを発火する(observation_sa… | required | done | 7591a5f |
| V3-KRM-32 | 経済システム(Economy)としてプラチナコイン(通貨でなく貢献を示すメダル)… | required | in_progress | 4cf360b |
| V3-MKT-01 | 個体/観測(RAG chunk)を軸に、固定価格・オークション・抽選・プラチナコ… | required | todo | — |
| V3-MKT-02 | Listingは状態機械(unlisted→listed_*→sold/deli… | required | done | 3631352 |
| V3-MKT-03 | 取引ステージモデルを採用: マッチング前は公開(商品詳細+公開Q&A+ほめボード… | required | done | 0a868da |
| V3-MKT-04 | 取引成立を『配送完了確認(買い手受取申告) かつ 評価確定』と定義し、マッチング… | required | done | 3631352 |
| V3-MKT-05 | オークションは締切(ends_at)経過でsettleDueAuctionsが自… | required | done | 31fc4f9 |
| V3-MKT-06 | オークション以外に、未出品個体への直接オファー(欲しい意思表示、拒否設定は現観測… | required | done | 8a40adf |
| V3-MKT-10 | 取引成立時に売上5%を(旧8%から引き下げ)『システム維持費税』として売り手に負… | required | done | 674a5dc, 1c5d912, bff1b98, 9d14f02 |
| V3-MKT-11 | マーケットの「システム維持費」(旧称:手数料。悪印象回避+利益からの貢献還元とい… | required | todo | — |
| V3-MKT-12 | 振込コードはuserIdから決定的に生成(SHA-256→uint24先頭3バイ… | required | done | 887bb12 |
| V3-MKT-15 | 【第16回裁定で読み替え】GMOあおぞら退役に伴い、本条の人間ゲートはPAY.J… | required | todo | — |
| V3-MKT-18 | マーケット争いは当事者opt-inの『公開して投票』を提供する。7日・1票=1P… | required | done | adae1e9 |
| V3-MKT-19 | 悪質ユーザーを排除するのでなく、正しい取引の方が儲かるインセンティブ設計(『10… | required | todo | — |
| V3-MKT-20 | 取引の配送では自社DBに送り手ID/受け手ID(システム内ニックネーム)と取引ス… | required | done | b070403 |
| V3-MKT-22 | テンプレート(論文/UIスキン/グラフ/重み付け設定/AI設定パック/プロンプト… | required | done | 3631352 |
| V3-MKT-23 | 出品は個体ID一覧の複数選択で9割完成させ、個体を選ぶだけで親個体画像・血統・成… | required | done | 3631352, b01847d |
| V3-MKT-25 | 観測データ(種・血統・サイズ・性別・産地・環境ログ)を素材に特徴量ベクトルの高次… | required | in_progress | — |
| V3-MKT-27 | マーケット評価は自前スコアを発明せずADR-H-08の『良い/普通/悪い』件数モ… | required | done | 3631352 |
| V3-MKT-29 | 取引成立後は所有者移転と観測データ(温度/重量/齢/成長速度/画像/取引履歴)引… | required | done | 3631352, 5d11d74 |
| V3-MKT-35 | プラチナコインを投票通貨とし、認証ユーザーが/economy/voteで対象・枚… | required | done | c21bc00 |
| V3-MKT-36 | 経済層を3層構造とする: (1)IT.Hercules.Laboratoryマー… | required | in_progress | 674a5dc, 1c5d912, bff1b98 |
| V3-MKT-39 | 経済(カルマ・プラチナ・マーケット)データは全てR2(JSON)のみで管理しDB… | required | todo | — |
| V3-MKT-40 | 市場台帳(ledger)を複式簿記(Σdebit=Σcredit一致・残高非負・… | required | done | dbbb506, 1d472b1 |
| V3-MKT-45 | 研究成果(projectId)に紐づく商品を出品し外部EC(BASE/Shopi… | required | done | 1d472b1 |
| V3-MKT-47 | Docker観測拡張をフォーク管理(parent_extension_id/li… | required | done | 0958f97 |
| V3-MKT-49 | ランニングコスト(R2・さくらVPS等)をAPIで取得して透明に表示する。ただし… | required | done | 36bc43c |
| V3-MKT-55 | 全決済がprojectIdに紐づき透明であること、マーケットデータは公開情報とす… | required | todo | — |
| V3-MKT-61 | ブロックしたユーザーとは金銭・成体・標本の取引(オファー送信・購入確定・予約マッ… | required | done | 3d21ba6 |
| V3-MKT-62 | P2P決済ユーザー選択制: 買主→売主決済を取引ごとに①銀行振込(既定・無料・I… | required | in_progress | 5d11d74 |
| V3-MKT-63 | 5%システム維持費ゆる請求徴収: 取引完了後「計算して振り込んでね」方式でゆるく… | required | in_progress | 5d11d74, 9d14f02 |
| V3-MKT-64 | カード非保有ユーザー向けプリペイドカード案内: PAY.JP Platform選… | required | done | a06fc66 |
| V3-MKT-65 | P2P送金アプリの取引利用禁止の規約明記: ユーザー間代金決済にPayPay送金… | required | done | 2cf67e0 |
| V3-OTH-01 | ユーザーのコア思想2点は不可侵: (1)10年続くランニングコスト最小=R2/保… | required | todo | — |
| V3-OTH-02 | OSS/フォーク文化を中核に据える: 世界中のエンジニアが粒度自由(ボタン一つ〜… | required | todo | — |
| V3-OTH-03 | OSS公開を前提に、市場(#06)・掲示板(#07)等をcivilization… | required | todo | — |
| V3-OTH-05 | 分類・観測・API基盤のスキーマは生物専用に固定せず自由キー構造とし表記揺れはA… | required | todo | — |
| V3-OTH-06 | ブランド/アイデンティティ: サービス名は必ず『ヘラクレス』を含める(英雄でなく… | required | todo | — |
| V3-OTH-07 | 少人数×物量の思想: 運営者一人が多数の役職(研究者/開発者/法務/デザイナー)… | required | todo | — |
| V3-OTH-10 | 好みモデルは離散モデルとし連続数値の合計スコアを定義しない。検索スコア順序はRA… | required | todo | — |
| V3-OTH-12 | 生成物の再現性を保証: 同じ入力からは必ず同じ結果を返し、乱数など非決定的処理を… | required | todo | — |
| V3-OTH-27 | 根本ビジョン: 単なる甲虫飼育管理アプリではなく『ユーザーが自分の文明を作り育て… | required | todo | — |
| V3-KRM-08 | カルマが下がるのは問題行為(詐欺・故意の未発送/未入金・誹謗中傷・虚偽レビュー・… | best-effort | todo | — |
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
| V3-MKT-28 | 取引に関する個人情報(氏名・配送先・振込口座・局留め設定)は掲示板に打ち込ませず… | best-effort | todo | — |
| V3-MKT-34 | 年間最高傑作の標本/象徴(Symbol)や研究標本は、プラチナ100枚での『購入… | best-effort | todo | — |
| V3-MKT-41 | 市場出品の未認証(unauthenticated)閲覧境界を明示的に定義し(マー… | best-effort | todo | — |
| V3-MKT-42 | マーケット・掲示板・論文は独立画面/独立Featureではなく検索の『プリセット… | best-effort | todo | — |
| V3-MKT-44 | 広告を一切表示せず(利益ゼロでも許容)、収益化目的化を避けるため行動リンクを広告… | best-effort | todo | — |
| V3-MKT-52 | マーケット検索/フィルタAPIは複合インデックス(country+intlOnl… | best-effort | todo | — |
| V3-MKT-56 | マーケットUIをW2で整理する: 販売方式タブを3(オークション/抽選/プラチナ… | best-effort | todo | — |
| V3-MKT-59 | IHL 商標マーク使用許諾プログラム: 外部がシステムのデータ登録・信頼性確保を… | best-effort | todo | — |
| V3-MKT-66 | 予約マーケットにおいて、単価固定・ラブレター形式・貢献度優先の3パターンを、並列… | best-effort | todo | — |
| V3-MKT-67 | プラチナコインショップの商品は運営者(ユーザー本人)のみが用意し、一般ユーザーは… | best-effort | todo | — |
| V3-OTH-09 | バージョン戦略: ver2完了基準は『.dev環境で検索でき、画像表示と可変詳細… | best-effort | todo | — |
| V3-OTH-15 | ユーザー体験の中核循環を『観測→変換(1〜4次)→生成(画像/動画)→評価→司法… | best-effort | todo | — |
| V3-OTH-20 | タグはsystem_tags(UI自動付与・編集不可)/ai_tags(AI自動… | best-effort | todo | — |

### L3/L4-auth

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-AUT-01 | 認証はメール宛マジックリンク方式のみ（パスワードレス）とし、パスワード・OAut… | required | done | 1409b6b |
| V3-AUT-02 | マジックリンクトークンはTTL15分・ワンタイム（検証済はR2で消費済に更新）と… | required | todo | — |
| V3-AUT-03 | ver3のセッションは署名付きステートレストークン(HMAC/JWT系・サーバ側… | required | done | a49ca1c |
| V3-AUT-04 | マジックリンクの本番SMTP鍵・送信ドメイン設定は人間ゲートとし、実メール送信は… | required | todo | — |
| V3-AUT-05 | SMTP未設定/送信失敗/CI時はdev_tokenフォールバック（画面内トーク… | required | todo | — |
| V3-AUT-06 | ログイン画面はメールアドレス入力と利用規約同意チェックを必須とし、未同意/未入力… | required | done | 4295494 |
| V3-AUT-08 | @ユーザーID（handle）は3〜30文字の限定文字種で一意・不変（確定後変更… | required | done | e9db7f7 |
| V3-AUT-09 | 新規登録は独立サインアップ画面を持たず、ログイン画面のマジックリンク初回検証時に… | required | done | eda9946 |
| V3-AUT-10 | オンボーディング未完了(onboardingComplete===false)の… | required | done | eda9946, 2126232, 8e792cb |
| V3-AUT-11 | 認証→初期設定フロー（登録→国/言語→利用規約→ホーム）を明示的に定義し、全画面… | required | done | 4295494 |
| V3-AUT-12 | 保護ルートはProtectedApp/middlewareでガードし未ログイン時… | required | done | db2bc69, 3f5012a, 2126232 |
| V3-AUT-13 | 認証境界はデフォルトデナイ（疑わしきは保護）とし、公開は認証入口(/login … | required | todo | — |
| V3-AUT-14 | 観測配下はREAD既定・WRITE列挙のdeny-listとし、新WRITEルー… | required | todo | — |
| V3-AUT-15 | 本番はWRITE(commit/upload等)のみログイン必須(IHL_AUT… | required | blocked | — |
| V3-AUT-16 | 観測検索スコープはScope A（コミュニティ）とし、ログイン済ユーザーは全観測… | required | todo | — |
| V3-AUT-17 | 書き込み・個人設定(commit・命名・個体・デバイス等)はuseActorId… | required | todo | — |
| V3-AUT-18 | 個体QRはihl://individual/<id>のアプリスキームdeep l… | required | todo | — |
| V3-AUT-19 | 保護APIはBearer JWTを要求し、無Bearer/不正=401 UNAU… | required | in_progress | 987c5c3 |
| V3-AUT-20 | APIエラーは機械可読なerrorコードで返し、クライアントはそれをユーザー向け… | required | done | 987c5c3 |
| V3-AUT-22 | admin系ルートのroleゲート・devツール既定off・Capability… | required | todo | — |
| V3-AUT-45 | レガシー register/locale/complete-onboarding… | required | todo | — |
| V3-AUT-46 | magic-link数字コードフォールバック: magic-link発行時に同一… | required | done | a49ca1c |
| V3-I18-01 | 翻訳/i18n(#21)の横断機能を認証・UI・掲示板・裁判・マーケット・カルマ… | required | done | d59fb61 |
| V3-I18-02 | 新規登録/オンボーディングで表示言語(locale)を必須選択させ、国籍・国コー… | required | in_progress | — |
| V3-I18-03 | 表示言語(locale)を設定/プロフィールからいつでも変更でき、保存成功後は製… | required | done | d59fb61 |
| V3-I18-04 | ログインUI文言は日本語中心とし、locale設定はオンボーディング側に委譲する… | required | todo | — |
| V3-I18-06 | UGC(掲示板投稿・二人部屋メッセージ・出品説明・自由記述等)は作者言語の原文の… | required | done | b3cd929 |
| V3-I18-08 | UI文言リソースをキー化({screen}.{component}.{field… | required | done | — |
| V3-AUT-24 | 創世アカウント IT.Hercules.Laboratory(role:admi… | best-effort | todo | — |
| V3-AUT-26 | 世界全体にowner/editor/viewer等のロール(role)を定義し、… | best-effort | todo | — |
| V3-AUT-28 | 投稿・観察記録・研究・プロフィールなど各コンテンツ種別ごとにデフォルト公開範囲(… | best-effort | todo | — |
| V3-AUT-31 | メールアドレス乗っ取り時はアカウントを即時凍結(freeze=true)し、元の… | best-effort | todo | — |
| V3-AUT-32 | 乗っ取り対策として弱い秘密の質問は採用せず、バックアップメール・端末信頼・ログイ… | best-effort | todo | — |
| V3-AUT-33 | 物理userテーブルはUUIDとメール(任意)のみの最小構成とし、状態はstat… | best-effort | todo | — |
| V3-AUT-38 | GitHubユーザー名とIHLユーザーIDの対応表(world/economy/… | best-effort | todo | — |
| V3-AUT-40 | ログイン/認証はuserIdを全APIに伝搬でき、admin/memberロール… | best-effort | todo | — |
| V3-AUT-41 | マイページ/サイドメニューでカルマ・プラチナコイン所持枚数・貢献度・「相手を良い… | best-effort | todo | — |
| V3-I18-05 | 言語設定はUIと翻訳表示の基準のみを決め、国籍・居住地・タイムゾーン・法的管轄・… | best-effort | todo | — |
| V3-I18-09 | 全UI JSONを走査して翻訳対象となるテキストキー全般(label/title… | best-effort | todo | — |
| V3-I18-10 | 翻訳解決順を user > country > official > auto … | best-effort | todo | — |
| V3-I18-11 | 翻訳辞書はLLMで初期自動生成(英語をハブ言語に日本語→英語→他言語)し、変な翻… | best-effort | todo | — |
| V3-I18-17 | 国籍によってUIを分けず全ユーザー共通のデフォルトUIとし、国旗はデフォルト非表… | best-effort | todo | — |

### L4

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-AIP-01 | モデル分業を制度化する：計画・設計・レビューは高effortモデル、機械的作業は… | required | todo | — |
| V3-AIP-02 | タスク重要度に応じてeffort/モデルTierを動的ルーティングし既定を下げて… | required | todo | — |
| V3-AIP-03 | 実装物は独立の批評家/監査エージェント(実装EXECと監査AUDITは別エージェ… | required | todo | — |
| V3-AIP-04 | 敵対的検証の独立性は、決定論チェック(lint/test/schema)を前段に… | required | todo | — |
| V3-AIP-05 | 機能ごとにV-model5点ゲート(要件定義・詳細設計・遷移設計・UI設計・テス… | required | todo | — |
| V3-AIP-06 | 設計→実装の解禁は3段の委任Goチェーン(DELEGATED-DESIGN-GO… | required | todo | — |
| V3-AIP-07 | FR/NFRの100%をRTM行に紐づけreq_id↔test_case_idを… | required | done | 8e00920 |
| V3-AIP-08 | 既存の先行実装はretrofit(impl-ahead)として扱い、V-mode… | required | todo | — |
| V3-AIP-09 | 人間の「完成」宣言より機械GATE PASSを優先する(C6)。「完成しましたか… | required | todo | — |
| V3-AIP-10 | 設計・DOC作業を4段階(1フォルダ構成→2設計書構成→3設計作成→3b網羅GA… | required | todo | — |
| V3-AIP-101 | 完成報告の実機検証義務(AI完成報告恐怖症対策): AI は「できました」報告の… | required | todo | — |
| V3-AIP-104 | 写真解析/embedding計算の実行場所設計: 撮影後の写真解析・embedd… | required | done | 912941e, ed2c13a |
| V3-AIP-105 | file-board-registry の board_thread_id 列を… | required | todo | — |
| V3-AIP-106 | 実装コードを変更するPRは、対応する設計書§の同時更新、または理由付きの「設計影… | required | todo | — |
| V3-AIP-107 | リリースごとにgit tag+リリースノート(GitHub Releases)を… | required | todo | — |
| V3-AIP-11 | 設計書憲法の不変原則を守る：同一トピックに正本を1つに固定(C1)、情報は削除せ… | required | todo | — |
| V3-AIP-12 | REQは1機能200–400行を目安に意図と測定可能な受入基準のみ書き、API … | required | todo | — |
| V3-AIP-13 | 詳細設計はv3を唯一のDET正本とし旧版は1行stub化してアーカイブmove、… | required | todo | — |
| V3-AIP-14 | 契約変更はDET v3§3→契約レジスタ更新→オラクルcheck→TESTの順で… | required | todo | — |
| V3-AIP-15 | 横断アーキ決定は機能番号を付けない新ADRに記録し、要件定義書には仕様(WHAT… | required | todo | — |
| V3-AIP-16 | contributorが3hop以内に辿れるContributor Spine(… | required | todo | — |
| V3-AIP-17 | 全パスをCanonical/Working/Generated/Archiveの… | required | todo | — |
| V3-AIP-18 | 24機能すべてにfeature README(IDXテンプレ・全正本層への1枚リ… | required | todo | — |
| V3-AIP-19 | 新規フォルダ作成はデフォルト禁止(新#NN feature/sub/_横断種別/… | required | todo | — |
| V3-AIP-20 | .github/CODEOWNERSで01-04・05-運用/queuesをde… | required | todo | — |
| V3-AIP-21 | リポジトリを単一repo正本(it-hercules-laboratory-cl… | required | todo | — |
| V3-AIP-22 | GitHub ActionsでpytestとApps/webのtest/buil… | required | done | 124027b(既存) |
| V3-AIP-23 | CONTRIBUTINGのcloneパスをrepoルート相対に統一しdesign… | required | done | 567a554 |
| V3-AIP-24 | 設計正本の物理配置をREQ=01-要件/・DET/TRN/UI=02-設計/fe… | required | todo | — |
| V3-AIP-25 | AI執筆はスライス執筆/stub/索引をAutoで機能あたり≤8並列(ファイル衝… | required | todo | — |
| V3-AIP-26 | ラボ画面/実装はREQ→DET→UI→TRNのオラクル階層に従い該当設計書の該当… | required | todo | — |
| V3-AIP-27 | エージェントの自己採点とユーザー採点の差分を採点テンプレート・キャリブレーション… | required | todo | — |
| V3-AIP-28 | 成果物はスコアカードで加重機械採点する(例: STRUCTURAL25%・DES… | required | done | 3d21a73, 8e00920(cwd依存バグ修正) |
| V3-AIP-29 | 大規模作業は司令塔(オーケストレーター)1体が計画・分配し、実作業は単一巨大エー… | required | todo | — |
| V3-AIP-30 | 詳細設計文書を巨大単一ファイルにせずAPI1ルート・FR1ID・スキーマフィール… | required | todo | — |
| V3-AIP-31 | 人間ゲート/human-in-the-loopを必須とする：ワンクリック全自動を… | required | done | b88a0f6 |
| V3-AIP-32 | 要件は一度凍結したら変更はCR(変更要求)のみ：抜けが見つかったら§9未決に追記… | required | todo | — |
| V3-AIP-33 | 要件の正本階層を憲法>採用REQ(accepted_requirements.c… | required | todo | — |
| V3-AIP-34 | コードより仕様書が先に存在する仕様書中心設計(Spec-Driven)を採り、憲… | required | in_progress | 124027b, fc2fada |
| V3-AIP-35 | 意図駆動開発ISP(Intent→Spec→Implementation)を正式… | required | todo | — |
| V3-AIP-36 | 全変更で意図↔仕様↔コミット↔文明史(R2)を紐付け、意図メタデータ(inten… | required | todo | — |
| V3-AIP-37 | 改善履歴・改善サイクルはGitHub(PR/Discussions/BOARD.… | required | todo | — |
| V3-AIP-40 | AI機能ごとに使用モデル/計算資源を差し替え可能にする(ai-profile: … | required | todo | — |
| V3-AIP-41 | AI推論はスマホ/エッジ(ユーザーの計算資源)推論をデフォルト最優先としクラウド… | required | todo | — |
| V3-AIP-43 | AI機能をタグ別(#script/#image/#video/#analytic… | required | todo | — |
| V3-AIP-44 | 全コンポーネントにEngineer Spec(技術者用)・Human-Frien… | required | todo | — |
| V3-AIP-45 | データ設計をAIのRAG検索・引用で最大限活用できる形へ最適化する(最大のユーザ… | required | todo | — |
| V3-AIP-46 | OSS/importを最大活用し車輪の再発明をしない：各サブシステムをOSSから… | required | todo | — |
| V3-AIP-48 | 完成の定義は「欲しい機能が実際に使え、データが保管され、エラーが無く、UXが最低… | required | todo | — |
| V3-AIP-49 | テスト文化を全レイヤー緑前提で運用する：backend unit/fronten… | required | in_progress | 124027b, a0c631d |
| V3-AIP-50 | テストを要件・詳細設計から体系的に生成する(要件→TC表→pytestの正統な流… | required | in_progress | 124027b |
| V3-AIP-52 | 機能追加は機能単位のプチウォーターフォール(micro-waterfall)で進… | required | todo | — |
| V3-AIP-53 | 一般的なウォーターフォール型で要件定義・詳細設計・UI設計・テスト設計・CI設計… | required | todo | — |
| V3-AIP-54 | ver1を「完璧」に仕上げてから同一品質バー(同DoD・同Tier体系)で機能単… | required | todo | — |
| V3-AIP-55 | 自律実行の運用ルール：可逆なステップでは許可を求めて止まらず自律実行し、確認質問… | required | todo | — |
| V3-AIP-56 | 大型・自律的な開発はultracode相当の複数ステージ(Stage P調査→R… | required | todo | — |
| V3-AIP-57 | 繰り返し使うワークフロー・手順はまず1回手動で正しさを確認してからスキル/ルール… | required | done | b1511e4 |
| V3-AIP-59 | セッション進捗報告は「今どこ/完了/進行中/次はあなた/次はAuto/数字/既知… | required | todo | — |
| V3-AIP-60 | ver1・ver2のコード・設計書・過去のAIとの要件整理やり取りを全て資料とし… | required | done | 91e2e17 |
| V3-AIP-61 | システム構築に必要な最高の技術選定をまずdeep researchで行い(ant… | required | todo | — |
| V3-AIP-63 | 環境層・知識層・プロダクト層の3層を相互補強させ、プロダクト層での学びを知識層へ… | required | todo | — |
| V3-AIP-64 | 並列実行の資源制御：worktree分離は並列エージェントが同一ファイルを触る場… | required | todo | — |
| V3-AIP-65 | 既存設計書はいきなり動かさずStage Rで全設計書の一覧・重複・矛盾・参照切れ… | required | todo | — |
| V3-AIP-66 | git運用ルール：ユーザーが明示的に指示しない限りcommitしない、force… | required | todo | — |
| V3-AIP-67 | GitHub Issues(label=improvement/feature-… | required | done | 55f7fc7 |
| V3-AIP-68 | ユーザーが機能を改善・開発した際に本番同様に結合・試用できるサンドボックス(本番… | required | todo | — |
| V3-AIP-70 | 本番apps/webは編集禁止(読み取り専用参照)、apps/ui-parts-… | required | todo | — |
| V3-AIP-76 | AIプロンプト・評価軸・文化テンプレート(UIテーマ/掲示板構造/評価軸)をコー… | required | todo | — |
| V3-AIP-78 | 大量タスクを夜間overnight/週次実行パックとしてAI(Auto余力)に切… | required | done | 4883f25 |
| V3-AIP-80 | システムの「外側」(UI Schema/思想/宣言書Manifesto/技術思想… | required | todo | — |
| V3-AIP-90 | RAG検索基盤を文明の脳とし全データ(観測・論文・掲示板・UI・テンプレート)を… | required | done | 91a782f |
| V3-AIP-92 | Builder(文明編集ツール)をOSDefinition/Component/… | required | blocked | — |
| V3-AIP-93 | 各正本Markdown/画面1ファイルに開発掲示板スレ1本を1:1で紐づけ(fi… | required | done | 2219a99 |
| V3-AIP-94 | 仕様書と実装の間で思想レイヤー(不変:哲学・文明観・目的・価値観)/構造レイヤー… | required | todo | — |
| V3-AIP-96 | 就寝中など人間不在の時間帯に、Claude Code の余剰セッション/スケジュ… | required | done | 26bbb23 |
| V3-AIP-97 | D:\claude を Claude の本拠地（HQ）とするワークスペース階層を… | required | done | 4ac0d40 |
| V3-AIP-98 | 夜間限定の自動運転(V3-AIP-96)を時間帯予約式スケジューラへ拡張し、夜間… | required | done | 3388451 |
| V3-AIP-99 | モデル階層ポリシー: 自動運転(開発予約外時間帯の無人運転)は軽量モデル(Son… | required | todo | — |
| V3-CST-01 | 10年間ユーザーが増えなくてもコストを賄える構造を最優先とし、ユーザー数に比例し… | required | done | 831f14f |
| V3-CST-02 | Sakura VPS(サーバー費)+Cloudflare R2(ストレージ費)等… | required | done | f3ebe59 |
| V3-CST-04 | 最安インフラを選定する:独自ドメインは年間更新料が最小のTLD(.uk最安)を採… | required | todo | — |
| V3-CST-05 | デプロイ/運用手順を整備する:nginx+certbot(Let's Encry… | required | todo | — |
| V3-CST-09 | Truth(R2)バックアップ二重化: Truth正本を別プロバイダ(Backb… | required | done | fed43fb |
| V3-FND-01 | R2/Truth への書き込みは INSERT ONLY(append-only… | required | done | 8fbcc49 |
| V3-FND-02 | 永続正本は Cloudflare R2 のみとし、常駐DB(Postgres/S… | required | done | e4e79ee |
| V3-FND-03 | システムを「個体の一生と再解析可能性を守るファイルベース研究データレイク」として… | required | done | 32099ac |
| V3-FND-04 | 世界状態の更新は Command → 純粋関数 Reducer(Kernel) … | required | done | 8271f49 |
| V3-FND-05 | 文明の同一性を Genesis Hash + 連続したR2イベント列(各イベント… | required | done | 8271f49 |
| V3-FND-10 | ver4では負荷を偏在させず、メインAPI・スケール・R2バインディングを Cl… | required | todo | — |
| V3-FND-11 | 本番API接続は Cloudflare Pages 経由 rewrite ではな… | required | todo | — |
| V3-FND-12 | 依存方向を apps→libs/ihl\|packages\|components … | required | done | e4e79ee |
| V3-FND-14 | システムの同期・接続・管理の最小単位を C-USB(Civilization-U… | required | done | 07fda74 |
| V3-FND-15 | 全進化しうるデータ構造に系譜メタ(uuid/parent_uuid/ancest… | required | todo | — |
| V3-FND-16 | フォーク文化を前提とし全構成を置換しても同一文明であり続ける(R2=神域はfor… | required | todo | — |
| V3-FND-17 | it-hercules-laboratory を唯一の新製品(OSS publi… | required | todo | — |
| V3-FND-18 | データ取得元管理を Placement/DeviceBinding/Occupa… | required | done | 9eeea25 |
| V3-FND-19 | 重い計算は原則ユーザー端末(WASM/WebGPU/ローカルLLM+8GB GP… | required | todo | — |
| V3-FND-20 | WASM(Extism/Spin)ドライバで中間APIサーバーを不要化し、既存フ… | required | in_progress | df69bc9 |
| V3-FND-21 | AI呼び出しを集約する AI Kernel(A90)を新設し全機能のAI利用(翻… | required | done | 8271f49 |
| V3-FND-25 | 『文明として進化するOS』を第一原理の上位ビジョンとして承認する。ただし実装スコ… | required | todo | — |
| V3-FND-30 | MVP v1スコープを明確化する:マーケット(#06)・マチアプ(#10)・裁判… | required | todo | — |
| V3-FND-34 | バッチ/cron失敗の監視・ハートビート通知: 月次Fibonacci消込等のバ… | required | done | c5ecd17 |
| V3-FND-35 | 外部依存の交換可能アダプタNFR: 決済(PAY.JP/PayPay/銀行)・配… | required | done | 8eb8358, f3ebe59 |
| V3-AIP-100 | 使用者もAIファーストにする: エンドユーザーの代理AIエージェント(ボット)が… | best-effort | todo | — |
| V3-AIP-102 | 技術記事投稿パック: システム案・思想を複数技術サイトへ投稿できる「コピペ完結」… | best-effort | todo | — |
| V3-AIP-103 | マルチ SNS 自動投稿オーケストレーション: 1 コンテンツを Instagr… | best-effort | todo | — |
| V3-AIP-47 | 独自UIを発明する前に必ずOSS事例調査(ライセンス/流用範囲/効果)を設計フェ… | best-effort | todo | — |
| V3-AIP-51 | E2E詳細化には要件定義書だけでは不足で、ユーザー入力(HQ判断/シナリオ)とP… | best-effort | todo | — |
| V3-AIP-58 | やるべきタスクとその依存順序を00-マスター実行順.mdに集約しチャット毎に追記… | best-effort | todo | — |
| V3-AIP-62 | 実装をフェーズ0(要件確定)→1(プロトタイプ)→2(条件リクエスト/フォーク)… | best-effort | todo | — |
| V3-AIP-71 | 非エンジニアでも実行できるワンクリック/コピペ起動を用意する：ホストにNodeを… | best-effort | todo | — |
| V3-AIP-73 | エージェントに実装を委ねる際はRAGに基づく思想理解に沿った改善は事前確認不要で… | best-effort | todo | — |
| V3-AIP-75 | 生成物(画像・字幕・タイトル・タグ・台本等)はすべてユーザーのOK/NG評価と理… | best-effort | todo | — |
| V3-AIP-79 | 段階的リリースを取り最小核(観測してデータが取れる+個体ページ閲覧+Issue風… | best-effort | todo | — |
| V3-AIP-81 | 世界(DB+API)とUI(文化)をリポジトリレベルで分離しWorld=不変/U… | best-effort | todo | — |
| V3-AIP-82 | AIはUIコードや世界を直接書かず(World/UIのJSON(AST)またはC… | best-effort | todo | — |
| V3-AIP-86 | コンテンツ生成AI(要約・モデレーション・司法アシスタント・判例生成等)のプロン… | best-effort | todo | — |
| V3-AIP-87 | 現状の実装から現在の仕様書をJSONで自動生成し(実装/過去HTML→設計の逆流… | best-effort | todo | — |
| V3-AIP-88 | 仕様統合の優先順位ルールを「現在の実装仕様<旧設計書<新アイディア<マイクロカー… | best-effort | todo | — |
| V3-AIP-89 | コード構造をKernel(物理法則/API・データ・計算・観測)・Feature… | best-effort | todo | — |
| V3-AIP-91 | 実装は依存関係の積み上げ順(userid→観測→そのデータを使う多機能→変換→台… | best-effort | todo | — |
| V3-AIP-95 | AI推論の切替をAI_MODE=stub\|prod/LOCALAI_ENABLE… | best-effort | todo | — |
| V3-CST-03 | AI運用コストを最適化する:調査タスクは上位モデルで直接回さず下位モデルで実行、… | best-effort | todo | — |
| V3-FND-06 | 世界状態を immutable な snapshot として保存し、上書きせず版… | best-effort | todo | — |
| V3-FND-07 | 文明全体の状態を定期(四半期等)に Era Snapshot として R2 へ保… | best-effort | todo | — |
| V3-FND-08 | ユーザーが自分のデータ(個体・観察・研究・設定・デバイス等)を範囲選択して多形式… | best-effort | todo | — |
| V3-FND-22 | APIは統一エンベロープ形式(data/meta{requestId,times… | best-effort | todo | — |
| V3-FND-23 | OpenTelemetry/Prometheus によるHTTPミドルウェア計装… | best-effort | todo | — |
| V3-FND-31 | 全認証ユーザーが本番の写しから安全に試験し改善テンプレートとして昇格できる Pe… | best-effort | todo | — |
| V3-FND-33 | 観測画面だけを先行してWeb公開し、画面のボタン等を止めずに後からシステム(掲示… | best-effort | todo | — |

### L4-gov

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-GOV-01 | 争い処理の基本モデル: 開発者・創世者は裁判官にならず、争いは(1)マーケット(… | required | todo | — |
| V3-GOV-07 | プラチナ投票は当事者が「公開して投票」を選んだ場合のみ開始し、7日間・1票=1P… | required | done | adae1e9 |
| V3-GOV-09 | 行政・当局から指摘があった場合、該当出品・データ・画像に即『不使用フラグ』を立て… | required | todo | — |
| V3-GOV-10 | 掲示板・マーケットの指摘は30回ごとにプラチナ1枚を消費し(クールダウンなし)、… | required | in_progress | 0c866ff |
| V3-GOV-11 | ホームは司法インボックスのプレビュー(最大5件)と環境IoT due予定(最大3… | required | done | 837b314 |
| V3-GOV-12 | 判例をR2 append-onlyに蓄積し引用可能にする。争いクローズ時にAIが… | required | todo | — |
| V3-GOV-13 | AI違法性スコアによる自動モデレーション(NGワード表)は採用せず、人間の指摘と… | required | todo | — |
| V3-GOV-19 | 統治ルール群(ProjectRules/Governance/Civilizat… | required | todo | — |
| V3-GOV-20 | 世界法(A50)を憲法/物理法則/文化法/経済法/AI法/翻訳法/観測法の統合体… | required | todo | — |
| V3-GOV-22 | 機能・UI・部品・コードを4レイヤー(3:機能構成/2:UI構成/1:部品/0:… | required | todo | — |
| V3-GOV-23 | OS自体をフォーク可能とし(C-USB準拠なら誰でもブランチ可)、マージは投票制… | required | todo | — |
| V3-SEC-02 | 収集エージェント(collector)の秘密鍵はcollector/.envにの… | required | todo | — |
| V3-SEC-03 | SwitchBot等の外部サービスAPIキー・秘密はサーバー側に一切保持・使用せ… | required | blocked | — |
| V3-SEC-04 | 秘密値(.env/credentials/APIキー/Cloudflare/Sa… | required | todo | — |
| V3-SEC-05 | LLMのAPI Keyは保存時のみ送信しレスポンスに返さず存在フラグのみ表示する… | required | todo | — |
| V3-SEC-06 | システムは個人情報・決済情報(氏名/住所/電話/クレカ/口座)の平文を一切保持し… | required | todo | — |
| V3-SEC-07 | 個人情報を保存前に必ずPII検出→マスク→保存の順で処理し、マスク前データの保存… | required | todo | — |
| V3-SEC-11 | プロフィールに住所を保持せず主体識別はUUID/UserID/表示名のみとし、O… | required | todo | — |
| V3-SEC-13 | 公開エクスチェンジ移行時はPIIをredactし構造化ID(追跡番号・観測画像I… | required | todo | — |
| V3-SEC-14 | ログイン系エンドポイントにレート制限(magiclink 20回/60秒/IP、… | required | done | 7c28a03 |
| V3-SEC-15 | open-redirectガードとして、認証済み /login?next= は内… | required | todo | — |
| V3-SEC-16 | セキュリティ機構(認証ゲート等)は『置いただけで効いている』と仮定せず、未ログイ… | required | todo | — |
| V3-SEC-17 | 画像取得エンドポイントの認証は、blob取得方式が不十分でない限り除外(認証免除… | required | todo | — |
| V3-SEC-19 | 本番環境変数を人間が確認する — VPS APIは IHL_AUTH_REQUI… | required | todo | — |
| V3-SEC-20 | 利用規約(ToS)機能はサービスの性質・データの扱い・禁止行為をユーザーが理解し… | required | done | 067fd1d |
| V3-SEC-24 | 利用規約の条文正本・法務文言はAIが自律的に変更してはならない(#02 HUMA… | required | todo | — |
| V3-SEC-26 | 自己ホスト版とクラウド提供版の責任分界を条文で明示し、自己ホスト利用者向けに『デ… | required | todo | — |
| V3-SEC-30 | 文明OSはOSS前提(Apache 2.0/MIT検討)で公開し、仕様書・R2構… | required | todo | — |
| V3-SEC-31 | 特許は取得せず、公開日をもって先使用権を主張する『公開宣言書』(MANIFEST… | required | todo | — |
| V3-SEC-34 | 外部データの取り込みは共有ボタン/認証済みAPI/OAuth(GitHub/No… | required | todo | — |
| V3-SEC-41 | ValueCheck/好みセッションは本人JWTと組み合わせた検索ブーストのみに… | required | done | ec51ada |
| V3-SEC-42 | 画像・解析データにSHA-256(元画像・ROIマスク・解析結果JSON)/Me… | required | done | ca52bb8 |
| V3-SEC-45 | ユーザーコード/ドライバー実行はサンドボックス境界(Extism/Docker/… | required | in_progress | 6db3dd9 |
| V3-SEC-46 | ロジックはAPIに固定しUIはAPIを呼ぶだけの『皮』に留める。価値ある操作(コ… | required | todo | — |
| V3-SEC-52 | cron等でユーザー不在時に勝手に情報取得する仕組みは日本の法律上問題がある恐れ… | required | todo | — |
| V3-SEC-56 | 出品状態書込・テンプレ公開・GMO等は認可(requireMarketListi… | required | done | 6bcd976 |
| V3-SEC-57 | 鍵バンドルのサーバzero-knowledge保管+オフラインリカバリコード: … | required | done | 290c33d |
| V3-SEC-58 | 書込系レート制限+ユーザー別クォータ: R2書込経路にレート制限とユーザー別クォ… | required | done | c3a907e |
| V3-GOV-02 | 争い入口を一本化し、単一のdispute-roomコンポーネントがanchor_… | best-effort | todo | — |
| V3-GOV-03 | 指摘の仕様: 入口は指摘のみ(通報UIを置かない)、タグ+理由テキストを必須。同… | best-effort | todo | — |
| V3-GOV-04 | 第三者の争いへの関与は閲覧のみとし投稿はさせない。 | best-effort | todo | — |
| V3-GOV-05 | 合意時は削除せずR2 append-onlyで新版を追加し、被指摘側の修正提案→… | best-effort | todo | — |
| V3-GOV-06 | 合意しなければ1ヶ月で強制クローズする。合意の自動検知・強制合意はスコープ外(判… | best-effort | todo | — |
| V3-GOV-08 | 指摘カルマΔcountルール: 市場紛争カテゴリ(Y01-Y15/虚偽出品・配送… | best-effort | todo | — |
| V3-GOV-14 | 違反対応は段階的ペナルティとする: まず警告(ミスかもしれない)→複数回続くとカ… | best-effort | todo | — |
| V3-GOV-15 | モデレーション/違反履歴の透明性を階層化する: 本人は全文・スコア・カテゴリ・カ… | best-effort | todo | — |
| V3-GOV-16 | 管理者は運営者1人のみとし常駐せず『召喚型』とする(思想の純度維持)。日常は研究… | best-effort | todo | — |
| V3-GOV-17 | 管理者は権限付与アカウントのみに管理者管理画面(A9000系)を表示し、GUIか… | best-effort | todo | — |
| V3-GOV-18 | API追加・R2追加・テーブル追加など『壊れないためのセーフティ』が必要な危険操… | best-effort | todo | — |
| V3-GOV-21 | 文明OSを完全構造主義(善意・信頼・人間性に依存せず、裏切りの利得<協調の割引現… | best-effort | todo | — |
| V3-GOV-24 | OSフォーク権限を文明ごとの政治制度(封建制=Creator/Adminのみ/共… | best-effort | todo | — |
| V3-GOV-25 | 変更管理プロトコル(CMP)/AI管理官(A90)憲法: 仕様変更は『変更理由の… | best-effort | todo | — |
| V3-GOV-26 | 世界観ガード(Worldview Guardian/G50)がAI生成物・投稿を… | best-effort | todo | — |
| V3-GOV-27 | 四半期ごとに文明全体のスナップショット(プロンプト/評価/UI文化テンプレ/文化… | best-effort | todo | — |
| V3-GOV-34 | マーケットの不適切な出品は、ワードフィルタ等の事前防止に頼らず(抜け道が無数にあ… | best-effort | todo | — |
| V3-GOV-35 | 違法/規約違反の疑いがある出品への指摘は、国により合法/違法の基準が異なり時代で… | best-effort | done | b070403 |
| V3-GOV-36 | 投票制度は二層とする: ①無料のノーコスト投票(誰でも参加) ②プラチナコイン『… | best-effort | todo | — |
| V3-SEC-01 | 観測データは原則オープンデータ(ライセンス選択可)とし、論文本文は著作権配慮のう… | best-effort | todo | — |
| V3-SEC-08 | 公開データのユーザーIDは public_user_id=SHA256(user… | best-effort | todo | — |
| V3-SEC-10 | サンドボックス用にユーザーIDを1,2,3...へ連番再割り当てし、変換表(ルー… | best-effort | todo | — |
| V3-SEC-12 | 個人情報を掲示板・公開チャット・公開ボードに打ち込ませず、取引前に局留め氏名(フ… | best-effort | todo | — |
| V3-SEC-21 | 利用規約を『法的版(binding・単一正本)』と『やさしい読み版(小学5年生向… | best-effort | todo | — |
| V3-SEC-22 | 利用規約の各条にはその条を設けた意図を解説するYouTube動画を紐づけ、改定時… | best-effort | todo | — |
| V3-SEC-23 | 法的版に版ID(terms_version・agreedTermsVersion… | best-effort | todo | — |
| V3-SEC-25 | 利用規約・プライバシー・市場/プラチナコイン利用注意の法務ドラフトと人間確認チェ… | best-effort | todo | — |
| V3-SEC-27 | IHLは civilization-os とは別の独立ToS/Privacyを … | best-effort | todo | — |
| V3-SEC-29 | 利用規約に収集項目(メールアドレス・国・言語・行動履歴/画面遷移/AI利用履歴)… | best-effort | todo | — |
| V3-SEC-35 | システムは外部AIモデルの再学習(学習)には使わず、取り込んだデータは推論・保存… | best-effort | todo | — |
| V3-SEC-37 | テンプレート/OSS取り込みはオープンライセンスのものだけを選んで一括取り込みし… | best-effort | todo | — |
| V3-SEC-39 | コンテンツ本文はMarkdownとしXSSフィルタを適用してsanitize済み… | best-effort | todo | — |
| V3-SEC-43 | 投稿画像はhash(perceptual/difference/wavelet)… | best-effort | todo | — |
| V3-SEC-44 | QRコードは公開用(標本・展示向け・暗号化なし・誰でも読み取り可)と観測/管理用… | best-effort | todo | — |
| V3-SEC-47 | 価値操作をサーバー側で強制する: コイン増減はサーバー(role=system)… | best-effort | todo | — |
| V3-SEC-48 | ストレージから読み込んだデータ・APIで受け取ったJSONはKernelに渡す前… | best-effort | todo | — |
| V3-SEC-50 | ユーザーのブランド資産(ロゴ等)を『禁止/保護アセット(A110/protect… | best-effort | todo | — |

### L4-knowledge

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-BBS-01 | 知の広場(/knowledge)を掲示板改称の統合ハブとし、3柱構成(1.公式掲… | required | todo | — |
| V3-BBS-03 | 全ファイル・全コンポーネント・全画面テンプレートに『説明掲示板(使い方)・愚痴掲… | required | in_progress | e61f50b, 0bf56a8, 640fa3b |
| V3-BBS-05 | 掲示板スレ・投稿は上書き・削除せず、訂正は追記セクションで行う(INSERT O… | required | done | e61f50b, 0bf56a8 |
| V3-BBS-09 | 掲示板の投稿者名は入力欄を廃止し、初回登録時に確定した固定ユーザーネーム({{c… | required | todo | — |
| V3-BBS-10 | スレッドは一定量(100投稿ごと)でAIが要約・タグ付け・RAG向け整形を行い、… | required | todo | — |
| V3-BBS-14 | 掲示板への改善要求はvoteable(積み投票/プラチナコイン)方式で扱い、AI… | required | done | 814c648 |
| V3-BBS-20 | 全エンティティ(観測個体・スレ・投稿・ユーザー・タグ・論文・マーケット出品等)を… | required | todo | — |
| V3-BBS-28 | 公開Q&A・称賛・未出品オファー・ラブレター一括募集などのEngagement(… | required | done | d005f3a |
| V3-BBS-29 | フォーク前提の文明とし、改善案(フォーク)は既存コンポーネントから必ず自動でブラ… | required | todo | — |
| V3-BBS-36 | 知の広場の設計目標は「意見交換と化学反応(異視点の衝突・合意形成・セレンディピテ… | required | todo | — |
| V3-BBS-37 | 任意の画面/機能/正本ファイルから、関連する議論スレ・intentチェーン(in… | required | todo | — |
| V3-BBS-38 | GitHub統合は画面遷移(外部リンク)ではなくAPI連携を原則とする。知の広場… | required | todo | — |
| V3-PPR-01 | 論文照合(Paper Match)機能: 論文が要求する条件P(JSON)とユー… | required | done | 0bf56a8 |
| V3-PPR-02 | 論文の条件P(P⇒Qの前提)のJSON Schemaを単一正本としてファイル化し… | required | done | 2678d20 |
| V3-PPR-03 | 論文をPaperSectionsV1の6節(目的/仮説/条件/検証/現在のフェー… | required | in_progress | 0bf56a8 |
| V3-PPR-04 | 論文を『進行中(in_progress)を一級市民』として扱い、下書き概念を使わ… | required | todo | — |
| V3-PPR-06 | 論文全文(sections+conditions+tags)をembedding… | required | done | 33b8a6d |
| V3-PPR-07 | 研究の空白領域を、観測データの4象限モデル(P∧Q=n11/P∧¬Q=n10/¬… | required | done | 41600e4 |
| V3-PPR-09 | 全派生成果物にrun_id・model_name/version・input_h… | required | done | e61f50b, 9eeea25, 33b8a6d |
| V3-PPR-12 | 解析は端末CPU/GPUをフル活用した完全ローカル計算(マルチスレッド/SIMD… | required | done | f2ac74c |
| V3-PPR-13 | 科学OSの世界接続層(3要素: Wikidata正規ID・使用時発行の内部Ind… | required | done | 33b8a6d, 52cef86 |
| V3-PPR-14 | 論文をLiving Paper(動的論文)として構造化データ(JSON)で管理し… | required | todo | — |
| V3-PPR-16 | 研究プロジェクトをprojectId中心(研究の最小単位=背骨)に、プロフィール… | required | done | 33b8a6d |
| V3-PPR-17 | 研究テーマ(温度・容器サイズ・湿度・振動等がヘラクレス成長に与える影響)を洗い出… | required | done | 33b8a6d |
| V3-PPR-18 | 追検証は『データ提供のみ』で完了できるようにし、グラフへの自動追加・相関係数の自… | required | done | 33b8a6d |
| V3-PPR-20 | 論文の観察項目・測定単位・条件・写真動画・修正履歴を統一データフォーマットとして… | required | done | ffa8eb1 |
| V3-PPR-23 | 論文管理を章構成+引用管理(observation/paper/url/book… | required | done | c4af847 |
| V3-PPR-30 | 研究者でない一般ユーザーが論文級の成果物を簡単に作れる仕組みを提供する: Dat… | required | done | 33b8a6d |
| V3-WIK-01 | エージェント維持型の永続Wiki(サブブレイン)を情報源(掲示板/論文/観測)の… | required | done | 33b8a6d |
| V3-WIK-02 | 知識バンドルはOKF v0.1規約(type frontmatter必須/ind… | required | todo | — |
| V3-WIK-03 | 検索は決定論の梯子(キーワード抽出→index.mdスコアリングでファイルを開か… | required | done | de5376e |
| V3-WIK-04 | 決定論ingest CLI(tools/knowledge_ingest.py)… | required | done | b902af9 |
| V3-WIK-05 | ページを作成・改名したら同じ変更でindex.mdに1行を追加・修正し、inde… | required | todo | — |
| V3-WIK-06 | 各TopicページはTruthイベント・設計doc・辞書への引用をCitatio… | required | todo | — |
| V3-WIK-07 | 月次Lint(矛盾・孤立ページ・古い記述・リンク切れ)を実行しlog.mdに記録… | required | done | 7c2049a |
| V3-WIK-09 | 安定・高信頼な知識のみwiki層に蒸留し、高頻度更新・大量データ(生の時系列画像… | required | todo | — |
| V3-WIK-13 | 統合検索を全文/タグ/ユーザー/ノードの4本柱で提供し、投稿(ノード)作成時にR… | required | done | 0bf56a8 |
| V3-WIK-14 | 検索用タグを3層(system_tags=UI自動付与・編集不可/ai_tags… | required | todo | — |
| V3-WIK-16 | 記事・ブログ機能を論文(#09)とほぼ同じ共通CMS基盤で提供する。記事とブログ… | required | done | 33b8a6d |
| V3-WIK-17 | 会話ログ・AIチャット・観測データ・行動履歴を『共有』ボタン1タップ(PWA共有… | required | done | 33b8a6d |
| V3-WIK-20 | 設計書・コード・掲示板・修整理由・世界観・動画/記事メタ・フォーク系統・種(血統… | required | done | 783b38f |
| V3-WIK-22 | 知識の属人化を完全に消し(『本人しか知らない』が存在しない)、誰でも短時間で『わ… | required | todo | — |
| V3-WIK-28 | Cursor等のAIセッションを全て閲覧できるようにし、サブ脳として情報を整理・… | required | done | 36fa042 |
| V3-WIK-29 | 論文/研究のためにanthropics/life-sciences等の外部知識(… | required | done | bc4f513 |
| V3-WIK-30 | 仕様書のルール(例: 掲示板作成+5Pt)をJSONで全公開し、誰でも文明の『法… | required | todo | — |
| V3-BBS-02 | 製品掲示板の主入口を『愚痴・改善・論文・その他』の4つのみに限定し、独立Rese… | best-effort | todo | — |
| V3-BBS-04 | 全画面分の掲示板スレッド(公式説明スレ+愚痴スレ、125画面×2=250スレ)を… | best-effort | todo | — |
| V3-BBS-06 | 掲示板の紛争解決は『通報』ではなく『指摘』ボタンとし、指摘タグ選択と理由記入を必… | best-effort | todo | — |
| V3-BBS-08 | 指摘への合意が得られた場合、被指摘者が修正表現を提案し指摘者が了承すると元発言の… | best-effort | todo | — |
| V3-BBS-11 | 掲示板は自然言語検索で先に既存の適合掲示板へ誘導・提案し(複数候補)、結果が十分… | best-effort | todo | — |
| V3-BBS-12 | 掲示板作成はAIがタイトル・タグ・説明・目的のたたき台を自動記入し、ユーザーがク… | best-effort | todo | — |
| V3-BBS-15 | 通報システムは導入せず、法律に反する言動があれば即BAN、それ以外はコミュニティ… | best-effort | todo | — |
| V3-BBS-16 | 開発掲示板はOS/システムのフォルダ構造・ファイル構成と同じ階層・同粒度で用意し… | best-effort | todo | — |
| V3-BBS-18 | 文明のあらゆる行動(カルマ変動・プラチナ付与・貢献度・称号・レビュー・取引・DM… | best-effort | todo | — |
| V3-BBS-19 | DM/メッセージ機能をスレッド一覧+バブル表示で提供しR2(dm/{thread… | best-effort | todo | — |
| V3-BBS-21 | 掲示板/コミュニティを『掲示板』ではなく『コミュニティの記憶・知識史システム』と… | best-effort | todo | — |
| V3-BBS-25 | 掲示板(BBS)はフルDiscourse実装ではなくスレッド/投稿をJSONLイ… | best-effort | todo | — |
| V3-BBS-26 | GitHub掲示板柱は自前掲示板UIを作り込まず、GitHub Discussi… | best-effort | todo | — |
| V3-BBS-32 | 思想・構造・哲学を公知化する技術宣言書(Technical Manifesto)… | best-effort | todo | — |
| V3-BBS-33 | 掲示板統計(投稿数推移・アクティブユーザー・文化スコア・時間帯ヒートマップ・タグ… | best-effort | todo | — |
| V3-PPR-05 | AI査読パイプラインの段階1〜5(構造・欠損・再現性・整合性・統計)を決定論コー… | best-effort | todo | — |
| V3-PPR-08 | 引用(Citation)を独立エンティティとして扱い、掲示板↔論文↔観測↔論文↔… | best-effort | todo | — |
| V3-PPR-10 | 解析エンジンをセマンティックバージョニングで凍結(Major=論文単位で固定/M… | best-effort | todo | — |
| V3-PPR-11 | R2上の画像・解析データを研究目的でAPI経由取得可能(CC0推奨・利用制限なし… | best-effort | todo | — |
| V3-PPR-15 | 論文/仮説の信頼度を、データ量補正f_data=1-e^(-k・n)、一貫性補正… | best-effort | todo | — |
| V3-PPR-19 | 既存の論文商業モデル(有料・閲覧制限・取り寄せ)への不満から、情報は無料で共有さ… | best-effort | todo | — |
| V3-PPR-21 | 個体データ蓄積の研究枠を事業内に恒常的に確保し、毎年温度・マット配合・容器サイズ… | best-effort | todo | — |
| V3-PPR-24 | 研究コミュニティをSNS/掲示板/Wikiではなく、個体(Individual)… | best-effort | todo | — |
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
| V3-IND-01 | 観測セッションを親個体(individual)に紐づけ父(sire)・母(dam… | required | todo | — |
| V3-IND-02 | individual masterの保存先をIHL R2のindividualテ… | required | done | e61f50b |
| V3-IND-04 | 個体名のリネーム/改名・昇格・テンプレ更新はUPDATEせずname_event… | required | done | e61f50b |
| V3-IND-07 | マチアプ(個体マッチング/ValueCheck)は画像に対するYES/NO(緑/… | required | todo | — |
| V3-IND-08 | マチアプの数式エンジンは計算量O(nタグ数)・GPU不要・深層学習/ブラックボッ… | required | done | 145d78d |
| V3-IND-12 | 血統(Cross)画面は非常に重要な機能として、齢別平均体重(初令/二令/三令初… | required | done | e61f50b, 3f941f2 |
| V3-IND-13 | 個体詳細(A2)を「個体のホーム画面」とし、観測(最新観測・履歴・成長曲線グラフ… | required | done | e61f50b, d49dcd9, 3d89c63, 57cc941 |
| V3-IND-15 | 生体カード(種・形態・サイズ・特徴・QRコード)を生成し、印刷用テンプレートをf… | required | in_progress | e61f50b |
| V3-IND-18 | 血統(個体)機能にランキング・トップ10・最高サイズ等の競争煽り要素は一切作らず… | required | todo | — |
| V3-IND-19 | 種(species)と形態(morph/Form)のCRUD管理をR2(spec… | required | todo | — |
| V3-IND-20 | スケジュール(飼育タスク)ノードを個体・観測テンプレに紐付け、AIが種族・成長ス… | required | in_progress | 57cc941 |
| V3-IND-21 | 個体・血統情報の登録数と実在数を照合できる透明性プラットフォームを作り水増… | required | done | e61f50b, 8b05247, 57cc941 |
| V3-IND-30 | 研究用の個体ID・観測IDは「生体情報ではなく研究ID」として個人情報と切り分け… | required | todo | — |
| V3-IND-34 | 血統管理は複数系統(A:体格重視、C:色重視等)を並行してインライン累代させ、理… | required | in_progress | 3f941f2, 57cc941 |
| V3-IND-35 | 割り出し前に、親個体(♂/♀)・希望単価・希望匹数を指定して事前予約できる予約シ… | required | done | b5fd006 |
| V3-IND-36 | 割り出し前の幼虫は個体識別せず匿名count層(プール数のみ)で扱い、sampl… | required | done | 65d7a00 |
| V3-OBS-01 | 観測は昆虫専用ではなく、対象を生物/器物/デジタル/環境/カスタムの5ドメインに… | required | todo | — |
| V3-OBS-02 | 観測対象ナビゲータはテキストのみ(画像・サムネイル非表示)で、学名検索・アキネー… | required | done | ee79efd |
| V3-OBS-03 | 種の同定候補はAI/GBIF/Wikidataが提示してよいが、種・亜種・個体ラ… | required | todo | — |
| V3-OBS-04 | TaxonomyCandidateとUserConfirmedTaxonomyを… | required | todo | — |
| V3-OBS-05 | 観測はappend-onlyとし編集UIを禁止、修正は新規追記(APPEND)で… | required | todo | — |
| V3-OBS-06 | 全ての計測・特徴値にvalue_origin(direct_observed/i… | required | done | e61f50b |
| V3-OBS-07 | 観測の信頼度モデルを設け、自動取得>手入力>後日編集の順で信頼度を明示スコア化し… | required | done | e61f50b, aa9dee3 |
| V3-OBS-08 | 観測パイプラインはITO構造(IN:写真・env・metadata → Tran… | required | done | e61f50b, 35e555e |
| V3-OBS-09 | 画像埋め込みはEmbeddingBackend Protocolで一本化し、本番… | required | done | e61f50b, 35e555e |
| V3-OBS-10 | 類似検索は決定論優先の梯子(metadata whitelist絞り込み→siz… | required | todo | — |
| V3-OBS-11 | 類似検索の最終rerankスコアはembedding+color+size+li… | required | done | e61f50b |
| V3-OBS-14 | 撮影特徴量は部位別平均L*a*b*(頭部/胸角/前胸/上翅)+分散+色ヒストグラ… | required | done | 426c2ca |
| V3-OBS-15 | 環境データは生値(温度・湿度・light_level)のみ保存し、露点・飽差・絶… | required | todo | — |
| V3-OBS-16 | 環境点はBモデルでenvironment_snapshotとphoto_cond… | required | todo | — |
| V3-OBS-17 | 観測commit時にデバイス(devices[])を宣言するとDeviceBin… | required | done | ce81dd5 |
| V3-OBS-18 | 計測テンプレートはユーザーが完全自由に項目(数値/テキスト/選択/画像アノテーシ… | required | todo | — |
| V3-OBS-19 | 種族+発育段階を1度決めて観測画面に引き継ぐWorkflowContext(観測… | required | done | f728a06 |
| V3-OBS-20 | 個体ID・棚・場所からQRコードを発行/スキャンし、スキャンで該当個体の新規観測… | required | done | 890f079 |
| V3-OBS-21 | 観測入力時に次回観測日(next_observation_at)を決め、テンプレ… | required | todo | — |
| V3-OBS-22 | MVP v1観測コアスコープを「観測データ収集・写真登録・詳細ビュー・親個体連携… | required | done | — |
| V3-OBS-23 | 観測セッションに写真を1枚以上アップロードしてR2に保存し、thumbnailは… | required | done | e3d5aa5 |
| V3-OBS-24 | 観測詳細ビューは高忠実度モック準拠で、大型写真・構造化撮影条件・由来タグ付き測定… | required | done | f728a06 |
| V3-OBS-25 | 観測登録は3画面フロー(対象を選ぶ→入力→確認)とし、入力画面単体での即時保存(… | required | done | — |
| V3-OBS-26 | 観測計測入力の1行UIは(項目)ドロップダウン選択or新規追加/数値入力/(単位… | required | done | f728a06 |
| V3-OBS-27 | 測定行・撮影条件行・環境スナップショット行を単一のStructuredRowコン… | required | done | f728a06 |
| V3-OBS-28 | SwitchBot等IoT環境センサー(温度/湿度/CO2/照度/ジャイロ/pH… | required | todo | — |
| V3-OBS-29 | SwitchBot等IoTの秘密鍵(TOKEN/SECRET)をIHLサーバ/V… | required | todo | — |
| V3-OBS-31 | 計測機器(Device)は環境(placement)に紐づけ個体には紐づけない。… | required | todo | — |
| V3-OBS-43 | 観測を文明OSの中心Input(全機能の一次データ/機能の中心)と位置づけ、固体… | required | done | — |
| V3-OBS-44 | 観測input取得はDocker拡張側に寄せ、文明OS本体はC-USB Lite… | required | todo | — |
| V3-OBS-45 | スケール紙/計測台を標準化(A4方眼19×26cm+四隅マーカー10mm角+QR… | required | in_progress | 2dcf396 |
| V3-OBS-46 | LabelMe相当の画像アノテーション(点/線/ポリゴン/ラベル)を統合し、観測… | required | in_progress | e61f50b |
| V3-OBS-47 | 写真を撮った瞬間に大きさ・角の長さ・色などをローカル解析(HSV/Lab色空間・… | required | in_progress | e61f50b |
| V3-OBS-48 | 観測詳細画面に「この観測を再解析する」ボタンを1つ置き、新しい画像なしで既存画像… | required | done | e61f50b |
| V3-OBS-52 | 写真・音声・センサー生データ等のRawData/元画像はRDBに入れずR2/S3… | required | todo | — |
| V3-OBS-53 | 写真1枚からmm単位精度で色・光度・湿度・温度を取得・記録できる観測システムと設… | required | in_progress | 2dcf396 |
| V3-OBS-54 | 観測データは改ざん不可・透明・再現可能とし、捏造・他者観測の盗用・AI偽造を禁止… | required | todo | — |
| V3-OBS-56 | searchable_capture_setを検索中核Parquetとし、cap… | required | done | 2dc42f8 |
| V3-OBS-57 | 写真解析で個体観測画像から種候補・形態特徴・タグ・taxonomyを導く。種候補… | required | done | b7078e5 |
| V3-OBS-61 | 観測入力を自然言語のフリーテキスト欄1つ+「解析する」ボタンで受け付け、日付・個… | required | done | 4ab0135 |
| V3-OBS-62 | 観測フローを固定順で定義する: userId/auth→種族確定(taxonom… | required | in_progress | — |
| V3-OBS-63 | タグは真実でなく解釈のため固定列の現在値でなくappend-onlyなtag e… | required | todo | — |
| V3-OBS-72 | 研究室環境コンテキストの紐付け: 部屋・棚の配置、エアコン等の空調環境、センサー… | required | done | 23a4064 |
| V3-OBS-73 | データエクスポート二層+要件CRフロー: ユーザーデータを二層(事実CSV/画像… | required | done | 65d7a00, cc21229 |
| V3-IND-03 | 観測登録時に個体をindividual_id+display_nameで扱い、ユ… | best-effort | todo | — |
| V3-IND-05 | 血統(親子)表示で最良個体のみ次世代シリーズ名(例「玉」→「王」)へ昇格させる仕… | best-effort | todo | — |
| V3-IND-06 | 親表示はハイブリッド(Q7 C): truthはADR-H-11のparent_… | best-effort | todo | — |
| V3-IND-09 | マチアプに、価値観の精度を上げるPairwise比較画面(記載済み②)の前段とし… | best-effort | todo | — |
| V3-IND-11 | 色などの見た目を画像解析しユーザーの好みを統計学習して「理想個体に近づくにはどの… | best-effort | todo | — |
| V3-IND-14 | 個体一覧(A1)はキーワード・種族・形態・状態(生体/蛹/幼虫/死亡/標本)・テ… | best-effort | done | 65d7a00 |
| V3-IND-16 | 生体の一生をイベントログ(bio.created/moved/scheduled… | best-effort | todo | — |
| V3-IND-17 | 個体観測データは死亡・失敗も正式ステータス(alive/dead/failed、… | best-effort | todo | — |
| V3-IND-23 | 研究プロジェクト(projectId/P100)を中心に論文・個体・マット・製造… | best-effort | todo | — |
| V3-IND-26 | 成体の成長を追う4D Viewerは3D(体重X/体長Y/成長速度Z)+時間(s… | best-effort | todo | — |
| V3-IND-28 | 個体にlocation_history(場所×期間)を持たせ、Workerが期間… | best-effort | todo | — |
| V3-IND-29 | 棚の揺れイベント(ジャイロ閾値超過)を検出し、その時棚にいた個体に自動で紐づけて… | best-effort | todo | — |
| V3-IND-31 | ヘラクレスオオカブトの成長研究を環境・容器/空間・栄養・遺伝・成長プロセス・外乱… | best-effort | todo | — |
| V3-OBS-12 | ヘラクレス標準撮影チャンバー(40×40cm級マットグレー箱・CRI/Ra95以… | best-effort | todo | — |
| V3-OBS-13 | 甲虫色彩計測標準規格BPCMS v1.0を凍結制定する。ただし観測の生画像は無補… | best-effort | todo | — |
| V3-OBS-30 | デバイスのデータ取得間隔をデフォルト/一括上書き/複数選択/個別デバイスの4階層… | best-effort | todo | — |
| V3-OBS-33 | 環境観測は2層とし、Tier A(ガバナンスイベント)はINSERT ONLYを… | best-effort | todo | — |
| V3-OBS-34 | 占有(Occupancy)参照モデルとして個体・観測対象ごとに環境ファイルを増殖… | best-effort | todo | — |
| V3-OBS-38 | 画像表示のパフォーマンス・コストを段階的に最適化する。まず低コスト改善(サムネイ… | best-effort | todo | — |
| V3-OBS-40 | 観測登録APIはフロントの偽sessionId生成でなく、バックエンドが実際のs… | best-effort | todo | — |
| V3-OBS-42 | 検索/好み学習を連携する。好み学習(pairwise投票)で得た数値prefer… | best-effort | todo | — |
| V3-OBS-50 | 観測データ構造をSpecies(種)→Form(形態)→Individual(個… | best-effort | todo | — |
| V3-OBS-51 | 観測データを1次〜4次変換で再利用する層構造(0次=そのまま/1次=構造化・マー… | best-effort | todo | — |
| V3-OBS-55 | 観測データの物理基盤として、生活空間と分離した非居室の研究室(第三種24h換気・… | best-effort | todo | — |
| V3-OBS-58 | QC builderがblur/exposure/scale/backgroun… | best-effort | todo | — |
| V3-OBS-64 | 外部API/センサーを domain=datasource のDataSourc… | best-effort | todo | — |
| V3-OBS-65 | 取り込みは自分自身のもの・自分で証明できるデータに限定する。生体登録の親画像も本… | best-effort | todo | — |
| V3-OBS-66 | 変化の理由を残す観測ログレイヤー(logs/{timestamp}.json: … | best-effort | todo | — |
| V3-OBS-67 | 観測はライトユーザーが撮影だけで完結でき、研究者は観測項目を自由に追加できる二層… | best-effort | todo | — |
| V3-OBS-69 | 観測データを自動で統計化(成長率・生存率・湿度/温度相関・Ver別/ロット別比較… | best-effort | todo | — |
| V3-OBS-70 | Docker 中間層(C-USB 観測拡張)を介した外部ゲーム等からの観測データ… | best-effort | todo | — |
| V3-OBS-71 | 観測データ印刷: 個体詳細から、欲しいデータ項目(チェックボックス)と期間指定で… | best-effort | todo | — |

### L5-video

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-VID-01 | 台本→画像→字幕→音声→合成→サムネ/メタまでの生成パイプライン(F10〜F80… | best-effort | todo | — |
| V3-VID-02 | 動画自動生成を台本→音声→画像→合成の順にステップ分割し、各分割点でオーナー(人… | best-effort | todo | — |
| V3-VID-03 | 画像アセットは再利用優先: 台本生成時に既存画像をベクトル検索(CLIP emb… | best-effort | todo | — |
| V3-VID-07 | 完成後、システムの思想・開発苦労・既存の不透明性への不満などをネタに短尺動画を毎… | best-effort | todo | — |
| V3-VID-08 | 動画を全プラットフォーム(YouTube/TikTok/Reels/X/FB/L… | best-effort | todo | — |
| V3-VID-09 | 動画末尾はまとめ/振り返りで締める。チャンネル登録・高評価に加え、行動の「お願い… | best-effort | todo | — |
| V3-VID-11 | Twinの『AIに自然な会話をさせる自動対話方式』は難があり廃止/アーカイブする… | best-effort | todo | — |
| V3-VID-12 | ヘラクレス標準撮影チャンバーで全国参加者がスマホで同一品質画像を取得(同一照明/… | best-effort | todo | — |
| V3-VID-13 | シリーズ管理: 新規/追加シリーズを扱い、長すぎる台本は自動エピソード分割、一定… | best-effort | todo | — |
| V3-VID-15 | 動画・記事などAI生成コンテンツの評価軸は再生数などの数字を参考値に留め、作者(… | best-effort | todo | — |
| V3-VID-16 | 全プラットフォームの動画メトリクス(再生数/視聴維持率/クリック率等)をVide… | best-effort | todo | — |
| V3-VID-17 | 記事/UI/スレッドから動画台本を自動生成して動画化し、元の記事に自動で埋め込む… | best-effort | todo | — |
| V3-VID-18 | 動画生成をn8nワークフローで自動化(video_pipeline/voice_… | best-effort | todo | — |
| V3-VID-19 | 認証済みシステムのURLや会話ログ(この対話ログ含む)を取り込み、ローカルLLM… | best-effort | todo | — |
| V3-VID-23 | 学習コスト最小化のため各仕様をショート動画/まとめ動画/文章版/英語版/翻訳版/… | best-effort | todo | — |
| V3-VID-27 | 動画・画像・台本などの生成処理はすべて小さな関数単位(1枚/1段落/1カット)に… | best-effort | todo | — |
| V3-VID-28 | 動画台本エンジン: 構造化台本(Hook最初3秒/本題/例/まとめ)を過去成功例… | best-effort | todo | — |
| V3-VID-29 | 動画制作は内容ファーストを制約とする: 投資順位は 台本・構成 > 音声/字幕 … | best-effort | todo | — |
| V3-VID-31 | 台本・構成の標準規約: ①冒頭で「何が必要か」「得られるメリット」を明確に提示 … | best-effort | todo | — |
| V3-VID-32 | 視聴者への要求(CTA)全面禁止: いいね・チャンネル登録・通知ON・シェア等を… | best-effort | todo | — |
| V3-VID-ROUTE-A | 動画の公開URLは固定・永続(R2 latest.json / routing … | best-effort | todo | — |
| V3-VID-ROUTE-B | 画面ごとに使い方マニュアル動画URLを紐付ける動画ルーティング機能。紐付けがあれ… | best-effort | todo | — |
| V3-VID-ROUTE-C | VideoRoutingRuleで動画の目的(recruit/explain等)… | best-effort | todo | — |
| V3-VID-STORE | 動画本体はR2/システムに保存せず外部(YouTube/TikTok/X)に置き… | best-effort | todo | — |

### L6-ui

| id | title | scope | status | commits |
|---|---|---|---|---|
| V3-UIX-01 | ユーザー向けUIに「未実装」「WIP(未完)」等の未完表示を出さない。機能未提供… | required | todo | — |
| V3-UIX-02 | 主要導線(観測開始→保存、抽選応募、取引、GMO振込等)を機械計測で3クリック以… | required | todo | — |
| V3-UIX-03 | 空状態・ローディング・エラー・権限なし・409競合理由の表示を全経路(各画面/各… | required | todo | — |
| V3-UIX-04 | 色は意味のみに用いる(緑=成功/生存、赤=失敗、青=情報、黄=注意)。装飾的な多… | required | done | 72eccff |
| V3-UIX-05 | 認知負荷を下げるUI憲法:1画面1目的、主情報は3〜5チャンク、セクション最大3… | required | todo | — |
| V3-UIX-06 | 各画面の主要CTA(Primary CTA/主ボタン)を1つに限定する。 | required | todo | — |
| V3-UIX-08 | UIビルダーの責務を配置(layout)とデザイン(visual)と既存機能の紐… | required | todo | — |
| V3-UIX-14 | スタイル(色/角丸/影/アニメーション/レイアウト/余白/タイポグラフィ)自体を… | required | todo | — |
| V3-UIX-16 | デザインの正本をThemePack(--civ-*トークン/design_tok… | required | todo | — |
| V3-UIX-17 | UIをコードでなくデータ(ScreenDef/JSON)として宣言的に定義し、単… | required | todo | — |
| V3-UIX-18 | ScreenDef JSON(screen-defs/*.json)を画面定義の… | required | todo | — |
| V3-UIX-21 | ユーザーの好み・価値観を離散信号として記録し検索rerankに反映するマチアプ機… | required | in_progress | 25dbfe5 |
| V3-UIX-24 | stub段階のMatchApp/画面は『サンプルデータ』と分かる表示にし本番デー… | required | done | a5c8c86 |
| V3-UIX-25 | ホーム画面を認証後に着地するWorldレイヤーの司令塔とし、今日の状態(現在地カ… | required | done | 3f5012a |
| V3-UIX-26 | ホームの文明ミニマップは非PII集計(観測ペース/信頼度平均/テンプレ文化成長の… | required | done | 3f5012a |
| V3-UIX-27 | 次回観測upcoming/overdueをホームのtoday_linesへ最大3… | required | done | 3f5012a |
| V3-UIX-28 | 全画面共通のブランドクロムを採用する:ヘッダーに観測対象ナビゲータ・マイページ・… | required | done | 3f5012a |
| V3-UIX-32 | UIはOSSベース(Next.js 15 + shadcn/ui、掲示板は5ch… | required | done | 0499a80 |
| V3-UIX-37 | UIは統一と使い回しを徹底する(UIビルダーを念頭に共通部品を再利用、独自の作り… | required | todo | — |
| V3-UIX-43 | 設定機能を/me/settingsに集約し、AI接続(OpenAI互換BYOK)… | required | done | 25abe42 |
| V3-UIX-45 | 一般ユーザーが自分に合わせてUI/OSテンプレートを選び・差し替え・編集・フォー… | required | todo | — |
| V3-UIX-50 | 観測入力の操作フローを観測対象選択画面・テンプレート入力画面・条件リクエスト画面… | required | done | 269fe93 |
| V3-UIX-68 | マイページはシンプルにし、透明性の文化としてその人の作品を相手のマイページで全て… | required | in_progress | 4af2f0e |
| V3-UIX-76 | 万人共通の最適UIは存在しない(色弱・欠損・デバイス差・時代変化)前提で、誰が編… | required | todo | — |
| V3-UIX-80 | 取引前PII設定(局留め受取・配送先・銀行振込口座)が未完の場合、取引フロー内で… | required | done | efac100 |
| V3-UIX-81 | ScreenDef Renderer の共通層で WCAG 2.2 AA 相当の… | required | done | f565128 |
| V3-UIX-82 | 検索グラフビュー+ホバー簡易カード: 近さ(画像類似/形質/血縁)のエンティティ… | required | in_progress | a45ae3e |
| V3-UIX-83 | 個体ファインダー(IND内探索モード): 一覧・絞り込み(決定論sort=体長/… | required | todo | — |
| V3-UIX-84 | プロフィール等の画面に、カルマ・貢献度・取引評価を合成した派生スコア(例:『信頼… | required | todo | — |
| V3-UIX-09 | UIビルダーはWeb版を簡易版(forkテンプレ/ボタン宣言的操作)、Docke… | best-effort | todo | — |
| V3-UIX-10 | 任意の編集可能画面から『この画面を編集』でUIビルダーを開き、現在の画面を対象に… | best-effort | todo | — |
| V3-UIX-11 | UIビルダーのパネル(Canvas/LayerPanel/Inspector/T… | best-effort | todo | — |
| V3-UIX-12 | 各機能コンポーネントに『編集』ボタンを付け、C-USB経由で改善案(フォーク)一… | best-effort | todo | — |
| V3-UIX-19 | UI(画面)はロジック(transform)を一切持たず、C-USBのoutpu… | best-effort | todo | — |
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
| V3-UIX-53 | 掲示板は社交・議論・愚痴・改善の独立エントリ(/board)としコンテンツ発見経… | best-effort | todo | — |
| V3-UIX-55 | UIのビジュアルトークンを黒基調ダーク(#0D0D0D/#1A1A1A)・角丸1… | best-effort | todo | — |
| V3-UIX-58 | 対話・生成物・進化ログ・仕様変更・系譜・世界データ変化を2D空間マップ(ノード+… | best-effort | todo | — |
| V3-UIX-59 | 各画面にpage_info要約パネル(目的/哲学/AI要約/使い方/FAQ/改善… | best-effort | todo | — |
| V3-UIX-61 | ユーザーが自然言語で画面名・目的を言うだけでUIガイドライン準拠のUI JSON… | best-effort | todo | — |
| V3-UIX-67 | Builderを技術ではなくユーザーの『めんどくささ』で4レイヤー(L3 OS/… | best-effort | todo | — |
| V3-UIX-71 | ログイン/マイページ/マーケット/ダッシュボード等の初期テンプレート(ワイヤーフ… | best-effort | todo | — |
| V3-UIX-75 | UIは知識が無くても小学生でもぱっと見で使えるよう機能を詰め込みすぎずシンプル・… | best-effort | todo | — |
| V3-UIX-78 | 価値観テンプレート(タグセット、ユーザーが追加/削除/変更/フォーク可能)で各項… | best-effort | todo | — |
| V3-UIX-79 | pairwise好み入力は既定Nラウンド(N=10)で収束させ、現在ラウンド/上… | best-effort | todo | — |
