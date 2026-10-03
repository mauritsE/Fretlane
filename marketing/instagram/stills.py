"""
Still images for Instagram and link previews, made from real frames of the recorded takes.
Run after build.py (it needs marketing/work/ig/<take>/raw.mp4) and screenshot.ts:

  python3 marketing/instagram/stills.py   -> marketing/instagram/out/

  carousel-1..6.jpg   1080x1350 feed carousel
  story-1..3.jpg      1080x1920 stories (story-2 and -3 leave room for Instagram's poll / link sticker)
  profile.png         1080x1080 profile picture (Instagram crops it to a circle)
  social-preview.png  1280x640 GitHub "social preview" / link card for X, Bluesky, LinkedIn, Reddit
"""
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import build as B

OUT = B.OUT
WORK = B.WORK


def frame(take, ref):
    """A real frame from a take: ref is a marker name with an offset in seconds."""
    _, _, marks = B.assemble(take)
    png = B.TMP / f'still-{take}-{ref[0]}-{ref[1]}.png'
    png.parent.mkdir(parents=True, exist_ok=True)
    B.run(['ffmpeg', '-y', '-ss', f'{B.at(marks, ref):.3f}', '-i', str(WORK / take / 'raw.mp4'), '-frames:v', '1', str(png)])
    return Image.open(png).convert('RGB')


def shot(im, crop, box_w, box_h):
    """Crops (x, y, w) of a frame, taking the height from the box's aspect ratio."""
    x, y, w = crop
    h = round(w * box_h / box_w)
    return im.crop((x, y, x + w, y + h)).resize((box_w, box_h), Image.LANCZOS)


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


def bg(w, h):
    full = B.background()  # 1080x1920
    return full.resize((w, round(w * 1920 / 1080)), Image.LANCZOS).crop((0, 0, w, h)) if h <= w * 1920 / 1080 else full.resize((w, h))


def pill(d, cx, cy, label, size=40, fill=B.ACCENT, ink=(27, 27, 27)):
    f = B.font(800, size)
    tw = d.textlength(label, font=f)
    d.rounded_rectangle((cx - tw / 2 - size, cy - size, cx + tw / 2 + size, cy + size), radius=size, fill=fill)
    d.text((cx, cy), label, font=f, fill=ink, anchor='mm')


def sub(d, text, cy, size=32, color=B.MUTED, width=900):
    f = B.font(500, size)
    words, lines, line = text.split(' '), [], ''
    for w in words:
        if line and d.textlength(f'{line} {w}', font=f) > width:
            lines.append(line)
            line = w
        else:
            line = f'{line} {w}'.strip()
    lines.append(line)
    lh = size * 1.4
    y = cy - lh * (len(lines) - 1) / 2
    for ln in lines:
        d.text((540, y), ln, font=f, fill=color, anchor='mm')
        y += lh


def counter(d, i, n):
    d.text((1020, 70), f'{i}/{n}', font=B.font(600, 28), fill=B.MUTED, anchor='rm')
    logo = B.LOGO.resize((44, 44), Image.LANCZOS)
    return logo


# ---------- carousel ----------
SLIDES = [
    dict(title='The guitar tab player where the [whole band] plays along',
         sub='I wanted a practice tool that feels like an instrument, not software. So I built one.',
         img='landscape', crop=(0, 0, 1840)),
    dict(title='Open a song.\nThe [whole band] plays.',
         sub='Melody, rhythm guitar, bass and drums, with a cursor that follows every note. Tap a track to read it.',
         img=('band', ('bass', 3.0)), crop=(0, 0, 900)),
    dict(title='Too fast? [Slow it down]\nand loop it.',
         sub='From 25% to 150% speed. Drag across the bars you keep missing and loop them.',
         img=('practice', ('loop', 9.0)), crop=(0, 0, 1080)),
    dict(title='A metronome that\nknows [the song]',
         sub='One click sets it to the song\'s tempo at your practice speed. Or tap in your own.',
         img=('practice', ('tap', 4.0)), crop=(420, 0, 660)),
    dict(title='Bring your [own tabs]',
         sub='Guitar Pro, MusicXML, alphaTex, or a plain-text tab you paste in. Link a YouTube video and the tab follows it.',
         img=('paste', ('paste', 2.5)), crop=(152, 175, 776)),
    dict(title='[22 songs] built in.\nFree and open source.',
         sub='Greensleeves to Für Elise. Mac, Windows and Linux. Your library stays on your own computer.',
         img=('archive', ('library', 0.3)), crop=(0, 0, 1080), cta=True),
]


