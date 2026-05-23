#!/usr/bin/env python3
"""macOS squircle 图标源生成器

把任意方形 PNG 处理成 macOS Big Sur+ 风格的 squircle 应用图标源：
  - 1024x1024 透明 PNG
  - 内容居中缩放到 824x824（Apple 官方模板规格，四周 100px 透明 padding）
  - 形状为 superellipse |x|^n + |y|^n = 1（n=5，与 Apple 连续曲率视觉一致）
  - 4x supersampling 抗锯齿

用法:
    python3 scripts/icons/make-squircle.py <input.png> <output.png>

依赖: Pillow (pip install pillow)

设计为 macOS / Windows / Linux / iOS / Android 全平台统一图标源；
生成后喂给 `pnpm tauri icon <output.png>` 派生各平台尺寸。
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

CANVAS = 1024
CONTENT = 824
SQUIRCLE_N = 5.0
SUPERSAMPLE = 4
POLY_SAMPLES = 2000


def squircle_polygon(size: int, n: float = SQUIRCLE_N, samples: int = POLY_SAMPLES):
    """采样 superellipse |x|^n + |y|^n = 1 的封闭多边形顶点，用于 ImageDraw.polygon。"""
    half = size / 2.0
    points = []
    for i in range(samples):
        t = 2.0 * math.pi * i / samples
        ct, st = math.cos(t), math.sin(t)
        x = math.copysign(abs(ct) ** (2.0 / n), ct) * half + half
        y = math.copysign(abs(st) ** (2.0 / n), st) * half + half
        points.append((x, y))
    return points


def make_squircle_mask(size: int) -> Image.Image:
    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(squircle_polygon(big), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main(src: str, dst: str) -> None:
    src_path = Path(src)
    if not src_path.is_file():
        print(f"error: source not found: {src}", file=sys.stderr)
        sys.exit(1)

    img = Image.open(src_path).convert("RGBA")
    src_size = img.size
    if src_size[0] != src_size[1]:
        print(f"error: source must be square, got {src_size[0]}x{src_size[1]}", file=sys.stderr)
        sys.exit(1)

    img.thumbnail((CONTENT, CONTENT), Image.LANCZOS)
    cw, ch = img.size

    content_mask = make_squircle_mask(cw)
    r, g, b, a = img.split()
    img_alpha = ImageChops.multiply(a, content_mask)
    img_squircle = Image.merge("RGBA", (r, g, b, img_alpha))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(img_squircle, ((CANVAS - cw) // 2, (CANVAS - ch) // 2), img_squircle)

    canvas.save(dst, "PNG", optimize=True)
    print(f"[squircle] {src} ({src_size}) -> {dst} ({CANVAS}x{CANVAS}, content {cw}x{ch})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: make-squircle.py <input.png> <output.png>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
