---
id: V3-DOC-AI-SESSION-INGEST-HOWTO
title: AIセッション(Cursor等)ローカル抽出手順書
date: "2026-07-17"
status: active
requirement_ids: [V3-WIK-28]
---

# AIセッション(Cursor等)ローカル抽出手順書

> V3-WIK-28「Cursor等のAIセッションを全て閲覧できるようにし、サブ脳として情報を整理・
> 蓄積する」の最小構成。**実DBへ常時接続する常駐サービスは持たない**(不変条項①)。
> ローカルの人間/一度きりのスクリプトが、この手順で本文を取り出して
> `POST /api/v1/research/ai-sessions` へ渡す(サーバは決定論正規化+append のみ)。

## 1. Cursor のセッションデータの所在

Cursor はワークスペースごとの状態を SQLite ファイル `state.vscdb` に保持する
(Windows の既定パス例):

```
%APPDATA%\Cursor\User\workspaceStorage\<workspace-hash>\state.vscdb
```

グローバル(ワークスペース非依存)なチャット履歴は `User\globalStorage\state.vscdb`
側に入っていることもある。どちらも `ItemTable(key TEXT, value BLOB)` 形の
key-value ストアで、AI チャット関連の値は `key` 列に `chat`/`aichat`/`composer`
等の文字列を含むことが多い(**Cursor のバージョンにより key 名は変わりうる —
本書は固定の key 名を保証しない。誇張ゼロ: 下記 2 節の SELECT で毎回自分の
バージョンの実際の key を確認すること**)。

## 2. 読み取り専用(read-only)で開く — ライブDBを壊さない

Cursor 実行中でも安全に読めるよう、**書き込みロックを取らない read-only +
immutable 接続**で開く(Cursor 自身のプロセスと同時にファイルを触っても
壊れない・IHL 側は一切書き込まない)。

Python の例(`sqlite3` 標準ライブラリのみ・追加依存なし):

```python
import sqlite3, json

DB_PATH = r"C:\Users\<you>\AppData\Roaming\Cursor\User\workspaceStorage\<hash>\state.vscdb"
uri = f"file:{DB_PATH}?mode=ro&immutable=1"
con = sqlite3.connect(uri, uri=True)

# 1. まず自分の Cursor バージョンでの実際の key を確認する
for row in con.execute("SELECT key FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%'"):
    print(row[0])

# 2. 見つけた key で本体を取り出す(例)
key = "workbench.panel.aichat.view.aichat"  # ← 1. で確認した実際の key に置き換える
row = con.execute("SELECT value FROM ItemTable WHERE key = ?", (key,)).fetchone()
con.close()  # 読み終えたら即座に閉じる(常時接続はしない)
raw_value = row[0]
```

- `mode=ro`: 書き込みを一切行わない。
- `immutable=1`: SQLite にこのファイルが接続中変化しないことを伝え、ロック
  待ちや WAL チェックポイント絡みの競合を避ける(スナップショット読取の
  ニュアンス — 実際に Cursor が同時に書き込んでいても、こちらの接続は
  即座にエラーにするか開いた時点の内容を読むだけで、相手のファイルを壊さない)。
- 接続は **開く→読む→閉じるの一度きり**。バッチや cron で定期接続するような
  常駐運用は行わない(本要件の不変条項①・「実DB常時接続はしない」)。

## 3. JSON → JSONL への変換(任意)

取り出した値が `[{"role": "user", "content": "..."}, {"role": "assistant", ...}]`
のようなターン配列 JSON なら、1 行 1 ターンの JSONL に変換すると
`POST /research/ai-sessions` の `format:"jsonl"` パーサ(`adaptAiSession`/
`jsonlToMarkdown`・`apps/api/src/research-content-routes.ts`)がそのまま
`**role**: content` の markdown へ整形してくれる:

```python
turns = json.loads(raw_value)
jsonl = "\n".join(json.dumps({"role": t["role"], "content": t["content"]}, ensure_ascii=False) for t in turns)
```

構造が上記と違う場合は、そのまま `format:"markdown"` で自由記述本文として
渡してもよい(パーサは role/content 形以外の行を黙ってスキップするだけで
失敗しない)。

## 4. 取り込み(append)

```python
import urllib.request, json as jsonlib

payload = {
    "source": "cursor",
    "session_ref": DB_PATH + "#" + key,  # 同一セッションの再投入が自然に409になるための決定論キー
    "format": "jsonl",
    "raw": jsonl,
}
req = urllib.request.Request(
    "https://<ihl-host>/api/v1/research/ai-sessions",
    data=jsonlib.dumps(payload).encode("utf-8"),
    headers={"content-type": "application/json", "authorization": "Bearer <session-token>"},
    method="POST",
)
urllib.request.urlopen(req)
```

- 同じ `source`+`session_ref` を再度 POST すると `409 DUPLICATE_CONTENT` になる
  (content_id は `sha256(source:session_ref)` から決定論導出・INSERT ONLY・
  不変条項③)。取り込み直しは `session_ref` を変える(例: 末尾にタイムスタンプ
  を足す)ことで新しい版として追記できる(古い版は消えない)。

## 5. 閲覧

`screen-defs/ai-sessions.json`(`/s/ai-sessions`・設定画面「AIセッション閲覧
(サブ脳)」から導線あり)が一覧(`GET /research/chat-index`)+本文
(`GET /research/content/{id}`)を表示する。

## 参考にした外部フォーマット(V3-WIK-28 要件本文より)

- OKF/SPEC・karpathy の gist 等、軽量な「単一ファイル/決定論変換」の外部知識
  共有フォーマットに合わせ、本経路も「1 セッション = 1 JSONL/markdown
  テキスト → 1 content イベント」という単純な1:1変換に留めている(独自の
  複雑なセッションスキーマは新設しない・reuse-first)。