def carousel():
    for i, s in enumerate(SLIDES, 1):
        im = bg(1080, 1350)
        d = ImageDraw.Draw(im)
        logo = B.LOGO.resize((48, 48), Image.LANCZOS)
        im.paste(logo, (60, 46), logo)
        d.text((122, 70), 'Fretlane', font=B.font(700, 30), fill=B.TEXT, anchor='lm')
        d.text((1020, 70), f'{i}/{len(SLIDES)}', font=B.font(600, 28), fill=B.MUTED, anchor='rm')
        B.draw_caption(im, s['title'], 215, size=64)
        sub(d, s['sub'], 375, size=30)
        box_w, box_h = 900, 790 if s.get('cta') or i == 1 else 860
        src = Image.open(WORK / 'landscape.png').convert('RGB') if s['img'] == 'landscape' else frame(*s['img'])
        place(im, shot(src, s['crop'], box_w, box_h), 90, 450)
        if i == 1:
            pill(d, 540, 1350 - 72, 'Swipe  →', size=30, fill=(40, 44, 54), ink=B.TEXT)
        if s.get('cta'):
            pill(d, 540, 1350 - 72, 'Free download  ·  link in bio', size=30)
        im.save(OUT / f'carousel-{i}.jpg', quality=92)


# ---------- stories ----------
def stories():
    # 1: announcement over a real frame.
    im = B.background()
    d = ImageDraw.Draw(im)
    logo = B.LOGO.resize((150, 150), Image.LANCZOS)
    im.paste(logo, (465, 250), logo)
    B.draw_caption(im, 'I built a [guitar tab player]', 500, size=76)
    sub(d, 'Free, open source, and the whole band plays along.', 640, size=36, color=B.TEXT)
    place(im, shot(frame('band', ('bass', 3.0)), (0, 0, 900), 860, 940), 110, 760)
    d.text((540, 1790), 'New Reel on my profile', font=B.font(600, 34), fill=B.MUTED, anchor='mm')
    im.save(OUT / 'story-1.jpg', quality=92)

    # 2: question, with an empty area for Instagram's poll sticker.
    im = B.background()
    d = ImageDraw.Draw(im)
    B.draw_caption(im, 'What\'s the hardest part of\n[learning a song]?', 520, size=72)
    d.rounded_rectangle((140, 760, 940, 1160), radius=40, outline=(70, 76, 92), width=3)
    d.text((540, 960), 'Add the poll sticker here', font=B.font(500, 30), fill=(90, 96, 112), anchor='mm')
    sub(d, 'Building Fretlane, a free tab player. Your answers decide what I add next.', 1330, size=32)
    im.save(OUT / 'story-2.jpg', quality=92)

    # 3: link story, room for the link sticker.
    im = B.background()
    d = ImageDraw.Draw(im)
    logo = B.LOGO.resize((220, 220), Image.LANCZOS)
    im.paste(logo, (430, 380), logo)
    d.text((540, 720), 'Fretlane', font=B.font(900, 120, display=True), fill=B.TEXT, anchor='mm')
    B.draw_caption(im, 'Free download for\n[Mac, Windows and Linux]', 900, size=58)
    d.rounded_rectangle((240, 1080, 840, 1240), radius=40, outline=(70, 76, 92), width=3)
    d.text((540, 1160), 'Add the link sticker here', font=B.font(500, 30), fill=(90, 96, 112), anchor='mm')
    sub(d, 'Open source (MIT). No account, no tracking. Your library stays on your computer.', 1390, size=32)
    im.save(OUT / 'story-3.jpg', quality=92)


# ---------- profile picture and link card ----------
def profile():
    im = Image.new('RGB', (1080, 1080), B.BG)
    g = B.background().crop((0, 420, 1080, 1500))
    im.paste(g)
    logo = B.LOGO.resize((640, 640), Image.LANCZOS)
    im.paste(logo, (220, 220), logo)
    im.save(OUT / 'profile.png')


def social_preview():
    W, H = 1280, 640
    im = B.background().resize((1280, 2276)).crop((0, 300, W, 300 + H))
    d = ImageDraw.Draw(im)
    logo = B.LOGO.resize((96, 96), Image.LANCZOS)
    im.paste(logo, (70, 92), logo)
    d.text((70, 250), 'Fretlane', font=B.font(900, 92, display=True), fill=B.TEXT, anchor='lm')
    f = B.font(700, 38)
    d.text((70, 335), 'Guitar tabs where the', font=f, fill=B.TEXT, anchor='lm')
    d.text((70, 385), 'whole band', font=f, fill=B.ACCENT, anchor='lm')
    d.text((70 + d.textlength('whole band ', font=f), 385), 'plays along', font=f, fill=B.TEXT, anchor='lm')
    fs = B.font(500, 26)
    for j, line in enumerate(['Free and open source', 'Mac, Windows and Linux', 'github.com/mauritsE/Fretlane']):
        d.text((70, 470 + j * 40), line, font=fs, fill=B.MUTED if j < 2 else B.TEXT, anchor='lm')
    shot_im = Image.open(WORK / 'landscape.png').convert('RGB')
    # Right side: the real player, cropped to track list + first systems.
    crop = shot(shot_im, (0, 0, 1900), 640, 520)
    place(im, crop, 580, 60, radius=18)
    im.save(OUT / 'social-preview.png')


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    carousel()
    stories()
    profile()
    social_preview()
    print('stills written to', OUT)
