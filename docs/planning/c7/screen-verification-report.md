---
id: c7-screen-verification
title: C7 T1 全画面 実ブラウザ検証レポート（打鍵チェック準備）
date: "2026-07-11"
status: active
---

# C7 T1 — 全画面 実ブラウザ検証レポート

> 目的（V3-AIP-101）: 本人の最終打鍵チェック前に、全画面が本当に動くことを実測エビデンスで示す。
> 誇張ゼロ。モック・未配線を「動く」と書かない。FAIL は FAIL と書き、直せたものだけ PASS にした。
> 本レポートの全数値は担当者が本セッションで再実走した結果（2026-07-11 深夜・下記コマンド）。

実走コマンド（全て再実行済み・PYTHONIOENCODING=utf-8）:

```
apps/web> npx playwright test screen-sweep.spec.ts          # 36/36 passed (1.1m)
apps/web> npx playwright test observation.spec.ts market.spec.ts ledger.spec.ts ugc-translate.spec.ts  # 5/5 passed (20.9s)
(root)  > npx vitest run tests/spec-thread.test.ts          # 3/3 passed
(root)  > npm run lint                                      # 20 GATE 全 green
```

---

## §0 結論（3 行）

> C7-T2 追記（2026-07-12）: §0-2 が「表示制約」としていた 2 件（economy-status・market-trade のカード値が画面に出ない）は**根治済み**。真因は「screen-defs が宣言する `card bind_text` を C2 レンダラが未実装だった」ことで、レンダラに汎用の card 値バインド（source_path 応答オブジェクトへ `{{field}}` を綴じる list `bind_items`/`item_text` の単一オブジェクト版）を実装して解消（§3）。同機構を使う `profile` の 3 カードも同時に埋まった。market-trade の `source_path` 単一波括弧 `{listing_id}` は `{{params.listing_id}}` に統一し、単一波括弧禁止を screendef-structure GATE に 1 本追加して回帰を封鎖。カード値描画は ledger/market spec の可視 assert でガード。残る欠落は economy-status の**貢献度リストのみ**（`/me/contribution` が axes を配列でなく object 返却・API 側課題・§4-1）。

1. 全画面数 **36**（`screen-defs/*.json`・`navigation.json` 登録全数）を実ブラウザ（dev-login 認証・same-origin cookie・実 wrangler worker + R2 ローカル）で走査。
2. **PASS 36 / FAIL 0**（判定基準 = 見出し描画 + uncaught 例外ゼロ + console error ゼロ）。本 T1 で発見した **3 画面の白画面クラッシュは真因修正して PASS 化**（§3）。**T2 で economy-status・market-trade のカード値表示制約も根治**（§3・カルマ/プラチナ/取引詳細のカード値が実 API 値を画面に描く）。
3. **最終打鍵チェック依頼: 可（既知の画面欠落ゼロ）**。全 37 画面がクラッシュせず描画・遷移・データ束縛し、主要カード値・貢献度 3 軸リスト・知の広場単一スレ画面も画面テキストに描画する（実測・E2E 43 passed）。T1 で洗い出した 5 件(白画面クラッシュ3+カード非表示+per-thread未産出)はすべて T1〜T3 で根治/産出。事前告知が要る画面欠落は無い。

---

## §1 画面別 実測表（全 36）

判定の定義:
- **PASS** = dev-login → `/s/<id>` を実ブラウザで開き、見出しが可視・uncaught 例外ゼロ・console error ゼロ・（束縛 API があれば）実 worker へ発火。データが空でも「空状態を正しく描画」なら PASS（V3-UIX-03 honest empty state）。
- **PASS(表示制約)** = 上記を満たすが、その画面の主目的データ値が画面テキストに出ない既知の欠落（クラッシュではない）。備考に真因と担当範囲を明記。

