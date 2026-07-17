"""obs-manifest ITO + dummy backend TC (design-k1 §3 / V3-OBS-08/09). No network,
no torch — the dummy backend is deterministic and self-contained. Test names ASCII.
"""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import pytest

# Load the sibling run.py under a UNIQUE module name. A bare `import run` collides
# with components/collector-switchbot/run.py in the same pytest session (both are
# top-level `run` modules; whichever is imported first wins in sys.modules), which
# made every obs-manifest attribute lookup resolve to the wrong module.
_spec = importlib.util.spec_from_file_location(
    "obs_manifest_run", Path(__file__).resolve().parent.parent / "run.py"
)
run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run)


# ── OBS-09 dummy image backend ───────────────────────────────────────────────
def test_dummy_backend_is_384_dim_l2_normalized_no_nan():
    vec = run.embed_dummy(b"hello world")
    assert len(vec) == run.EMBEDDING_DIM == 384
    assert all(math.isfinite(x) for x in vec)  # no NaN / Inf
    norm = math.sqrt(sum(x * x for x in vec))
    assert norm == pytest.approx(1.0, abs=1e-9)  # L2-normalized


def test_dummy_backend_is_deterministic_and_input_sensitive():
    assert run.embed_dummy(b"same") == run.embed_dummy(b"same")  # same bytes -> same vector
    assert run.embed_dummy(b"same") != run.embed_dummy(b"different")


def test_dinov2_backend_is_off_by_default():
    with pytest.raises(RuntimeError):
        run.get_backend("dinov2")(b"x", 384)
    with pytest.raises(ValueError):
        run.get_backend("bogus")


# ── OBS-08 ITO manifest ──────────────────────────────────────────────────────
def test_run_writes_required_manifests_and_embeddings(tmp_path):
    inputs = [{"image_id": "a", "bytes": b"aaa"}, {"image_id": "b", "bytes": b"bbb"}]
    res = run.run_manifest(inputs, tmp_path, "run-1", backend="dummy")
    out = Path(res["out_dir"])

    # output_manifest is REQUIRED and lists both rows.
    om = json.loads((out / "output_manifest.json").read_text("utf-8"))
    assert om["count"] == 2
    assert {r["image_id"] for r in om["rows"]} == {"a", "b"}
    assert om["embedding_dim"] == 384
    assert (out / "input_manifest.json").exists()
    assert (out / "run_info.json").exists()
    # each row's embedding file exists and holds a 384-vector.
    for r in om["rows"]:
        v = json.loads((out / r["embedding_file"]).read_text("utf-8"))["vector"]
        assert len(v) == 384


def test_bad_row_continues_and_is_logged_to_errors_jsonl(tmp_path):
    inputs = [
        {"image_id": "ok", "bytes": b"good"},
        {"image_id": "broken"},  # neither bytes nor path -> fails
        {"image_id": "ok2", "bytes": b"good2"},
    ]
    res = run.run_manifest(inputs, tmp_path, "run-err", backend="dummy")
    out = Path(res["out_dir"])
    assert res["run_info"]["n_ok"] == 2
    assert res["run_info"]["n_error"] == 1
    errs = [json.loads(line) for line in (out / "errors.jsonl").read_text("utf-8").splitlines()]
    assert len(errs) == 1
    assert errs[0]["image_id"] == "broken"
    # the two good rows still made it into the output_manifest.
    om = json.loads((out / "output_manifest.json").read_text("utf-8"))
    assert {r["image_id"] for r in om["rows"]} == {"ok", "ok2"}


def test_same_run_id_existing_output_fails(tmp_path):
    run.run_manifest([{"image_id": "a", "bytes": b"aaa"}], tmp_path, "dup", backend="dummy")
    with pytest.raises(FileExistsError):
        run.run_manifest([{"image_id": "a", "bytes": b"aaa"}], tmp_path, "dup", backend="dummy")


def test_searchable_capture_set_column_order_is_fixed():
    # OBS-56: the fixed column order is the contract; the Polars batch is later.
    assert run.SEARCHABLE_CAPTURE_SET_COLUMNS[0] == "capture"
    assert run.SEARCHABLE_CAPTURE_SET_COLUMNS[-1] == "shape"
    assert "embedding_locator" in run.SEARCHABLE_CAPTURE_SET_COLUMNS
    assert len(run.SEARCHABLE_CAPTURE_SET_COLUMNS) == 12


# ── OBS-09 EmbeddingBackend Protocol一本化 ────────────────────────────────────
def test_resolve_image_backend_defaults_to_dummy_protocol_shape():
    backend = run.resolve_image_backend()
    assert backend.model_name == "dummy-sha256-rng"
    assert backend.embedding_dim == 384
    vec = backend.embed_image(b"hello")
    assert len(vec) == 384
    assert vec == run.embed_dummy(b"hello")  # same math as the bare function


def test_resolve_image_backend_dinov2_is_off_by_default():
    backend = run.resolve_image_backend("dinov2")
    assert backend.model_name == "dinov2_vits14"
    with pytest.raises(RuntimeError):
        backend.embed_image(b"x")


# ── OBS-09 併算: 色ヒスト/透明感/黒割合 ───────────────────────────────────────
def test_analyze_color_is_deterministic_and_bounded():
    a = run.analyze_color(b"same-bytes")
    b = run.analyze_color(b"same-bytes")
    assert a == b  # deterministic
    assert len(a["histogram"]) == 8
    assert pytest.approx(sum(a["histogram"]), abs=1e-9) == 1.0
    assert 0.0 <= a["transparency"] <= 1.0
    assert 0.0 <= a["black_ratio"] <= 1.0
    assert run.analyze_color(b"different-bytes") != a


# ── OBS-08 derived-artifact metadata (run_id/schema_version/input_hash/provenance) ──
def test_output_rows_and_run_info_carry_derived_artifact_metadata(tmp_path):
    inputs = [{"image_id": "a", "bytes": b"aaa"}, {"image_id": "b", "bytes": b"bbb"}]
    res = run.run_manifest(inputs, tmp_path, "run-meta", backend="dummy")
    om = res["output_manifest"]
    for row in om["rows"]:
        assert row["run_id"] == "run-meta"
        assert row["schema_version"] == run.MANIFEST_SCHEMA_VERSION
        assert row["input_hash"] == row["sha256"]
        assert row["provenance"]["generator_kind"] == "agent"
        assert "histogram" in row["color"]

    info = res["run_info"]
    assert info["schema_version"] == run.MANIFEST_SCHEMA_VERSION
    assert isinstance(info["input_hash"], str) and len(info["input_hash"]) == 64  # sha256 hex

    # re-running with the SAME inputs (different run_id) yields the SAME
    # run-level input_hash — it is a pure function of the input set.
    res2 = run.run_manifest(inputs, tmp_path, "run-meta-2", backend="dummy")
    assert res2["run_info"]["input_hash"] == info["input_hash"]
