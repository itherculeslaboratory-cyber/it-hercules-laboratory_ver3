---
source: "docs/planning/ver3/b2/research-tts-video-stack-v1.md@4a56cf6"
id: V3-B2-RES-TTS-VIDEO
title: TTS / 動画生成スタック選定（B5 動画量産パイプライン前提）
date: 2026-07-10
status: verified
decision: "TTS は VOICEVOX Engine を正（VOICEVOX 互換 HTTP API を C-USB 境界とし AivisSpeech を差替候補）、合成は ffmpeg + Python 直組み（ASS 焼き込み）、画像は ComfyUI(SD 系, 8GB VRAM) + open_clip 再利用判定、投稿は YouTube Data API のみ自動・TikTok/X は半自動"
sources_count: 21  # 数え方 = §2 の根拠項目数（URL 延べ本数では 32）
revalidate_before_impl: true
---

# TTS / 動画生成スタック選定（ver3 Phase B2 deep-research）

> 対象要件: V3-VID-01 / V3-VID-02 / V3-VID-18 / V3-VID-27（B5 動画量産パイプラインの前提）
> 調査日: 2026-07-10。本書の外部情報はすべて 2026-07 時点。実装着手時に §6 の再検証を必須とする。

## 1. 結論（選定）

日本語 TTS は **VOICEVOX Engine（ローカル HTTP API）を正**とし、パイプラインの音声段は「**VOICEVOX 互換 REST API**」を C-USB 境界（差し替え点）として定義する。これにより COEIROINK・AivisSpeech が無改修で差し替え可能になる（AivisSpeech は VOICEVOX 互換 API を公式にうたい、CPU のみで動作・クレジット表記不要）。動画合成は **ffmpeg 直叩き + 薄い Python スクリプト**（字幕は ASS を libass で焼き込み、立ち絵・背景は overlay フィルタ）とし、Remotion / MoviePy / ゆっくりMovieMaker4 は採用しない。画像アセットは **ComfyUI 上の SD1.5/SDXL（8GB VRAM で動作実績あり）** で 1 カット単位に生成し、生成前に **open_clip の画像埋め込み cosine 類似度 ≥ 0.75 で既存アセット再利用**を判定する。サムネは Pillow によるテンプレート合成。自動投稿は **YouTube Data API（videos.insert）のみ**とし、TikTok / X は制約（未監査クライアントの非公開ロック、無料枠 500 post/月）により「ファイル+メタデータを用意して人間が投稿」の半自動に留める。分割点（台本→音声→画像→合成→サムネ→投稿の各段の出力）はすべてファイルとして残し、人間 OK/NG ゲートを段間に置く。

## 2. 根拠（出典付き・アクセス日 2026-07-10）

1. **VOICEVOX は商用・非商用問わず無料で利用可（クレジット表記必須）**。ソフトウェア利用規約に「商用・非商用問わず利用することができます」と明記。生成音声の利用は各音声ライブラリ（キャラクター）規約に従う必要がある。エンジンは HTTP API を公開しており自動化に直接使える。
   - https://voicevox.hiroshiba.jp/term/ （WebFetch で規約本文確認）
   - https://voicevox.github.io/voicevox_engine/api/ （エンジン API ドキュメント）
2. **AivisSpeech は VOICEVOX 互換 HTTP API・CPU 動作・クレジット表記不要（個人/商用とも）**。AivisSpeech Engine は LGPL-3.0 の OSS。音声モデル側のライセンス（ACML / ACML-NC / CC0）確認は別途必要。VOICEVOX 互換 API を境界にすれば無改修で差し替え可能な実証。
   - https://aivis-project.com/ （WebFetch で確認）
3. **Style-Bert-VITS2 は日本語品質最高峰クラスだが AGPL v3**。学習・スタイル制御に強い一方、AGPL のためサービス組込み時のソース開示義務リスクがある。SBV2 で学習したモデルを AivisSpeech 形式（AIVM）へ変換して使う公式手順が存在し、「声を作る側」の技術として位置付けるのが妥当。
   - https://github.com/litagin02/Style-Bert-VITS2
   - https://note.com/aivis_project/n/nd689f3f45dae （SBV2 モデル → AivisSpeech/AIVM 変換手順）