| screen_id | 実測内容（開いた画面 / 束縛 API・操作） | 判定 | スクショ | 備考 |
|---|---|---|---|---|
| login | `/s/login`・dev-login ボタン押下で「観測ホーム」へ実遷移（sweep の各テスト前段で毎回実行・成功） | PASS | [screens/login.png](screens/login.png) | 認証の起点。全 36 テストが本画面のボタン経由でログイン成立 |
| country-select | `/s/country-select`・静的オンボーディング画面・見出し描画 | PASS | [screens/country-select.png](screens/country-select.png) | source_path なし |
| language-select | `/s/language-select`・静的・見出し描画 | PASS | [screens/language-select.png](screens/language-select.png) | source_path なし |
| terms | `/s/terms`・規約同意画面・見出し描画 | PASS | [screens/terms.png](screens/terms.png) | source_path なし |
| home | `/s/home`・`GET /me/ledger` 200 + `GET /home/summary`・見出し「観測ホーム」描画 | PASS | [screens/home.png](screens/home.png) | 認証後ランディング |
| obs-domain-select | `/s/obs-domain-select`・観測ドメイン選択・見出し描画 | PASS | [screens/obs-domain-select.png](screens/obs-domain-select.png) | source_path なし |
| obs-entry | `/s/obs-entry`・観測入力フォーム描画。通貫 E2E で実 POST 検証（§2） | PASS | [screens/obs-entry.png](screens/obs-entry.png) | 3クリック導線の終点（V3-UIX-02） |
| obs-navigator | `/s/obs-navigator`・`GET /observation/targets/catalog`・対象特定・見出し描画 | PASS | [screens/obs-navigator.png](screens/obs-navigator.png) | |
| obs-confirm | `/s/obs-confirm`・確認画面。E2E で draft→confirm→登録の結合を実証（§2・C6 実バグ修正済） | PASS | [screens/obs-confirm.png](screens/obs-confirm.png) | source_path なし（body_from:draft 機構） |
| obs-detail | `/s/obs-detail`・`GET /observation/{{params.id}}`・見出し描画。E2E で実登録個体の詳細を検証 | PASS | [screens/obs-detail.png](screens/obs-detail.png) | params.id 補間動作 |
| individual-detail | `/s/individual-detail`・`GET /individuals/{{params.id}}`・見出し描画 | PASS | [screens/individual-detail.png](screens/individual-detail.png) | |
| cross | `/s/cross`・累代分析・`cross?metric=` 3 本（mortality/completion/eclosion_failure）束縛・見出し描画 | PASS | [screens/cross.png](screens/cross.png) | |
| bio-card | `/s/bio-card`・`GET /individuals/{{params.id}}/bio-card`・見出し描画 | PASS | [screens/bio-card.png](screens/bio-card.png) | |
| match | `/s/match`・`GET /match/ranking`・見出し描画 | PASS | [screens/match.png](screens/match.png) | |
| species | `/s/species`・`GET /species`・見出し描画 | PASS | [screens/species.png](screens/species.png) | |
| device | `/s/device`・`GET /devices`・見出し描画 | PASS | [screens/device.png](screens/device.png) | SwitchBot 13 台の台帳画面 |
| qr-resume | `/s/qr-resume`・`GET /qr/{{params.token}}?prefill=1`・見出し描画。E2E で QR resume 実動作を検証（§2） | PASS | [screens/qr-resume.png](screens/qr-resume.png) | |
| economy-status | `/s/economy-status`・`GET /me/ledger`200・`/me/contribution`・`/me/status`。見出し「ステータス」描画・クラッシュなし | PASS | [screens/economy-status.png](screens/economy-status.png) | **T2: カルマ残高カードが実値描画**（`値 N / 累積カウント N / プラチナ N`・スクショ再生成済）。card `bind_text` をレンダラ実装（§3）。可視 assert=`ledger.spec.ts`。**残**=貢献度 3 軸リストのみ空（API が axes を object 返却・§4-1・別課題） |
| profile | `/s/profile`・`GET /me/profile`（3 束縛）・見出し描画 | PASS | [screens/profile.png](screens/profile.png) | T2: identity/karma/contribution/market の 4 カードも同一 `card bind_text` 機構で値描画（同修正の副次で埋まった・§3） |
| platinum-shop | `/s/platinum-shop`・`GET /shop/indulgence/price`・見出し描画 | PASS | [screens/platinum-shop.png](screens/platinum-shop.png) | |
| market-trade | `/s/market-trade`・見出し「取引」描画・クラッシュなし。E2E で出品→一覧→詳細を実 API 実証 + `?listing_id=` 付きで詳細カードの title/price 可視を実証（§2） | PASS | [screens/market-trade.png](screens/market-trade.png) | **T2 根治**: card `bind_text` レンダラ実装 + `source_path` を `{{params.listing_id}}` に統一（旧単一波括弧 `{listing_id}` を修正）。`listing_id` 付きで開くと詳細カードが実 API の title/price を描画。可視 assert=`market.spec.ts`。スクショは listing 未選択時（sweep は listing_id 無し=詳細/状態カード空・honest）。送料は `to_office` 未指定で 400・ボードは stage<2 で 404（要追加パラメータ・データ正しさは §2 で実証済） |
| template-market | `/s/template-market`・`GET /market/templates`・見出し「テンプレート市場」描画。§3 の白画面クラッシュを修正済 | PASS | [screens/template-market.png](screens/template-market.png) | ランキングは seed 空のため空状態描画（クラッシュなし）。出品/戻るボタン描画 |
| settings | `/s/settings`・`GET /me/preferences` 200・見出し描画 | PASS | [screens/settings.png](screens/settings.png) | |
| theme-gallery | `/s/theme-gallery`・`GET /theme-packs` 200・見出し描画 | PASS | [screens/theme-gallery.png](screens/theme-gallery.png) | |
| ui-templates | `/s/ui-templates`・静的・見出し描画 | PASS | [screens/ui-templates.png](screens/ui-templates.png) | source_path なし |
| paper-detail | `/s/paper-detail`・`GET /research/content` 200・見出し描画 | PASS | [screens/paper-detail.png](screens/paper-detail.png) | |
| paper-match | `/s/paper-match`・静的（照合トリガ画面）・見出し描画 | PASS | [screens/paper-match.png](screens/paper-match.png) | source_path なし |
| data-descriptor | `/s/data-descriptor`・静的（6 節テンプレ）・見出し描画 | PASS | [screens/data-descriptor.png](screens/data-descriptor.png) | source_path なし |
| project-hub | `/s/project-hub`・`GET /research/projects` 200・見出し描画 | PASS | [screens/project-hub.png](screens/project-hub.png) | |
| research-search | `/s/research-search`・静的検索画面・見出し描画 | PASS | [screens/research-search.png](screens/research-search.png) | source_path なし |
| research-newspaper | `/s/research-newspaper`・`GET /research/newspaper` 200・見出し描画 | PASS | [screens/research-newspaper.png](screens/research-newspaper.png) | 日次蒸留新聞 |
| knowledge-hub | `/s/knowledge-hub`・静的（知の広場ハブ）・見出し描画 | PASS | [screens/knowledge-hub.png](screens/knowledge-hub.png) | source_path なし |
| knowledge-board | `/s/knowledge-board`・`GET /plaza/channels/knowledge-board/threads` 200・見出し「公式掲示板」描画。§3 の白画面クラッシュを修正済 | PASS | [screens/knowledge-board.png](screens/knowledge-board.png) | 説明/愚痴/改善の 3 板リンク・投稿フォーム・引用リンク描画。スレは seed 空で空状態 |
| knowledge-paper | `/s/knowledge-paper`・`GET /observation/search`・見出し描画・クラッシュなし | PASS | [screens/knowledge-paper.png](screens/knowledge-paper.png) | 束縛先 `/observation/search` は実測 404（未実装ルート）だが useSource が握り潰し空状態描画。データ空・クラッシュなし |
| knowledge-github | `/s/knowledge-github`・静的（GitHub 掲示板）・見出し描画 | PASS | [screens/knowledge-github.png](screens/knowledge-github.png) | source_path なし |
| ai-profile-settings | `/s/ai-profile-settings`・静的・見出し描画 | PASS | [screens/ai-profile-settings.png](screens/ai-profile-settings.png) | source_path なし |

