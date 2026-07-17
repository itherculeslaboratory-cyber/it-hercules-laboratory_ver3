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
> ② `tests/**`・`apps/**/*.test.{ts,tsx}`・`.github/workflows/ci.yml` 全190ファイルを走査し、要件ID(`V3-XXX-##`)の文字列言及を機械抽出(①とは独立のソース)。
> ③ `04-traceability/rtm.json`(V-model 5点ゲート・hand-authored・g09クラスタ起点17件)との突合。
> 誇張ゼロ方針: 「TC根拠なし」を無理に埋めない。①②いずれの機械シグナルも無い項目は「未確認」として正直に列挙する(=テストが無い、ではなく「IDタグでの機械追跡ができていない」の意)。

## 0. 実行環境実測(本ラン・2026-07-17・wave-3反映)

| 検証 | 結果 |
|---|---|
| `npm run lint`(21 GATE) | 全 OK(filename/generated-file/agents-sync/schema/frontmatter/codegen×3/ui-tokens/contrast/ui-copy/screendef-structure/i18n-keys/secrets/cron/navigation/public-docs/dep/component/rtm/file-board-registry) |
| `npm test`(apps/api + tests + apps/web) | **Test Files 165 passed(1+155+9) / Tests 1395 passed(1+1238+156) / 0 failed** |
| `pytest -q` | **49 passed, 1 skipped**(skip は既知の torch 依存分岐・意図的) |
| `npm run e2e -w apps/web` | 本ランでは完走前に本表を確定(誇張ゼロ)。直近実測は `HANDOFF-c8-session2.md` §0(2026-07-17朝・commit 211a47f 時点)= **60/60 green**。本レポートはこの数値を再検証していないため「未確認」として扱う |

> npm test/pytest の数値は前回版(commit 5c30b9b)と同一(165/1395/0・49/1skip) — wave-2 修復コミット(`6b38140`)は `progress.json`/`progress.md` のみの変更でテストコード自体には触れていないため、回帰なし・不変を実測で確認。

## 1. 全体サマリー(progress.json 334件・wave-3反映後)

| 区分 | 件数 | done | in_progress | blocked | todo |
|---|---|---|---|---|---|
| 全体 | 334 | 128(38%) | 23 | 3 | 180 |
| 第1波必達(required) | 184 | 125(67.9%) | 23 | 3 | 33 |
| 第2波ベストエフォート(best-effort) | 150 | 3(2.0%) | 0 | 0 | 147 |

> 出典: `docs/planning/c8/progress.md`(生成物・本表と同一値。乖離があれば `progress.json` が正)。
> 前回版(5c30b9b・2026-07-17朝)比: required done **122→125(+3)**・in_progress 24→23(-1)・todo 35→33(-2)。差分は `6b38140`(IND系progress実態同期・wave-2報告欠落の修復)によるもので、既に実装済みだった3件(観測/個体一覧レーン)の状態が正しく`done`へ反映された(新規実装コミットはゼロ・実態同期のみ)。

## 2. 機械検証①: progress.json 自己申告 `tc` フィールドの実在チェック

- `tc` 配列が空でない項目: **78 / 334**(前回73)
- `tc` 文字列(配列要素)総数: 104(前回95)
- 文字列からファイルパスらしきトークンを正規表現抽出: **103 個**(前回97)
- 実在確認: **103 / 103 = 100%**(完全一致 102・ベース名フォールバック一致 1: `V3-MKT-65` の `apps/web screendef-snapshots.test.tsx(全50件)` 表記)
- 実在しない(捏造/リンク切れ)参照: **0 件**

→ progress.json が「済」として挙げる TC 参照に、存在しないファイルへの言及(捏造)は機械チェック上ゼロ件(前回同様)。

## 3. 機械検証②: テストファイル内の要件IDタグ言及(独立ソース)

