"""Ko-fi Shop images for Fretlane, laid out from the real App Store screenshots.

    python3 marketing/kofi/build.py

Reads appstore/screenshots/*.png and build/icon.png, writes marketing/kofi/out/*.jpg.
Needs Pillow, numpy and the Inter font (/usr/share/fonts/opentype/inter, or set INTER_DIR).
Colours and font match marketing/social/.
"""
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "appstore" / "screenshots"
ICON = ROOT / "build" / "icon.png"
OUT = Path(__file__).resolve().parent / "out"
INTER = Path(os.environ.get("INTER_DIR", "/usr/share/fonts/opentype/inter"))

BG = (18, 20, 25)
TEXT = (232, 234, 239)
MUTED = (154, 161, 177)
AMBER = (245, 176, 65)
BORDER = (70, 76, 92)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(INTER / f"Inter-{weight}.otf"), size)


def background(w: int, h: int) -> Image.Image:
    """Dark base with an amber glow top-right and a blue glow bottom-left."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32) + BG

    def glow(cx, cy, rx, ry, colour, strength):
        d = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
        a = np.clip(1 - d, 0, 1)[..., None] ** 1.6 * strength
        return a * (np.array(colour, np.float32) - BG)

    img += glow(w * 0.95, 0, w * 0.6, h * 0.55, (110, 75, 25), 0.75)
    img += glow(0, h, w * 0.55, h * 0.5, (30, 45, 80), 0.8)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def paste_shot(canvas: Image.Image, shot: Image.Image, box: tuple[int, int, int]) -> int:
    """Paste a screenshot at (x, y) scaled to width, with border and shadow. Returns its bottom y."""
    x, y, width = box
    height = round(shot.height * width / shot.width)
    shot = shot.convert("RGB").resize((width, height), Image.LANCZOS)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 18, x + width, y + height + 18), 16, fill=(0, 0, 0, 150))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(25)))

    b = 3
    frame = Image.new("RGB", (width + 2 * b, height + 2 * b), BORDER)
    canvas.alpha_composite(rounded(frame, 16), (x - b, y - b))
    canvas.alpha_composite(rounded(shot, 13), (x, y))
    return y + height


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=f) <= width:
            line = test
        else:
            lines.append(line)
            line = word
    return lines + [line]


def brand(canvas: Image.Image, x: int, y: int, size: int) -> None:
    icon = Image.open(ICON).convert("RGBA").resize((round(size * 1.45),) * 2, Image.LANCZOS)
    canvas.alpha_composite(rounded(icon, size // 4), (x, y))
    ImageDraw.Draw(canvas).text((x + icon.width + size * 0.5, y + icon.height / 2), "Fretlane",
                                font=font("Bold", size), fill=TEXT, anchor="lm")


def headline(draw, x: int, y: int, lines: list[list[tuple[str, bool]]], size: int) -> int:
    """Each line is a list of (text, amber?) runs. Returns the y below the last line."""
    f = font("ExtraBold", size)
    for line in lines:
        cx = x
        for text, amber in line:
            draw.text((cx, y), text, font=f, fill=AMBER if amber else TEXT)
            cx += draw.textlength(text, font=f)
        y += round(size * 1.08)
    return y


def paragraph(draw, x: int, y: int, text: str, size: int, width: int, colour=MUTED) -> int:
    f = font("Regular", size)
    for line in wrap(draw, text, f, width):
        draw.text((x, y), line, font=f, fill=colour)
        y += round(size * 1.4)
    return y


def footer(draw, x: int, y: int, size: int) -> None:
    draw.text((x, y), "Free and open source", font=font("Regular", size), fill=MUTED)
    draw.text((x, y + size * 1.4), "Windows · Mac · Linux", font=font("SemiBold", size), fill=TEXT)


def shot(name: str) -> Image.Image:
    return Image.open(SHOTS / name)


TAGLINE = [[("Guitar tabs that", False)], [("play ", True), ("along", True)]]
SUB = "Open a tab, link the YouTube video or Spotify track, and the tab follows the recording."


def cover_square() -> Image.Image:
    w = h = 1200
    c = background(w, h).convert("RGBA")
    d = ImageDraw.Draw(c)
    brand(c, 80, 64, 40)
    y = headline(d, 80, 160, TAGLINE, 84)
    y = paragraph(d, 80, y + 24, SUB, 30, w - 160)
    paste_shot(c, shot("2-player.png"), (80, y + 40, w - 160))
    return c


def cover_wide() -> Image.Image:
    w, h = 1600, 800
    c = background(w, h).convert("RGBA")
    d = ImageDraw.Draw(c)
    brand(c, 72, 64, 38)
    y = headline(d, 72, 230, TAGLINE, 68)
    paragraph(d, 72, y + 24, SUB, 28, 560)
    footer(d, 72, h - 130, 28)
    paste_shot(c, shot("2-player.png"), (720, 150, 820))
    return c


def feature(name: str, title: list[list[tuple[str, bool]]], text: str) -> Image.Image:
    w, h = 1600, 800
    c = background(w, h).convert("RGBA")
    d = ImageDraw.Draw(c)
    brand(c, 72, 64, 32)
    y = headline(d, 72, 250, title, 64)
    paragraph(d, 72, y + 20, text, 28, 500)
    paste_shot(c, shot(name), (640, 150, 900))
    return c


IMAGES = {
    "1-cover-square": cover_square,
    "2-cover-wide": cover_wide,
    "3-library": lambda: feature("1-library.png", [[("22 songs", True)], [("to start with", False)]],
                                 "Well-known public-domain tunes, arranged for guitar, bass and drums, "
                                 "and marked beginner or intermediate."),
    "4-player": lambda: feature("2-player.png", [[("The whole", False)], [("band", True), (" plays", False)]],
                                "Switch between melody, rhythm guitar, bass and drums. Slow it down and "
                                "loop the bar you keep missing."),
    "5-metronome": lambda: feature("3-metronome.png", [[("A metronome", False)], [("built ", False), ("in", True)]],
                                   "Tap tempo, accents, and one click for the song's own tempo at your "
                                   "practice speed."),
    "6-add-song": lambda: feature("6-add-song.png", [[("Bring your", False)], [("own ", False), ("tabs", True)]],
                                  "Guitar Pro, MusicXML or a plain-text tab, plus the song's YouTube or "
                                  "Spotify link."),
}

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, make in IMAGES.items():
        path = OUT / f"{name}.jpg"
        make().convert("RGB").save(path, quality=88, optimize=True)
        print(path.relative_to(ROOT), f"{path.stat().st_size // 1024} KB")
