---
id: RULING-2026-07-31-R23
title: ver3 ユーザー裁定記録 — 2026-07-31 第23回(カードのgood欄由来の新規要件2件=AIP108-1・AIP109-1 + V3-AIP-45降格1件)
date: "2026-07-31"
status: active
---

# ver3 ユーザー裁定記録 — 2026-07-31 第23回

> 入力(逐語原本): `D:\claude\00-hq\review-queue\R0731-42b784-kvratelimit-2026-07-31.json`(`user_ruling.good`欄)。
> このカード自体の判断対象(`KV-1`)は無関係の別件(Cloudflare KV名前空間の作成可否・スコア85で`o`回答済み)。
> **本回で扱うのは、そのgood欄にユーザーが追加で書いた新しい要望**であり、カードの`decisions[]`には
> 存在しない自由記述からの起票。
> 中間処理: `D:\claude\00-hq\RULING-2026-07-31-gen65-hqrulings.md` の **R65-16**(V3-AIP-45降格)・
> **R65-18**(新規要件2件の採番)として65代目HQが裁定し、調査艦報告
> `D:\claude\00-hq\kits\lane-research\R0731-d263a0-REPORT-2026-07-31-g65-usagecounter.md` の実測を
> 踏まえた上で、本レーン(記録役 lane-record・発注書 `D:\claude\00-hq\kits\lane-record\ORDER-2026-07-31-g65-newreq.md`)
> が `registry.json` へ機械適用したもの。
> 総数 761 → **763**(+2)。新規採番 **2件**(V3-AIP-108・V3-AIP-109)。既存patch **1件**(V3-AIP-45・ruling_note追記)。
> req_status変更: 確定660→**662**(新規2件が確定で追加。既存1件はreq_status変更なし)。
> wave変更: 第1波359→**361**(新規2件)。
> 検算恒等式・件数突合は本記録 §7 参照(レジストリJSON実カウントを正とする)。
> ★本記録は00-hqの記録役(lane-record)が `ruling-record` スキルの手順に従って機械適用したもの。
> ユーザーの逐語は§1に全文保存(改変・要約しない)。逐語と、記録役の解釈が分かれる箇所は§1・§5・§9で明示的に分離する。

## 1. ユーザー回答原文(逐語・要約禁止)

### 1.1 カード「R0731-42b784-kvratelimit-2026-07-31」(score=85・2026-07-31T13:21:29.606Z)

**KV-1(このカード本来の判断対象)への回答**: `o`(コメント欄「もちろん作っていいですよ。」) — ★本回の対象外(既に処理済みの別件)。

**good欄逐語(★本回の起点。KV-1とは無関係の新しい要望)**:

> よい提案ですね。
>
> カウンタで思い出しましたが、
>
> データが、参照された回数、引用された回数、更新された回数（更新されるたびに次世代データとして、
> ver管理で、参照された回数、引用された回数　は新たにカウントし始める。が、前のverと、
> 前の引用された回数とかが消えるわけではない。いつでも戻せる。）とか実装されてますよね？
>
> AIファーストだと、AIにとっての価値は以下に使われているデータかどうかになると思っているので！必須かと。

**bad欄**: (空)

## 2. 記録のみ(採番不要の運用指示。registryへは反映しない)

なし(good欄の要望は全て新規要件2件の起票、または既存要件(V3-AIP-45)の状態記述訂正に紐づく)。

## 3. 処置マッピング(原文 → 処置)

| # | 対象 | 処置 | 結論 | 適用ルール |
|---|---|---|---|---|
| 1 | good欄「更新された回数」 → V3-AIP-108(新規) | 新規採番 | 承認 — データ(content等)の更新回数を記録する要件として起票。現状contentはappend-only単発イベントで「更新」の型が存在しない前提を明記 | R3,R6 |
| 2 | good欄「更新されるたびに次世代データ…前のverと…消えるわけではない。いつでも戻せる」 → V3-AIP-109(新規) | 新規採番 | 承認 — 世代ごとのカウンタ(参照回数・引用回数を新世代で0から再カウント)+復元(旧世代は非破壊)の要件として起票。lineage-meta(V3-FND-15)のcontentへの適用として設計方針を注記 | R3,R4,R6 |
| 3 | V3-AIP-45(既存・「参照回数を記録する」) | 既存patch(ruling_note追記・降格) | R65-16裁定によりprogress.json側のstatusをdone→in_progressへ降格(HTTPで到達可能なroute 0件を自己grepで裏取り済み) | R65-2適用 |

