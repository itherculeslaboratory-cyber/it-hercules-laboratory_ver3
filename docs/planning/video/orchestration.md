---
id: video-orchestration
title: 動画量産オーケストレーション雛形（V3-VID-33 後半）
date: "2026-07-11"
status: active
requirements:
  - V3-VID-33
  - V3-VID-34
  - V3-VID-27
  - V3-VID-28
  - V3-VID-29
  - V3-VID-30
  - V3-VID-31
  - V3-VID-32
  - V3-VID-14
  - V3-VID-09
  - V3-VID-01
  - V3-VID-02
  - V3-VID-18
  - V3-VID-STORE
---

# 動画量産オーケストレーション雛形

対象要件: V3-VID-33（事前整備）/ V3-VID-34（多言語）/ V3-VID-27・28・29・30・31・32・14・09・01・02・18・STORE。
方式は R-3 撤回制約に従い、**単一ナレーター（合成音声）+ 立ち絵 + 字幕の構造化解説型**。二体キャラの自動掛け合い台本は生成しない。

## 1. パイプライン全体図

```
台本生成（V3-VID-31/28 準拠・ja 正本）
  → 批評家ゲート①（台本: §3 の機械検査 + LLM 観点チェック）
  → ★人間 OK/NG（分割点1: 台本承認）          [V3-VID-01]
  → 音声合成（ja=VOICEVOX ローカル / en=OSS TTS 候補比較中・§1.1）
    ∥ 画像/立ち絵素材生成（並列・1カット=1関数・バッチ生成禁止・V3-VID-27）
  → 字幕タイミング付与（音声波形と整合・V3-VID-14）
  → ★人間 OK/NG（分割点2: 音声、分割点3: 画像）  [V3-VID-01]
  → ffmpeg 組立（ローカル完結・V3-VID-18）
  → 批評家ゲート②（完成動画: 字幕焼き込み・7秒ルール・尺・CTA ゼロ再確認）
  → ★★人間ゲート（分割点4: 合成の OK/NG + 公開ボタン）— ここで必ず停止 [V3-VID-01/02]
  → 外部PF（YouTube 等）へ人間が投稿 → ルーティング表に URL/目的/version/履歴を記録
```

- 動画本体は R2/システムに保存しない。保持するのはルーティング表（URL・目的・version・履歴）のみ（V3-VID-STORE）。
- 各段の生成は小関数単位（1枚/1段落/1カット）。失敗時はそのカットだけ再生成する（V3-VID-27）。
- 投資順位は 台本・構成 > 音声/字幕 > 画像 > モーション（V3-VID-29）。モーション工程は標準形に含めない。

### 1.1 英語音声合成の候補（比較・未確定）

ja は VOICEVOX（ローカル HTTP API）で確定 — b2 リサーチで選定済（`docs/planning/b2-research/research-tts-video-stack.md` の decision）。本 repo での実測・実走記録は未了。en は OSS-first・ローカル 8GB VRAM 級で回る候補として、Piper（軽量・CPU 可・品質は実務水準）、Kokoro（近年の小型モデル・品質評価が高いが実測未了）、Coqui XTTS 系（品質は高いがライセンスが CPML で商用制約あり・採用には確認必須）を比較対象とする。いずれもこの repo では**実測未検証**であり、断定しない。選定は cutover 後の第2波で、同一原稿による聴感比較 + ライセンス確認を経て人間裁定に諮る。

## 2. Workflow 雛形スクリプト（Claude Code Workflow ツール用）

素材生成コマンド（VOICEVOX API・ffmpeg）は具体例として書くが、**実測未検証・cutover 後の第2波で実配線**する。加えて、以下の Workflow DSL 構造そのもの（`pipeline`/`phase`/`agent`、`parallel:`/`human: true`/`gate: {onFail}`/`terminal: true`）も本 repo・環境内に検証済み仕様書や実走例がなく、実配線時に実際の Workflow ツール仕様へ合わせて書き換える。現時点で「動く」とは主張しない（誇張ゼロ）。

