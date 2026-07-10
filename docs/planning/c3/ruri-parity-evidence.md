---
id: ruri-parity-evidence
title: ruri-v3-70m PyTorch ⇄ ONNX 一致検証エビデンス（C3 §4 受け入れ ii）
date: "2026-07-11"
status: active
---

# ruri-v3-70m PyTorch ⇄ ONNX 一致検証（逐語ログ）

> C3 設計契約 `design-c3.md` §4 の受け入れ (ii)。research §5 risk 1（非公式 ONNX 変換の出力コサイン一致を手元で検証）の実施記録。
> 判定基準: 同一入力 5 本以上で `cosine(pytorch, onnx) >= 0.999`。
> 実行体: `components/wiki-ingest/parity_check.py`（component venv 内）。参照 REPORT-ver3-phase-c3-2026-07-11。

## 結論

**PASS**。入力 6 本すべてで cosine = **1.000000**（worst 1.000000 / mean 1.000000 ≥ 閾値 0.999）。
非公式 ONNX 変換 `sirasagi62/ruri-v3-70m-ONNX` は PyTorch 参照 `cl-nagoya/ruri-v3-70m`
（sentence-transformers）と数値上完全一致。research の降格条項（フォールバック
multilingual-e5-small）を発動する必要なし。所要合計 206s（時間ガード 30 分に対し余裕）。

## 検証構成

- PyTorch 参照: `sentence-transformers` の `SentenceTransformer("cl-nagoya/ruri-v3-70m").encode(..., normalize_embeddings=True)`。mean pooling + L2 正規化は ST 既定。
- ONNX: `onnxruntime` CPUExecutionProvider で `sirasagi62/ruri-v3-70m-ONNX` の `onnx/model.onnx` を実行。トークナイザは原モデル `cl-nagoya/ruri-v3-70m`（SentencePiece）。出力 `last_hidden_state (batch, seq, 384)` を attention-mask mean pooling → L2 正規化（`backends.py` `_mean_pool` + `_l2_normalize`。ST の Pooling と同一手順）。
- プレフィックス: ruri-v3 の文書側 `検索文書: ` を両経路に同一適用（parity はモデルを測る。研究 §5 risk 2）。
- 入力: 日本語 wiki 風文（ミツバチ/鉱物/QR/堆肥）+ 英語 1 本 + 単語「苔」で分かち書き・多言語トークナイズを exercise。

## 逐語ログ（`parity_check.py` 標準出力そのまま）

```
# ruri-v3-70m PyTorch vs ONNX parity — verbatim run log
# timestamp: 2026-07-11T02:40:06+0900
# python: 3.12.10 / Windows-11-10.0.26200-SP0
# torch: 2.13.0+cpu
# onnxruntime: 1.27.0
# transformers: 5.13.0
# sentence_transformers: 5.6.0
# numpy: 2.5.1

## loading backends
pytorch backend loaded in 13.6s -> cl-nagoya/ruri-v3-70m#pytorch dim=384
onnx    backend loaded in 8.5s -> cl-nagoya/ruri-v3-70m#onnx dim=384

## per-input cosine (pytorch vs onnx)
[0] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | ニホンミツバチの巣箱は夏場に温度が上がりやすいため風通しを確保する。
[1] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | 石英は六方晶系の鉱物で、モース硬度は7である。
[2] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | 個体識別のためのQRトークンは現物ラベルとして印刷して使う。
[3] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | The observation ladder runs whitelist, t
[4] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | 苔
[5] cos=1.000000  norm_pt=1.0000 norm_onnx=1.0000  | 堆肥の切り返しは発酵温度が60度を超えたら行うと良い。

## result: n=6 worst=1.000000 mean=1.000000 threshold=0.999
VERDICT: PASS
```

## pytest（component venv・実 cosine assert）

```
$ .venv/Scripts/python.exe -m pytest -q tests/
..                                                                       [100%]
2 passed in 12.86s
```

- `tests/test_parity.py`: (a) 両 backend の `embedding_dim == 384`、(b) 5 入力で `cosine >= 0.999` を assert。
- **CI（torch 無し・repo 直下 `pytest -q`）は 1 skipped**（`importorskip` で自動 skip・機械 GATE を割らない）。実 assert は component venv でのみ発火。

## 環境・再現

- Python: `C:/Users/sawad/AppData/Local/Programs/Python/Python312/python.exe`（3.12.10）。
- venv: `components/wiki-ingest/.venv`（component 内・repo 未コミット）。依存 `requirements-parity.txt`（torch 2.13.0+cpu ほか）。
- モデル DL 先: HF 既定キャッシュ `~/.cache/huggingface`（repo 外）。`sirasagi62/ruri-v3-70m-ONNX` + `cl-nagoya/ruri-v3-70m`。
- 再現: `pip install -r requirements-parity.txt` 後に `python parity_check.py`。

## 残課題・注記

- ruri-v3 プレフィックスは文書側固定。検索クエリ側（`検索クエリ: `）を使う検索経路の実装は search レーン側（design-c3 §1）で backend を呼ぶ際に選択する。本 backend は `prefix` 引数で両対応済み。
- ONNX 出力は `(batch, seq, 384)` = pooling 前 hidden state だったため mean pooling を本 backend 側で実施。ST 側の pooling と一致（cosine=1.0 が実証）。
- backend は既定 OFF（`resolve_backend` は名前指定必須。5 不変条項①）。実用化は人間ゲート後の別判断（research §5 risk 7）。