## 4. 新規採番

1. **V3-AIP-108**(データの更新回数を記録する): group=g09-AIプロセス・category=AI運用/開発プロセス・kind=機能要件・
   req_status=確定・wave=第1波(score_v2=36・tier_v2=A・ds=3。直接の類似要件V3-AIP-45に倣って記録役が付与した
   判断であり、ユーザー本人が個別に指定した値ではない — §9参照)。詳細statement・sourcesはregistry.json本体を参照。
2. **V3-AIP-109**(世代ごとのカウンタ+復元): group=g09-AIプロセス・category=AI運用/開発プロセス・kind=機能要件・
   req_status=確定・wave=第1波(score_v2=36・tier_v2=A・ds=3。V3-AIP-108と同一の判断根拠 — §9参照)。
   詳細statement・sourcesはregistry.json本体を参照。

## 5. 各裁定の詳細(R6形式)

1. **V3-AIP-108 新規承認(更新回数)**(R3,R6): 逐語は§1参照。ユーザーは「データが…更新された回数…とか
   実装されてますよね?」と問い、続けて「AIファーストだと、AIにとっての価値は…に使われているデータかどうか
   になると思っているので!必須かと。」と述べており、必須要件として明言している。

   ### 5-1. ★調査結果(既存実装の前提)

   調査艦R0731-d263a0の実測を自己確認: `schemas/events/content.schema.json`(全208行)に「更新」という
   操作を表すイベント型・フィールドは存在しない。現状のcontent postイベントはappend-onlyの単発型
   (article/blog/paper/chat_log/newspaperのcontent_type enumのみ)であり、「更新」を記録する仕組み自体が
   ゼロから設計が必要。この前提をstatementに明記した。

2. **V3-AIP-109 新規承認(世代ごとのカウンタ+復元)**(R3,R4,R6): 逐語は§1参照(V3-AIP-108と同一箇所の
   括弧内「更新されるたびに次世代データとして、ver管理で、参照された回数、引用された回数は新たにカウントし
   始める。が、前のverと、前の引用された回数とかが消えるわけではない。いつでも戻せる。」)。

   ### 5-2. ★R65-18裁定の設計方針(HQ裁定・逐語ではなく裁定内容として記録)

   `RULING-2026-07-31-gen65-hqrulings.md` R65-18は以下を裁定した(要旨。全文は当該ファイル参照):
   - **正本はTruthのイベント側に置く**。KVは(使うとしても)都度再計算可能な派生キャッシュに留める。
     理由: ①KVは最新値で上書きする性質があり「前世代が消えず戻せる」と相性が悪い、②Truthの
     append-onlyなら古い世代の行が消えないので過去のカウントは再計算でいつでも出せる、③KVを正本にすると
     不変条項①(ID/Indexは使う瞬間だけ発行・派生値は都度再計算)から外れる。
   - **既存部品の再利用(reuse-first)**: 系譜メタ`lineage-meta.schema.json`(V3-FND-15・`generation`/
     親子関係。実装済み)をcontentにも適用する形で作る(ゼロから作らない)。自己確認: 当該スキーマは
     `schemas/common/lineage-meta.schema.json`に実在し、`uuid`/`lineage_hash`/`content_hash`/`generation`
     (root=0、子=親+1)/`parent_uuid`/`ancestor_chain`を持つ共用型として定義済み。
   - **将来の課題として正直に残す**: `projectReferenceCounter`は現状都度全走査(O(n))であり、
     データ量が増えると効かなくなる。投影indexは既存コメントが「後波」と認めている。今は塞がない。

