---
id: handoff-c9-close
title: C9クローズHANDOFF(2026-07-18) — 次スレ=wave1統合オーナー用
date: "2026-07-18"
status: active
---

# HANDOFF — C9第1ラウンド完走・クローズ(次スレ=wave1統合オーナー兼務)

> 次スレッドはこのファイルだけ読めば続行できる。前スレ(C9・2026-07-17夜〜07-18)は 構造正本承認→個体ファインダー3周判定(15点相当の反省→80点→**100点採用**)を完走した。台帳: `D:\claude\00-hq\TASK-LEDGER.md` T-62〜T-68。

## 貼り付け本文(新スレッド起動用)

```
D:\claude\systems\ihl-ver3 で起動して。
まず docs/planning/c9/HANDOFF-c9-close-2026-07-18.md を読め(現在地の正本)。
あなたはC9後継であり、wave1(ihl-obs/ihl-knw 並列)の統合オーナーを兼ねる。
00-hq\kits\ihl-waves\WAVE-DESIGN.md の前提3・完了ゲート4点・§6の統合オーナー注意に従うこと。
現在地の要約は §9(夜間ラン 2026-07-19 追記)を読め=main=5ca805a・夜間の基準固定タスク5項目完了・残るユーザー判定待ちは home v2採否のみ。
最初の一手: **home完成予想図v2の朝判定を確認**(`00-hq\review-queue\c9-home-forecast-v2-2026-07-18.json`)→ ○なら逐語採用+実データ配線でmain実装(現 038df97 の暫定homeを置換)・×なら §5-1 の必達5点でv3再作成。
```

## §1 現在地(main = `5ca805a` push済み・lint 22ゲート緑・E2E 178緑・pytest 49緑・vitest api1488/web196)

> **最新は §9(夜間ラン 2026-07-19)を読め**。本§1〜§8は 2026-07-18 クローズ時点の記述。§9以降で main は `038df97`→`5ca805a` へ進行(OBS wave1統合 / chrome剥がし / T-71残監査+セキュリティ硬化7件 / plaza-post CTX-1)。ホームは v2予想図を投函済みで**朝判定待ち**(§9末尾)。
> **本スレッド(2026-07-18〜19 クローズ時)の進捗**: レンダラ版2画面撤去(§5-2)完了 → T-71(POST /events allowlist)統合 → ホーム3ラウンド。詳細は§8。

### 完了(ユーザー判定済み)

| 成果 | 判定 | 実体 |
|---|---|---|
| 構造正本(画面マップ9ゾーン+語彙10語) | 承認(一発・R50) | `docs/planning/c9/structure-canon.md` = **active・凍結**(wave前提1。変更はC9差し戻しのみ) |
| 個体ファインダーMVP(レンダラ版) | 80点採用(R51) | `/s/individual-finder`+`/s/individual-universe` — **caseB7直系版に置換済み・撤去提案中**(§5-2) |
| **caseB7直系ファインダー+宇宙(正)** | **100点採用(R54)**「完璧!導線も最高!UXめっちゃいい」 | `apps/web/public/finder/{finder,universe}.html`+`lib/`(Tabulator/3d-force-graph=MITローカル同梱・finder-data.js)。実API配線・全幅レイアウト・血統発光・テーマ切替(T-68=12/12検証) |
| 要件採番 | round-17 | V3-UIX-83(registry 749→750検算OK)・srs v1.11 |
| T-64(既存バグ根治) | 批評家PASS | QR再開E2E期待陳腐化+**実バグ**(renderer.tsx measureValueの文字列型計測値破棄=成長チャート欠落)+sec-58 fake timers化 |
| 決済の最適形 | 照会2通で確定 | ユーザー間=銀行振込直接+5%=PAY.JP通常決済(利用開始OK回答済)。Platform型=閉鎖(法人限定+昆虫不可)。PayPay=代行会社経由のみ→**質問シート裁定待ち** |

### 進行中

- なし(ライトモード修正はクローズ前に完遂→§8)。

### 未着手/後続波

1. **レンダラ版2画面の撤去**(§5-2・提案済み): `/s/individual-finder`・`/s/individual-universe`(screen-defs 2+renderer専用ノード2+E2E spec 2)。**残すもの**: `GET /individuals/pedigree-links` API・`universe-utils.ts`/`individual-finder-utils.ts`(caseB7版のfinder-data.jsの参照元アルゴリズム・テスト付き)・`theme.js`。
2. known minor 4件(批評家advisory): 欠測個体の減光表現未実装 / 原型由来「HERAKLES 3D UNIVERSE」表記(多種族に不正確) / `#mockbadge` 旧id名残 / 多種族テストデータ時のチップ棚と凡例の重なり。
3. 波4=胸角mm・色系統sort(OBS測定スキーマ拡張+OBS-14/46/47結線が前提・design-individual-finder.md §5)。波5=画像類似(embedding・DINOv2)。
4. c8残: in_progress 26件残余・best-effort 147件(`docs/planning/c8/progress.md`)。

## §2 進行中worktreeの状態

