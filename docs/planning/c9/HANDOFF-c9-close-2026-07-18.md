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
最初の一手: 本HANDOFF §5「次の一手」の 1(wave1通知確認)と 2(レンダラ版2画面の撤去)から。
```

## §1 現在地(main = `25f93f6` push済み・lint 21ゲート緑・E2E 183/183緑・pytest 49緑)

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
| E2E | ベースライン**183本**(スイート増減の比較基準)。`finder-pro.spec.ts` がcaseB7版の通しフロー |

## §4 有効裁定と人間ゲート残

**有効裁定(尊重)**: 構造正本承認(R50)/ caseB7直系版=正・100点採用(R54)/ **UIラウンド既定プロセス=「完成形の実物採用+配線のみ・1判断1カード・触れる入口必須・両モードスクショ」**(R50/R51/R52/R54)/ 完成済みの仕組みは次画面から標準装備で横展開(R53)/ 取引中=独立画面・話し合いの場=汎用調停 / Q-META-01(未回答=推奨採用で自走)/ 決済確定形(§1表)。

**人間ゲート残(AIは触らない・一覧提出のみ)**: 公開の実施 / 実鍵・KV投入 / Truthバックアップ(B2)実契約 / cutover / 物理印刷治具 / 裁定3件(V3-SEC-03・V3-AUT-15・V3-AIP-92※推奨付きでc8 HANDOFF§0) / PayPay追加採否(次の質問シートで裁定・勝手に進めない) / PAY.JP通常決済の本番申込 / tailnet HTTPS serve有効化(任意・login.tailscale.comで1クリック→自己署名TLSプロキシ退役可) / **wave1の2スレッド起動の実行**(常駐トークン消費の開始=ユーザー判断・WAVE-DESIGN人間ゲート節)。

## §5 次の一手(順)

1. **wave1通知の確認**: `00-hq\review-queue\` に `NOTIFY-C9-wave1-start`(proj: ihl-ver3・status: ready)が投函されていないか確認。あればwave1稼働中=統合オーナー業務開始。`00-hq\FLEET.md` で稼働状況を確認。
2. **レンダラ版2画面の撤去**(1コミット規模): §1後続1のとおり。撤去後 `npm run lint`+E2E緑を確認(screendef-snapshots・navigation GATEが差分検知する)。
3. known minor 4件の掃引(小・§1後続2)。
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
- **【後継スレッド追記 2026-07-18】§5-2撤去=完了**(main統合 `52800b9`・E2E 175/175・+11/-1788)。**E2E隔離の追加罠**(§6の罠リストに追加・wave1ゾームも必ず適用): ①`next.config.mjs`/`middleware.ts`/`lib/api.ts` は `NEXT_PUBLIC_API_URL` 未設定時 8787 固定フォールバック→専用ポート隔離時は playwright.config の webServer `env` に必ず明示(渡さないと外部8787へ黙って接続=テスト汚染) ②前ランの孤児devサーバの残留に注意(kill はコマンドラインでポート限定を確認してから) ③worktree の `.wrangler/state` 残渣が偽API 500を生む(実行前クリア)。**採番訂正**: 本書の「R54」はHQ正本では**R70**(採番はHQ専任・T-67行注記)。**残escalation**: `.civ-pedigree-*` 6クラスも消費者ゼロの疑い(撤去ノードと同根)— known minor掃引レーンで裁定する。
