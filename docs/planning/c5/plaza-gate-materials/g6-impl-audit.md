---
id: g6-impl-audit
title: G6 実装監査 — 知の広場/ガバナンス実装 × design-c5 §K6 契約突合
date: "2026-07-11"
status: active
---

# G6 実装監査 — ver3 知の広場/ガバナンス実装の契約適合

> 目的: 人間が「レビューするだけで裁定できる」判定材料。ver3 の実装(`apps/api/src/plaza-routes.ts` /
> `gov-routes.ts` / `plaza-constants.ts` + `schemas/events/plaza-*.json` / `gov-*.json` / `cite-ref.schema.json`
> + `tests/plaza-*.test.ts` / `gov-*.test.ts`)を design-c5.md §K6 契約(行 1005–1189)と 5 観点で突合する。
> 実在確認はすべて Read/Grep で行い file:line を引用。誇張ゼロ — 契約と実装が食い違う点は §差分 に隠さず明記。

## 0. 監査スコープと確定事実

- 対象要件 13 件: V3-BBS-01/03/05/10/20/29/36・V3-GOV-01/09/12/19/23(design-c5.md:1011)。
- 全 route 22 本(slot033–040・design-c5.md:1035–1059)が `plaza-routes.ts` / `gov-routes.ts` に実在(下表)。
- 定数 11 種はすべて `plaza-constants.ts` 単一正本(散在ハードコードなし)。契約 §2.5(design-c5.md:1111–1123)と値一致 —
  `BOARD_KINDS`(:7)・`FORK_RANKS`(:10)・`STANCE_VALUES`(:13)・`CONSENSUS_MIN_VOTES=5`(:16)・
  `CONSENSUS_AGREE_RATIO=0.6`(:19)・`DIVISIVE_MIN_SIDE_RATIO=0.3`(:22)・`SUMMARY_BLOCK_SIZE=100`(:25)・
  `DISPUTE_TTL_DAYS=14`(:29)・`GOV_FLAG_COUNT_STEPS=10`(:32)・`RANKING_WEIGHTS`(:36)・`OS_PROMOTION_MIN_SCORE=100`(:40)。

| slot | route | 実装 file:line |
|---|---|---|
| 033 | POST /plaza/posts | plaza-routes.ts:133 |
| 033 | GET /plaza/channels/:channel/threads | plaza-routes.ts:224 |
| 033 | GET /plaza/threads/:thread_id | plaza-routes.ts:193 |
| 033 | GET /plaza/posts/:post_id | plaza-routes.ts:229 |
| 034 | POST /plaza/stances | plaza-routes.ts:239 |
| 034 | GET /plaza/threads/:thread_id/consensus | plaza-routes.ts:288 |
| 035 | POST /plaza/forks | plaza-routes.ts:299 |
| 035 | GET /plaza/forks | plaza-routes.ts:367 |
| 035 | GET /plaza/forks/:fork_id | plaza-routes.ts:376 |
| 036 | POST /plaza/signals | plaza-routes.ts:386 |
| 036 | GET /plaza/ranking | plaza-routes.ts:473 |
| 036 | POST /plaza/summaries | plaza-routes.ts:484 |
| 036 | GET /plaza/threads/:thread_id/summary | plaza-routes.ts:552 |
| 037 | POST /gov/votes | gov-routes.ts:54 |
| 037 | GET /gov/rules/:rule_id/threshold | gov-routes.ts:104 |
| 037 | GET /gov/os/promotion | gov-routes.ts:131 |
| 038 | POST /gov/disputes | gov-routes.ts:141 |
| 039 | POST /gov/disputes/:dispute_id/messages | gov-routes.ts:204 |
| 040 | POST /gov/disputes/:dispute_id/close | gov-routes.ts:256 |
| 040 | GET /gov/disputes/:dispute_id | gov-routes.ts:296 |
| 040 | GET /gov/precedents | gov-routes.ts:323 |
| 040 | GET /gov/precedents/:precedent_id | gov-routes.ts:329 |
| 040 | POST /gov/flags | gov-routes.ts:340 |