```javascript
// video-pipeline.workflow.js — 動画量産オーケストレーション骨格
// 注意: コマンド例および DSL 構造（human/gate/terminal 等）は実測未検証。
// cutover 後の第2波で実配線時に実仕様へ合わせる。
export const meta = {
  id: "video-pipeline",
  title: "台本→批評→素材→組立→最終批評（公開は人間ゲート）",
  requirements: ["V3-VID-33", "V3-VID-27", "V3-VID-31", "V3-VID-32"],
};

export default pipeline([
  phase("script", {
    agent: agent({
      model: "sonnet",
      prompt: `docs/planning/video/model-script-ja.md を手本に、指定テーマの台本を
        V3-VID-31 規約（Hook3秒/本題/例/まとめ・専門用語・デメリット明記・CTAゼロ）で書け。
        出力: script.md（カット表つき。列は手本と同一 —
        ja: cut, 開始目安, 画面, 音声, 字幕, 素材メモ /
        en: cut, start, screen, audio, subtitle, asset memo）`,
    }),
  }),

  phase("critic-script", {
    agent: agent({
      model: "sonnet",
      prompt: `orchestration.md §3 の機械検査(a)-(e)を script.md に適用し、
        major/minor で判定せよ。major 1件でも FAIL。`,
    }),
    gate: { onFail: "loop-back:script" },
  }),

  phase("human-gate-1", {
    // ★分割点1: 台本の人間 OK/NG。ここで必ず停止する。
    human: true,
  }),

  phase("assets", {
    parallel: [
      // 音声: 1段落=1関数。VOICEVOX ローカル API（実測未検証・第2波で実配線）
      {
        agent: agent({
          model: "sonnet",
          prompt: `カット表の各段落を個別に音声化せよ。バッチ生成禁止。
            例: curl -s -X POST "localhost:50021/audio_query?speaker=3" --get --data-urlencode text@para-01.txt > q.json
                curl -s -X POST "localhost:50021/synthesis?speaker=3" -H "Content-Type: application/json" -d @q.json > para-01.wav`,
        }),
      },
      // 画像/立ち絵: 1カット=1関数。CLIP 類似による素材再利用は将来項（第2波以降・本雛形では未実装）
      {
        agent: agent({
          model: "sonnet",
          prompt: `カット表の各カットの静止画・立ち絵合成指示を1カットずつ生成せよ。バッチ生成禁止。`,
        }),
      },
    ],
  }),

  phase("subtitle-timing", {
    agent: agent({
      model: "sonnet",
      prompt: `各 wav の実測尺から字幕の in/out を確定し srt を出せ。
        ja 1行22字/en 1行42字・2行まで・太字白文字黒縁・下部配置（V3-VID-14）。`,
    }),
  }),

  phase("human-gate-2-3", {
    // ★分割点2(音声)・分割点3(画像)の人間 OK/NG。ここで必ず停止する。
    human: true,
  }),

  phase("assemble", {
    agent: agent({
      model: "sonnet",
      prompt: `ffmpeg でカット単位に結合せよ（実測未検証・第2波で実配線）。
        例: ffmpeg -y -loop 1 -t 6.5 -i cut-01.png -i para-01.wav -vf "subtitles=cut-01.srt" -shortest cut-01.mp4
            ffmpeg -y -f concat -safe 0 -i cuts.txt -c copy draft.mp4`,
    }),
  }),

  phase("critic-final", {
    agent: agent({
      model: "sonnet",
      prompt: `完成動画に §3 全検査を再適用（字幕焼き込み後の CTA ゼロ・7秒ルール・
        タイトル/サムネ V3-VID-30 要素）。major 1件でも納品不可。`,
    }),
    gate: { onFail: "loop-back:assemble" },
  }),

  phase("human-gate-publish", {
    // ★★分割点4（合成後の完成動画）の人間 OK/NG（V3-VID-01）と公開ボタン（V3-VID-02）を兼ねる。
    // Workflow はここで終端し、投稿は人間のみが行う。NG なら assemble へ差し戻し。
    // 投稿後、動画本体は外部PFへ。ルーティング表（URL/目的/version/履歴）だけを repo に記録。
    human: true,
    gate: { onFail: "loop-back:assemble" },
    terminal: true, // terminal は onPass 側のみの意（NG 時は上の gate で assemble へ戻る）
  }),
]);
```

