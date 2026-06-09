#!/usr/bin/env python3
"""Validate a custom wrap against Tesla's documented image requirements."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops


MAX_FILE_SIZE = 1_000_000
VALID_MIN_SIZE = 512
VALID_MAX_SIZE = 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a Tesla custom wrap PNG.")
    parser.add_argument("wrap", type=Path)
    parser.add_argument(
        "--template",
        type=Path,
        default=Path("assets/modely-2025-premium-template.png"),
    )
    return parser.parse_args()


def validate(wrap_path: Path, template_path: Path) -> list[str]:
    errors: list[str] = []
    if wrap_path.suffix.lower() != ".png":
        errors.append("File extension must be .png")
    if wrap_path.stat().st_size > MAX_FILE_SIZE:
        errors.append(
            f"File is {wrap_path.stat().st_size / 1_000_000:.2f} MB; maximum is 1 MB"
        )

    with Image.open(wrap_path) as wrap, Image.open(template_path) as template:
        if wrap.format != "PNG":
            errors.append(f"File format is {wrap.format}; expected PNG")
        if wrap.width != wrap.height:
            errors.append(f"Image must be square; got {wrap.width}x{wrap.height}")
        if not VALID_MIN_SIZE <= wrap.width <= VALID_MAX_SIZE:
            errors.append(
                f"Width must be {VALID_MIN_SIZE}-{VALID_MAX_SIZE}px; got {wrap.width}px"
            )

        wrap_alpha = wrap.convert("RGBA").getchannel("A")
        template_alpha = template.convert("RGBA").getchannel("A")
        if wrap_alpha.size == template_alpha.size:
            transparent_template_area = template_alpha.point(
                lambda value: 255 if value == 0 else 0
            )
            outside_panels = ImageChops.multiply(wrap_alpha, transparent_template_area)
            if outside_panels.getbbox():
                errors.append("Opaque pixels extend outside the official Tesla panels")
        else:
            errors.append("Image size does not match the official template")

    return errors


def main() -> None:
    args = parse_args()
    errors = validate(args.wrap, args.template)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print(f"Valid Tesla wrap: {args.wrap}")


if __name__ == "__main__":
    main()
