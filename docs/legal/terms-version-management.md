# 利用規約 版管理・再同意フロー・scroll gate 運用文書 [社内ドラフト]

> **本文書は法的助言ではない。社内向けの社内ドラフトである。**

対応する進捗ID: `V3-SEC-23`(`terms_version`版管理・再同意フロー・scroll gate・暗黙同意廃止)。
API側の実装は `apps/api/src/policy.ts:123-163` に実装・テスト済み(`TermsVersionInfo` 型・
`isScrollComplete` 関数)。本文書はその**運用ルール**を定める(コードは版に依存しないロジックのみを
提供しており、実際の運用ルールは文書側で定義する設計)。

## 1. `terms_version` の付番規則

- 形式: `<状態>-<YYYY-MM-DD>`。ドラフト段階は `draft-YYYY-MM-DD`、公開承認後は `v<連番>-YYYY-MM-DD`
  へ改める(例: `v1-2026-08-01`)。
- 本規約・プライバシーポリシー・動画マッピング表(`tos-video-script.md`)は常に同一の `terms_version`
  を参照する(3文書で版がズレることを禁ずる)。
- `TermsVersionInfo.effective_at` は、実際にユーザーへ提示・適用が開始される日時とする。

## 2. 再同意フロー

1. 規約またはプライバシーポリシーの内容を変更する場合、新しい `terms_version` を発行する。
2. 既存ユーザーがログイン時、自身が同意済みの `terms_version` が最新でない場合、新しい規約への
   同意画面を表示する。
3. 同意画面では、変更点の要約(やさしい版 `tos-easy.md` ベース)を先に提示し、その後に全文
   (`tos-legal.md`)を表示する。
4. ユーザーが同意した場合、同意した `terms_version` と同意日時をユーザーレコードに記録する。

## 3. scroll gate(全文スクロール完了までは同意不可)

- `isScrollComplete(scrollTop, scrollHeight, clientHeight)`(`policy.ts:161-163`)が `true` を返すまで、
  同意ボタンを非活性(クリック不可)にする。
- 判定式: `scrollTop + clientHeight >= scrollHeight - 1`(下端到達判定に1pxの丸め誤差を許容)。
- 全文が1画面に収まりスクロールが発生しない場合(`scrollHeight <= clientHeight`)も、この式は
  `scrollTop(=0) + clientHeight >= scrollHeight - 1` を満たすため同意可能と判定される(スクロール
  不要な短い規約でも同意ボタンがロックされ続ける不具合を作らない)。

## 4. 暗黙同意の廃止

- 「一定期間ログインし続けた場合に同意したとみなす」「規約ページを開いただけで同意したとみなす」等の
  **黙示の同意を一切行わない**。
- 同意は、上記2節の同意画面でユーザーが明示的に同意操作(ボタン押下等)を行った場合にのみ成立する。
- 同意記録が存在しないユーザーは、新規ユーザーと同様に同意画面を経由させる(推測で「既に同意済み」と
  扱わない)。

## 5. 未接続の実装(誇張ゼロ・持ち越し事項)

- 実際の同意画面の route 配線(`consent-routes.ts`)は、w1-aut艦の所有ファイルであり、w2-sec艦が
  越境せず持ち越した(`docs/planning/c8/progress.json` V3-SEC-23 の note を参照)。本艦
  (docs/legal専用)も同ファイルへの編集権限を持たないため、本文書は**運用ルールの文書化まで**とし、
  route実装への反映は別途担当艦が行う。
