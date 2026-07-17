---
id: tc-coverage-c8
title: C8 要件ID↔TC対応表(機械集計・PLAN §6-2)
date: "2026-07-17"
status: active
---

# C8 要件ID↔TC対応表(機械集計)

> 出典契約: `docs/planning/c8/PLAN-c8-full-run.md` §6-2「要件↔TC 対照を `docs/planning/c8/tc-coverage-c8.md` に出す(自動化可能分の green 率)」。
> 集計方法: **手で書かない**。以下3ソースをスクリプトで突合した実測値のみを載せる。
> ① `docs/planning/c8/progress.json`(334件・C8 第1波/第2波の追跡スコープ)の `tc` フィールド(自己申告TC参照)→ファイルシステム実在チェック。
> ② `tests/**`・`apps/**/*.test.{ts,tsx,js}`・`apps/**/*.spec.{ts,tsx,js}`・`.github/workflows/ci.yml` 全ファイルを走査し、要件ID(`V3-XXX-##`)の文字列言及を機械抽出(①とは独立のソース)。
> ③ `04-traceability/rtm.json`(V-model 5点ゲート・hand-authored・g09クラスタ起点17件)との突合。
> 誇張ゼロ方針: 「TC根拠なし」を無理に埋めない。①②いずれの機械シグナルも無い項目は「未確認」として正直に列挙する(=テストが無い、ではなく「IDタグでの機械追跡ができていない」の意)。

## 0. 実行環境実測(本ラン・2026-07-17・セッション2最終)

| 検証 | 結果 |
|---|---|
| `npm run lint`(21 GATE) | 全 OK(filename/generated-file/agents-sync/schema/frontmatter/codegen×3/ui-tokens/contrast/ui-copy/screendef-structure/i18n-keys/secrets/cron/navigation/public-docs/dep/component/rtm/file-board-registry) |
| `npm test`(apps/api + tests + apps/web) | **Test Files 182 passed(1+172+9) / Tests 1525 passed(1+1357+167) / 0 failed** |
| `pytest -q` | **49 passed, 1 skipped**(skip は既知の torch 依存分岐・意図的) |
| `npm run e2e -w apps/web` | **本ランで完走実測: 174 passed / 0 failed**(6.6分・single worker)。1回目の試行は外形タイムアウト(SIGTERM)で打ち切られ末尾1本が見かけ上失敗表示になったが、フル再実行で174/174 green を確認(見かけの失敗はプロセス強制終了の副作用であり実バグではない)。 |

> npm test は前回版(commit 363cc5d・165 files/1395 tests)比で **+17 files / +130 tests**(0 failed 維持)。差分はセッション2継続実装(UI磨き第2弾・L4残クラスタ消化・市場残route等)による新規テスト追加。pytest は前回と同一(49 passed/1 skip)。e2e は前回版が「未検証(前回実測を借用)」だったのに対し、本版は**このラン内で実際に完走・green を確認**した(誇張ゼロの実測)。

## 1. 全体サマリー(progress.json 334件・セッション2最終)

| 区分 | 件数 | done | in_progress | blocked | todo |
|---|---|---|---|---|---|
| 全体 | 334 | 158(47.3%) | 26 | 3 | 147 |
| 第1波必達(required) | 184 | 155(84.2%) | 26 | 3 | **0** |
| 第2波ベストエフォート(best-effort) | 150 | 3(2.0%) | 0 | 0 | 147 |

> 出典: `docs/planning/c8/progress.md`(生成物・本表と同一値。乖離があれば `progress.json` が正)。
> **前回版(363cc5d)比の最大変化**: 第1波必達(required)の **todo が 33 → 0 になった**(done 125→155 / in_progress 23→26 / blocked 3→3 不変)。これは `HANDOFF-c8-session2.md` §7 完走定義①「required 全件が done/in_progress(残余理由明記)/blocked(裁定・照会待ち明記)のいずれかに分類され todo が0件」を満たしたことを意味する(機械チェック済み — in_progress 26件全件に残余理由の `note` 記入を確認、空文字0件)。best-effort(第2波)は今回対象外のため前回と同数(done3・todo147)。全体の変化は required 側の内訳変更がそのまま反映(todo 180→147・done 128→158・in_progress 23→26)。

## 2. 機械検証①: progress.json 自己申告 `tc` フィールドの実在チェック

