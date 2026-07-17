"""V3-OBS-14 部位別L*a*b*特徴量 TC (design-k1 §2). Pure numpy math — no image
decode/segmentation (that is OBS-46/47's job, a later wave)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest

_spec = importlib.util.spec_from_file_location(
    "obs_manifest_lab_features", Path(__file__).resolve().parent.parent / "lab_features.py"
)
lab_features = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lab_features)


def _solid(rgb: tuple[int, int, int], h: int = 4, w: int = 4) -> np.ndarray:
    return np.tile(np.array(rgb, dtype=np.uint8), (h, w, 1))


def test_rgb_to_lab_white_and_black_reference_points():
    white = lab_features.rgb_to_lab(_solid((255, 255, 255)))
    assert white[0, 0, 0] == pytest.approx(100.0, abs=0.1)  # L*=100
    assert white[0, 0, 1] == pytest.approx(0.0, abs=0.1)  # a*=0
    assert white[0, 0, 2] == pytest.approx(0.0, abs=0.1)  # b*=0

    black = lab_features.rgb_to_lab(_solid((0, 0, 0)))
    assert black[0, 0, 0] == pytest.approx(0.0, abs=0.1)  # L*=0


def test_region_lab_stats_solid_region_has_zero_variance():
    stats = lab_features.region_lab_stats(_solid((120, 80, 40)))
    assert stats["L_var"] == pytest.approx(0.0, abs=1e-9)
    assert stats["a_var"] == pytest.approx(0.0, abs=1e-9)
    assert stats["b_var"] == pytest.approx(0.0, abs=1e-9)
    assert stats["L_mean"] > 0


def test_color_histogram_sums_to_one_and_handles_empty():
    hist = lab_features.color_histogram(_solid((100, 150, 200)))
    assert len(hist) == 8
    assert sum(hist) == pytest.approx(1.0, abs=1e-9)
    empty = lab_features.color_histogram(np.zeros((0, 0, 3), dtype=np.uint8))
    assert empty == [0.0] * 8


def test_compute_part_features_per_part_and_skips_empty_regions():
    regions = {
        "head": _solid((200, 50, 50)),
        "elytra": _solid((10, 10, 10)),
        "horn": np.zeros((0, 0, 3), dtype=np.uint8),  # empty -> must be skipped, not zero-filled
    }
    out = lab_features.compute_part_features(regions)
    assert out["part_names"] == ["elytra", "head"]  # sorted, horn absent (not faked as 0)
    assert "horn" not in out["parts"]
    assert set(out["parts"]["head"].keys()) == {"L_mean", "a_mean", "b_mean", "L_var", "a_var", "b_var", "histogram"}
    # distinct colors -> distinct L means
    assert out["parts"]["head"]["L_mean"] != out["parts"]["elytra"]["L_mean"]


def test_body_parts_vocabulary_is_a_default_not_a_restriction():
    # an unconventional region name is honored just the same (fork-friendly).
    out = lab_features.compute_part_features({"custom-part-xyz": _solid((1, 2, 3))})
    assert out["part_names"] == ["custom-part-xyz"]
    assert set(lab_features.BODY_PARTS) == {"head", "horn", "pronotum", "elytra"}