- 走査対象: `tests/**`(node_modules除く)・`apps/**/*.test.{ts,tsx,js}`・`apps/**/*.spec.{ts,tsx,js}`・`.github/workflows/ci.yml` = **190 ファイル**
- 発見した要件ID(`V3-XXX-##` パターン)の異なり数: **135**
- `01-requirements/registry.json`(749件)に存在しないID言及(誤タグ/typo): **0 件**

## 4. 必達(required)×done 125件のTC根拠クロス表

| シグナル | 件数 | 割合(/125) |
|---|---|---|
| ①自己申告tcあり | 69 | 55.2% |
| ②IDタグのテスト内言及あり | 64 | 51.2% |
| ①または②(union・機械的にTC根拠を確認できた) | **94** | **75.2%** |
| ①②いずれも無し(未確認) | 31 | 24.8% |

> union 94件は全て今回実測の `npm test` green(165ファイル中に包含・0 failed)に属する。つまり「機械的にTC根拠を確認できた必達doneの94件」は **green率100%**(自動化可能分の green 率という PLAN §6-2 の問いに対する実測回答)。
> 前回(91/122=74.6%)比: union +3(94件)・分母(done)も+3(125件)で、比率はほぼ同水準(74.6%→75.2%)。今回新たに`done`扱いになった3件(IND系・§1参照)は3件とも機械TC根拠ありでunion側に加わった(未確認31件リストは前回と完全一致・変化なし)。
> 残る31件は「テストが無い」のではなく、C1〜C4 期の実装が `CL-01`〜`CL-13` のような別命名規約でテストされており、`V3-XXX-##` タグでの機械追跡対象になっていない可能性が高い(例: V3-FND-01 は `tests/cl-01-insert-only.test.ts` で担保されるが、ファイル内に文字列 `V3-FND-01` が無いため②で拾えない・progress.json 側にも `tc` 未記入)。個別の手動確認は今回のスコープ外(手で埋めると誇張になるため据え置く)。

### 4.1 未確認31件(次レーンでの `tc` 補記対象・前回と同一)

V3-AIP-23, V3-AIP-57, V3-AIP-60, V3-AIP-78, V3-AIP-90, V3-AIP-96, V3-AIP-97, V3-AIP-98, V3-FND-01, V3-FND-03, V3-FND-35, V3-IND-04, V3-KRM-03, V3-KRM-05, V3-KRM-10, V3-KRM-11, V3-KRM-18, V3-KRM-19, V3-KRM-20, V3-KRM-21, V3-KRM-24, V3-MKT-04, V3-MKT-22, V3-MKT-27, V3-OBS-06, V3-OBS-43, V3-PPR-16, V3-PPR-17, V3-PPR-18, V3-WIK-01, V3-WIK-16

## 5. lane別(required scope)TC根拠カバレッジ

| lane | required 総数 | done | done中に機械TC根拠あり |
|---|---|---|---|
| CSV | 1 | 1 | 1 |
| L1/PAY | 39 | 25 | 13 |
| L3/L4-auth | 17 | 14 | 14 |
| L4 | 34 | 29 | 18 |
| L4-gov | 12 | 9 | 9 |
| L4-knowledge | 28 | 16 | 11 |
| L4-obs | 39 | **26** | **23** |
| L6-ui | 14 | 5 | 5 |
| **合計** | **184** | **125** | **94** |

> 前回比の変化は L4-obs レーンのみ(done 23→26・TC根拠あり 20→23、他レーンは不変)。IND系3件(§1参照)が全て L4-obs 所属。

## 6. blocked 3件のTC状況(裁定待ち・想定通り0件・前回と同一)

| id | lane | tc | commits |
|---|---|---|---|
| V3-AIP-92 | L4 | (なし) | (なし) |
| V3-AUT-15 | L3/L4-auth | (なし) | (なし) |
| V3-SEC-03 | L4-gov | (なし) | (なし) |