## 3. 批評家ゲート仕様（機械検査）

判定は **major / minor** の2段階。**major が1件でもあれば納品不可**（ループバックして修正）。minor は指摘つきで通過可。

### (a) CTA・要求形文言の禁止語（0件を強制・major）

台本本文・字幕・概要欄・タイトルの全テキストに対して grep 相当で適用し、ヒット0件を強制する。**検査対象は台本ファイルの §1（メタデータ: タイトル・サムネ文言・概要欄・チャプター）と §2（カット表）のみ**。自己検査節（手本の §3）は禁止語のメタ言及を含むため対象外 — ファイル全体へのナイーブな rg は誤 FAIL する。以下は**検出対象の定義**であり、実文としての使用ではない。

```
# ja — CTA
(チャンネル登録|高評価|低評価.*お願い|いいね[をも]?|通知(を)?(オン|ON)|ベルマーク|シェア(を)?|拡散(を)?|フォロー(を)?)
# ja — 要求形（宣言形に書き換えさせる）
(してください|して下さい|お願いします|お願いいたします|ください[。！]|ぜひ[^、。]{0,10}(を|に)|忘れずに)
# ja — コメント誘導（V3-VID-32「等」の範囲）
(コメント欄|コメントで(教えて|お寄せ|募集|お待ち))
# en — CTA / viewer-directed request（case-insensitive）
\b(subscribe|hit the bell|smash|leave a like|drop a like|give (it|this( video)?) a like|like and (share|subscribe)|thumbs up|share (this|it|this video)|check out (my|our) channel|follow (us|me)|turn on notifications?)\b
\b(please\b|make sure to|don'?t forget to|be sure to|feel free to)\b
# en — コメント誘導
\b(let (me|us) know in the comments|comment below|leave a comment|drop a comment)\b
```

- ja 要求形の正規表現は過検出側に倒す（例: 引用文中の一致も major 扱いとし、人間ではなく台本側を書き換える）。en も同方針 — bare の like/share は誤検出過多のため対象外とするが、句単位の CTA 変種は見つけ次第 regex に追加し、過検出側に倒す。
- 注意喚起は宣言形のみ許可（「火災に注意が必要」は可）。

### (b) 字幕文字数（major）

- ja: 1行 22 文字以内・2行以内。
- en: 1行 42 文字以内・2行以内。
- srt/カット表の全字幕行に機械適用。1件でも超過は major。

### (c) 7秒ルール（major）

カット表の `開始目安`（en: `start`）の隣接差が 7 秒以内であること、**または**差が 7 秒を超える各カットで `画面`（en: `screen`）欄に前カットからの画面変化、かつ `素材メモ`（en: `asset memo`）欄にカット内の静止回避手段（逐次表示・ハイライト・トランジション等）が明記されていること。どちらも満たさないカットが1つでもあれば major（V3-VID-29）。最終カットは開始目安から §1 想定尺までの差を同一基準で検査する（隣接差が存在しないための見逃しを防ぐ）。列名は手本カット表の実列名に一致させる（§2 の script phase 出力スキーマと同一）。

**判定規則（静止回避手段の認定）**: §1 で全カット既定とされる立ち絵のまばたき/口パクは、それ自体を有効な静止回避手段として認める。したがって図要素の逐次表示・ハイライト・トランジション等がカット個別の `素材メモ` に明記されていなくても、§1 の包括宣言（全カットで立ち絵が動く）に依拠するカットは (c) を満たす。個別の逐次表示等は補強であって必須要件ではない。これにより手本 ja/en の全カット（cut19/27/30/31 等を含む）が厳密適用で (c) PASS となり、§5 期待結果と一致する。

### (d) V3-VID-31 観点チェックリスト（LLM 批評家）

各項目 PASS/FAIL を根拠引用つきで返させる。FAIL は major。

1. 冒頭で「何が必要か」「得られるメリット」を明示しているか
2. 論理的な説明とテンポが維持されているか（冗長段落・論理飛躍の指摘）
3. 分野の専門用語を正しく使っているか（平易な言い換え併記は可・用語回避は FAIL）
4. デメリット・不都合な情報を正直に伝えているか（誇張表現の検出）
5. 末尾がまとめ/振り返りで締まっているか（要求形での締めは (a) でも捕捉）

