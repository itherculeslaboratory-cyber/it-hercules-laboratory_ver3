---
id: RULING-2026-08-07-PAYMENT-RETIRE
title: ver3 ユーザー裁定記録 — 2026-08-07 決済方針裁定(PAY-1〜4 全て○。PAY.JP Platform撤回・銀行振込一本化・PayPay見送り・PAY.JP追加照会)
date: "2026-08-07"
status: active
---

# ver3 ユーザー裁定記録 — 2026-08-07 決済方針裁定(payment-retire)

> 入力(逐語原本): `D:\claude\00-hq\review-queue\R0807-e6552c-payment-policy-2026-08-07.json`(`user_ruling`欄。
> 回答=PAY-1:o / PAY-2:o / PAY-3:o / PAY-4:o、score=90、answered_at 2026-08-06T16:01:19.868Z)。
> 中間資料: 考える役 `D:\claude\00-hq\kits\lane-think\R0807-e6552c-REPORT-2026-08-07-payment-policy.md`(§2〜§6・裁定案の一次資料突合)。
> 発注書: `D:\claude\00-hq\kits\lane-implement\ORDER-2026-08-07-payment-apply.md`(発注者=準備HQ7代目)。
> 一次資料(PAY.JP/PayPay回答): `D:\claude\00-hq\kits\lane-madoguchi\R0806-d81e35-REQUIREMENTS-payment-provider-replies-2026-08-06.md`。
> 総数 773 → **773**(±0。新規採番なし・既存3件のpatchのみ)。
> req_status変更: 確定672→**669**(-3) / 確定(修正)93→**96**(+3)(V3-MKT-62/63/64 の3件が「確定」→「確定(修正)」)。
> wave変更: なし(3件とも wave は無変更)。
> 検算恒等式・件数突合は本記録 §7 参照(レジストリJSON実カウントを正とする)。
> ★**正直な記録(発注書「守れ」節の要求)**: PAY.JPの2026-07-17回答は**7週間ではなく約3週間(20日)**、資料(`status.md`)へ未反映のまま放置されていた。原因・再発防止は §6 参照。PAY-3(PayPay)についても、round-16裁定(2026-07-17)で「やる」と決めてから**3週間、1行もコードが書かれないまま**今回の見送り裁定に至った。両方とも「決めたのに動かなかった」記録として、書き換えず本ファイルに残す。

## 1. ユーザー回答原文(逐語・要約禁止)

### 1.1 カード「R0807-e6552c-payment-policy-2026-08-07」(score=90・2026-08-06T16:01:19.868Z)

| key | 回答 | コメント |
|---|---|---|
| PAY-1(PAY.JP Platformカード決済オプションの正式撤回) | `o` | 「出来ないもんはしょうがないです。」 |
| PAY-2(8/9は銀行振込のみで公開) | `o` | 「とてもいいですね。」 |
| PAY-3(PayPayを8/9スコープから外す) | `o` | (なし) |
| PAY-4(PAY.JPへ確認質問1問を送る。送信はユーザー) | `o` | 「送るメール文を明確にしてくれたら、送る手間はそんなないよ。ただまあ行けるとは思うけどね？」 |

good欄: 「いいんじゃね？」 / bad欄: (空)

## 2. 処置マッピング(§3)

| 原文の判断 | 対象ID | 処置 | R適用 |
|---|---|---|---|
| PAY-1 ○ | V3-MKT-62(既存patch) | statement からカード決済オプション記述を削除・superseded新設・req_status「確定」→「確定(修正)」 | R4(時代の重み。2026-08-07回答が2026-07-17裁定を上書き) |
| PAY-1 ○ の道連れ | V3-MKT-64(既存patch) | Platform従属のため発火条件消滅・superseded新設・req_status「確定」→「確定(修正)」 | R4 |
| PAY-2 ○ / PAY-1 ○ | V3-MKT-63(既存patch) | statement から「PAY.JP Platform経由取引のみ5%自動控除」を削除 | R4 |
| PAY-3 ○ | V3-MKT-63(既存patch・PAY-1と同一entryのため統合) | statement の「PayPay OPA承認後は支払手段にPayPayを追加する」→「PayPay追加は2026-08-07裁定で保留」・req_status「確定」→「確定(修正)」 | R4 |
| PAY-4 ○ | 新規採番なし・運用指示 | メール文面のみ作成(`D:\claude\00-hq\kits\lane-implement\R0807-111726-PAY4-mail-draft.txt`)。送信は人間ゲート(R1) | R1(対外操作は人間ゲート) |

## 3. 新規採番

なし(今回は既存3要件のpatchのみ)。

## 4. レジストリ変更仕様(適用済み)

`D:\claude\systems\ihl-ver3\01-requirements\registry.json`(トップ list)への適用。既存値は削除せず statement/req_status/superseded/ruling_note/sources へ append/patch のみ。

### 4.1 V3-MKT-62(`registry.json` 内 `id: "V3-MKT-62"`)