- **アクティブな作業レーンなし**。C9の全レーン(T-63/T-64/T-66/T-67)はmainへ統合済み。
- `.claude/worktrees/` に**32本のstale worktree**(過去workflow/agentの残骸・全て統合済みか放棄済み)。`git worktree prune`+ディレクトリ削除で整理可だが急がない。**wave1ゾームはこれらを再利用せず、キット手順で専用の長寿命worktreeを新規作成する**。
- working treeの恒久的な未ステージ変更3件(触るな): `docs/planning/rulings/round-16-question-sheet.md`(**ユーザー回答用紙・stage/checkout絶対禁止**)・`docs/planning/c9/screens/individual-finder-{filtered,detail-pedigree}.png` 2枚(旧版スクショの無害な残骸)。
- **稼働中デモ環境**(ユーザーが触る・恒久停止禁止): wrangler api :8798(`--persist-to` 隔離ストア=クリーン14体3世代)+next dev :3098+TLSプロキシ :3099。入口= `https://ihl.tail4ae0a0.ts.net:3099/finder/finder.html`。再起動= `D:\claude\00-hq\review-queue\assets\c9-r1-finder-demo\open-finder-demo.cmd`(停止=stop-finder-demo.cmd)。実ローカルTruth(`apps/api/.wrangler/state`)とは分離されている。

## §3 共有コンポーネント/スキーマの現況(統合オーナー管轄・ゾームは変更提案のみ可)

| 資産 | 現況 |
|---|---|
| `schemas/screendef/screendef.schema.json` | nodeType に individual-finder / individual-universe 追加済み(codegen済み) |
| `apps/web/src/renderer/renderer.tsx` | 専用ノード2本追加(search-navigator同型・撤去候補§5-2)。**measureValue/TimelineRowの文字列計測値コアーション修正済み**(全ゾーンの成長チャートに効く共有修正) |
| `apps/web/public/assets/theme.js` | HQ `dashboard/assets/theme.js` の複製(hqThemeキー・`<html data-theme>`・🌓自動注入)。**HQ側と二重管理** — 片側を更新したらもう片側へ同期すること |
| `apps/web/src/app/tokens.generated.css` | `data-theme` 上書きブロック実在だが**アプリ本体の切替配線は未実装**(caseB7ページのみtheme.js使用)。全アプリ展開はこの規約に乗せる |
| `screen-defs/navigation.json` | individual-finder/universe追加済み。home→`/finder/finder.html` は**href直リンク**(ScreenDefのnavigateは`/s/<id>`固定のため。ボタンでなくリンク表示になる制約あり) |
| `scripts/check-ui-tokens.mjs` | `apps/web/public/finder/lib/`(vendored第三者CSS)の除外を追加済み |
| `apps/api/src/individual-routes.ts` | `GET /individuals/pedigree-links` 新設(read-only投影・actor自己スコープ・Truth書込ゼロ) |
| 要件 | registry.json=**750件**(V3-UIX-83)・srs=**v1.11**・rtm/file-board-registryはcodegen再生成運用 |
| E2E | ベースライン**175本**(レンダラ版2画面撤去でspec 2本減・§8)。`finder-pro.spec.ts` がcaseB7版の通しフロー |

## §4 有効裁定と人間ゲート残

**有効裁定(尊重)**: 構造正本承認(R50)/ caseB7直系版=正・100点採用(R54)/ **UIラウンド既定プロセス=「完成形の実物採用+配線のみ・1判断1カード・触れる入口必須・両モードスクショ」**(R50/R51/R52/R54)/ 完成済みの仕組みは次画面から標準装備で横展開(R53)/ 取引中=独立画面・話し合いの場=汎用調停 / Q-META-01(未回答=推奨採用で自走)/ 決済確定形(§1表)。

**人間ゲート残(AIは触らない・一覧提出のみ)**: 公開の実施 / 実鍵・KV投入 / Truthバックアップ(B2)実契約 / cutover / 物理印刷治具 / 裁定3件(V3-SEC-03・V3-AUT-15・V3-AIP-92※推奨付きでc8 HANDOFF§0) / PayPay追加採否(次の質問シートで裁定・勝手に進めない) / PAY.JP通常決済の本番申込 / tailnet HTTPS serve有効化(任意・login.tailscale.comで1クリック→自己署名TLSプロキシ退役可) / **wave1の2スレッド起動の実行**(常駐トークン消費の開始=ユーザー判断・WAVE-DESIGN人間ゲート節)。

## §5 次の一手(順)

> **【2026-07-19 更新】§5-1のホーム完成予想図v2は作成・投函済み(§9参照)。朝判定待ち。以下の必達点はv2作成時に履行済み=×差し戻しでv3を作る場合の参照要件として残す。**

1. **ホーム完成予想図v2**(作成済・`c9-home-forecast-v2-2026-07-18.json`=ready・朝判定待ち)。R108=×50点「前よりよくなった」だがIA/ナビ不合格を受けて再提示。**v2必達点(v2で履行済・v3が要る場合の参照)**:
   - ① 4主要動線=**観測を始める/個体を探す/知の広場/マーケット を同列primary**で強調(飼育者の一次動線)。
   - ② 項目過多を解消し**二次項目をグルーピング**(テーマ⊂UIテンプレート・コスト/デバイス⊂設定)。
   - ③ 用途不明・内部語ラベル(「ガイドを選ぶ/突き合わせ/種図鑑/ステータス」)を**撤廃 or 用途1行明示**(R79内部概念露出禁止)。
   - ④ **機能を黙って落とさない**=愚痴・改善の吐き出し場所(HAN=話し合い)を明示配置。
   - ⑤ **ユーザーの直接質問に必ず明示回答**=UIbuilderは廃止か後回しかをカード本文で回答(沈黙=不誠実)。
   - **戦略意図(HQ 22:52-53・最重要)**: (a)**UIbuilderは絶対に落とさない**=T-22ライト/ヘビーUI+テンプレfork=「全観測対象・全員に対応」の中核機構。最低でも入口の置き場所を確保。(b)ごちゃつき是正=機能削除でなく**観測対象フィルタリング**(その人の観測対象で文脈適応)。(c)絞り込み手段=**アキネーター(ガイド式Q&A)/生物学分類(タクソノミー)/検索**が既存 — 消えている。「ガイド選ぶ/突き合わせ/種図鑑」=これらの不明瞭ラベル版と推定。実装現況を確認し「観測対象を絞り込む」ツール群として正しく再ラベル・グルーピング(アキネーター=ガイド選択/タクソノミー=種図鑑/検索)。
   - 作り方=**完成予想図ファースト厳守**(R103学習=[[existing-renderer-is-30pt-drag]])。既存renderer上に建てず、絵→承認→逐語採用+実データ配線。ラベルは平易語(R79・[[decision-cards-plain-language]])。
