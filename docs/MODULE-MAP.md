# MODULE-MAP — 住所帳

**このファイルが艦別globの唯一の正本**(計画§7・draftsと食い違ったらこのファイルが正・食い違い自体をHQへ報告する。2026-07-31 n60w0fix T3・批評R0731-c70cca 中1是正)。

このモジュールがどこにあり、誰の担当かを1枚で引くための正本。
出典: `D:\claude\00-hq\R0730-ad0c0b-PLAN-ihl3-core-2026-07-31.md` §4(命名規則)・§7(艦別分割)。

## ニーモニック表

| ニーモニック | ドメイン(実態の名前) | registry接頭辞 | 実装glob | 担当艦 |
|---|---|---|---|---|
| `obs` | 観測登録 | V3-OBS | `observation-*`, `collector-*`, `device-*`, `taxon-*` | w1-obs |
| `mkt` | マーケット | V3-MKT | `market-*`(9本), `shop-*`, `fee-*`, `economy-constants` | w1-mkt |
| `plaza` | 知の広場(旧: 掲示板) | V3-BBS | `plaza-*`, `social-*`, `engagement-*` | w1-plaza |
| `know` | 知識・wiki | V3-WIK | `knowledge-*`, `source-*`, `tag-*`, `reference-counter` | w1-plaza |
| `gov` | 司法・ガバナンス | V3-GOV | `gov-*`, `proposal-*` | w1-gov |
| `ind` | 個体・ブリーディング | V3-IND | `individual-*`, `clutch-*` | w1-ind |
| `krm` | カルマ・貢献度 | V3-KRM | `contribution-*` | w1-gov |
| `ppr` | 論文・研究 | V3-PPR | `paper-match-*`, `research-*` | w1-ind |
| `aut` | 認証・アカウント | V3-AUT | `auth-*`, `session`, `mail`, `account`, `profile-*`, `settings-*` | w1-aut |
| `sec` | セキュリティ・法務 | V3-SEC | `authz`, `denylist`, `rate-limit`, `policy`, `pii-*`, `hmac` | w1-sec |
| `fnd` | 基盤 | V3-FND | `env`, `kv`, `index`, `batch-*`, `truth-backup-*` | w1-fnd |
| `i18` | 翻訳 | V3-I18 | `i18n*` | w1-fnd |
| `cst` | コスト・運用 | V3-CST | `costs-routes` | w1-fnd |
| `vid` | 動画・発信(分離) | V3-VID | (実装0件・実測) | Track V(分離) |
| `ui` | 画面 | V3-UIX | `apps/web`, `screen-defs` | Wave 4(後回し) |
| `aip` | 開発の決まりごと | V3-AIP | (コードではなく規律) | w1-aip |
| `oth` | その他 | V3-OTH | `github-*`連携ほか | w1-mkt |

## 艦別・書いてよい場所(排他glob)

| 艦 | 担当(件数: W1+W2) | 書いてよい場所(glob) |
|---|---|---|
| `w1-fnd` | fnd+cst+i18(13+13) | `apps/api/src/{env.ts,kv,batch*,truth-backup-connector,telemetry-merge,costs-routes,i18n*,script-driver*}*`, `libs/datalake/**`, `tests/{fnd,cst,i18,foundation,costs,datalake,script-driver}*`(★批評致命2反映: `env`→`env.ts`。`env-import-routes.ts`はw1-obsの明示所有。★2026-07-31 w2: `script-driver*`追加=V3-FND-20実装先・61代目HQ裁定(c)=次波でglob明示割当) |
| `w1-aut` | aut(12+9) | `apps/api/src/{auth-routes,session,mail,account,consent-routes,handle-routes,profile-routes,settings-routes}*`, `tests/{auth.test,auth-,aut-,account,session,consent,profile,settings,handle}*`(★批評致命2反映: `auth`前方一致が`authz.test.ts`(w1-sec所有)を飲むため限定化) |
| `w1-sec` | sec(20+18) | `apps/api/src/{authz,denylist,rate-limit,policy,pii*,hmac,key-bundle-routes}*`, `tests/{sec,authz,rate-limit,pii,policy,denylist,hmac}*` |
| `w1-obs` | obs(21+19) | `apps/api/src/{observation*,collector-routes,device-routes,env-import-routes,csv-import,freetext-parser,taxon-routes,thumbnail*}*`, `components/collector-switchbot/**`, `components/obs-manifest/**`, `tests/{obs,observation,collector,device,taxon,csv,thumbnail}*` |
| `w1-mkt` | mkt+oth(19+21) | `apps/api/src/{market*,shop-routes,fee-routes,payjp-connector,gmo*,economy-constants,ledger*,match-routes,github-issues-connector,github-webhook-routes}*`, `tests/{mkt,market,shop,fee,payjp,gmo,ledger,match}*` |
| `w1-plaza` | bbs+wik(17+19) | `apps/api/src/{plaza*,social-routes,engagement-routes,knowledge*,source-routes,tag-routes,reference-counter}*`, `components/wiki-ingest/**`, `tests/{plaza,bbs,wik,knowledge,social,tag,source,engagement}*` |
| `w1-gov` | gov+krm(16+24) | `apps/api/src/{gov-routes,proposal-routes,contribution*}*`, `tests/{gov,krm,contribution,proposal,dispute,vote}*` |
| `w1-ind` | ind+ppr(11+21) | `apps/api/src/{individual-routes,clutch-routes,paper-match*,research*}*`, `tests/{ind,individual,clutch,ppr,paper,research}*` |
| `w1-aip` | aip対応表(63+18) | 報告書のみ(コード0行) |

