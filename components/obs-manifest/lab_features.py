#!/usr/bin/env python3
"""lab_features.py — OBS-14 部位別平均L*a*b*特徴量 (design-k1 §2 / V3-OBS-14).

Pure numpy math (no cv2/Pillow, no image decode/segmentation here): given
ALREADY-EXTRACTED per-part pixel regions (RGB uint8 arrays — e.g. a LabelMe
polygon crop, OBS-46's job to produce), computes per-part mean/variance L*a*b*
+ an 8-bin intensity histogram. This module IS the "解析ロジック" itself — the
region-extraction step (photo + annotation -> per-part pixel arrays) is a later
wave (OBS-46/47, client-side per V3-AIP-104); this file is the forkable,
independent analysis NODE a template can swap without touching the extraction
step (V3-OBS-14: "解析ロジックはテンプレごとにフォーク可能な独立ノードとして保存する").

Feeds the V3-OBS-11 rerank composite's color/size components once a template
wires real per-part pixel arrays through — until then the rerank's color/size
stay at their documented 欠測既定 (observation-constants.ts RERANK_MISSING).
"""
from __future__ import annotations

from typing import Any

import numpy as np

# Standard body-part vocabulary this pipeline's default template names regions
# after (頭部/胸角/前胸/上翅 — round-16 registry statement for V3-OBS-14). A
# fork may use its own names: compute_part_features() honors WHATEVER key a
# caller supplies, this tuple is documentation/a default template, not a
# schema restriction.
BODY_PARTS = ("head", "horn", "pronotum", "elytra")


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB (..., 3) uint8/float 0-255 -> CIE L*a*b* (D65 illuminant), same
    leading shape. Standard sRGB->linear->XYZ->Lab pipeline, pure numpy."""
    lin = _srgb_to_linear(rgb.astype(np.float64))
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    xn, yn, zn = 0.95047, 1.0, 1.08883  # D65 white point
    xr, yr, zr = x / xn, y / yn, z / zn

    def f(t: np.ndarray) -> np.ndarray:
        d = 6.0 / 29.0
        return np.where(t > d**3, np.cbrt(t), t / (3 * d * d) + 4.0 / 29.0)

    fx, fy, fz = f(xr), f(yr), f(zr)
    lstar = 116.0 * fy - 16.0
    astar = 500.0 * (fx - fy)
    bstar = 200.0 * (fy - fz)
    return np.stack([lstar, astar, bstar], axis=-1)


def region_lab_stats(rgb_region: np.ndarray) -> dict[str, float]:
    """Mean + variance of L*a*b* over one region's pixels — region shape (...,3)."""
    lab = rgb_to_lab(rgb_region).reshape(-1, 3)
    mean = lab.mean(axis=0)
    var = lab.var(axis=0)
    return {
        "L_mean": float(mean[0]), "a_mean": float(mean[1]), "b_mean": float(mean[2]),
        "L_var": float(var[0]), "a_var": float(var[1]), "b_var": float(var[2]),
    }


def color_histogram(rgb_region: np.ndarray, bins: int = 8) -> list[float]:
    """Normalized (sums to 1.0; all-empty region -> all zeros) grayscale
    intensity histogram over the region's pixels."""
    gray = rgb_region.reshape(-1, rgb_region.shape[-1]).astype(np.float64).mean(axis=-1)
    hist, _ = np.histogram(gray, bins=bins, range=(0, 255))
    total = hist.sum()
    return (hist / total).tolist() if total else [0.0] * bins


def compute_part_features(regions: dict[str, np.ndarray]) -> dict[str, Any]:
    """OBS-14: per-part L*a*b* stats + histogram for every named region.

    `regions`: region_name -> RGB uint8 array of shape (H, W, 3) (or any shape
    ending in 3). Empty regions (size 0) are SKIPPED, not zero-filled — a
    missing part must read as absent, never as a fake zero value (誇張ゼロ).
    """
    parts: dict[str, Any] = {}
    for name, region in regions.items():
        if region.size == 0:
            continue
        stats = region_lab_stats(region)
        stats["histogram"] = color_histogram(region)
        parts[name] = stats
    return {"parts": parts, "part_names": sorted(parts)}