- `tc` 配列が空でない項目: **107 / 334**(前回78)
- 文字列からファイルパスらしきトークンを正規表現抽出: **147 個**(前回103)
- 実在確認: **147 / 147 = 100%**(完全一致 143・ベース名フォールバック一致 4: `screen-defs/navigation.json`・`screen-defs/obs-detail.json`・`screendef-snapshots.test.tsx`×2 — いずれもディレクトリ省略表記で本文中は実ファイルを指す)
- 実在しない(捏造/リンク切れ)参照: **0 件**

→ progress.json が「済」として挙げる TC 参照に、存在しないファイルへの言及(捏造)は機械チェック上ゼロ件(前回同様・母数は拡大)。

## 3. 機械検証②: テストファイル内の要件IDタグ言及(独立ソース)

- 走査対象: `tests/**`(node_modules除く)・`apps/**/*.test.{ts,tsx,js}`・`apps/**/*.spec.{ts,tsx,js}`・`.github/workflows/ci.yml` = **207 ファイル**(前回190)
- 発見した要件ID(`V3-XXX-##` パターン)の異なり数: **163**(前回135)
- `01-requirements/registry.json`(749件)に存在しないID言及(誤タグ/typo): **0 件**

## 4. 必達(required)×done 155件のTC根拠クロス表

| シグナル | 件数 | 割合(/155) |
|---|---|---|
| ①自己申告tcあり | 97 | 62.6% |
| ②IDタグのテスト内言及あり | 89 | 57.4% |
| ①または②(union・機械的にTC根拠を確認できた) | **122** | **78.7%** |
| ①②いずれも無し(未確認) | 33 | 21.3% |

> union 122件は全て今回実測の `npm test` green(182ファイル中に包含・0 failed)に属する。つまり「機械的にTC根拠を確認できた必達doneの122件」は **green率100%**(自動化可能分の green 率という PLAN §6-2 の問いに対する実測回答)。
> 前回(94/125=75.2%)比: union +28(122件)・分母(done)も+30(155件)で、比率はほぼ同水準(75.2%→78.7%)。

### 4.1 未確認33件(次レーンでの `tc` 補記対象)

V3-AIP-23, V3-AIP-57, V3-AIP-60, V3-AIP-78, V3-AIP-90, V3-AIP-96, V3-AIP-97, V3-AIP-98, V3-FND-01, V3-FND-03, V3-FND-35, V3-IND-04, V3-KRM-03, V3-KRM-05, V3-KRM-10, V3-KRM-11, V3-KRM-18, V3-KRM-19, V3-KRM-20, V3-KRM-21, V3-KRM-24, V3-MKT-04, V3-MKT-22, V3-MKT-27, V3-OBS-06, V3-OBS-43, V3-PPR-16, V3-PPR-17, V3-PPR-18, V3-UIX-24, V3-UIX-32, V3-WIK-01, V3-WIK-16

> 前回版(363cc5d)の未確認31件と比較すると、V3-UIX-24・V3-UIX-32 の2件が新規追加(いずれもセッション2で新たに`done`化した項目・`V3-XXX-##`タグでのテスト内言及が無いため②で拾えない)。他29件は前回と同一(C1〜C4期の実装が`CL-01`〜`CL-13`等の別命名規約でテストされておりタグ追跡対象外の可能性が高い、という前回の分析が引き続き妥当)。

## 5. lane別(required scope)TC根拠カバレッジ

| lane | required 総数 | done | done中に機械TC根拠あり |
|---|---|---|---|
| CSV | 1 | 1 | 1 |
| L1/PAY | 39 | 34 | 22 |
| L3/L4-auth | 17 | 14 | 14 |
| L4 | 34 | 29 | 18 |
| L4-gov | 12 | 9 | 9 |
| L4-knowledge | 28 | 26 | 21 |
| L4-obs | 39 | 31 | 28 |
| L6-ui | 14 | 11 | 9 |
| **合計** | **184** | **155** | **122** |

> 前回比の変化: L1/PAY(done25→34・TC根拠13→22)・L4-knowledge(done16→26・TC根拠11→21)・L4-obs(done26→31・TC根拠23→28)・L6-ui(done5→11・TC根拠5→9)。他レーン(CSV/L3/L4-auth/L4/L4-gov)は前回と不変。全レーン合計で required の todo が消滅(§1参照)。

