#!/usr/bin/env python3
"""Apply square artwork to Tesla's official wrap alpha mask."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS_SIZE = (1024, 1024)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Map artwork onto the opaque panels of a Tesla wrap template."
    )
    parser.add_argument("artwork", type=Path, help="Square artwork or texture image")
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("assets/modely-2025-premium-template.png"),
        help="Official Tesla wrap template",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output/custom_wrap.png"),
        help="Destination PNG",
    )
    return parser.parse_args()


def fit_artwork(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize and center-crop artwork to completely cover the wrap canvas."""
    source = image.convert("RGBA")
    scale = max(size[0] / source.width, size[1] / source.height)
    resized_size = (round(source.width * scale), round(source.height * scale))
    resized = source.resize(resized_size, Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def apply_template_mask(artwork: Image.Image, template: Image.Image) -> Image.Image:
    """Preserve Tesla's exact alpha mask while replacing panel colors."""
    template_rgba = template.convert("RGBA")
    if template_rgba.size != CANVAS_SIZE:
        raise ValueError(
            f"Template must be {CANVAS_SIZE[0]}x{CANVAS_SIZE[1]}, "
            f"got {template_rgba.width}x{template_rgba.height}"
        )

    fitted_artwork = fit_artwork(artwork, template_rgba.size)
    fitted_artwork.putalpha(template_rgba.getchannel("A"))
    return fitted_artwork


def main() -> None:
    args = parse_args()
    with Image.open(args.artwork) as artwork, Image.open(args.template) as template:
        result = apply_template_mask(artwork, template)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, format="PNG", optimize=True)
    print(f"Created {args.output} ({args.output.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