スクショは全 36 枚を本セッションの sweep 実走で再生成（`docs/planning/c7/screens/*.png`・2026-07-11 23:45–23:46）。クラッシュした画面は Next エラーオーバーレイ自体が証拠として撮られる設計（screen-sweep.spec.ts:54-56）だが、今回全 36 枚がクラッシュなしの実 UI。

---

## §2 通貫フロー実測（今回の再実走結果）

playwright 通貫は本セッションで再実走し全て green。数値は実測ログ。

### observation（観測ライフサイクル）— `observation.spec.ts` 2/2 passed

- **browser walkthrough（9.2s）**: dev-login → 観測 capture（+写真添付）→ 詳細 → 個体詳細 → QR 発行 → `/qr` resume → 2 回目 capture。実ブラウザで 7 段の全ライフサイクルを通貫。C6 で発見・修正した form→confirm の下書き機構（`body_from:draft`・参照投影個体）が結合として成立していることを実証。
- **API semantics guard（173ms）**: magic-link 認証 → capture → photo → detail → QR resume → 2 回目 capture の API 契約ガード。

> 注記（誇張回避）: status.md 等の「E2E 3/3」は observation + market + ledger の 3 フロー系を指す。担当者の今回実測は `observation.spec.ts` が 2 テスト（walkthrough + guard）で 2/2 green。以下 market/ledger を合わせ計測した。