---

## 監査観点 (a) 全 route PROTECTED か — **PASS**

契約(design-c5.md:1007)= 全 route deny-by-default・新 route は PUBLIC_ROUTES 非登録で自動保護。

- **配線**: `plazaRoutes` は index.ts:163、`govRoutes` は index.ts:169 で `app.route("/api/v1", …)` にマウント。
- **gate**: 認証 middleware `app.use("*", …)`(index.ts:66–106)が全 path を先に通す。`PUBLIC_ROUTES`(index.ts:47–63)は
  `/health` + auth 3 route + dev-login + collector/ingest + github/webhook の **7 本のみ**。plaza/gov の path は 1 本も含まれない
  → 未認証は 401(index.ts:105)で route 到達前に遮断。認証成功時のみ `c.set("actorId", …)`(index.ts:81, 99)。
- **書込 actor_id 強制刻印(V3-AUT-17)**: 全 POST handler が body の actor_id を無視し `c.get("actorId")` を刻む
  (plaza-routes.ts:138, 243, 303, 391, 488;gov-routes.ts:58, 147, 209, 261, 351)。spoof 拒否テスト = plaza-posts.test.ts:31–39。
- **回帰ガード**: 各 route ファミリに未認証 401 テストあり — plaza-posts.test.ts:128、plaza-consensus.test.ts:92、
  plaza-fork.test.ts:105、gov-dispute.test.ts:106、gov-vote-threshold.test.ts:125、gov-flag.test.ts:50。
- **契約超過(良い方向)**: `POST /gov/flags` は契約 §2.1(design-c5.md:1061「現状は保護 route=認証済みなら誰でも叩ける状態・
  admin ゲートは K2」)を超えて `requireRole("operator","admin")`(gov-routes.ts:340)を実装済み。非 operator は 403・append ゼロ
  (gov-flag.test.ts:56–72)。批評家指摘 #5(design-c5.md:1188 の griefing ベクトル)は実装側で解消済み。§差分 D1 参照。

**根拠**: index.ts:47–63, 66–106, 163, 169;gov-routes.ts:340;各 401 テスト。

---

## 監査観点 (b) INSERT ONLY 遵守(UPDATE/DELETE 経路の不在)— **PASS**

契約(design-c5.md:1007, 1144)= R2 INSERT ONLY・TruthStore の UPDATE/DELETE メソッド不在(CL-12)。

- **ストレージ層強制**: `TruthStore` は update/delete メソッドを持たない(store.ts:39–41 の明示コメント「NO update/delete
  methods … their absence is itself the append-only contract」)。書込は `writeOnce`(store.ts:48–54)が
  `put(…, { onlyIf: { etagDoesNotMatch: "*" } })` で put-if-absent、既存キーは `res === null` → `{status:"conflict"}` を返す。
- **全 plaza/gov 書込が putEventAt 経由**: 直 `bucket.put` は route に存在せず、すべて `store(c).putEventAt(key, envelope)` を通る
  — plaza-routes.ts:162, 254, 317, 403, 512;gov-routes.ts:72, 161, 222, 249, 282, 365。conflict は各所で 409 にマップ
  (例 plaza-routes.ts:164、gov-routes.ts:74)。
- **論理無効化(GOV-09)**: 不使用フラグは DELETE せず flag event を append + `grantKarmaCountIncrease`(gov-routes.ts:365, 369)。
  「flag object は存在し続ける(DELETE しない)」を実測 = gov-flag.test.ts:33–35。
- **dispute close も append**: close は原 open event を消さず event を追加(gov-routes.ts:282)。close 後も open+close の 2 event が
  残存 = gov-precedent.test.ts:66–68。
- **投影内の mutation は R2 非関与**: `projectThread` が `target.corrections ??= []` を push(plaza-routes.ts:181)するのは
  listEvents で読み込んだメモリ上の投影オブジェクトのみ。R2 への書戻しは無い(投影は都度再計算)。