2. **wave1通知の確認**: `00-hq\review-queue\` に `NOTIFY-C9-wave1-start`(proj: ihl-ver3・status: ready)が投函されていないか確認。あればwave1稼働中=統合オーナー業務開始。`00-hq\FLEET.md` で稼働状況を確認。
3. known minor 4件+`.civ-pedigree-*` 6クラス(消費者ゼロ疑い)の掃引(小・§1後続2・§8末尾)。
4. 以後はwave1統合オーナー業務(§6)を軸に、ENTRY/HOME(wave0担当ゾーン)のラウンドを1判断ずつ。

## §6 wave1統合オーナーとしての注意(WAVE-DESIGN.md要点+C9の実地知見)

**WAVE-DESIGNの拘束(必読・`00-hq\kits\ihl-waves\WAVE-DESIGN.md`)**:
- 前提3: ①構造正本は凍結(ゾーン境界変更はC9差し戻し) ②ゾームは専用長寿命worktreeで作業し**mainへ直接pushしない** ③共有資産(§3の表)の変更はゾームからは**提案のみ**・実装統合はC9(あなた)だけが行う。
- wave1完了ゲート4点: ゾームworktreeでlint/E2E/pytest緑 → 批評家(opus)blocking0 → ユーザー判定GO(proj: ihl-obs / ihl-knw) → **あなたがmainへ統合し統合後もE2E全緑**。4点揃うまでwave2は起票しない。
- wave2候補=IND+ファインダーだが、**ファインダー本体はT-63/T-67で実装済み**のため実質スコープはIND残り画面のみ(WAVE-DESIGN §wave2の注記どおり)。

**C9実地で踏んだ罠(統合作業で必ず効く)**:
- **E2Eはmain直下で実行できないことがある**: 稼働中デモ(next dev)が `apps/web/.next` のロックを保持。実績のある回避= 一時worktreeにmainをcheckout→`npm install`(またはrobocopy+workspaceシンボリック再作成)→`.dev.vars`複写→全suite実行→worktree撤去。
- **ポートの取り合い**: 8787/3000はデモ・HQ serve.py・E2Eが衝突する。playwrightの`reuseExistingServer`が**他人の古いサーバに吸着して古いコードをテストする事故が実際に起きた** — 検証は必ず専用ポートを明示。
- **E2Eは本物ローカルTruthに書き足す**(append-only=消せない)。種族チップ等がテスト残骸で汚れるため、**ユーザー判定材料の撮影は必ず `--persist-to` の隔離ストアで**(クリーン14体ストア=§2参照)。
- 統合は1本ずつmerge・生成物conflictは手で直さずcodegen再生成。`npm install`を忘れると新依存でvitestが落ちる。
- ワーカーBash事故で0バイトファイルや`nul`がrepo直下に生まれることがある(lint赤の原因・削除でよい)。
- **判定の出し方**(persona確定): 1判断=1カード・queue JSONの`proto`欄を空で投函しない(触れる入口必須)・スマホ到達はTLS(自己署名)+dev-loginボタンの構成が実績・ライト/ダーク両モードのスクショ・「この判断に含まないこと」を明記。
- theme.jsを載せた画面は**全チップ/ボタンのactive状態を両モードでスクショ検査**(R54の残欠陥の再発防止)。

## §7 参照索引

- wave: `00-hq\kits\ihl-waves\WAVE-DESIGN.md` / `00-hq\kits\ihl-obs\` / `00-hq\kits\ihl-knw\` / `00-hq\FLEET.md`
- 品質: `D:\claude\00-hq\QUALITY-PLAYBOOK.md` / `00-hq\feedback\persona-model.md`(R45〜R54が本ラウンドの学習)
- 設計: `docs/planning/c9/structure-canon.md`(凍結正本) / `docs/planning/c8/design-individual-finder.md`(波4-5の残スコープ定義)
- 裁定: `docs/planning/rulings/user-ruling-2026-07-18-round-17.md` / round-16一式 / `inquiry-replies/`(決済照会原本)
- 判定履歴: `00-hq\review-queue\c9-r1-{structure-canon,finder-mvp,finder-pro}.json`(100点の逐語はfinder-proのfeedback)
- デモ運用: `00-hq\review-queue\assets\c9-r1-finder-demo\`(bat/README/隔離ストア)

## §8 追記欄(クローズ直前の更新)

- **ライトモード修正: 完了(`0ab8d07` push済み)**。原因=原型CSSの `.chip.on.all` が文字色を `#0d0f13` にハードコード(背景はテーマ変数`--fg`)→ライトで黒地黒文字。`[data-theme="light"] .chip.on.all{color:var(--bg)}` を両ページに追加(原型は無改変・additive)。同型掃引の結果、該当は「全種族」チップ2箇所のみ・他のactive/hover状態は両モード健全。ダーク無回帰をスクショで確認。check-contrastゲートはpublic配下の素HTMLを走査しないため機械検知できなかった(将来の改善候補)。
- 注意: `docs/planning/c9/screens/universe-pro-light-1920.png` は**修正前に撮った旧版**のため黒ピルが写ったまま(実物は修正済み。撮り直しは急がない)。
- **【後継スレッド追記 2026-07-18】§5-2撤去=完了**(main統合 `52800b9`・E2E 175/175・+11/-1788)。**E2E隔離の追加罠**(§6の罠リストに追加・wave1ゾームも必ず適用): ①`next.config.mjs`/`middleware.ts`/`lib/api.ts` は `NEXT_PUBLIC_API_URL` 未設定時 8787 固定フォールバック→専用ポート隔離時は playwright.config の webServer `env` に必ず明示(渡さないと外部8787へ黙って接続=テスト汚染) ②前ランの孤児devサーバの残留に注意(kill はコマンドラインでポート限定を確認してから) ③worktree の `.wrangler/state` 残渣が偽API 500を生む(実行前クリア)。**採番訂正**: 本書の「R54」はHQ正本では**R70**(採番はHQ専任・T-67行注記)。

