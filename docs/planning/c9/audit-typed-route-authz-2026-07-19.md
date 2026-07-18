---
id: audit-typed-route-authz
title: T-71残スコープ監査 — apps/api 全typed route 所有者検証(authz)網羅監査
date: "2026-07-19"
status: active
audited_commit: e97aa96
scope: apps/api/src 書込エンドポイント約120件(43ファイル)
---

# T-71残スコープ監査報告(2026-07-19)

POST /events 生経路は allowlist(2951828)で封鎖済み。本監査は「typed route 側の所有者検証」を対象に、
apps/api/src の全書込エンドポイント(POST/PUT/PATCH/DELETE 約120件・43ファイル)を read-only 監査した。

## 結論サマリ

- **T-71主目的(POST /events allowlist)自体は SAFE** — exploitテスト95件で担保。
- **市場所有権譲渡(金銭級)の主経路は堅牢** — `market-routes.ts transitionActorGuard` / `source-routes.ts projectCurrentOwner`(persona R75/R3 明示コメント付き模範実装)。
- **最大の実害=GAP①**: 個体の核心書込route(親/名前/life-event/schedule)に所有者検証が丸ごと欠落。allowlist採用の前提「typed route側で所有者スコープが担保される」が個体routeで不成立。

## SAFE(検証済み・堅牢)

| route / file:line | 現状authz |
|---|---|
| `POST /market/listings/:id/transition`(transfer等) `market-routes.ts:329-360` | `transitionActorGuard` seller/buyer/party限定・kind別分岐で網羅 |
| `POST /market/offers` `market-routes.ts:734` | 自己出品拒否+ブロック関係チェック |
| `POST /market/reservations*` `market-reservation-routes.ts:254-520` | confirm/decline/match すべて当事者限定 |
| `POST /gov/disputes/:id/{messages,close,publicize}` `gov-routes.ts:231,285,328` | `isParticipant()` |
| `POST /gov/disputes/:id/votes` `gov-routes.ts:400` | 誰でも投票可(意図的open)・PT残高+1 actor 1票 |
| `POST /gov/flags` `gov-routes.ts:617` | `requireRole("operator","admin")` |
| `POST /plaza/threads/:id/resolution` `plaza-routes.ts:397-409` | root post作者限定(ownerId!==actorId→403) |
| `POST /clutches/:id/{events,promote}` `clutch-routes.ts:245,343` | 明示 Ownership guard(cd.actor_id!==actorId→403 NOT_OWNER)=**模範** |
| `POST /occupancy` / moveOccupancy / deriveDeviceBindings `source-routes.ts:265,394,502` | `projectCurrentOwner()`(市場transfer反映)=**模範** |
| `POST /devices/:id/test` `device-routes.ts:151` | d.actor_id!==actorId→404 |
| `POST /market/listings/:id/{flags,gov-stop,misban-reversal}` `market-flag-routes.ts` | 国スコープ+requireRole+投影ゲート |

## GAP①【高・修正実施対象】— 個体書込routeに所有者検証が皆無

`individual-routes.ts` 全体を `grep "FORBIDDEN|actor_id !==|actorId !=="` → **ゼロヒット**。所有者チェックが1行も無い。

| route:line | 現状 | 実害 |
|---|---|---|
| `POST /individuals/:id/parents` `individual-routes.ts:1259-1268` | 誰でも任意個体に親リンク追記 | **血統詐称**(buildPedigree/projectAuthenticity→市場評価額に直結) |
| `POST /individuals/:id/name` `individual-routes.ts:1297-1315` | 誰でも任意個体を改名 | 嫌がらせ・なりすまし |
| `POST /individuals/:id/life-events` `individual-routes.ts:1496-1527`(writeLifeEvent) | 誰でも任意個体に死亡/標本化を追記 | **市場妨害**(deriveLifeStatus→生死フィルタ/出品信頼性を破壊) |
| `POST /individuals/:id/schedule/generate` `individual-routes.ts:1536-1556` | 誰でも任意個体の予定生成 | 低実害 |
| `POST /observation/batch-commit` kind="life-event" `batch-commit-routes.ts:42-47` | writeLifeEvent の第二攻撃経路 | 上と同じ穴の別入口 |