> 未実装(裁定待ち)のためTC自体が存在しないのは仕様通り。詳細理由は `docs/planning/c8/progress.md` §blocked一覧、または本ランの `docs/planning/status.md` を参照。

## 7. best-effort(第2波)done 3件のTC状況

| id | lane | 自己申告tc | IDタグ言及 |
|---|---|---|---|
| V3-GOV-35 | L4-gov | なし | **あり**(`tests/gov-35-observation-freeze.test.ts` describe見出し) |
| V3-IND-14 | L4-obs | なし | **あり**(`tests/individual.test.ts` describe見出し) |
| V3-MKT-13 | L1/PAY | なし | **あり**(`tests/market-payment-mismatch.test.ts` コメント+describe見出し) |

> 訂正(前回版との差分): 前回版(5c30b9b)は本3件を「machine-verifiableなTC根拠が無い」と記載していたが、本ランの独立ソース②スキャン(§3)で3件とも実在テストファイル内にIDタグ言及を確認した(該当コミット`b070403`/`65d7a00`はいずれも前回版生成時点で既にrepoに存在しており、前回の②スキャンが取りこぼしていたと判断される)。progress.json側の自己申告`tc`フィールドは依然として空欄のままなので、次レーンでの`tc`補記対象として残す。

## 8. `04-traceability/rtm.json`(V-model 5点ゲート)との突合

- rtm.json 総数: **17件**(C5 K8 由来・g09-AIプロセスクラスタ起点・hand-authored・test gate 必須)
- うち progress.json(C8追跡スコープ)と重複: **8件**(V3-AIP-22/28/31/34/49/50/93/104)
  - **done: 5件**(V3-AIP-22/28/31/93/104)
  - **in_progress: 3件**(V3-AIP-34/49/50 — progress.json側でも継続in_progress。前回版は誤って「8件全てdone」と記載していたため本版で訂正)
- うち progress.json 範囲外(C8着手前=事前実装済みで追跡対象に入っていない): **9件**(V3-AIP-05/32/35/36/40/45/68/76/80)
- rtm.json は 5 点ゲート(req/det/**test**/trn_ui/retrofit)全closeが条件のより厳格な正本。範囲がg09クラスタに限定される点で本表(progress.json 334件全体)より狭い。

## 9. 判定(PLAN §6-2 への回答)

- **自動化可能な必達(required)done 125件のうち、機械的にTC根拠を確認できた94件(75.2%)は、今回実測の `npm test` 全緑(1395 passed / 0 failed)に含まれる → 根拠付き green率 = 100%(94/94)**。
- 未確認31件(4.1節)は次に `tc` を埋める対象として明示した(前回版と同一リスト・変化なし)。捏造(存在しないTCを書く)は機械チェック上ゼロ件確認済み(2節)。
- 第2波(best-effort)は着手率自体が低く(3/150)、TCカバレッジ議論の対象規模に達していない。ただし3件とも実は独立ソース②でTC根拠を確認できることが本ランで判明した(7節)。

## 10. 既知の限界(誇張ゼロ宣言)

1. 本表は `V3-XXX-##` という**文字列タグ**の有無で機械判定している。タグを付けずに実装・テストされた機能(特にC1〜C4期の基盤コード)は「未確認」に分類され、実際のテスト有無とは必ずしも一致しない。
2. `npm run e2e -w apps/web` は本ランで完走を待たずに集計を確定した(§0参照)。E2Eに依存する機能のgreen判定は前回実測(HANDOFF記載)を借用しているのみで、本レポート内では未検証。
3. best-effort(第2波)150件はほぼ未着手のため、この表は主に required(第1波)スコープの実態を反映する。
4. 本版は前回版(5c30b9b)の2点の誤りを訂正した: (a) §7 best-effort 3件のTC根拠有無判定、(b) §8 rtm.json重複8件の status 内訳。いずれも独立スキャンの再実行で判明した測定誤差であり、progress.json自体の書き換えは伴わない。