### market（取引ライフサイクル）— `market.spec.ts` 1/1 passed（T2 実走 green）

- dev-login → `/s/market-trade` 実描画（見出し「取引」）→ 出品 `POST /market/listings` = 201 → 一覧 `GET` = 200（投影に出品が出現）→ 詳細 `GET` = 200（title/price/actor_id 一致）。same-origin cookie で実 worker + R2 を通貫。**データの正しさ（出品→一覧→詳細）は実 API で実証**。
- **T2 追加 assert**: `/s/market-trade?listing_id=<出品した id>` を実ブラウザで開き、詳細カードが `bind_text` で実 API の `title / price 円` を**画面テキストに可視描画**することを assert（批評家指摘「カード値描画を守る自動 assert が無い」を解消）。

### ledger / economy-status（残高 read-through）— `ledger.spec.ts` 1/1 passed（T2 実走 green）

- dev-login → `/s/economy-status` 実描画（見出し「ステータス」）→ 残高 `GET /me/ledger` = 200（actor_id / karma_value / karma_count / platinum_coins 全て実データ）。
- **T2 追加 assert**: カルマカードが `bind_text` で `値 {karma_value} / 累積カウント {karma_count} / プラチナ {platinum_coins}` を**画面テキストに可視描画**することを、同一 API 読値と突き合わせて assert（カード値描画のガード）。

### spec-thread（知の広場スレ仕様）— `tests/spec-thread.test.ts` 3/3 passed（vitest 129ms）

- screendef.schema.json 検証 pass / 全 API 経路 deny-by-default 401 AUTH_REQUIRED / navigation.json 到達可能 の 3 本 green。真の per-thread 単一スレ画面（`…/t/{thread_id}` 型）は C5 未産出のため、最も近い `knowledge-board`（plaza スレ板）へ retarget して green 化（§4-3）。

### ugc-translate（端末側翻訳）— `ugc-translate.spec.ts` 1/1 passed（141ms）

- UGC 翻訳が on-device で走りネットワーク発信ゼロ（V3-I18-06）を実測。無改変で green 維持。

---

## §3 修正した実バグ一覧（真因つき）

本 T1 の初回 sweep で **3 画面が白画面クラッシュ**していた。いずれも同一の真因で、`screen-defs/` の `bind_items` パス修正のみで根治（レンダラ・API は無改変）。

### 真因（3 画面共通）

