"""
"Tell your friends" visuals for the 0.3 release: a Facebook carousel and an Instagram story.
Every app screen is a real screenshot (see README.md for which ones and what is staged). Drawn: the
headlines, the background and the end cards, in the colours and font of ../instagram/.

  npx tsx marketing/friends/capture.ts      # the editor shots, needs `npm run build`
  python3 marketing/friends/render.py       # -> marketing/friends/out/

  fb-1..5.jpg     1080x1350  Facebook post (multi-photo) or Instagram feed carousel
  story-1..6.jpg  1080x1920  Instagram story (story-6 leaves room for the link sticker)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'out'
SHOTS = ROOT / 'marketing/work/friends'
FONTS = Path('/usr/share/fonts/opentype/inter')

BG = (18, 20, 25)
ACCENT = (245, 176, 65)
TEXT = (240, 241, 245)
MUTED = (154, 161, 177)
WEIGHTS = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'}


def font(weight, size, display=False):
    return ImageFont.truetype(str(FONTS / f'{"InterDisplay" if display else "Inter"}-{WEIGHTS[weight]}.otf'), size)


# Real screenshots and the part of each that is shown: (file, (x, y, w, h)) in source pixels.
SRC = {
    'score': (SHOTS / 'editor-guitar.png', (440, 102, 1280, 1280)),
    'drums': (SHOTS / 'editor-drums.png', (0, 102, 1300, 1180)),
    'assistant': (SHOTS / 'editor-guitar.png', (0, 760, 420, 960)),
    'audio': (ROOT / 'appstore/screenshots/7-audio-file.png', (1958, 130, 893, 1036)),
    'cloud': (ROOT / 'appstore/screenshots/8-cloud.png', (806, 490, 1268, 806)),
}


def shot(name, box_w):
    path, (x, y, w, h) = SRC[name]
    im = Image.open(path).convert('RGB').crop((x, y, x + w, y + h))
    return im.resize((box_w, round(box_w * h / w)), Image.LANCZOS)


def background(w, h):
    im = Image.new('RGB', (w, h), BG)
    g = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(g)
    d.ellipse((w * 0.35, -h * 0.25, w * 1.5, h * 0.35), fill=(78, 54, 18))
    d.ellipse((-w * 0.6, h * 0.6, w * 0.6, h * 1.3), fill=(24, 34, 62))
    return Image.blend(im, g.filter(ImageFilter.GaussianBlur(170)), 0.9)


def place(canvas, img, x, y, radius=26):
    d = ImageDraw.Draw(canvas)
    w, h = img.size
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x - 4, y + 10, x + w + 4, y + h + 22), radius=radius, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(shadow, (0, 0), shadow)
    d.rounded_rectangle((x - 4, y - 4, x + w + 4, y + h + 4), radius=radius + 4, fill=(70, 76, 92))
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    canvas.paste(img, (x, y), mask)


def rich(d, text, f, max_w, cx, y, gap=1.18, color=TEXT):
    """Centred text; [words] are drawn in the accent colour. Returns the y below the last line."""
    words = []
    accent = False
    for raw in text.split(' '):
        if raw.startswith('['):
            accent, raw = True, raw[1:]
        if ']' in raw:
            head, tail = raw.split(']', 1)
            words.append((head, True))
            if tail:
                words[-1] = (head + tail, True)
            accent = False
        else:
            words.append((raw, accent))
    lines, cur = [], []
    for wd in words:
        trial = ' '.join(t for t, _ in cur + [wd])
        if cur and d.textlength(trial, font=f) > max_w:
            lines.append(cur)
            cur = []
        cur.append(wd)
    lines.append(cur)
    lh = round(f.size * gap)
    for line in lines:
        total = d.textlength(' '.join(t for t, _ in line), font=f)
        x = cx - total / 2
        for i, (t, acc) in enumerate(line):
            s = t + (' ' if i < len(line) - 1 else '')
            d.text((x, y), s, font=f, fill=ACCENT if acc else color)
            x += d.textlength(s, font=f)
        y += lh
    return y


def icon(canvas, cx, y, size):
    ic = Image.open(ROOT / 'build/icon.png').convert('RGBA').resize((size, size), Image.LANCZOS)
    canvas.paste(ic, (cx - size // 2, y), ic)


def slide(w, h, title, sub, name=None, shot_w=None, top=None, title_size=84, footer=None):
    im = background(w, h)
    d = ImageDraw.Draw(im)
    y = top if top is not None else (150 if h > 1500 else 96)
    y = rich(d, title, font(900, title_size, display=True), w - 140, w / 2, y, gap=1.12)
    if sub:
        y = rich(d, sub, font(500, 38), w - 170, w / 2, y + 22, gap=1.35, color=MUTED)
    if name:
        img = shot(name, shot_w or w - 120)
        room = h - y - (170 if footer else 90)
        if img.height > room:
            img = img.resize((round(img.width * room / img.height), room), Image.LANCZOS)
        place(im, img, (w - img.width) // 2, y + 56)
    if footer:
        f = font(600, 36)
        d.text((w / 2, h - 90), footer, font=f, fill=MUTED, anchor='mm')
    return im


def end_card(w, h, story):
    im = background(w, h)
    d = ImageDraw.Draw(im)
    y = 330 if story else 170
    icon(im, w // 2, y, 190)
    y += 270
    y = rich(d, 'Free download at [fretlane.app]', font(900, 88, display=True), w - 140, w / 2, y, gap=1.12)
    y += 30
    for line in ['Mac, Windows and Linux', 'Mac version now signed by Apple', 'No account needed to play']:
        d.text((w / 2, y), line, font=font(500, 40), fill=TEXT, anchor='mt')
        y += 62
    y += 40
    d.rounded_rectangle((90, y, w - 90, y + 210), radius=28, fill=(34, 37, 46), outline=(70, 76, 92), width=2)
    rich(d, 'Writing songs + the riff assistant: [Fretlane Cloud], from $5 a month', font(600, 38), w - 260, w / 2, y + 44, gap=1.35)
    if story:
        d.text((w / 2, h - 330), 'Link sticker goes here ↓', font=font(500, 32), fill=MUTED, anchor='mm')
    return im


def main():
    OUT.mkdir(exist_ok=True)
    W, H = 1080, 1350
    fb = [
        slide(W, H, 'My tab player [writes songs] now', 'Fretlane 0.3: type the frets, hear every note as you go', 'score'),
        slide(W, H, 'Guitar, bass and [drums]', 'One song, every part, and it all plays back together', 'drums'),
        slide(W, H, 'Stuck? Ask for a [bass line]', 'The riff assistant reads your whole song and writes the parts that fit', 'assistant', shot_w=420),
        slide(W, H, 'Play along with [your own recordings]', 'Rehearsal takes, backing tracks, MP3 or WAV. Slow them down without the pitch going weird.', 'audio'),
        end_card(W, H, story=False),
    ]
    for i, im in enumerate(fb, 1):
        im.save(OUT / f'fb-{i}.jpg', quality=92)

    W, H = 1080, 1920
    story = [
        None,
        slide(W, H, 'Now it [writes songs]', 'Type the frets, hear every note as you go', 'score', top=260),
        slide(W, H, 'With [drums] too', 'And bass, ukulele, mandolin, banjo…', 'drums', top=260),
        slide(W, H, 'And an AI that writes the [bass line]', 'It reads the whole song first', 'assistant', shot_w=470, top=200),
        slide(W, H, 'Your band\'s rehearsal, [synced to the tab]', 'Drop in your own audio file and pin bar 1', 'audio', top=260),
        end_card(W, H, story=True),
    ]
    first = background(W, H)
    d = ImageDraw.Draw(first)
    icon(first, W // 2, 520, 220)
    y = rich(d, 'Remember that [tab player] I built?', font(900, 104, display=True), W - 140, W / 2, 840, gap=1.1)
    rich(d, 'It got a lot bigger →', font(600, 46), W - 160, W / 2, y + 50, color=MUTED)
    story[0] = first
    for i, im in enumerate(story, 1):
        im.save(OUT / f'story-{i}.jpg', quality=92)
    print(f'wrote {len(fb)} feed images and {len(story)} story frames to {OUT}')


if __name__ == '__main__':
    main()
