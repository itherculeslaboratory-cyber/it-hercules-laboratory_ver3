"""Dry-run TC for the SwitchBot collector (design-c3 §3). No network.

Ties the Python signer to the SAME protocol the TS ingest route verifies: it
replays the real C1 fixture (tests/fixtures/cl-09-ed25519-fixture.json) to prove
canonical_json is byte-identical to ver2, then signs a freshly-built payload with
an ephemeral keypair and verifies it — the exact shape POST /collector/ingest
accepts. Ed25519 lives in `cryptography`; skip cleanly if it is absent so a bare
CI stays green (mirrors components/wiki-ingest/tests).
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("cryptography", reason="Ed25519 signer dep not installed")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from cryptography.hazmat.primitives.serialization import (  # noqa: E402
    Encoding,
    NoEncryption,
    PrivateFormat,
    load_pem_public_key,
)

import run  # noqa: E402

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "cl-09-ed25519-fixture.json").read_text("utf-8")
)


def test_canonical_json_matches_ver2_fixture_byte_for_byte():
    assert run.canonical_json(FIXTURE["payload"]) == FIXTURE["canonical_json"]
    assert run.signed_message(FIXTURE["payload"], FIXTURE["timestamp"]) == FIXTURE["signed_message"]


def test_verifies_the_real_fixture_signature():
    # Our signed_message + the fixture public key must validate the fixture sig —
    # i.e. what we produce is exactly what the TS route (and ver2) accept.
    pub = load_pem_public_key(FIXTURE["public_key_pem"].encode())
    msg = run.signed_message(FIXTURE["payload"], FIXTURE["timestamp"]).encode()
    pub.verify(base64.b64decode(FIXTURE["signature_base64"]), msg)  # raises on failure


def test_build_ingest_payload_from_switchbot_status():
    status = {"temperature": 24.5, "humidity": 51, "battery": 99}
    p = run.build_ingest_payload(
        status, user_id="u_collector", placement_id="pl_x", device_id="meter-1", captured_at="2026-06-10T03:00:00.000Z"
    )
    assert p["schema"] == "env_collector_ingest_v1"
    assert p["readings"] == [
        {"deviceId": "meter-1", "measurements": {"temperatureC": 24.5, "humidityPct": 51, "batteryPct": 99}}
    ]
    # absent SwitchBot fields are omitted, never faked
    assert "co2Ppm" not in p["readings"][0]["measurements"]


def test_sign_roundtrip_matches_ingest_route_shape():
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    payload = run.build_ingest_payload(
        {"temperature": 20.0, "humidity": 40}, user_id="u", placement_id="pl", device_id="d1", captured_at="2026-07-11T00:00:00Z"
    )
    ts = "1783680913411"
    sig_b64 = run.sign_payload(payload, pem, ts)

    # verify exactly as the TS route does: pubkey over "<ts>.<canonical_json>"
    pub = key.public_key()
    pub.verify(base64.b64decode(sig_b64), run.signed_message(payload, ts).encode())

    # a tampered payload under the same signature must NOT verify
    tampered = json.loads(json.dumps(payload))
    tampered["readings"][0]["measurements"]["temperatureC"] = 99.0
    with pytest.raises(Exception):
        pub.verify(base64.b64decode(sig_b64), run.signed_message(tampered, ts).encode())