- **【後継スレッド追記 2026-07-18】T-71(POST /events恒久硬化)=完了**(main統合 `2951828`)。POST /events を自己サービス型allowlist化(`SELF_SERVICE_EVENT_TYPES`={ihl.ui.vote.v1/ihl.process.intent.v1/ihl.test.sample.v1}以外はfail-closed 403)。回帰exploitテスト95件(owner-b-probe→403+Truth書込ゼロ等)。ユーザー承認R91・敵対的批評家PASS。設計doc=`docs/planning/c9/design-events-allowlist.md`。**残**: promote/role整理は台帳T-71=◐。

- **【後継スレッド追記 2026-07-19】ホーム(ENTRY/HOME wave0)=3ラウンド実施・まだ未確定(§5-1最優先)**。経緯:
  1. **R2 ジャーニー選定**: J-A(再訪ホーム司令塔)/J-B(初回オンボーディング)/J-C(取引中独立画面)の3案カード。当初 dev用語(`home.json`等)露出で**30点**→平易語カードに是正(教訓memory=[[decision-cards-plain-language]])。ユーザー裁定 **J-A=○/J-B=×(backlog)/J-C=×(暫定保留)**。
  2. **R103 磨き版=30点差し戻し**「既存が足引っ張ってると思います。作り直してください」。全ゲート緑・批評家PASS・実データでも30点=**KNW stage1(R90)と同型の既存表現層ドラッグ**。教訓memory=[[existing-renderer-is-30pt-drag]]。磨き版カード `c9-r3-home` はクローズ・実装は `038df97` にmain統合されているが**暫定**(v2承認で置換)。
  3. **完成予想図ファーストへ転換**→ KNW100点mockupの視覚システムを型に全幅・両テーマ・平易語のホーム完成予想図を新規作成(既存renderer不使用)。触れるproto=`/mockups/c9-home-forecast.html`。カード=`c9-home-forecast-2026-07-18`。
  4. **R108 =×50点**「前よりはよくなりました」だが**IA/ナビ差し戻し**。→ 次はホーム**完成予想図v2**(§5-1の必達5点+戦略意図=UIbuilder中核維持・観測対象フィルタ)。ビジュアル前進は◎・予想図ファースト転換自体は◎、詰めるのはIA。
  - **未処理queueカード**: `c9-home-forecast-2026-07-18`=answered(R108)。次アクション=v2予想図カードの新規投函(未着手)。

- **残escalation/掃引レーン**: `.civ-pedigree-*` 6クラスも消費者ゼロの疑い(撤去ノードと同根)— known minor掃引レーンで裁定する。HQ R103系統エスカレーション=全ゾーン共通の表現層方針「既存renderer上に建てず予想図/実物を採用」の平台確立(chrome strip R95/共有レイアウトSL-1/2と束ねる)は未完=v2設計に織り込む。

## §9 夜間ラン追記(2026-07-19・OVERNIGHT-BRIEF固定基準タスク)

> このラウンドは味判定を要さない「基準固定・検証可能」タスクのみを実行(R109)。味が要る採否は朝カードへ投函。

