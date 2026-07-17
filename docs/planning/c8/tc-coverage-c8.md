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
> ② `tests/**`・`apps/**/*.test.{ts,tsx}`・`.github/workflows/ci.yml` 全198ファイルを走査し、要件ID(`V3-XXX-##`)の文字列言及を機械抽出(①とは独立のソース)。
> ③ `04-traceability/rtm.json`(V-model 5点ゲート・hand-authored・g09クラスタ起点17件)との突合。
> 誇張ゼロ方針: 「TC根拠なし」を無理に埋めない。①②いずれの機械シグナルも無い項目は「未確認」として正直に列挙する(=テストが無い、ではなく「IDタグでの機械追跡ができていない」の意)。

## 0. 実行環境実測(本ラン・2026-07-17)

| 検証 | 結果 |
|---|---|
| `npm run lint`(20 GATE) | 全 OK(filename/generated-file/agents-sync/schema/frontmatter/codegen×3/ui-tokens/contrast/ui-copy/screendef-structure/i18n-keys/secrets/cron/navigation/public-docs/dep/component/**rtm**/file-board-registry) |
| `npm test`(apps/api + tests + apps/web) | **Test Files 165 passed(1+155+9) / Tests 1395 passed(1+1238+156) / 0 failed** |
| `pytest -q` | **49 passed, 1 skipped**(skip は既知の torch 依存分岐・意図的) |
| `npm run e2e -w apps/web` | 本ランでは未再実行。直近実測は `HANDOFF-c8-session2.md` §0(2026-07-17朝・commit 211a47f 時点)= **60/60 green**。本レポートはこの数値を再検証していないため「未確認」として扱う(誇張ゼロ) |

## 1. 全体サマリー(progress.json 334件)

| 区分 | 件数 | done | in_progress | blocked | todo |
|---|---|---|---|---|---|
| 全体 | 334 | 125(37%) | 24 | 3 | 182 |
| 第1波必達(required) | 184 | 122(66.3%) | 24 | 3 | 35 |
| 第2波ベストエフォート(best-effort) | 150 | 3(2.0%) | 0 | 0 | 147 |

> 出典: `docs/planning/c8/progress.md`(生成物・本表と同一値。乖離があれば `progress.json` が正)。

## 2. 機械検証①: progress.json 自己申告 `tc` フィールドの実在チェック

- `tc` 配列が空でない項目: **73 / 334**
- `tc` 文字列(配列要素)総数: 95
- 文字列からファイルパスらしきトークンを正規表現抽出: **97 個**
- 実在確認: **97 / 97 = 100%**(完全一致 94・ベース名フォールバック一致 3)
- 実在しない(捏造/リンク切れ)参照: **0 件**

→ progress.json が「済」として挙げる TC 参照に、存在しないファイルへの言及(捏造)は機械チェック上ゼロ件。ベース名フォールバック3件は末尾に補足説明("...(全50件)"等)を含む記述だったため、フルパスでなく短縮ファイル名で書かれていたのみ(実ファイルは存在)。

## 3. 機械検証②: テストファイル内の要件IDタグ言及(独立ソース)

- 走査対象: `tests/**`・`apps/**/*.test.{ts,tsx,js}`・`apps/**/*.spec.{ts,tsx,js}`・`.github/workflows/ci.yml` = **198 ファイル**
- 発見した要件ID(`V3-XXX-##` パターン)の異なり数: **140**
- `01-requirements/registry.json`(749件)に存在しないID言及(誤タグ/typo): **0 件**

## 4. 必達(required)×done 122件のTC根拠クロス表

| シグナル | 件数 | 割合(/122) |
|---|---|---|
| ①自己申告tcあり | 66 | 54.1% |
| ②IDタグのテスト内言及あり | 66 | 54.1% |
| ①または②(union・機械的にTC根拠を確認できた) | **91** | **74.6%** |
| ①②いずれも無し(未確認) | 31 | 25.4% |

> union 91件は全て今回実測の `npm test` green(165ファイル中に包含・0 failed)に属する。つまり「機械的にTC根拠を確認できた必達doneの91件」は **green率100%**(自動化可能分の green 率という PLAN §6-2 の問いに対する実測回答)。
> 残る31件は「テストが無い」のではなく、C1〜C4 期の実装が `CL-01`〜`CL-13` のような別命名規約でテストされており、`V3-XXX-##` タグでの機械追跡対象になっていない可能性が高い(例: V3-FND-01 は `tests/cl-01-insert-only.test.ts` で担保されるが、ファイル内に文字列 `V3-FND-01` が無いため②で拾えない・progress.json 側にも `tc` 未記入)。個別の手動確認は今回のスコープ外(手で埋めると誇張になるため据え置く)。