## 6. blocked 3件のTC状況(裁定待ち・想定通り0件・前回と同一)

| id | lane | tc | commits |
|---|---|---|---|
| V3-AIP-92 | L4 | (なし) | (なし) |
| V3-AUT-15 | L3/L4-auth | (なし) | (なし) |
| V3-SEC-03 | L4-gov | (なし) | (なし) |

> 未実装(裁定待ち)のためTC自体が存在しないのは仕様通り。詳細理由は `docs/planning/c8/progress.md` §blocked一覧、または `docs/planning/status.md` を参照。3件とも前回版から変化なし(裁定待ちのまま)。

## 7. best-effort(第2波)done 3件のTC状況

| id | lane | 自己申告tc | IDタグ言及(実在ファイル) |
|---|---|---|---|
| V3-GOV-35 | L4-gov | なし | **あり**(`tests/market-flag.test.ts`・`tests/gov-35-observation-freeze.test.ts`・`tests/fixtures/route-matrix.csv`・`tests/cl-04-route-matrix.test.ts`) |
| V3-IND-14 | L4-obs | なし | **あり**(`tests/individual.test.ts`) |
| V3-MKT-13 | L1/PAY | なし | **あり**(`tests/market-payment-mismatch.test.ts`) |

> 前回版と同一3件・同一判定(自己申告`tc`は空欄のまま・独立スキャン②では実在テストファイル内にIDタグ言及を確認)。best-effort(第2波)は本ラン対象外のため着手件数自体に変化なし(3/150)。

## 8. `04-traceability/rtm.json`(V-model 5点ゲート)との突合

- rtm.json 総数: **17件**(C5 K8 由来・g09-AIプロセスクラスタ起点・hand-authored・test gate 必須)
- うち progress.json(C8追跡スコープ)と重複: **8件**(V3-AIP-22/28/31/34/49/50/93/104)
  - **done: 5件**(V3-AIP-22/28/31/93/104)
  - **in_progress: 3件**(V3-AIP-34/49/50 — progress.json側でも継続in_progress。前回版と同一)
- うち progress.json 範囲外(C8着手前=事前実装済みで追跡対象に入っていない): **9件**(V3-AIP-05/32/35/36/40/45/68/76/80)
- rtm.json 5点ゲート(req/det/test/trn_ui/retrofit)全close: **17/17件**(前回と同一・変化なし)
- rtm.json は 5 点ゲート全closeが条件のより厳格な正本。範囲がg09クラスタに限定される点で本表(progress.json 334件全体)より狭い。

## 9. 判定(PLAN §6-2 への回答)

- **自動化可能な必達(required)done 155件のうち、機械的にTC根拠を確認できた122件(78.7%)は、今回実測の `npm test` 全緑(1525 passed / 0 failed)に含まれる → 根拠付き green率 = 100%(122/122)**。
- **required の todo は本ランで 0件に到達**(§1参照)。残る in_progress 26件は全件`note`に残余理由を明記済み・blocked 3件は裁定/照会待ちとして`docs/planning/status.md`に一覧化済み。
- 未確認33件(4.1節)は次に `tc` を埋める対象として明示した(前回31件+セッション2新規done2件)。捏造(存在しないTCを書く)は機械チェック上ゼロ件確認済み(2節)。
- 第2波(best-effort)は着手率自体が低く(3/150・前回と不変)、本ランのスコープ外。

## 10. 既知の限界(誇張ゼロ宣言)

1. 本表は `V3-XXX-##` という**文字列タグ**の有無で機械判定している。タグを付けずに実装・テストされた機能(特にC1〜C4期の基盤コード)は「未確認」に分類され、実際のテスト有無とは必ずしも一致しない。
2. e2e は本ラン内で実際にフル実行し174/174 greenを確認した(§0)。前回版までの「借用値・未検証」という限界はこの版で解消済み。
3. best-effort(第2波)150件はほぼ未着手(3件のみdone)のため、この表は主に required(第1波)スコープの実態を反映する。
4. 未確認33件・rtm.jsonのin_progress3件など「未closeの残り」は、実装の欠如ではなく多くが「別命名規約でのテスト済み」または「意図的な段階的着手(noteに残余理由明記)」であり、これを額面通り「未検証」と読むと過小評価になる点に注意(ただし本表はその区別を機械的に行えないため、あえて厳しい側=「未確認」に倒して集計している)。