**対比根拠**: 同codebaseの `clutch-routes.ts:245`・`source-routes.ts:253-266`・`market-individual-offer-routes.ts:85-88` が同一の「個体マスタ所有者と一致しなければ403」を一貫実装。個体書込routeだけ欠落=設計判断でなく実装漏れ。

**修正方針**: `source-routes.ts` の `projectCurrentOwner`(市場transfer後の現所有者を追跡=より正確)を parents/name/life-events/schedule の4route + batch-commit の life-event 経路に横展開し、`owner!==actorId`→403 FORBIDDEN を write前に追加。回帰exploitテスト(他人個体への parents/name/life-event 差込→403+Truth書込ゼロ)を追加。

**修正実施(2026-07-19・6ef28c3)**: 上記4route+batch-commit経路にガード追加=完了。parents/life-events は共有ヘルパ(linkParent/writeLifeEvent)にガードを集約し route と batch-commit の両入口を1箇所でカバー(根本原因修正)。`projectCurrentOwner` 再利用・新ロジックゼロ・循環import不要。回帰exploitテスト6本(tests/individual-authz-exploit.test.ts)=各経路で403+Truth書込ゼロ+市場transfer後に新所有者が書け旧所有者が書けないことを実証。敵対的批評家PASS(単一writer検証済=別の裏口無し・fail-closed確認)。

**A-1(批評家が敵対検証で発見・当初監査の見落とし・2026-07-19別コミットで解消)**: `POST /observation/schedule`(home-routes.ts:270-299)が schedule/generate と同じ `ihl.obs.schedule.v1` を任意 individual_id へ所有者ガードなしで書ける sibling door。低実害(injected record は actor_id=攻撃者・schedule読取は本人スコープで被害者に露出せず・pedigree/life-status/market値がscheduleを消費しない)だが「sibling caller still broken」パターンのため同一 projectCurrentOwner ガードを横展開して封鎖。

## GAP②〜⑤・GRAY①【中・朝カードで裁定】

修正方針に仕様意図の解釈が入るため、ユーザー裁定に回す。

- **GAP②(中)** `individual-routes.ts:1467-1492` lineage-doubt `action="withdrawn"` に raiser 検証なし。他人が提起した血統疑義を doubt_id を知るだけで取り下げ表示可(append-onlyなので原レコードは残存)。修正=raiser一致確認で403。
- **GAP③(中)** `market-individual-offer-routes.ts:32-37` `currentObserver` が市場transfer後の所有権移転を反映しない(master作成者固定)。正規売買後、offer-policy設定権/offers閲覧権が旧所有者に残る業務不整合。修正=`projectCurrentOwner`へ置換。
- **GAP④(中〜高)** `proposal-routes.ts:133-160` `hypothesis_transition` が投票収束を完全バイパス。誰でも任意proposalを state:"supported" 等へ直接設定可(CONVERGE_MIN_VOTES=3/SUPPORT_TRUST=0.6 を迂回)。修正=hypothesis_transitionは draft→hypothesis のみ許可・supported/rejectedは収束ロジック導出値に限定。※仕様意図の確認要。
- **GAP⑤(中)** `market-rating-routes.ts:94-127` POST /market/ratings に取引当事者検証なし。無関係listing_id+任意ratee_idで捏造評価を無制限投稿可(公開評価スコア汚染)。修正=取引当事者(seller/matched_with)検証。
- **GRAY①** `plaza-routes.ts:570-591,610-654` signals(like/use/retain)に actor単位dedupなし。gov.vote/theme投票はdedup済なのに信号系だけ抜け=単一actorがランキング(GOV-23 OS昇格)を吊り上げ可。修正=(actor,target,signal)単位dedup追加。

## 網羅性宣言

個別コード読解: index.ts / authz.ts / market-*(routes/reservation/rating/comment/block/flag/template/individual-offer) / theme / gov / plaza / contribution / shop / clutch / batch-commit / individual(write全) / source(全) / device / social / proposal / tag / taxon / project / research-*(store/content) / paper-match / match / handle / settings / gmo / home / collector / fee。
grep確認のみ(自己スコープ/me型 or 既存owner-check確認済): key-bundle / consent / pii / cusb / env-import / github-webhook / auth / profile / ai-kernel / ai-digest(requireRole) / sandbox / knowledge-lint / research-canonical / research-agent-batch。