**根拠**: store.ts:39–54, 74–78;上記 putEventAt 群;gov-flag.test.ts:33–35;gov-precedent.test.ts:66–68。

---

## 監査観点 (c) Polis 投影の決定論性(LLM 呼び出し不在)— **PASS**

契約(design-c5.md:1023, 1086)= Zulip 型 channel+topic・Polis 型 stance→consensus/divisive を純算術で決定論投影・LLM 不要。

- **projectConsensus(plaza-routes.ts:263–284)は純算術**: statement ごとに stance を scan → actor ごと最新 ULID を latest 採用
  (append-only 上書き・:268–271)→ agree/disagree/pass 計数 → 定数閾値で consensus/divisive 判定(:279–280)。
  クラスタリング・乱数・外部呼び出しなし。
- **LLM/fetch/乱数の実在検査**: `plaza-routes.ts` / `gov-routes.ts` を `fetch|openai|anthropic|LLM|Math.random` で Grep した結果、
  ヒットは **すべてコメント上の「LLM 呼び出しゼロ」宣言のみ**(gov-routes.ts:4, 81, 228, 255, 268)。実コードの呼び出しはゼロ。
  要約本文(plaza-routes.ts:503 の `current_summary` 空文字許容)・判例 title/summary(gov-routes.ts:265–269 で人間 closer が供給・
  欠落は 400)・embedding(plaza-routes.ts:36, 539–540 は manifest 参照の空スロット)はすべて「後日バッチ/手動が埋める空スロット」。
- **content_hash は決定論 crypto.subtle**: `sha256Hex`(plaza-routes.ts:109–112)は Web Crypto SHA-256 のみ。
- **決定論の実測**: 同一 stance 集合で projection が同一(plaza-consensus.test.ts:81–89)・閾値分類の算術検証(:63–79)・
  LLM 非依存を明示(:81 の it 名 "LLM-free")。

**根拠**: plaza-routes.ts:263–284, 109–112, 503, 539–540;Grep(plaza/gov-routes.ts の fetch/LLM = コメントのみ);
plaza-consensus.test.ts:63–89。

---

## 監査観点 (d) permalink 不変・tombstone — **PASS**

契約(design-c5.md:1019, 1084)= plaza-post は permalink 不変・cite 欠落は tombstone に積むが cite_ref 自体は消さない(BBS-05)。

- **permalink 不変**: post は不変キー `truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json`(plaza-routes.ts:161)に
  put-if-absent。`GET /plaza/posts/:post_id`(plaza-routes.ts:229–234)は保存済み post をそのまま返す。訂正(correction_of)後も
  原投稿 body は不変 = plaza-posts.test.ts:73–77。同 post_id 二重投稿は 409(:118–125)で上書き不能。
- **correction は追記共存(上書きなし)**: `projectThread`(plaza-routes.ts:179–182)が correction_of を辿り原投稿の
  `corrections[]` に post_id を push。原投稿・訂正投稿の両方が残る = plaza-posts.test.ts:57–71。
- **tombstone は cite_ref を消さない**: `projectThread`(plaza-routes.ts:183–188)が各 cite_ref の target 実在を
  `citeTargetExists`(:116–126)で解決し、欠落なら `tombstones[]` に `{ref, reason:"target_missing"}` を積むが、post 上の
  `cite_refs` は保持。欠落 target で tombstone 記録 + cite_ref 残存を実測 = plaza-posts.test.ts:80–91。
  外部型(observation/paper/user 等)は scan 不能のため未検証で存置(:114–125・honest disclosure)。
- **citeUrl は全 type で安定 URL**: plaza-routes.ts:91–106 に default 分岐あり(空文字を返さない)。判例引用の安定 URL 実測 =
  gov-precedent.test.ts:63–64。

**根拠**: plaza-routes.ts:91–106, 116–126, 161, 179–188, 229–234;plaza-posts.test.ts:57–91, 118–125。

---

## 監査観点 (e) TC の実質性 — **PASS(1 minor 注記)**

契約(design-c5.md:1146–1158)= FakeR2Bucket + AUTH_HEADERS の全スタック実行で要件挙動を検証。

