# /// script
# dependencies = ["pillow"]
# ///
"""Fits a screenshot to the 1280x800 the Chrome Web Store requires, and that
Firefox Add-ons shows best, without squishing it.

The --crop box is cut out first. If that box is not exactly 16:10, the short
side is padded with the page's own colour, so a white page gets white margins
and a black video frame gets black ones. By default the padding is split
between both sides and takes the colour of the top-left pixel. With
--pad end it all goes below (or to the right), in the colour of the
bottom-left (or top-right) pixel. That suits a page whose top bar has a
different colour from its body. Only then is the image scaled, by the same
factor in both directions.

    uv run src/everything-extension/scripts/fit_store_screenshot.py <in.png> <out.png> [--crop X,Y,WIDTH,HEIGHT] [--pad both|end]
"""

import argparse

from PIL import Image

STORE_SIZE = (1280, 800)


def pad_to_store_ratio(image: Image.Image, pad_at_end: bool) -> Image.Image:
    width, height = image.size
    target_ratio = STORE_SIZE[0] / STORE_SIZE[1]
    padded_size = (max(width, round(height * target_ratio)), max(height, round(width / target_ratio)))
    if pad_at_end:
        pads_below = padded_size[1] > height
        colour = image.getpixel((0, height - 1) if pads_below else (width - 1, 0))
        offset = (0, 0)
    else:
        colour = image.getpixel((0, 0))
        offset = ((padded_size[0] - width) // 2, (padded_size[1] - height) // 2)
    padded = Image.new("RGB", padded_size, colour)
    padded.paste(image, offset)
    return padded


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--crop", help="X,Y,WIDTH,HEIGHT in the input's pixels")
    parser.add_argument("--pad", choices=["both", "end"], default="both")
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGB")
    if args.crop:
        x, y, width, height = (int(value) for value in args.crop.split(","))
        image = image.crop((x, y, x + width, y + height))
    pad_to_store_ratio(image, pad_at_end=args.pad == "end").resize(STORE_SIZE, Image.LANCZOS).save(args.output)


main()