- `statement` 置換前(逐語): `"P2P決済ユーザー選択制: 買主→売主決済を取引ごとに①銀行振込(既定・無料・IHL非関与・本人確認なし)②PAY.JP Platformカード決済(オプション・テナント本人確認・5%自動控除)から選択できる。IHLは決済代行せず、売り=マッチング成立・情報の透明性・観測データ引継ぎとする。"`
- `statement` 置換後(逐語): `"P2P決済: 買主→売主決済は銀行振込(無料・IHL非関与・本人確認なし)の一方式とする。IHLは決済代行せず、売り=マッチング成立・情報の透明性・観測データ引継ぎとする。【2026-08-07裁定】PAY.JP Platformカード決済オプションは退役(superseded参照)。"`
- `req_status`: `"確定"` → `"確定(修正)"`
- `superseded`(新設): `"PAY.JP Platform(Payouts型)カード決済オプション+テナントKYC+5%自動控除は、2026-07-17付PAY.JP回答(プラットフォーマー契約は法人限定/本サービスにおける昆虫の売買は取り扱い不可)により実現不能。2026-08-07裁定で退役。P2P決済は銀行振込一本へ収束。"`
- `sources[]` 追加: `payjp-reply-standard-settlement-and-payouts-inquiry.txt`(2026-07-17・trust=高)
- `ruling_note` 追記(既存の第21回分は保持し ` | ` で連結): `"ユーザー裁定 2026-08-07: Platformオプション部分を退役(PAY.JP回答2026-07-17)。銀行振込既定部分は無傷で存続。"`
- `human_confirm`: `true`のまま変更なし(PAY.JP本番契約という人間ゲートは5%徴収側で依然として残るため)

### 4.2 V3-MKT-63(`registry.json` 内 `id: "V3-MKT-63"`)

- `statement` 置換前(逐語): `"5%システム維持費ゆる請求徴収: 取引完了後「計算して振り込んでね」方式でゆるく請求し、取り逃しを許容する(厳格強制せず負担金額と楽さを最優先)。PAY.JP Platform経由取引のみ5%を自動控除する。PayPay OPA承認後は支払手段にPayPayを追加する。振込名義コード(V3-MKT-12)で照合する。"`
- `statement` 置換後(逐語): `"5%システム維持費ゆる請求徴収: 取引完了後「計算して振り込んでね」方式でゆるく請求し、取り逃しを許容する(厳格強制せず負担金額と楽さを最優先)。PayPay追加は2026-08-07裁定で保留(決済代行会社経由必須のため・§(c))。振込名義コード(V3-MKT-12)で照合する。"`
- `req_status`: `"確定"` → `"確定(修正)"`
- 「5%システム維持費ゆる請求徴収」文と「振込名義コード(V3-MKT-12)で照合する」文は無変更(触っていない)

### 4.3 V3-MKT-64(`registry.json` 内 `id: "V3-MKT-64"`)

- `req_status`: `"確定"` → `"確定(修正)"`
- `superseded`(新設): `"V3-MKT-62 Platformオプションの退役(2026-08-07)に伴い発火条件が消滅。案内対象となるカード決済オプションが存在しないため退役。"`
- `statement`は無変更(条件文自体は歴史的事実として残す)

## 5. PAY-4(対外メール文面・人間ゲート)

R1(不可侵の人間ゲート=対外操作)に該当するため、実装レーンはメール文面の**作成のみ**を行い、送信はユーザーが行う。文面ファイル: `D:\claude\00-hq\kits\lane-implement\R0807-111726-PAY4-mail-draft.txt`。

## 6. 正直な記録(7週間表記の訂正・PayPay 3週間ゼロの記録)

- PAY.JP回答受領(2026-07-17)から発覚(2026-08-06)まで**20日(約2.9週)**。「7週間」は元カード・発注書の誤記で、約2.4倍の過大表記だった。カード本文・本記録では「約3週間」と正確に記載する。
- round-16裁定(2026-07-17)で「paypayもやっとこうよ」と決定してから、8/9直前の本裁定(2026-08-07)まで**3週間、`apps\`配下にpaypayという名前のファイルは0件**(実測)。「やる」と決めた機能が3週間動かず、そのまま8/9スコープ外という先送りになった、という事実を隠さず記録する。
- 原因の推定(考える役報告書§7-1): 「回答が届く先(ユーザー個人のメール受信箱)と、状態を書いている先(リポジトリのstatus.md)が、別人・別媒体で、両者を繋ぐ作業が誰の担当でもなかった」。
- 再発防止(8/9後に実施・8/9には効かない): `status.md`等の「回答待ち」表記に`recheck_by`日付を必須化し、`tools\check_claims.py`に期限超過WARNを1ルール追加する(新規常駐は作らない)。

## 7. 検算(必須・実測)

```
python -c "
import json, collections
d = json.load(open(r'D:\claude\systems\ihl-ver3\01-requirements\registry.json', encoding='utf-8'))
print('総数', len(d))
print('req_status', dict(collections.Counter(e['req_status'] for e in d)))
ids = ['V3-MKT-62','V3-MKT-63','V3-MKT-64']
for e in d:
    if e['id'] in ids:
        print(e['id'], '|', e['req_status'], '| superseded_set=', e['superseded'] is not None)
"
```

実行結果(実測・本記録作成時点):
```
総数 773
req_status {'確定': 669, '確定(修正)': 96, '棄却': 8}
V3-MKT-62 | 確定(修正) | superseded_set= True
V3-MKT-63 | 確定(修正) | superseded_set= False
V3-MKT-64 | 確定(修正) | superseded_set= True
```

- 総数恒等式: `669 + 96 + 8 = 773` = レジストリ総数773 ✅(新規採番0件のため総数は不変)
- 対象3件の反映確認: V3-MKT-62/63/64 いずれも `req_status = "確定(修正)"` に変わっており、3件を触ったことがレジストリ上で確認できる ✅