- **フルスタック実行**: 全 TC が `app.request(...)`(index.ts の app)を叩き、認証 middleware → route → TruthStore → FakeR2Bucket の
  実経路を通す。ロジックのモック差替えではなく、観測可能挙動(status code・投影出力・R2 キー有無・dedup・fib 減点)を assert。
  例: dedup による ballot stuffing 不能を R2 直 seed で実測(gov-vote-threshold.test.ts:74–83, 112–122)、
  flag の Δcount+10 と value 減点を projectLedger で実測(gov-flag.test.ts:22–40)。
- **negative 回帰(GOV-13)**: `gov-no-automod.test.ts:17–33` が `apps/api/src` 全 .ts を走査し、auto-moderation route 登録も
  NG ワード配列定数宣言も不在であることを構造パターンで assert(実装物ゼロの守り)。
- **要件カバレッジ**: 11 テストファイルが 13 要件を覆う — plaza-posts(BBS-01/03/05/20/36)・plaza-cite(BBS-20)・
  plaza-consensus(BBS-36)・plaza-fork(BBS-29/GOV-19/23)・plaza-summary(BBS-10)・gov-dispute(GOV-01)・
  gov-precedent(GOV-12)・gov-vote-threshold(GOV-19/23)・gov-flag(GOV-09)・gov-no-automod(GOV-13)・knowledge-screens(BBS-01)。
- **minor(注記)**: `gov-no-automod` は正規表現によるソース走査のため、創造的命名(例 非英語の禁止語配列)を取り逃す上限がある。
  思想(自動モデレーション不採用)の回帰ガードとしては十分だが、完全性は保証しない — ceiling として記録。

**根拠**: gov-vote-threshold.test.ts:74–83, 112–122;gov-flag.test.ts:22–40;gov-no-automod.test.ts:17–33。

---

## 差分(design-c5 §K6 契約 vs ver3 実装 — 隠さず明記)

| # | 契約(design-c5.md) | 実装 | 種別・裁定インパクト |
|---|---|---|---|
| D1 | §2.1(:1061)`POST /gov/flags` は「認証済みなら誰でも叩ける・admin ゲートは K2」・批評家 #5(:1188)で griefing ベクトルと開示 | `requireRole("operator","admin")`(gov-routes.ts:340)を実装・非 operator 403(gov-flag.test.ts:56–72) | **実装が契約を超過(良い方向)**。批評家 #5 の残リスクは解消。GOV-09 の admin-only 意図を満たす。裁定影響なし(むしろ改善)。 |
| D2 | §2.3(:1084)`projectThread(s, channel, thread_id)` = channel 込み prefix scan `truth/…/<channel>/<thread_id>/` | `projectThread(s, threadId)`(plaza-routes.ts:171–175)= 全 post 型を scan して thread_id で filter(channel 引数なし) | **O(n) 全走査の残課題**(下記 R1)。route が channel を持たないための実装選択。挙動は正しいが計算量が契約意図と乖離。 |
| D3 | §2.3(:1094)citeUrl post→`/knowledge/<channel>/t/<thread_id>#<post_id>` | citeUrl post→`/knowledge/board/p/<id>`・thread→`/knowledge/board/t/<id>`(plaza-routes.ts:97–98) | **minor(URL 形状差)**。どちらも決定論・安定 permalink。channel を URL に埋めない差のみ。裁定影響ほぼなし。 |
| D4 | §2.1(:1047)`GET /plaza/ranking(query: channel or target_type)` | `target_type` のみ対応(plaza-routes.ts:473–476)・channel scope なし | **minor(query 削減)**。channel 別ランキングは未実装。target_type 別は動作。将来波で channel 対応可。 |
| D5 | §2.1(:1037–1059)handler 名を `appendPost`/`readPost`/`applyFlag` 等と明記 | route は無名 arrow handler・投影のみ named export(`projectThread` 等) | **cosmetic(命名差)**。route の存在・挙動は契約通り。監査上のトレースは本書 §0 表で解決。 |

