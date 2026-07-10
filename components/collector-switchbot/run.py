#!/usr/bin/env python3
"""collector-switchbot — single-shot collector (design-c3 §3 / CL-09 / V3-OBS-28).

Fetches temperature/humidity from the SwitchBot Cloud API, wraps it in an
env_collector_ingest_v1 payload, signs it with an Ed25519 private key, and POSTs
it to the API's POST /api/v1/collector/ingest. NOT a daemon — one run, one push.

The Ed25519 + canonical_json protocol is UNCHANGED from the C1 fixture
(tests/fixtures/cl-09-ed25519-fixture.json): signed_message =
"<timestamp_ms>.<canonical_json(payload)>", canonical_json = json.dumps with
sorted keys + compact separators. The matching public key is registered on the
API side under COLLECTOR_PUBLIC_KEYS[collector_id].

Secrets (SwitchBot token/secret, Ed25519 private key) come from an env file
(default D:\\env\\platform.env). They are NEVER printed — only device counts and
non-secret status are logged. ponytail: no config framework, no retry/backoff —
a single cron-driven run; add backoff only if the SwitchBot API rate-limits.

Usage:
  run.py --fetch-only            # smoke: prove the SwitchBot token works (no signing/POST)
  run.py --device-id <id>        # full: fetch -> build -> sign -> POST to INGEST_URL
  run.py --env-file <path>       # override secrets file (default D:\\env\\platform.env)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SWITCHBOT_API = "https://api.switch-bot.com/v1.1"


# ── protocol (byte-identical to ver2 / the TS route) ────────────────────────
def canonical_json(obj: Any) -> str:
    """ver2 libs/ihl/env/collector_ingest.py canonical_json: sorted keys, compact.

    Reproduces tests/fixtures/cl-09-ed25519-fixture.json canonical_json exactly
    (proven in tests/test_collector.py). Mirror of @ihl/truth canonicalJson.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def signed_message(payload: dict, timestamp_ms: str) -> str:
    return f"{timestamp_ms}.{canonical_json(payload)}"


def sign_payload(payload: dict, private_key_pem: str, timestamp_ms: str) -> str:
    """Ed25519-sign the signed_message → standard base64 of the raw 64-byte sig."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    key = load_pem_private_key(private_key_pem.encode(), password=None)
    sig = key.sign(signed_message(payload, timestamp_ms).encode())
    return base64.b64encode(sig).decode()


# ── SwitchBot status → ingest payload ───────────────────────────────────────
def build_ingest_payload(
    status_body: dict, *, user_id: str, placement_id: str, device_id: str, captured_at: str
) -> dict:
    """Map a SwitchBot Meter status body to an env_collector_ingest_v1 payload.

    status_body = the `body` of GET /devices/{id}/status (temperature/humidity/
    battery). Absent fields are simply omitted (never faked).
    """
    m: dict[str, Any] = {}
    if "temperature" in status_body:
        m["temperatureC"] = status_body["temperature"]
    if "humidity" in status_body:
        m["humidityPct"] = status_body["humidity"]
    if "battery" in status_body:
        m["batteryPct"] = status_body["battery"]
    if "CO2" in status_body:
        m["co2Ppm"] = status_body["CO2"]
    return {
        "schema": "env_collector_ingest_v1",
        "userId": user_id,
        "capturedAt": captured_at,
        "placementId": placement_id,
        "readings": [{"deviceId": device_id, "measurements": m}],
    }


# ── SwitchBot Cloud API (v1.1 HMAC auth) ────────────────────────────────────
def _switchbot_headers(token: str, secret: str) -> dict:
    t = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    to_sign = f"{token}{t}{nonce}".encode()
    sign = base64.b64encode(hmac.new(secret.encode(), to_sign, hashlib.sha256).digest()).decode()
    return {"Authorization": token, "sign": sign, "t": t, "nonce": nonce, "Content-Type": "application/json"}


def switchbot_get(path: str, token: str, secret: str) -> dict:
    import requests  # lazy: the dry-run TC never hits the network

    r = requests.get(f"{SWITCHBOT_API}{path}", headers=_switchbot_headers(token, secret), timeout=15)
    r.raise_for_status()
    return r.json()


def post_ingest(ingest_url: str, collector_id: str, timestamp_ms: str, payload: dict, signature_b64: str) -> int:
    import requests

    r = requests.post(
        ingest_url,
        json={
            "collector_id": collector_id,
            "timestamp": timestamp_ms,
            "payload": payload,
            "signature_base64": signature_b64,
        },
        timeout=15,
    )
    return r.status_code


# ── env file (KEY=VALUE; values never printed) ──────────────────────────────
def load_env_file(path: Path) -> dict:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="single-shot SwitchBot -> collector ingest")
    ap.add_argument("--env-file", default=r"D:\env\platform.env")
    ap.add_argument("--device-id", default=None, help="SwitchBot deviceId (Meter). If omitted, uses first Meter found.")
    ap.add_argument("--fetch-only", action="store_true", help="smoke: list devices only, no signing/POST")
    args = ap.parse_args(argv)

    env = load_env_file(Path(args.env_file))
    token = env.get("SWITCHBOT_TOKEN")
    secret = env.get("SWITCHBOT_SECRET")
    if not token or not secret:
        print(f"[collector] SWITCHBOT_TOKEN/SWITCHBOT_SECRET not found in {args.env_file}", file=sys.stderr)
        return 2

    devices = switchbot_get("/devices", token, secret)
    device_list = devices.get("body", {}).get("deviceList", [])
    # Log counts/types only — never the token or device secrets.
    print(f"[collector] SwitchBot API OK: {len(device_list)} device(s)")

    if args.fetch_only:
        for d in device_list:
            print(f"[collector]   {d.get('deviceType', '?')}  id={d.get('deviceId', '?')[:6]}...")
        return 0

    device_id = args.device_id or next((d.get("deviceId") for d in device_list if "Meter" in str(d.get("deviceType", ""))), None)
    if not device_id:
        print("[collector] no Meter device found; pass --device-id", file=sys.stderr)
        return 3

    status = switchbot_get(f"/devices/{device_id}/status", token, secret).get("body", {})
    payload = build_ingest_payload(
        status,
        user_id=env.get("COLLECTOR_USER_ID", "u_collector"),
        placement_id=env.get("COLLECTOR_PLACEMENT_ID", "pl_default"),
        device_id=device_id,
        captured_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )

    private_pem = env.get("COLLECTOR_PRIVATE_KEY_PEM")
    collector_id = env.get("COLLECTOR_ID", "collector-switchbot-01")
    ingest_url = env.get("INGEST_URL")
    if not private_pem or not ingest_url:
        print("[collector] COLLECTOR_PRIVATE_KEY_PEM / INGEST_URL missing — cannot sign+POST", file=sys.stderr)
        return 4

    timestamp_ms = str(int(time.time() * 1000))
    sig = sign_payload(payload, private_pem, timestamp_ms)
    code = post_ingest(ingest_url, collector_id, timestamp_ms, payload, sig)
    print(f"[collector] ingest POST → HTTP {code}")
    return 0 if code in (202, 409) else 1


if __name__ == "__main__":
    raise SystemExit(main())
