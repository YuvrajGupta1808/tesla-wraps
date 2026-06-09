#!/usr/bin/env python3
"""Place artwork precisely inside the Model Y driver-side door UV islands."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


CANVAS_SIZE = (1024, 1024)
DRIVER_DOOR_SEEDS = ((120, 400), (120, 650))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("artwork", type=Path)
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("assets/modely-2025-premium-template.png"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output/driver_side_doors.png"),
    )
    parser.add_argument(
        "--diagnostic",
        type=Path,
        default=Path("output/driver_side_doors_diagnostic.png"),
    )
    return parser.parse_args()


def connected_region(alpha: Image.Image, seed: tuple[int, int]) -> Image.Image:
    pixels = alpha.load()
    if pixels[seed] == 0:
        raise ValueError(f"Seed {seed} is outside an opaque template panel")

    width, height = alpha.size
    region = Image.new("L", alpha.size, 0)
    region_pixels = region.load()
    queue = deque([seed])
    visited = {seed}
    region_pixels[seed] = pixels[seed]

    while queue:
        x, y = queue.popleft()
        for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            nx, ny = neighbor
            if (
                0 <= nx < width
                and 0 <= ny < height
                and pixels[nx, ny] > 0
                and neighbor not in visited
            ):
                visited.add(neighbor)
                region_pixels[nx, ny] = pixels[nx, ny]
                queue.append(neighbor)
    return region


def fit_inside(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Contain the complete square artwork inside a door-sized rectangle."""
    source = image.convert("RGBA")
    scale = min(size[0] / source.width, size[1] / source.height)
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    background = Image.new("RGBA", size, (0, 122, 31, 255))
    position = ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2)
    background.alpha_composite(resized, position)
    return background


def place_on_region(
    canvas: Image.Image, artwork: Image.Image, region: Image.Image
) -> tuple[int, int, int, int]:
    bbox = region.getbbox()
    if bbox is None:
        raise ValueError("Door region is empty")
    fitted = fit_inside(artwork, (bbox[2] - bbox[0], bbox[3] - bbox[1]))
    layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    layer.paste(fitted, bbox[:2])
    canvas.alpha_composite(Image.composite(layer, Image.new("RGBA", CANVAS_SIZE), region))
    return bbox


def make_diagnostic(
    wrap: Image.Image,
    template: Image.Image,
    regions: list[Image.Image],
    boxes: list[tuple[int, int, int, int]],
) -> Image.Image:
    diagnostic = Image.new("RGBA", CANVAS_SIZE, (35, 35, 35, 255))
    full_panel_overlay = Image.new("RGBA", CANVAS_SIZE, (255, 255, 255, 70))
    diagnostic.alpha_composite(
        Image.composite(full_panel_overlay, Image.new("RGBA", CANVAS_SIZE), template.getchannel("A"))
    )
    diagnostic.alpha_composite(wrap)

    draw = ImageDraw.Draw(diagnostic)
    for index, (region, box) in enumerate(zip(regions, boxes), start=1):
        outline = region.filter(ImageFilter.FIND_EDGES)
        red = Image.new("RGBA", CANVAS_SIZE, (255, 40, 40, 255))
        diagnostic.alpha_composite(
            Image.composite(red, Image.new("RGBA", CANVAS_SIZE), outline)
        )
        draw.rectangle(box, outline=(255, 220, 0, 255), width=2)
        draw.text((box[0] + 4, box[1] + 4), f"Driver door {index}", fill="yellow")
    return diagnostic


def main() -> None:
    args = parse_args()
    with Image.open(args.template) as template_source, Image.open(args.artwork) as artwork:
        template = template_source.convert("RGBA")
        regions = [
            connected_region(template.getchannel("A"), seed)
            for seed in DRIVER_DOOR_SEEDS
        ]
        wrap = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
        boxes = [place_on_region(wrap, artwork, region) for region in regions]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    wrap.save(args.output, optimize=True)

    diagnostic = make_diagnostic(wrap, template, regions, boxes)
    diagnostic.save(args.diagnostic, optimize=True)
    print(f"Created {args.output}")
    print(f"Created {args.diagnostic}")


if __name__ == "__main__":
    main()
