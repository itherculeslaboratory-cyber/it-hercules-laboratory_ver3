---
id: component-collector-switchbot
title: collector-switchbot — SwitchBot 温湿度を署名付きで観測 ingest する単発コレクタ
date: "2026-07-11"
status: active
---

# collector-switchbot

SwitchBot Cloud API の温湿度計を読み、`env_collector_ingest_v1` ペイロードにして
**Ed25519 署名**を付け、API の `POST /api/v1/collector/ingest` へ 1 回だけ POST する
常駐しない単発 `run.py`(design-c3 §3 / CL-09 / V3-OBS-28)。

- 署名プロトコルは C1 fixture(`tests/fixtures/cl-09-ed25519-fixture.json`)と**無変更**:
  `signed_message = "<timestamp_ms>.<canonical_json(payload)>"`、
  `canonical_json = json.dumps(sort_keys=True, separators=(',',':'))`(ver2 と byte 一致・TC で担保)。
- 署名そのものが認証。API 側は `COLLECTOR_PUBLIC_KEYS[collector_id]` に登録した公開鍵で検証し、
  改竄署名/未登録 collector は 401。検証成功で観測イベント append(`provenance.generator_kind="device"`)。
- シークレット(SwitchBot token/secret・Ed25519 秘密鍵)は env ファイル参照(既定 `D:\env\platform.env`)。
  **値はコミット・出力しない**(run.py はデバイス数など非機密のみログ)。

## 使い方

```bash
PY=C:/Users/sawad/AppData/Local/Programs/Python/Python312/python.exe
# smoke: トークン疎通のみ(署名/POST なし)
$PY run.py --fetch-only
# 本番: 取得→署名→ingest へ POST(INGEST_URL / COLLECTOR_PRIVATE_KEY_PEM が要る)
$PY run.py --device-id <SwitchBot deviceId>
```

## 必要な env キー(`.env.example` に型あり・実値は D:\env)

`SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET`(SwitchBot v1.1 API 認証)/ `COLLECTOR_ID` /
`COLLECTOR_PRIVATE_KEY_PEM`(Ed25519 秘密鍵 PEM)/ `INGEST_URL` /
任意 `COLLECTOR_USER_ID` `COLLECTOR_PLACEMENT_ID`。

## テスト(dry-run・ネットワーク無し)

```bash
$PY -m pytest -q            # canonical_json byte 一致 + 実 fixture 署名検証 + 署名 roundtrip
```

`cryptography` が無い環境では skip(bare CI 緑維持)。`requests` は実行時のみ遅延 import。

## 残し方(ponytail)

- 常駐しない・retry/backoff なし(cron 1 発)。SwitchBot がレート制限したら backoff を足す。
- リプレイ防御 = API 側の append-only 冪等(同一署名 → 409)のみ。ver2 の ±skew 壁時計ガードは
  「破棄済み fixture 鍵では再署名不能=TC 不能」のため未実装(design-c3 §3 の ponytail 天井)。