構成が Hook 3秒 / 本題 / 例 / まとめ の4部を持つか（V3-VID-28）も同時に検査する。

### (e) タイトル/サムネ必須要素（V3-VID-30・major）

- タイトル+サムネイルの組が一意検索キーとして成立すること（既存ルーティング表との重複検査）。ルーティング表の予定パスは `docs/planning/video/routing-table.md`（初回投稿時に作成・現時点では未作成）。表が存在しない・空の初回は「重複なし」として PASS とする。
- サムネ指示に「要点文言」「シリーズ名」「話数」の3要素が全て存在すること。
- 説明（概要欄冒頭）が1行であること。
- チャプターが存在すること（§1 メタデータに1点以上・V3-VID-14）。
- タイトル/タグが内容を正確に表すこと（釣り検出は LLM 批評家・V3-VID-14）。

## 4. 人間ゲート一覧と多言語展開

### 人間ゲート一覧（必ず停止する点）

| # | 位置 | 内容 | 要件 |
|---|------|------|------|
| 1 | 分割点1 | 台本の OK/NG | V3-VID-01 |
| 2 | 分割点2 | 音声の OK/NG | V3-VID-01 |
| 3 | 分割点3 | 画像/立ち絵の OK/NG | V3-VID-01 |
| 4 | 分割点4 + 最終 | 合成後の完成動画の OK/NG と **公開・投稿ボタン**を兼ねる（Workflow の終端。投稿操作は人間のみ。NG は assemble へ差し戻し） | V3-VID-01・V3-VID-02 |

批評家ゲート①②は機械ゲートであり人間を待たない。上表の4点のみが停止点。分割点4（合成）の OK/NG は #4 が兼ねるため、V3-VID-01 の4分割点すべてが人間停止点で担保される。

### 多言語展開手順（V3-VID-34）

1. **ja 正本**を上記パイプラインで完成させる（分割点1〜3 通過済みの台本・カット表が正）。
2. **en 翻案**: 逐語訳ではなく翻案。専門用語は英語圏の正式用語に置換し、字幕は 42字/行 規約で再割付。批評家ゲート①（en 用禁止語 regex）を再適用。音声は en で新規合成。画像素材は、写真・グラフ・立ち絵などテキストを含まない基底素材のみ ja 版を再利用し、テキストを含む見出し板・用語ふきだし・カード類は en テキストで再生成する（再生成も1カット=1関数・バッチ生成禁止）。
3. **追加言語**: 合成音声ベースのため追加コストは低い。言語選択・優先順位は AI 裁量とするが、公開ボタンは言語ごとに人間ゲート（上表 #4）を通す。

## 5. 手本台本への参照と期待結果

手本（V3-VID-33 前半の完成見本）:

- `docs/planning/video/model-script-ja.md`
- `docs/planning/video/model-script-en.md`

§3 の批評家ゲートをこの2ファイルに適用した際の期待結果:

| 検査 | model-script-ja | model-script-en |
|------|-----------------|-----------------|
| (a) CTA/要求形 regex | 0件（PASS） | 0件（PASS） |
| (b) 字幕文字数 | 全行 22字/2行以内（PASS） | 全行 42字/2行以内（PASS） |
| (c) 7秒ルール | 隣接差 7秒超のカットは全て `画面` に変化・`素材メモ` に静止回避手段あり（PASS） | 同左（PASS） |
| (d) V3-VID-31 ①〜⑤ | 5項目 PASS | 5項目 PASS |
| (e) タイトル/サムネ要素 | 要点文言・シリーズ名・話数・説明1行・チャプター すべて存在（PASS） | 同左（PASS） |

- (a) の検査対象は §3(a) のスコープ規則どおり、手本の §1・§2 のみ（手本の §3 自己検査節は禁止語のメタ言及を含むため対象外）。

期待結果と実適用結果が食い違った場合は手本側を修正する（手本は規約の実演であり、規約が正）。regex 自体の過検出で手本が FAIL する場合のみ regex を調整し、調整履歴を本ファイルの git 履歴で持つ。