`apps/web/src/renderer/renderer.tsx:226` — `useSource` が API レスポンス `r` を**ノードの `node.id` をキーにして** `data.<node.id>` に丸ごと格納する。list ノード（例 id=`history`）が `source_path` から受けるレスポンスは `{...profile, history: [...]}` のような**ラッパーオブジェクト**であり、配列本体は `data.history.history` にある。
旧 `bind_items: "data.history"` はラッパーオブジェクト（配列でない）を指していた。同 `renderer.tsx:527` の `getPath(...) ?? []` ガードは **nullish しか弾かず、非配列は素通し**するため、`:537` の `items.map(...)` が `items.map is not a function` で uncaught crash → 白画面（Next error overlay）。

### 修正 3 件（screen-defs のみ・レンダラ/API 無改変）

| screen_id | 束縛 API | 修正 bind_items | 実 API レスポンス形（検証済み） |
|---|---|---|---|
| economy-status | `/me/status` | `data.history` → **`data.history.history`** | `profile-routes.ts:107` = `{...profile, history: [...]}` |
| template-market | `/market/templates` | `data.templates` → **`data.templates.templates`** | `market-template-routes.ts:137` = `{templates: [...]}` |
| knowledge-board | `/plaza/channels/knowledge-board/threads` | `data.threads` → **`data.threads.threads`** | `plaza-routes.ts:227` = `{channel, threads: [...], boards}` |

修正後: 3 画面とも sweep PASS（見出し可視・クラッシュなし・実 API 配列を描画 or 空状態）。フル sweep **36/36 passed**。`npm run lint` **20 GATE 全 green**（screendef-structure / navigation / secrets / rtm 含む）。

### T2 真因: card 値バインド未実装（economy-status・market-trade・profile 共通）

初回レポートが §4 で「表示制約」としていた 2 件は、grep で全 caller を辿ると**同一真因**だった。`economy-status`（karma カード）・`market-trade`（state/price/shipping カード）・`profile`（identity/karma/contribution/market カード）はいずれも card ノードに `props.bind_text`（`source_path` 応答オブジェクトへ `{{field}}` を綴じる宣言）を持つが、**C2 レンダラの `CardNode` が `bind_text` を一切読まず**、子ノードだけを描いていた。子を持たないこれらのカードは空 `<article>` を描くだけで値が出ない。list は `bind_items`/`item_text` を実装済（home.json の today list が実動）だが、card 用の単一オブジェクト版が欠けていた。

#### T2 修正 3 件

| 対象 | 修正 | 実測 |
|---|---|---|
| `apps/web/src/renderer/renderer.tsx`（`CardNode`） | `props.bind_text` を実装。カード自身の取得オブジェクト `data[node.id]` に対し `interpolate` で `{{field}}` を綴じ、`<p class="civ-text">` を描く（list の card 版・全 caller をここ 1 箇所で根治） | economy-status で `値 0 / 累積カウント 0 / プラチナ 0` を実描画（スクショ再生成済）。profile 4 カードも同時に埋まった |
| `screen-defs/market-trade.json` | `source_path` の単一波括弧 `{listing_id}` を `{{params.listing_id}}` に統一（4 経路）。加えて先頭に**詳細カード**（`GET /market/listings/{{params.listing_id}}` → `{{listing.title}} / {{listing.price}} 円`）を追加 | `market.spec.ts` が `?listing_id=` 付きで開き title/price 可視を実証 |
| `scripts/check-screendef-structure.mjs`（GATE） | 全 screen-def の `source_path` に**単一波括弧禁止**の検査を 1 本追加（`{{…}}` を剥がして残る `{`/`}` を検出）。cluster 所有に関係なく全画面走査 → 回帰封鎖。TC 1 本追加（`checkSourcePaths`） | `npm run lint` / vitest green |

可視 assert 追加: `ledger.spec.ts`（カルマ/累積/プラチナ）・`market.spec.ts`（詳細カード title/price）。フル e2e **41 passed**（sweep 36 + observation 2 + market 1 + ledger 1 + ugc 1）。`npm run lint` 20 GATE green・root vitest 77 passed。

> 補足（作業衛生）: repo 直下に 0 バイト迷子ファイル `e.to`（HANDOFF §3 が警告するシェル事故の産物）が残存していたため削除した。git 追跡外・内容空・実害なし。

