#!/usr/bin/env python3
"""Place complete artwork inside one connected Tesla template panel."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("artwork", type=Path)
    parser.add_argument("--seed-x", type=int, required=True)
    parser.add_argument("--seed-y", type=int, required=True)
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("assets/modely-2025-premium-template.png"),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--diagnostic", type=Path)
    parser.add_argument(
        "--artwork-scale",
        type=float,
        default=1.0,
        help="Scale the artwork relative to the contained size; values above 1 crop",
    )
    parser.add_argument(
        "--rotate",
        type=int,
        choices=(0, 90, 180, 270),
        default=0,
        help="Rotate artwork clockwise before placing it",
    )
    return parser.parse_args()


def connected_panel(alpha: Image.Image, seed: tuple[int, int]) -> Image.Image:
    pixels = alpha.load()
    if pixels[seed] == 0:
        raise ValueError(f"Seed {seed} is outside an opaque template panel")

    panel = Image.new("L", alpha.size, 0)
    panel_pixels = panel.load()
    visited = {seed}
    queue = deque([seed])

    while queue:
        x, y = queue.popleft()
        panel_pixels[x, y] = pixels[x, y]
        for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            nx, ny = neighbor
            if (
                0 <= nx < alpha.width
                and 0 <= ny < alpha.height
                and pixels[nx, ny] > 0
                and neighbor not in visited
            ):
                visited.add(neighbor)
                queue.append(neighbor)
    return panel


def contain_artwork(
    artwork: Image.Image, size: tuple[int, int], artwork_scale: float
) -> Image.Image:
    source = artwork.convert("RGBA")
    if artwork_scale <= 0:
        raise ValueError("--artwork-scale must be greater than 0")
    scale = min(size[0] / source.width, size[1] / source.height) * artwork_scale
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    background_color = source.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    fitted = Image.new("RGBA", size, background_color)
    fitted.alpha_composite(
        resized,
        ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2),
    )
    return fitted


def main() -> None:
    args = parse_args()
    with Image.open(args.template) as template_source, Image.open(args.artwork) as artwork:
        template = template_source.convert("RGBA")
        if args.rotate:
            artwork = artwork.rotate(-args.rotate, expand=True)
        panel = connected_panel(template.getchannel("A"), (args.seed_x, args.seed_y))
        box = panel.getbbox()
        if box is None:
            raise ValueError("Selected panel is empty")

        fitted = contain_artwork(
            artwork,
            (box[2] - box[0], box[3] - box[1]),
            args.artwork_scale,
        )
        layer = Image.new("RGBA", template.size, (0, 0, 0, 0))
        layer.paste(fitted, box[:2])
        wrap = Image.composite(layer, Image.new("RGBA", template.size), panel)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    wrap.save(args.output, optimize=True)

    if args.diagnostic:
        diagnostic = Image.new("RGBA", template.size, (30, 30, 30, 255))
        ghost = Image.new("RGBA", template.size, (255, 255, 255, 65))
        diagnostic.alpha_composite(
            Image.composite(ghost, Image.new("RGBA", template.size), template.getchannel("A"))
        )
        diagnostic.alpha_composite(wrap)
        diagnostic.convert("RGB").save(args.diagnostic, quality=94, optimize=True)

    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