4. **2026 年時点の日本語 TTS 比較記事では Style-Bert-VITS2 と AivisSpeech が日本語品質で最高評価、VOICEVOX は CPU のみで動作と紹介されている**（「動画制作用途 = SBV2/AivisSpeech、GPU 不要枠 = VOICEVOX/AivisSpeech」という用途別の定式化は記事の評価を本書側で再構成したもの）。クラウド TTS は OpenAI gpt-4o-mini-tts $0.015/分、Google Chirp3 HD $100/100万文字、Amazon Polly NTTS $19.20/100万文字等で、量産すると従量課金が積み上がる（『一日で20ドル』の再発リスク）。ローカル OSS は電気代のみ。
   - https://qiita.com/0h-n0/items/8f78f7acd31000612d13 （日本語TTSモデル徹底比較2026、WebFetch で確認）
5. **COEIROINK も VOICEVOX 互換ローカル API を持ち商用利用可（キャラ規約準拠が条件）**。差し替え候補の 2 番手として互換境界の妥当性を補強する。
   - https://coeiroink.com/terms
6. **ゆっくりMovieMaker4（YMM4）は商用収益化に AquesTalk 商用ライセンス（年 6,380 円〜、永続 3 種で 19,140 円）が必要**で、GUI 前提のためコマンドライン自動化の公式手段がない。Lite 版は AquesTalk 非同梱でライセンス不要だが自動化不可は同じ。「ゆっくり文化の原点」ではあるが量産パイプラインの部品には不適。
   - https://manjubox.net/ymm4/ （公式）
   - https://note.com/yukkuri_auto/n/ne3ef886d01d6 （ライセンス解説 2026 年版）
7. **ffmpeg は SRT/ASS 字幕の焼き込みを標準フィルタで持つ**（`-vf "ass=subtitle.ass"` / `-vf subtitles=...`、要 libass）。ASS なら色・縁取り・位置指定ができ、ゆっくり系の字幕表現を宣言的に再現できる。追加依存ゼロ。
   - https://www.bannerbear.com/blog/how-to-add-subtitles-to-a-video-file-using-ffmpeg/
   - https://geoffreyangapa.wordpress.com/using-ffmpeg-to-burn-subtitles-into-a-video/
8. **Remotion は React + headless Chromium でフレームを撮って ffmpeg に渡すアーキテクチャで、無料利用は「個人 / 従業員 3 人以下の営利組織 / 非営利団体 / 評価目的」に限られ、それ以外の営利組織は有償の会社ライセンスが必要**（LICENSE.md を WebFetch で確認。年商基準は存在せず、価格はライセンス本文に記載なく remotion.pro 参照）。表現力は高いが、Node + Chromium という重いランタイムを 1 カット合成のために常駐させることになり、コスト最小・ローカル完結の方針に対して過剰。
   - https://www.remotion.dev/docs/license
   - https://github.com/remotion-dev/remotion/blob/main/LICENSE.md （WebFetch でライセンス本文確認）
   - https://tech.gmogshd.com/remotion-video-automation/ （自動化検証記事）
9. **MoviePy は Python の動画編集ライブラリだが、内部的には ffmpeg のラッパーでフレーム処理を Python 側で行うため長尺で遅い**。本パイプラインの合成は「静止画 + 音声 + 字幕 + overlay」で完結し、ffmpeg フィルタグラフで直接表現できるため中間層は不要。
   - https://pypi.org/project/moviepy/
10. **SDXL は 8GB VRAM で動作する**（RTX 3060 Ti / 4060 級で SD1.5・SDXL とも実用、ComfyUI は VRAM 効率が A1111 比 20〜30% 良い。Tiled VAE 等の低 VRAM 手法も確立）。ローカル画像生成の前提ハードで成立する。
    - https://chimolog.co/bto-gpu-stable-diffusion-specs/ （GPU 別実測）
    - https://42.uk/blogs/sdxl-for-beginners-comfyui-low-vram-guide.html （8GB 向け ComfyUI ガイド）
11. **CLIP 画像埋め込み + cosine 類似度による類似画像検索は確立された実装パターン**で、open_clip / clip-retrieval 等の OSS で数十行で組める。L2 正規化した埋め込みの内積 = cosine。「≥ 0.75 で再利用」の閾値運用は埋め込み DB（numpy / faiss）で実装可能。
    - https://github.com/rom1504/clip-retrieval
    - https://medium.com/@jeremy-k/unlocking-openai-clip-part-2-image-similarity-bf0224ab5bb0
