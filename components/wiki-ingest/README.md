---
id: component-wiki-ingest
title: wiki-ingest — ruri-v3-70m テキスト埋め込みバックエンド（384次元・ローカル・API費ゼロ）
date: "2026-07-11"
status: active
---

# wiki-ingest

決定論梯子の**第2段(補助)**であるテキスト埋め込みのバックエンド。主役は index.md
スコアリング(第1段)であり、埋め込みは既定 OFF(5 不変条項①)。

- モデル: `cl-nagoya/ruri-v3-70m`(384次元・Apache-2.0・日本語 Retrieval JMTEB 79.96)。
- 2 経路・同一モデル: `RuriPytorchBackend`(sentence-transformers 参照実装)と
  `RuriOnnxBackend`(onnxruntime・Python 非依存ランタイムでも動く `sirasagi62/ruri-v3-70m-ONNX`)。
- プレフィックス: ruri-v3 の `検索文書: `(文書)/`検索クエリ: `(クエリ)を両経路に同一適用。

選定根拠は `../../docs/planning/ver3/...`(ihl-ver2 参照)= `b2/research-wiki-integration-v1.md` §1-1。
C3 設計契約は `docs/planning/c3/design-c3.md` §4。

## 何が凍結され、何が可変か

- `backends.py` = EmbeddingBackend Protocol(embed_text → L2 正規化 float32 384）。
- 重い依存(torch / onnxruntime / transformers)と DL 済みモデルは **component venv 限定・repo 未コミット**（`.gitignore`）。CI(`pytest -q`)は torch 無しで緑(テストは自動 skip)。

## セットアップ（parity 検証用・重い依存）

```bash
# component 内に venv（フォルダ設計 §2.4）
C:/Users/sawad/AppData/Local/Programs/Python/Python312/python.exe -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-parity.txt
```

## PyTorch ⇄ ONNX 一致検証（C3 §4 受け入れ ii）

```bash
.venv/Scripts/python.exe parity_check.py   # >=5 入力の cosine を出力・全 >=0.999 で PASS
```

逐語ログは `docs/planning/c3/ruri-parity-evidence.md` に保存済み。

## テスト

```bash
# repo 直下（torch 無し環境）: 自動 skip で緑を維持
pytest -q
# component venv 内（torch あり）: 実 cosine>=0.999 を assert
.venv/Scripts/python.exe -m pytest -q tests/
```

## 残し方（ponytail）

- 常駐 index なし・ベクトルDB なし(B6)。埋め込みは R2 派生層(embeddings.bin + manifest)へ書く既存契約に載る想定。
- backend 既定 OFF。実用化そのものが人間ゲート後の別判断(research §5 risk 7)。