### 4.1 未確認31件(次レーンでの `tc` 補記対象)

V3-AIP-23, V3-AIP-57, V3-AIP-60, V3-AIP-78, V3-AIP-90, V3-AIP-96, V3-AIP-97, V3-AIP-98, V3-FND-01, V3-FND-03, V3-IND-04, V3-KRM-03, V3-KRM-05, V3-KRM-10, V3-KRM-11, V3-KRM-18, V3-KRM-19, V3-KRM-20, V3-KRM-21, V3-KRM-24, V3-MKT-04, V3-MKT-22, V3-MKT-27, V3-OBS-06, V3-OBS-43, V3-PPR-16, V3-PPR-17, V3-PPR-18, V3-WIK-01, V3-WIK-16, V3-FND-35

## 5. lane別(required scope)TC根拠カバレッジ

| lane | required 総数 | done | done中に機械TC根拠あり |
|---|---|---|---|
| CSV | 1 | 1 | 1 |
| L1/PAY | 39 | 25 | 13 |
| L3/L4-auth | 17 | 14 | 14 |
| L4 | 34 | 29 | 18 |
| L4-gov | 12 | 9 | 9 |
| L4-knowledge | 28 | 16 | 11 |
| L4-obs | 39 | 23 | 20 |
| L6-ui | 14 | 5 | 5 |
| **合計** | **184** | **122** | **91** |

## 6. blocked 3件のTC状況(裁定待ち・想定通り0件)

| id | lane | tc | commits |
|---|---|---|---|
| V3-AIP-92 | L4 | (なし) | (なし) |
| V3-AUT-15 | L3/L4-auth | (なし) | (なし) |
| V3-SEC-03 | L4-gov | (なし) | (なし) |

> 未実装(裁定待ち)のためTC自体が存在しないのは仕様通り。詳細理由は `docs/planning/c8/progress.md` §blocked一覧、または本ランの `docs/planning/status.md` を参照。

## 7. best-effort(第2波)done 3件のTC状況(既知ギャップ)

| id | lane | 自己申告tc | IDタグ言及 |
|---|---|---|---|
| V3-GOV-35 | L4-gov | なし | なし |
| V3-IND-14 | L4-obs | なし | なし |
| V3-MKT-13 | L1/PAY | なし | なし |

> 3件とも machine-verifiable なTC根拠が無い。実装コミット(`b070403`/`65d7a00`)自体は存在するため未テストと断定はしないが、根拠不足として正直に計上する。

## 8. `04-traceability/rtm.json`(V-model 5点ゲート)との突合

- rtm.json 総数: **17件**(C5 K8 由来・g09-AIプロセスクラスタ起点・hand-authored・test gate 必須)
- うち progress.json(C8追跡スコープ)と重複: **8件**(V3-AIP-22/28/31/34/49/50/93/104 — 全て progress.json 側 `status: done`)
- うち progress.json 範囲外(C8着手前=事前実装済みで追跡対象に入っていない): **9件**(V3-AIP-05/32/35/36/40/45/68/76/80)
- rtm.json は 5 点ゲート(req/det/**test**/trn_ui/retrofit)全closeが条件のより厳格な正本。範囲がg09クラスタに限定される点で本表(progress.json 334件全体)より狭い。

## 9. 判定(PLAN §6-2 への回答)

- **自動化可能な必達(required)done 122件のうち、機械的にTC根拠を確認できた91件(74.6%)は、今回実測の `npm test` 全緑(1395 passed / 0 failed)に含まれる → 根拠付き green率 = 100%(91/91)**。
- 未確認31件(4.1節)は次に `tc` を埋める対象として明示した。捏造(存在しないTCを書く)は機械チェック上ゼロ件確認済み(2節)。
- 第2波(best-effort)は着手率自体が低く(3/150)、TCカバレッジ議論の対象規模に達していない。

## 10. 既知の限界(誇張ゼロ宣言)

1. 本表は `V3-XXX-##` という**文字列タグ**の有無で機械判定している。タグを付けずに実装・テストされた機能(特にC1〜C4期の基盤コード)は「未確認」に分類され、実際のテスト有無とは必ずしも一致しない。
2. `npm run e2e -w apps/web` は本ランで再実行していない(§0参照)。E2Eに依存する機能のgreen判定は前回実測(HANDOFF記載)を借用しているのみで、本レポート内では未検証。
3. best-effort(第2波)150件はほぼ未着手のため、この表は主に required(第1波)スコープの実態を反映する。