12. **YouTube Data API の既定クォータは「videos.insert 100 回/日 + その他エンドポイント合算 10,000 units/日」**（公式 Quota Calculator を WebFetch で確認。従来広く知られた 1600 units/回の記述から改定されている点に注意）。1日数本の投稿なら既定枠で十分。ただしクォータ拡張・制限解除にはコンプライアンス監査が必要。
    - https://developers.google.com/youtube/v3/determine_quota_cost （WebFetch で確認）
    - https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
13. **TikTok Content Posting API は未監査クライアントだと投稿が SELF_ONLY（本人のみ閲覧）に固定され、24 時間で 5 ユーザーまで**。公開にはアプリ監査が必要。監査済みでも 1 クリエイターあたり日次上限（目安 15 post/日）とレート制限（6 req/分）がある。自動公開投稿のハードルが高い。
    - https://developers.tiktok.com/doc/content-posting-api-get-started
    - https://developers.tiktok.com/doc/content-sharing-guidelines
14. **X API v2 の無料枠は 500 post/月・100 read/月**（2025-10 時点情報。2025-08 以降 like/follow 系 POST は無料枠から除外）。動画付き告知程度なら無料枠で足りるが、読み取りがほぼ不可のため自動運用は書き込み専用に限定される。
    - https://devcommunity.x.com/t/specifics-about-the-new-free-tier-rate-limits/229761
    - https://medium.com/@modernrobinhood1998/how-to-get-an-x-twitter-api-key-and-post-with-the-free-tier-october-2025-b428b23e3fa8
15. **ffmpeg 公式フィルタ文書に overlay / ass / subtitles フィルタが標準フィルタとして記載**（subtitles/ass は libass ベースで字幕を映像に焼き込む）。合成段を ffmpeg 単体で完結できることの一次資料。
    - https://ffmpeg.org/ffmpeg-filters.html （WebFetch で確認）
16. **ffmpeg 公式フォーマット文書に concat demuxer が記載**。テキストのファイルリストからカット mp4 を再エンコードなしで結合でき、タイムスタンプは自動調整（全ファイル同一コーデック・タイムベースが条件）。「1 カット 1 mp4 → concat 結合」構成の一次資料。
    - https://ffmpeg.org/ffmpeg-formats.html （WebFetch で確認）
17. **ComfyUI 公式リポジトリは smart memory management による低 VRAM 動作（最小 1GB VRAM までのオフロード）と API endpoints を README に明記**。8GB VRAM 前提の成立性と自動化適性の一次資料。
    - https://github.com/comfyanonymous/ComfyUI （WebFetch で確認）
18. **ComfyUI 公式サンプルにワークフロー JSON を `http://127.0.0.1:8188/prompt` へ POST して実行するコードが同梱**。C-USB 契約「ComfyUI API JSON」がそのまま公式サポートの操作面であることの実証。
    - https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py （WebFetch で確認）
19. **open_clip 公式 README に「encode_image → L2 正規化 → 内積」のコード例がそのまま掲載**。cosine 類似度による再利用判定（V3-VID-18）が公式想定の使い方であることの一次資料。
    - https://github.com/mlfoundations/open_clip （WebFetch で確認）
20. **YouTube videos.insert 公式リファレンスは「2020-07-28 以降に作成された未検証 API プロジェクトからのアップロードは private 固定（解除には audit が必要）」と quota（Video Uploads バケットで 1 unit/回・100 回/日）を明記**。根拠12 のクォータ体系と §6-1 の private ロック懸念を公式一次資料で裏付け。
    - https://developers.google.com/youtube/v3/docs/videos/insert （WebFetch で確認）
21. **X API 公式ドキュメント（docs.x.com）は 2026-07 時点で「pay-per-usage のクレジット制」と記載し、無料枠の具体数値は本文に載せていない**。根拠14 の 500 post/月がすでに変動している可能性を示し、§6-4 の着手時再確認を必須とする根拠。
    - https://docs.x.com/x-api/getting-started/about-x-api （WebFetch で確認）

**選定ごとの根拠件数（数え方 = 根拠項目数）**: TTS = 根拠1〜6（6件） / 合成 = 根拠7・8・9・15・16（5件） / 画像 = 根拠10・11・17・18・19（5件） / 投稿 = 根拠12・13・14・20・21（5件）。合計 21 項目・URL 延べ 32 本。

## 3. 比較した代替案と却下理由