**全艦共通の不可侵**(§7): `apps/api/src/index.ts`・`package.json`(全階層)・`packages/schema-types/src/generated/**`・他艦のglob・`screen-defs/**`(UIは後回し)・`01-requirements/**`(読むのは自由)。

**★一時例外(2026-07-31 Wave2期間・V3-AUT-19是正)**: `apps/api/src/denylist.ts` は本来w1-sec globだが、AUT-19是正(失効理由コード追加)の中核のためWave2中は**autレーン(w2-aut)が一時所有**する。**w2-secはWave2中denylist.tsを編集するな**(読み取りは自由)。`ledger-routes.ts`(mkt)・`gov-routes.ts`(gov)へのAUT-19起因の1行変更はdiff-only(報告書に書きHQが適用)。是正完了後この例外は失効する。

新しいルートファイルを作った場合、`index.ts` への mount 行は艦が直接書かず、報告書に「追加すべき行と挿入位置」を明記してHQが検収時に適用する(mount順は `index.ts` の実装順に意味があるため。実在例: `homeRoutes`(index.ts:256)は `obsRoutes`(index.ts:269)より先にmountされている)。

## tests/ の未帰属ファイルについて(2026-07-31追記・批評R0731-c70cca 重大3是正)

上記の艦別globは既存の `tests/` 全183本のうち約61本(`cl-01`〜`cl-13`系・`check-*`系・`ai-*`系など)をどの艦にも割り当てていない。これらは既存テストの共有編集にあたるため、**触る必要が出た艦は書き換えず手を止め、レビューキュー経由でHQへ差し戻すこと**(計画§175の緩和策に準拠)。同様に `apps/api/src` 側にも `index.ts` を除く11本の未帰属ファイル(`ai-digest-routes.ts`・`ai-kernel.ts`・`culture.ts`・`cusb-routes.ts`・`home-routes.ts`・`index.test.ts`・`intent.ts`・`project-routes.ts`・`sandbox-routes.ts`・`theme-routes.ts`・`ui-constants.ts`)がある。これらの担当を新設・拡張するかどうかはHQの運用裁定事項であり、本ファイルは意図的に未確定のまま記録する(推測で艦を割り当てない)。

## 新設モジュールの標準構造(既存97ファイルはリネームしない・新設のみ適用)

新規ドメインを1本追加する場合、以下5つを対にする(全部揃えなくてよい。必要なものだけ作る):

| 層 | 実在パターン(命名規則) | 例 |
|---|---|---|
| api | `<domain>-routes.ts`(Hono ルーター。`apps/api/src/`直下) | `market-routes.ts`, `gov-routes.ts` |
| logic | `<domain>-constants.ts` / 補助ロジックを同ディレクトリに分離 | `economy-constants.ts` |
| ui | `apps/web/**` 配下(§10方針: 係数・鍵はロジック本体に埋め込まずconstants/env参照に分離) | (Wave 4以降) |
| page_info | `screen-defs/**`(このWave 0艦は不可侵。触らない) | — |
| threads | `tests/{domain}*`(vitest。ドメイン名プレフィックスで既存97本と同じ規則) | `tests/mkt-*.test.ts` |

## 出典・関連正本

- 計画正本: `D:\claude\00-hq\R0730-ad0c0b-PLAN-ihl3-core-2026-07-31.md` §4/§7/付録A
- 進捗分母: `docs/planning/c8/progress.json`
- 波検収: `scripts/wave-verify.mjs`
- 進捗マージ: `scripts/progress-merge.mjs`(Wave 1以降、艦はprogress.jsonを直接書かず、報告書に追記JSON行を貼り、HQがこのツールで適用する)