### 完了(main統合・確定)
- **OBS wave1統合=完了**(`e97aa96` push済)。wave1-obs 8コミット(qr-resume/qr-multi/棚紐づけ+所有権authz/バッチ正直表示/昇格確認フロー/昇格・クラッチ所有権)を `--no-ff` 統合。reconcile裁定どおり main allowlist(2951828)採用・ブランチdenylist(e7dc7af)破棄+残存参照ブロック除去(放置すると POST /events が ReferenceError 500 になる罠を修正)・denylist専用テスト1本削除。ゲート: lint21緑/api+tests 1460/1462(残2=既知の無関係flake・pre-merge再現確認済)/web vitest198緑/pytest49緑/**E2E 178/178緑**(隔離worktree・wave1新spec3本)。統合カード `obs-wave1-integrate-to-c9`=answered刻印・FLEET/台帳T-69更新済。

### 朝カード投函(味/裁定=ユーザー判定待ち)
- **ホーム完成予想図v2=作成完了・朝カード投函**(`c9-home-forecast-v2-2026-07-18.json`=ready)。§5-1必達5点(4主要動線=観測/個体を探す/知の広場/マーケットを同列primary・二次項目グルーピング・内部語ラベル撤廃/用途明示・話し合いの場明示・UIビルダー廃止せず中核維持を本文明示)+戦略意図(観測対象フィルタ=アキネーター/種図鑑/検索の再ラベル)を履行。実物=`00-hq/dashboard/mockups/c9-home-forecast-v2.html`(既存renderer不使用・KNW100点視覚システム流用・全幅両テーマ)。独立批評家(opus)PASS blocking0+統合オーナー目視PASS(両テーマ×1920/390)。**調査知見**: 「観測対象を特定する」3モードは `screen-defs/obs-navigator.json` に実装済(名前検索/はい・いいえ二分探索/分類ツリー)だがホーム直入口が無くネストに埋没=v2で表出。閲覧図鑑(種図鑑)は非実在=「分類からたどる(拡充中)」と正直表示。UIビルダー本体(T-22 3ペイン)は未実装ゆえ入口のみ確保が実態と一致。旧ラベル「ガイドを選ぶ/突き合わせ/種図鑑」はコード上に文字列非在=HQ推定ラベルだった。
- **セキュリティ中程度5件=朝カード投函**(`sec-typed-route-authz-audit-2026-07-19.json`=ready)。下記T-71残監査の産物。SEC-A2〜A6(血統疑義取り下げ/オファー権のtransfer追随/仮説昇格の投票収束バイパス/評価の当事者検証/広場信号のsybil dedup)=修正方針に仕様解釈が入るため裁定へ。

### T-71残監査=完了(監査正本 `docs/planning/c9/audit-typed-route-authz-2026-07-19.md`)
- apps/api 約120書込エンドポイント(43ファイル)をread-only網羅監査。**市場所有権譲渡(金銭級)主経路=SAFE**(`market-routes.ts transitionActorGuard`/`source-routes.ts projectCurrentOwner`=persona R75模範実装)。OBS側typed writer(占有/昇格/クラッチ)もSAFE。
- **GAP①(高・IDOR)発見→夜間に修正実施中**: `individual-routes.ts` の個体書込route(parents/name/life-events/schedule)+batch-commit life-event経路に所有者検証が皆無(grep ゼロヒット)=他人の個体IDを差し込むだけで血統詐称/改名/死亡記録捏造が通る。allowlist採用の前提「typed route側で所有者スコープ担保」が個体routeで不成立=実装漏れ。受入基準が明確(既存 projectCurrentOwner 横展開+fail-closed 403+回帰exploitテスト)ゆえ味判定不要と判断し修正レーン起動(コミット後push前に批評家ゲート)。

### 共有chrome剥がし(STRIP-1/SL-1/SL-2・R95承認済)=**完了・push済(`79a9272`+`1d5a18a`)**
- 撤去: ScreenBoardsFooter掲示板ピル/共有フッター(愚痴・改善/投票・Fork/Builder)/dead promotePending。全幅化: `.civ-page` 720px→1160px(home限定wideフック削除=挙動同一)。**重要発見**: 仕様の「①左下N-FAB」は**アプリ実体として非在**=Next.js dev-mode indicator badge(`next dev` 時のみ描画・本番非在)だった。偽FAB要素をでっち上げず根本原因 `next.config.mjs devIndicators:false` で対処。KNW評価スクショはdev起動で撮られこのbadgeを実app chromeと誤認していた=**評価スクショはビューポート撮影推奨**の教訓。掲示板本体/API/screen-defsは無傷(入口ピルのみ撤去)。独立批評家=B-1(promotePending読取1行残存でtsc赤)差し戻し→`1d5a18a`で1行削除して緑化→PASS。

### GAP①/A-1 個体書込authz硬化=**完了・push済(`6ef28c3`+`02f6b26`)**
- GAP①: 個体書込4route(parents/name/life-events/schedule-generate)+batch-commit life-event経路に所有者検証(`projectCurrentOwner`・fail-closed 403 NOT_OWNER)。共有ヘルパ(linkParent/writeLifeEvent)にガード集約で両入口を1箇所カバー(根本原因修正)。回帰exploitテスト6本(403+**Truth書込ゼロ**+市場transfer後の所有権追随を実証)。**敵対的批評家PASS**(単一writer検証=裏口無し)。
- A-1(敵対批評が発見のsibling): `POST /observation/schedule`(home-routes.ts)も同じ `ihl.obs.schedule.v1` を無ガード書込→同一パターンで封鎖。低実害だが「sibling caller still broken」除去。

### 統合検証(push前・隔離worktree)=全緑
- HEAD `02f6b26` で lint21/api1469/web196/tsc clean/pytest49・**E2E 178/178**(隔離worktree・回帰なし)。chrome撤去要素はE2E非依存(grep確認)・authz追加の正常系(所有者本人操作)無回帰を obs/finder/individual系specで確認。監査正本を `923c22f` で追加しスタック全体を **push済(e97aa96..923c22f)**。
- **E2E設計課題(申し送り)**: 全E2E specが `http://127.0.0.1:3000`/`:8787` をハードコードし playwright.config のポートを読まない=隔離/並行E2Eが別ポートで走らない。並行E2Eが恒常ニーズになるならチケット化。

### セキュリティ中程度5件(SEC-A2〜A6)=**完了・push済(`871f339`〜`ed3c51b`)**
- ユーザーがハブで裁定(07-19 1:28・R113・全5○・60点)=推奨案どおり実装解禁。A2=疑義取下げraiser本人限定(`871f339`+是正`ed3c51b`) / A3=オファー権をprojectCurrentOwnerへ(`384cd89`) / A4=hypothesis_transitionをdraft→hypothesisのみ(`6831ef2`) / A5=取引評価の当事者検証(`9cf211c`) / A6=plaza信号1人1dedup(`abad663`)。5件別コミット+各回帰exploitテスト。
- **敵対的批評家=A3〜A6初回PASS・A2はFAIL→是正**: A2の初版は「最新raiser」基準のため **doubt_idスクワット攻撃**(攻撃者が被害者のdoubt_idにraisedを後付け→最新raiser乗っ取り→withdrawn通過)を批評家が実exploitで実証。`raisedRows[0]`(最古=原提起者)基準へ是正+squat回帰テスト(`ed3c51b`)。**批評家ゲートが「修正のつもりが迂回可能」を捕捉した好例**。
- 統合検証(push前・隔離worktree): lint21/api1486/web196/tsc clean/pytest49緑・E2E 177/178(1件=obs-register-batchのload flake・SEC diff無関係を単独緑で二重実証)。カード=`sec-typed-route-authz-audit-2026-07-19.json`=answered。
- **advisory残(次スライス・今回対象外)**: 最古raiser是正後もsquat-raised行は残り、projectLineageDoubts(doubt_id単位LWW)で表示reason/actor_idを上書きしうる。doubt_idを提起者スコープに縛るか投影を提起者別に分離する検討。

### plaza-post 個体任意参照(CTX-1・R104承認済)=**完了・push済(`5ca805a`)**
- `schemas/events/plaza-post.schema.json` に任意 `context_individual_id`(string・minLength1・required外・additionalProperties:false維持)追加+codegen再生成(schema-types/validators)+POST /plaza/posts に1行パススルー(既存 correction_of と同型・putEventAt append-only経路)。**新規保存ゼロ=reuse-first**(KNWは既存 GET /individuals/:id/profile を read-join して環境/血統/令チップ描画)。独立批評家PASS(codegen整合=99 files in sync・既存consumer無影響・テスト実効)。**残**: KNW側の参照付与UI+ctx-chips描画配線はKNWレーン担当(基盤側の1点のみ完了)。

### 次スレッドの現在地(§5更新)
- main = **`5ca805a`**(夜間ラン全push済)。**夜間の基準固定タスク5項目=全完了**(OBS統合/home v2投函/chrome剥がし/T-71監査+承認修正7件/plaza-post)。残るユーザー判定待ち= **home v2採否のみ**。
- §5-1「ホーム完成予想図v2」= **作成・投函済**(`c9-home-forecast-v2-2026-07-18.json`=ready・採否は朝判定待ち)。承認されたら逐語採用+実データ配線でmain実装(現 `038df97` の暫定homeを置換)。
- 次アクション候補: home v2採用後の実装配線 / KNWレーンへ「CTX-1基盤完了=UI配線可」通知 / known minor 4件+`.civ-pedigree-*` 掃引 / SEC advisory(doubt_id提起者スコープ)。

## §10 総力戦ラン追記(2026-07-19・C9統合オーナー・外出モード)

> このセッションは DISPATCH-c9.md の裁定済み固定基準タスク+着弾カードを外出モード(R129・Monitor駆動)で実行。正本レポート= `D:\claude\ops\REPORT-c9-final-run-2026-07-19.md`。

### 完了・push済(main = `d3283cb`)
| 成果 | commit | 検証 |
|---|---|---|
| **structure-canon v2 焼き込み**(観測対象=グローバル文脈スイッチ・IA正本v2=R115・語彙#11・§2ヘッダーchrome・§5配置原則4問・§7種族の本・fidelity注記5点) | `12dd2d5` | lint22緑 |
| **KNW wave1 main統合**(知の広場7コミット・reconcile=ScreenBoardsFooter復活回避/plaza両側共存/陳腐化テスト是正) | `1cf1c89`+`3d8b764` | **E2E 178/178緑(clean Truth)**・lint22/tsc/web225/tests1488/pytest49 |
| **第18回裁定(round-18)反映**(fidelity F-1〜F-6全○/R135余波/改善艦F-2ドラフト R136・新規7件+patch9件+hold2件・統合オーナー批評家ゲート3点是正) | `0b30732` | 検算757/663/91/3・波363/237/21/136・srs v1.12 |
| **SW-1: plaza-postに任意species_id**(種族の本R133基盤・CTX-1同型・reuse-first) | `3986db0` | lint22/api8/contract53緑・codegen同期 |
| **設計書鮮度是正**(status.md C9トラック追加+srs §5.2.10「憲法」用語曖昧性解消) | `2e11e8f`+`d3283cb`(csv再生成) | lint22緑 |

### 判定カード投函済(ユーザー判定待ち・ハブ)
- `c9-header-selector-scope-2026-07-19`(HDR-1/HDR-2): **ヘッダー観測対象セレクタの範囲2問**。調査で判明=species/lineageは3ドメイン(個体/クラッチ/観測capture)のみ実在・市場/広場/研究は種族フィールド不在(スキーマ設計判断先行)・共有filter基盤ゼロ(44ファイル個別store())・識別子3系統分裂。**A1#4「全listエンドポイント」は一夜達成不能=複数スライス**。HDR-1=3ドメイン先行+段階拡張(推奨○)/HDR-2=系統/血統=lineage_idタグで確定(推奨○)。
- `c9-secondbrain-attribution-2026-07-19`(SB-1): **AIセッション・secondbrain帰属否定**(R135-b)。該当=V3-WIK-17(記憶ボタン/SoulProfile)・V3-WIK-28(Cursor AIセッション/サブ脳)の2件をhold中(V3-WIK-16=記事/ブログCMSは正当で対象外に是正)。棄却/外部切出し/存置の3択(推奨=棄却)。

### 着弾カード処理済
- knw-to-c9-shared-layout(SL-1/SL-2=○R132)・obs-r1-nav-edge(NAV-OBS-QR-1=○R132)=**先行統合作業で全ifYes実行済み**(NAVエッジ=OBS統合e97aa96に在・SL-2=ScreenBoardsFooter除去0/devIndicators:false・SL-1=.civ-page 1160px)。SL-1のlist/table系さらなる全幅化はヘッダーセレクタ実装スライスで扱う。

### home v2=完了・**実機○採用70点(R157・2026-07-19)**・push済(`842a71d`・独立検証全緑+reviewer PASS)
- **R157 bad対応(次スライスで必須)**: ユーザー「観測対象を特定するは、ヘッダーにあるから、ホーム画面の中にあるのおかしくない?」=正当。**ホーム内の「🔎 観測対象を特定する」ブロック(HomeDashboardNode renderer.tsx ~L6896-6935・obs-navigator3枚)は撤去し、ヘッダー観測対象セレクタへ一本化**(hq_note「その際」=ヘッダーセレクタ実装スライスと同時。ホーム内には残さない・省略した観測対象タグの復活先もヘッダーのみ)。現状header「観測対象を探す」→obs-search / home内3枚→obs-navigator(別画面)なので、セレクタ実装時にobs-navigator3モードをヘッダーに載せ+home内ブロック撤去+ctxタグ復活を一体で行う。
- HomeDashboardNode(KnowledgeHubNode同型・mockup逐語+実データ配線fetch3本)・home.json単一list化・globals.css .home-dashboard・15 e2e spec heading更新・両テーマ両幅スクショ4枚。**信頼度タイル除外(R135-a)**。誇張ゼロ除外2点(観測対象タグ=ヘッダーセレクタ未実装/pc-badge=API無)。ナビ契約保持(obs-domain-selectはIA v2でscreendef transition外し・navigation.jsonエッジ保持)。**実機判定カード=`c9-home-v2-live-2026-07-19`投函(ready)**。
- reviewer advisory(次スライス): pc-badge後日配線/copyハードコード=i18n未対応(KNW前例と同じ)/obs-search等の二次画面がhome直リンク喪失=到達性1回監査推奨。

### 進行中/申し送り(次スレッド)
2. **usecase-driven-design.md 追いつき改稿**(R126): worker実行中(冒頭に追いつき注記=structure-canon v2が現IA正本・C7以降裁定リスト)。
3. **ヘッダー観測対象セレクタ実装**(HDR裁定後): 複数スライス。決定可能スライス=ヘッダーUI+preferences永続(pref-set.schema.json frozen外に scope_species/scope_lineage_id追加)+3ドメイン配線(/individuals?species=&lineage_id=は既存・finder.js/SearchNavigator/obs-searchのクライアント側チップをサーバ側フィルタへ繋ぎ直す)。市場/広場/研究はスキーマ設計裁定(HDR-1回答)後。
4. **SW-2**(ihl.plaza.species-wiki.v1=種族の本要約キャッシュ・plaza-summary同型+stale判定): KNWの用途実装(章束ねread・記憶ボタン)と併せて起票。SW-1(species_id)は完了。
5. **board_kind 4→3分類**(F-2・困った/話したい/論文+種族軸): schema改訂=KNW章立て設計と協調(structure-canon §7・round-18 §2-2に記録)。
6. **known minor掃引**: 欠測個体減光/HERAKLES単一種族表記/#mockbadge旧id/多種族チップ棚重なり+`.civ-pedigree-*`6クラス。
7. **E2E設計債(申し送り)**: finder-pro等がローカルTruth(`apps/api/.wrangler/state`・8.7MB蓄積)汚染でフル走査時flake(**単独/clean実行では緑=merge非起因を実証済**)。全specがポート3000/8787ハードコード=並行E2E不可。state定期リセット or 隔離ストア化を検討。

### round-18 addenda(本セッションで着弾・処理済)
- **R141(6-c)**=投票二層(V3-GOV-36新規=無料+プラチナコイン権能投票)。**R142(6-d)**=経済3層是正(V3-MKT-36/V3-KRM-11: 5%維持費/3%商用利用料/10%は金銭でなくfork系譜三世代への貢献度追加発行ボーナス)。**R144(6-e)**=観測対象三層定義(structure-canon §1c+V3-OBS-43にスコープ明記・他は既存充足)。**R149(SB-1○)**=secondbrain棄却(V3-WIK-17/28 hold→棄却)。**総数758・確定661・確定(修正)92・棄却5**(第1波361/第2波238/実験枠21/対象外138)。

### ヘッダー観測対象セレクタ=**機能完成・push済**(slice1 `09e7a4a`○70/slice2+2b `1ab47d6`)
- **全ドメイン絞り込み+create自動タグが実際に機能**: 個体/finder/obs-search(slice1)+市場/知の広場/研究/clutch/BatchRoster(slice2 read)+create時にheader scopeのspeciesを自動付与(slice2b producer=FormNode header_scoped_producer・plaza compose)。**批評家がslice2の『producer無し=飾りフィルタ』をblocking指摘→2bで是正**(市場lifecycle全通貫E2E緑=money path無回帰・回帰テスト4本+API round-trip)。正直な限界(コード注記): lineage_id=個体/産卵のみ(市場/広場/研究に血統欄無し)・home集計エンドポイントは対象外(申し送り)・placement/device/種族マスタ=原理的対象外。research projects=content.project_id経由derived join(複数種束ねるため単一field不採用)。実機判定カード=`c9-header-selector-complete-2026-07-19`(ready)。

### (旧)第1スライス詳細=完了・push済(`09e7a4a`・reviewer PASS/blocking0)
- pref-set schema(scope_species/scope_lineage_id)+AppShellNodeにセレクタ常駐(obs-navigator3モード流用ドロワー・onConfirmで選好保存)+HeaderScopeCtx全画面配布+preferences永続。**個体ドメイン実配線**: /individuals(finder)・/individuals/pedigree-links(新フィルタ・GAP①所有者検証保持)・obs-search(SearchNavigator=localStorage→サーバ側スコープ昇格)・universe。**home v2 bad対応(R157)=観測対象ブロック撤去・ヘッダー一本化**。実回帰(閉dialogのciv-heading leak)捕捉修正。**実機判定カード=`c9-header-selector-live-2026-07-19`(ready)**。
- **次スライス(A1#4未配線=正直明示済)**: 市場/知の広場/研究=種族フィールド不在→**スキーマ設計先行**(plaza=SW-1のspecies_id活用/市場=mkt-listingにspecies参照追加/研究=content schema拡張)+配線。clutches(GET /clutches・speciesフィルタ追加)/observation-capture一覧/BatchRosterNode(/individuals未scope)。finder-proのTruth/WebGL環境flakeはCI確認推奨(diff非起因を批評家実証)。

### 現在地
- main = **`1ab47d6`**(全push済・lint22緑・clean Truth E2E=market lifecycle全通貫+knowledge-thread+screen-sweep全55緑・web230/tests1500/api8/pytest49)。本セッション**19コミット**(structure-canon v2/KNW wave1統合178緑/round-18+addenda758件/SW-1/鮮度是正/usecase/home v2/**ヘッダー観測対象セレクタ機能完成**)。
- 外出モードMonitor稼働。**回答済でifYes全実行完了**: home v2(R157○)/header-selector-scope(R144)/secondbrain(R149)/header-selector-live(R161○→slice2+2b実装)。**残ユーザー判定待ち**: ヘッダーセレクタ完成(`c9-header-selector-complete`=ready)/mkt予約等。
### 次のC9業務=**統合キュー**(各カードの○が統合解禁の号砲・fresh attentionで着手推奨)

1. **wave-mkt統合=解禁済(全4カード○: 取引中80/予約70/economy90/dispute70)・要精密reconcile**。ブランチ=`wave-mkt`(7コミット・tip 21b3b56・merge-base 6831ef2)。**merge試行済→2衝突(csv=再生成・home.json=下記)。market-routes.ts/i18nは自動マージ成功(species filterと新route別region)**。**home.json衝突のreconcile方針(要判断)**: HEAD=home v2単一node(採用が正=承認済R157)。wave-mktは旧home構造に4リンク(open-torihikichu/reservation/economy/hanashiai)追加+**4つの独立HTMLページ新設**(`apps/web/public/{torihikichu,reservation,economy-status,hanashiai}/*.html`=finder型)。**要確認**: (a)home v2採用時、この4ページの入口をどこに置くか(市場primary card→market-trade経由で取引中/予約が届くか・economy-status/hanashiaiの入口)。(b)**/hanashiai/hanashiai.html(新)と既存/s/dispute(renderer)の関係=置換か共存か**(wave-mktはdispute.json/renderer未改変=hanashiai.htmlは新規追加・話し合いの場の新canonical候補)。ihl-mkt意図の確認が要る。**abort理由**: このアーキテクチャreconcileは20コミット末尾で急ぐとmain破損/入口orphanリスク→fresh sessionで着手が安全(wave-mktは○済・ブランチ上で安全)。
2. **knw-to-c9-integrate-wave1カード(pending・2026-07-19着弾)**: KNWの追加統合依頼(stage4種族の本 knw-species-book-built等)。○化を待って統合。※KNW wave1本体(stage1-3)は統合済(1cf1c89)。
3. **4ゾーン(IND5/ME5/ENTRY6/FORK2)背景実装ブランチ(`wave-{ind,me,entry,fork}-impl`・R163)**: HQ発進済・実装中。完成→ブランチ+判定カード→○で統合。ME/ENTRY/FORK/INDの○はこれから。
4. **wave1-obs**: 統合済(e97aa96)。**wave-img**(画像解析・color○100 R140)も別途統合候補。

**統合の型(KNW wave1実績)**: merge --no-ff → 衝突精査(生成物=再生成・共有物=共有オーナー判断でreconcile) → lint/tsc/tests → **clean Truth E2E全緑**(finder-proのTruth/WebGL環境flakeは既知・diff非起因) → push。共有物(renderer/AppShellNode/HeaderScopeCtx/schemas/home.json/navigation.json)の整合を必ず確認。