| 段 | 代替案 | 却下理由 |
|---|---|---|
| TTS | クラウド TTS（OpenAI / Google / Amazon / ElevenLabs） | 従量課金が量産と正面衝突（根拠4）。『一日で20ドル』の再発経路そのもの。ローカル完結・コスト最小の不変条項①に反する |
| TTS | Style-Bert-VITS2 を直接ランタイムに | AGPL v3 の伝播リスク + 運用が学習寄りで重い（根拠3）。「モデル作成ツール」として位置づけ、実行系は VOICEVOX 互換 API に寄せる |
| TTS | AquesTalk（ゆっくり本家の声） | 商用収益化に有償ライセンス必須（根拠6）。VOICEVOX 系で「ゆっくり文化の後継声」は無料で成立する |
| 合成 | Remotion | Node + headless Chromium が常駐する重量級。会社ライセンス条件（従業員 3 人超の営利組織は有償）という将来リスクも抱える（根拠8）。表現要件は ASS + overlay で足りる |
| 合成 | MoviePy | ffmpeg ラッパーの中間層で速度・依存を増やすだけ（根拠9）。ffmpeg フィルタグラフで直接書ける |
| 合成 | ゆっくりMovieMaker4 | GUI 前提で CLI 自動化の公式手段なし + AquesTalk ライセンス問題（根拠6）。字幕・立ち絵の「見た目の文法」の参照元としてのみ使う |
| 画像 | クラウド画像生成 API（DALL·E 等） | 従量課金。再利用優先方針（CLIP ≥ 0.75）と組み合わせるなら、ローカル SD の生成コストゼロが最適（根拠10, 11） |
| 投稿 | TikTok / X の全自動投稿 | TikTok は未監査だと非公開固定（根拠13）、X は無料枠 500 post/月かつ読み取りほぼ不可（根拠14）。人間ゲート④があるため「投稿直前まで自動、公開クリックは人間」で実害なし |

## 4. ver3 要件との接続

- **V3-VID-01（動画量産パイプライン）**: 台本→音声→画像→合成→サムネ→投稿を各段ファイル出力の直列パイプにする本選定が土台。
- **V3-VID-02（日本語 TTS・ゆっくり系）**: VOICEVOX 正 + 互換 API 境界で充足。AquesTalk 費用を回避しつつ文化的系譜（YMM4/ゆっくり）と互換の声質帯を確保。
- **V3-VID-18（アセット再利用 CLIP cosine ≥ 0.75）**: open_clip + 正規化埋め込みの cosine 判定で実装（根拠11）。埋め込みインデックスは append-only で蓄積。
- **V3-VID-27（外部投稿・動画本体は R2 に置かない）**: YouTube Data API 投稿で充足。R2 には動画を置かず、メタデータ（動画ID・段間成果物のハッシュ）のみ記録。
- 不変条項への適合:
  - **① コスト最小**: 全段ローカル OSS（VOICEVOX / ffmpeg / ComfyUI / open_clip / Pillow）。従量課金ゼロ。API はクォータ無料枠内。
  - **② fork 文化**: 全部品が OSS または無料公式配布。パイプラインは fork 先でもキー・課金なしで再現可能（音声モデルのキャラ規約のみ fork 先で再確認要）。
  - **③ append-only**: 各段の成果物（wav / png / ass / mp4 / サムネ）は上書きせず版を積む。CLIP 埋め込みインデックスも追記のみ。
  - **④ 人間ゲート**: 段間の分割点で人間 OK/NG。特に「公開」操作（YouTube publish、TikTok/X 投稿）は人間が実行。
  - **⑤ 批評家ゲート**: 台本段・合成後プレビュー段に批評家 AI を挟める構造（各段がファイル境界なので挿入自由）。
- **バッチ生成禁止**: 1 カット = 1 回の TTS 呼び出し / 1 枚の画像生成 / 1 本の ffmpeg 実行、に写像される。VOICEVOX 互換 API はテキスト 1 発話単位、ComfyUI はワークフロー 1 実行単位で自然に粒度が合う。
- **C-USB コンポーネント化**: 段間 I/F はファイル + 「VOICEVOX 互換 REST」「ComfyUI API JSON」「ffmpeg フィルタグラフ文字列」の 3 契約。TTS エンジン・画像モデル・合成レシピが各々独立に差し替え可能。

## 5. 推奨スタック構成（段ごと）