> 上記いずれも「未実装を動くと偽った」記述はない。D2/D4 は実装状態の事実として本波で未到達の範囲。

---

## 既知の残課題(批評家 minor・人間裁定材料として明示)

### R1: projectThread 系の全走査 O(n)(D2 と同根)
- **事実**: `POST_TYPE` の全型 prefix scan `listEvents(\`truth/${POST_TYPE}/\`)` が plaza-routes.ts 内に 6 箇所(Grep 実測)—
  `projectThread`(:172)・readPost(:231)・consensus route(:290)・summary POST の block_index 算出(:495)・
  `projectSummary`(:523)・(readPost 相当)。thread/summary/consensus は channel を絞れず、投稿総数 N に対し O(N) の
  scan + 各 get(store.ts:104–112 の list→get ループ)。
- **上限と昇格パス**: MVP 投稿量では許容(TruthStore 自体が「投影 index は C3+」を宣言・store.ts:101–103)。本番投稿量が増えたら
  channel prefix 版 `projectThread(s, channel, thread_id)`(契約 §2.3 の元設計)へ差替え、または R2 prefix を channel 単位に狭める。
- **裁定**: 可逆な性能最適化。機能正しさは PASS。常駐 index 導入は不変条項①(常駐 DB 禁止)との整合を要するため設計裁定対象。

### R2: GOV-23 の TC 帰属(tc_map)の分散
- **事実**: GOV-23(自然淘汰ランキング + OS 昇格 + content_hash 改変検知)の専用テストファイルは存在しない。カバレッジは
  `gov-vote-threshold.test.ts`(os promotion = :86–122・ファイル名は GOV-19)+ `plaza-fork.test.ts`(content_hash 改変検知
  = :91–102・rank 投影)+ `projectRanking` の間接検証に分散。契約 §4(design-c5.md:1155)も os_merge/GOV-23 を GOV-19 の
  ファイルへ相乗り指定している。
- **インパクト**: これは**カバレッジ欠落ではなく帰属(traceability)の問題**。GOV-23 の各機構は実測されているが、要件→TC の
  1:1 対応表では GOV-23 の所在が追いにくい。RTM/tc_map 側で GOV-23 → {gov-vote-threshold, plaza-fork} の相乗りを明記すれば解消。
- **裁定**: ドキュメント上のトレース補正のみ。実装・テストの追加不要。

---

## レビュー結論(裁定サマリ)

| 観点 | 判定 | 一言根拠 |
|---|---|---|
| (a) 全 route PROTECTED | **PASS** | PUBLIC_ROUTES に plaza/gov 不在(index.ts:47–63)+ 全 route 401 テスト。flag は role ゲートで契約超過。 |
| (b) INSERT ONLY | **PASS** | TruthStore に update/delete 不在(store.ts:39–41)・全書込 putEventAt(put-if-absent 409)・DELETE 経路皆無。 |
| (c) Polis 決定論・LLM 不在 | **PASS** | projectConsensus 純算術(plaza-routes.ts:263–284)・fetch/LLM/乱数の実コード呼び出しゼロ(Grep=コメントのみ)。 |
| (d) permalink 不変・tombstone | **PASS** | 不変キー + 409 上書き不能・correction 追記共存・tombstone は cite_ref を残す(plaza-posts.test.ts:57–91)。 |
| (e) TC 実質性 | **PASS** | フルスタック app.request + FakeR2 + 挙動 assert・negative 回帰あり(minor: automod 走査は正規表現上限)。 |

**総合**: 5 観点すべて PASS。契約との差分 5 件はうち 1 件(D1)が実装の契約超過(改善)、残 4 件は minor/cosmetic または本波未到達
範囲の正直な開示で、機能正しさ・不変条項適合を損なわない。残課題 R1(O(n) 全走査)は可逆な性能事項・設計裁定対象、
R2(GOV-23 tc_map)はドキュメントトレース補正のみ。**知の広場/ガバナンス実装は §K6 契約に適合し、人間ゲート(公開の実施)以外の
実装ブロッカーは残っていない。**