3. **V3-AIP-45 既存patch(ruling_note追記・progress.json降格の裏取り)**(R65-2適用):

   `RULING-2026-07-31-gen65-hqrulings.md` R65-16の事実主張(「呼ぶrouteが`apps/api/src`全体に0件」)を
   本レーンが自分でも実測して裏取りした。

   ### 5-3. ★実測(自分でgrepした実出力)

   ```
   $ grep -rn "projectReferenceCounter" apps/api/src
   apps/api/src/reference-counter.ts:11:export async function projectReferenceCounter(

   $ grep -rln "reference-counter" apps/api/src
   apps/api/src/plaza-file-board-registry.ts
   apps/api/src/reference-counter.ts
   ```

   `plaza-file-board-registry.ts:71`の"reference-counter"は`KNOWN_API_MODULES`という**文字列索引の
   列挙値**であり、呼び出しではない。同ファイルの`classifyFileBoardLayer()`は`*-routes`/`*-connector`/
   `*-webhook`接尾辞をP層(HTTPルート相当)と分類する規則だが、"reference-counter"はこの接尾辞に
   該当せずB層(柔軟設計=非ルート)に分類される — すなわちこの索引自身も「reference-counterはHTTP
   ルートではない」ことを裏付けている。よって`projectReferenceCounter`を呼ぶHTTPルートは
   `apps/api/src`全体に**0件**(R65-16の主張どおり)。R65-2(未mount=到達不能ならdoneにしない)に該当し、
   `progress.json`のstatusをdone→in_progressへ降格する裁定は妥当と確認した。

   ★実行していないこと: `progress.json`自体の書き換えは本レーンの権限外(発注書★最優先節により
   絶対不触)。該当JSON行は本報告書(REPORT)に貼り、HQによる適用を待つ。

## 6. レジストリ反映指示(適用者=lane-record 自身。本記録と同時に実施済み)

各patchは**append/patch のみ・既存値の削除禁止**の原則で、`01-requirements/registry.json` に直接適用した
(Pythonスクリプトによる機械適用・検算通過後に書き込み):

- 新規登録: **2件**(V3-AIP-108・V3-AIP-109。§4参照)。
- 触れた既存ユニークID **1件**(V3-AIP-45): `ruling_note`へ本記録ファイルパス+R65-16の事実+自己grep実出力+
  日付2026-07-31+「実行していないこと」の注記を追記(append-only。既存の`ruling_note`は無かったため新規追加)。
- `req_status`変更: 確定660→**662**(V3-AIP-108・V3-AIP-109の新規2件による純増のみ。V3-AIP-45のreq_status
  変更は0件=`確定`のまま)。
- `wave`変更: 第1波359→**361**(V3-AIP-108・V3-AIP-109の新規2件。V3-AIP-45のwave変更は0件=`第1波`のまま)。
- `docs/planning/c8/progress.json`・`progress.md`は**触っていない**(発注書★最優先節・生成物ゆえ手編集
  禁止の両方に該当。適用対象のJSON行は本記録と同じ内容をREPORTへ貼る)。

## 7. 検算結果(実測値)

適用者=lane-record(実測日 2026-07-31)。`registry.json` を Python(`json.load`)で実カウント。

**before(適用前=第22回適用後の状態)**: 総数761 / req_status: 確定660・確定(修正)93・棄却8 /
wave: 第1波359・第2波234・実験枠20・対象外148

**after(適用後)**: 総数**763** / req_status: 確定**662**・確定(修正)93・棄却8 /
wave: 第1波**361**・第2波234・実験枠20・対象外148

**検算恒等式(実出力)**:
```
BEFORE {'total': 761, 'req_status': {'確定': 660, '確定(修正)': 93, '棄却': 8}, 'wave': {'第1波': 359, '対象外': 148, '第2波': 234, '実験枠': 20}}
AFTER {'total': 763, 'req_status': {'確定': 662, '確定(修正)': 93, '棄却': 8}, 'wave': {'第1波': 361, '対象外': 148, '第2波': 234, '実験枠': 20}}
dup ids 0
entries without id []
WRITTEN OK (json.load 再パース成功)
```