```
台本(md/JSON, 1段落単位)
  → [人間/批評家ゲート]
  → 音声: VOICEVOX Engine (localhost HTTP, /audio_query → /synthesis) … 1発話1wav
  → 画像: 既存アセット検索 (open_clip cosine ≥ 0.75 → 再利用) / なければ ComfyUI + SD1.5/SDXL … 1カット1png
  → 字幕: 台本から ASS 生成(Python 標準ライブラリで文字列組み立て)
  → 合成: ffmpeg 一発 (画像 loop + overlay立ち絵 + ass焼き込み + wav mux) … 1カット1mp4 → concat demuxer で結合
  → サムネ: Pillow(タイトル文字 + キービジュアル合成)
  → [人間ゲート: プレビュー OK/NG]
  → 投稿: YouTube Data API videos.insert(privacyStatus=private で上げ、公開切替は人間)
  → TikTok/X: メタデータ+ファイルを所定フォルダに出力、人間が投稿
```

- 立ち絵の口パク・目パチが将来必要になったら、ffmpeg overlay の enable 式（時刻条件）で差分画像を切り替える。まずは静的立ち絵で開始。

## 6. リスクと再検証条項

本書の外部情報はすべて **2026-07-10 時点**。実装着手時（B5 開始時）に以下を再検証すること（frontmatter `revalidate_before_impl: true`）。

1. **YouTube Data API クォータ体系**: 公式 Quota Calculator の記述が従来の「videos.insert = 1600 units」から「100 回/日の専用枠」表記に変わっている。着手時に公式ページと実プロジェクトのコンソール表示で再確認。未検証（audit 未実施）プロジェクトからのアップロードが private 固定される点は公式リファレンスに明記（根拠20）。実プロジェクトでの挙動も着手時に確認。
2. **VOICEVOX キャラクター規約**: 使用キャラ（例: ずんだもん等）の個別規約は変わり得る。採用キャラ確定時に各キャラの利用規約原文を確認しクレジット表記文字列を固定する。
3. **AivisSpeech のモデルライセンス**: AivisHub のモデルは ACML / ACML-NC / CC0 が混在。商用可否をモデル単位で確認。
4. **X API 無料枠**: 2023 年以降頻繁に改定されている（2025-08 にも縮小）。2026-07 時点の公式 doc は pay-per-usage クレジット制の記述に変わっており（根拠21）、500 post/月の数字は着手時に必ず再確認。
5. **TikTok アプリ監査**: 公開投稿には監査必須。監査コスト（申請工数）と手動投稿の手間を比較して自動化するか裁定する。
6. **Style-Bert-VITS2 の AGPL**: 声モデルを自作する場合のみ関係。学習成果物（AIVM 変換後モデル）へのライセンス伝播範囲は着手時に法的整理。
7. **8GB VRAM の実測**: SDXL の 1024x1024 が対象 GPU で実用速度か、SD1.5 に落とすかは実測で決める（品質要件次第）。
8. **ffmpeg の libass 有効化**: Windows 配布バイナリ（gyan.dev 等）は通常 libass 有効だが、導入時に `ffmpeg -version` の `--enable-libass` を確認。

## 7. 未解決の問い

1. 立ち絵（キャラクタービジュアル）を SD 生成にするか、固定イラスト（外注/自作）にするか。ゆっくり文化的には固定立ち絵 + 表情差分が正道で、SD 生成はカット背景・挿絵向き。
2. VOICEVOX のどのキャラクターを「ver3 の声」にするか（キャラ規約・収益化可否・世界観適合の 3 軸。裁定は人間ゲート案件）。
3. 口パク・字幕タイミングの同期精度をどこまで求めるか（VOICEVOX の audio_query はモーラ単位のタイミング情報を返すため、必要なら ASS のカラオケタグで語単位同期まで可能。ただし初期は 1 段落 1 字幕で十分の可能性)。
4. TikTok/X 向けの縦型ショート再編集を同一パイプラインの別レシピ（ffmpeg crop/scale）とするか、当面 YouTube のみに絞るか。
5. CLIP 閾値 0.75 の妥当性: 実データ（実際のカット画像群）での false-reuse 率を計測して閾値を校正する必要がある。

---

## 8. 訂正（2026-07-10 append 改訂）

- **§4 の ID 誤記訂正**: §4 の「**V3-VID-27（外部投稿・動画本体は R2 に置かない）**」行の内容（動画本体を R2 に置かずメタデータ・ハッシュのみ記録）は **V3-VID-STORE**（最終要件定義書 :699/:1283）に相当する。V3-VID-27（同 :704/:1282）は「小関数分割・バッチ生成禁止」の別要件であり、本レポートでは §4「バッチ生成禁止」段落が該当する。原文行は原本保存のため書き換えず、本訂正を正とする（B5 設計書 `b5/ver3-動画量産パイプライン設計-v1.md` §5.1 の批評家ゲート指摘による）。