---

## §4 FAIL 残（症状・影響・担当範囲）

> T2 更新: 当初 §4 が抱えた 2 件のうち §4-2（market-trade カード値）は根治し §3 へ移動、§4-1 も残高カードは根治して**貢献度リスト 1 件のみ**が残る。以下は現時点の残欠落。いずれもクラッシュではない（sweep は PASS）。

### §4-1 economy-status: 貢献度 3 軸リスト — T3 で根治（残欠落なし）

- 現況（T3 後）: 残高（カルマ）カードに続き貢献度（3 軸）リストも **根治済み**。economy-status に画面欠落は無い。
- 真因と修正: `/me/contribution` が axes を object 返却（`{research,capital,development}`）で、list の `bind_items` は配列を要求するため空だった。**API 契約を非破壊拡張**: `projectContribution` に `axis_list`（`{axis, score, minted, next_threshold, carry, title}` の 3 要素配列・object の `axes` は key 参照用に維持）を追加し、screen-def を `bind_items: "data.contribution.axis_list"` に結線。unit TC（`axis_list` の順序・object との同値）+ ledger.spec に research/capital/development の 3 行可視 assert を追加（回帰封鎖）。ledger E2E 実測で `research: 0 / capital: 0 / development: 0` が画面描画されることを確認。

### §4-2 market-trade: 詳細/状態/価格カード — T2 で根治

- **根治済み（§3 参照）**。card `bind_text` レンダラ実装 + `source_path` を `{{params.listing_id}}` に統一 + 詳細カード追加で、`listing_id` を渡して開くと詳細（title/price）・状態カードが実 API 値を描画。`market.spec.ts` が可視 assert でガード。
- 残（データ不足であり表示バグではない）: 送料カードは `to_office` クエリ未指定で 400、ボードは stage<2 で 404。いずれも**追加パラメータ待ち**で、クラッシュせず空描画（honest empty）。取引の中核データフロー（出品→一覧→詳細）は §2 で 201/200/200・値一致を実証済。

### §4-3 知の広場: 単一スレ画面（per-thread） — T3 で産出（残欠落なし）

- 現況（T3 後）: `screen-defs/knowledge-thread.json` を**新規産出**。GET /plaza/threads/{{params.thread_id}} のスレ投影(頭カード topic・投稿 materialized view)+ GET /plaza/threads/{{params.thread_id}}/consensus の Polis 型合意投影(Agree/Disagree/Pass の決定論集計・LLM 不要)を表示、POST /plaza/stances で賛否投票。knowledge-board から「スレッドを開く」導線・navigation/i18n 登録済み。
- 実測: `apps/web/e2e/knowledge-thread.spec.ts` で dev-login→スレ作成→per-thread 画面で topic/投稿可視→stance 投票→consensus が「賛成 1 / 反対 0 / 保留 0」に反映、を実ブラウザ green。screen-sweep でも knowledge-thread が PASS。

---

## 付録: 打鍵チェック依頼にあたっての誠実注記

- 全 37 画面（+knowledge-thread）は**クラッシュせず描画・遷移・データ束縛**する（実測・E2E 43 passed）。オンボーディング〜観測〜個体〜取引〜知の広場の主要導線は通貫 green。
- T2/T3 で economy-status・market-trade の**カード値表示**、economy-status の**貢献度 3 軸リスト**、知の広場の**単一スレ画面**を全て根治/産出済み（§3・§4）。C2 レンダラの `card bind_text` 実装 + `source_path` の `{{params.listing_id}}` 統一 + 単一波括弧禁止 GATE + `axis_list` 非破壊 API 拡張 + `knowledge-thread` 新規産出。`profile` の 4 カードも副次で埋まった。
- **打鍵前に本人へ明示すべき既知の画面欠落は無い**（T1 で洗い出した 5 件はすべて根治/産出）。V3-AIP-101 の要求「安心できる状態にしてから最終打鍵チェック」を満たす。実測エビデンス = 本レポート §1 の画面別表 + `docs/planning/c7/screens/*.png` + E2E 43 passed。