- 662+93+8=763 ✓ / 361+234+20+148=763 ✓ / ID重複0 ✓ / id欠落0件 ✓
- 総数の純増分(+2)はV3-AIP-108・V3-AIP-109の新規登録のみに起因する(§4)。既存1件(V3-AIP-45)の
  統計上の変更は0件(ruling_note追記のみ、req_status/wave/score_v2は不変)。

## 8. 決められなかったこと / 正直な一覧

1. **V3-AIP-108/109のカテゴリ選択(AIP vs WIK vs FND)は記録役の判断**。content.schema.json(WIK-16)への
   直接影響・lineage-meta(FND-15)の再利用の両方に関係するが、ユーザー逐語の主眼(「AIにとっての価値」
   「参照された回数、引用された回数」)がV3-AIP-45と同一の文脈だったため、AIPカテゴリ・g09グループへ
   分類した。WIK/FNDへの再分類が必要かはHQ/lane-thinkの判断に委ねる。
2. **score_v2/tier_v2/ds/wave/scores(bv/ui/dep/diff)は、srs.md:148の定義(要件重要度=DS×事業価値×依存関係)
   に基づく主観評価が必要**であり、本来lane-record(判断ゼロの機械作業)の権限外と考えられる。第22回
   round-22 §9-3(V3-SEC-59)の先例(「既存の類似要件の形式に倣った」と明記した上でスコアを付与)に倣い、
   直接の類似要件V3-AIP-45のスコアをそのまま踏襲する形で本回も付与したが、これは記録役による代行判断
   であり、ユーザー本人の指定ではない。HQ/lane-thinkによる確認・修正の余地を残す。
3. **`projectReferenceCounter`を「動くAPI」にする実装(R65-17で先にやるべきと裁定されている)は本回の
   対象外**。R65-17自体の着手(GETハンドラ1本の追加等)はihl-ver3のコード変更であり、記録レーンの権限外
   (実装レーンへの別発注が必要)。
4. **`progress.json`のV3-AIP-45行(status: done→in_progress)は本レーンが直接書き換えていない**。
   発注書★最優先節「`docs/planning/c8/progress.json`を絶対に触るな」に厳密に従い、該当JSON行は
   REPORT(報告書)に貼るのみ。適用はHQが行う。

## 9. 判断が要った箇所(実際に混ざった判断)

1. **V3-AIP-108/109をV3-AIPプレフィックス(カテゴリ=AI運用/開発プロセス・グループ=g09-AIプロセス)に
   分類したこと**(§8-1)。ユーザー逐語はカテゴリを指定していない。V3-AIP-45と同一の文脈(「AIにとっての
   参照価値」)であることを根拠に判断した。
2. **score_v2=36/tier_v2=A/ds=3/wave=第1波/scores(bv=4,ui=2,dep=3,diff=3)を、直接の類似要件V3-AIP-45の
   値をそのまま踏襲する形で付与したこと**(§8-2)。round-22 §9-3(V3-SEC-59)の先例に倣った代行判断であり、
   ユーザー本人が個別に指定した値ではない。
3. **V3-AIP-108とV3-AIP-109を1件の要求(「更新回数」)にまとめず2件に分割して採番したこと**。発注書
   (`ORDER-2026-07-31-g65-newreq.md` T1)が「新規要件2件を採番する」と明示していたため、この分割自体は
   発注書の指示に従った(記録役独自の判断ではない)。
4. **`projectReferenceCounter`の到達可能性(R65-16)の自己裏取りにおいて、`plaza-file-board-registry.ts:71`
   の"reference-counter"文字列がHTTPルートの呼び出しではなく索引の列挙値だと判定したこと**(§5-3)。
   ファイル冒頭のコメント・`classifyFileBoardLayer()`のP層判定規則(`*-routes`/`*-connector`/`*-webhook`
   接尾辞のみ)を根拠に判断した。
