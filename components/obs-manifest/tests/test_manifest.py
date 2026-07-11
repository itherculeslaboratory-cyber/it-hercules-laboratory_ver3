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
