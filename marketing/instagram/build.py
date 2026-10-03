"""
Builds the Instagram Reels (1080x1920, 30 fps, H.264 + AAC) and their cover images from the takes
recorded by marketing/instagram/record.ts.

  npx tsx marketing/instagram/record.ts http://localhost:5183          -> marketing/work/ig/<take>/
  npx tsx marketing/export-audio.ts http://localhost:5183 "Greensleeves" marketing/work/ig/greensleeves.wav
  python3 marketing/instagram/build.py [reel...] [--preview]          -> marketing/instagram/out/

Needs ffmpeg, Pillow and Inter as TTF in marketing/work/fonts (Inter-<weight>.ttf).

What is real: every app shot is footage of the app; the sound is what the app itself played during
the recording (captured from its Web Audio output), cut together with the picture. Footage is only
ever sped up where the app was silent. The one exception is the archive reel, which has no sound of
its own: it gets "Greensleeves" rendered by Fretlane's synthesizer as background music.
The drawn parts are the captions, the frame around the footage and the end card.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent / 'work' / 'ig'
FONTS = ROOT.parent / 'work' / 'fonts'
OUT = ROOT / 'out'
TMP = WORK / 'build'
W, H, FPS = 1080, 1920, 30
SRC_W, SRC_H = 1080, 1350  # recorded frames
FX, FY, FW, FH = 40, 470, 1000, 1250  # footage box on the reel
BG = (18, 20, 25)
ACCENT = (245, 176, 65)
TEXT = (240, 241, 245)
MUTED = (154, 161, 177)
LOGO = Image.open(ROOT.parent.parent / 'build' / 'icon.png').convert('RGBA')

# A shot: a stretch of one take [t0, t1] (seconds after the take's first frame, or a marker name with
# an optional offset), how fast to play it, an optional crop (x, y, w, h in the 1080x1350 recording,
# 4:5) and the caption. [Square brackets] in a caption are drawn in the accent colour.
REELS = {
    'band': dict(
        take='band',
        title='The whole band\nplays along',
        cover_at=('bass', 3.0),
        shots=[
            dict(t0='library', t1='play', speed=1.5, say='This guitar tab plays like a [whole band]'),
            dict(t0='play', t1='bass', crop=(0, 0, 880, 1100), say='This guitar tab plays like a [whole band]'),
            dict(t0='bass', t1='drums', crop=(0, 0, 880, 1100), say='Want the bass line?\n[One tap.]'),
            dict(t0='drums', t1=('end', -0.2), crop=(0, 0, 880, 1100), say='Or read along with\nthe [drum part]'),
        ],
    ),
    'practice': dict(
        take='practice',
        title='Slow it down.\nLoop it. Nail it.',
        cover_at=('loop', 9.0),
        shots=[
            dict(t0=('play', 0.6), t1=('speed', -0.3), say='Can\'t keep up\nwith a song?'),
            dict(t0=('speed', 0.0), t1=('loop', -0.6), say='Play it at\n[half speed]'),
            dict(t0=('loop', 0.0), t1=('loop', 14.0), say='Loop the bars you\nkeep [messing up]'),
            dict(t0=('metronome', 0.0), t1=('tap', -0.2), crop=(400, 0, 680, 850), say='A metronome at\nthe [song\'s tempo]'),
            dict(t0=('tap', 0.0), t1=('end', -1.6), crop=(400, 0, 680, 850), say='Or [tap in]\nyour own tempo'),
        ],
    ),
    'paste': dict(
        take='paste',
        title='Plain-text tab\nin, music out',
        cover_at=('playing', 4.0),
        shots=[
            dict(t0='library', t1='paste', speed=1.5, say='Found a tab online\nthat\'s just [plain text]?'),
            dict(t0='paste', t1='added', speed=1.3, say='[Paste it] into\nFretlane'),
            dict(t0='added', t1='playing', say='Now it\'s a [real tab]'),
            dict(t0='playing', t1=('end', -0.3), crop=(0, 0, 880, 1100), say='That [plays], with a cursor\non every note'),
        ],
    ),
    'archive': dict(
        take='archive',
        title='The most satisfying\nbutton in the app',
        cover_at=('end', -0.4),
        bed=WORK / 'greensleeves.wav',
        shots=[
            dict(t0='library', t1='done', speed=1.2, say='Star the songs\nyou\'re [learning]'),
            dict(t0='done', t1=('end', -2.2), say='Learned one?\nMark it [done]'),
            dict(t0=('end', -2.2), t1='end', say='Your archive of songs\nyou can [actually play]'),
        ],
    ),
}


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f'{args[0]} failed:\n{r.stderr[-3000:]}')
    return r


def font(weight, size, display=False):
    return ImageFont.truetype(str(FONTS / f'{"InterDisplay" if display else "Inter"}-{weight}.ttf'), size)


def duration(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]).stdout
    return float(out.strip())


# ---------- the recording ----------
def assemble(take):
    """frames + audio taps -> raw.mp4 (30 fps) and mix.wav, both starting at the first frame."""
    d = WORK / take
    frames = json.loads((d / 'frames.json').read_text())
    meta = json.loads((d / 'marks.json').read_text())
    t0 = frames[0]['t']
    raw, mix = d / 'raw.mp4', d / 'mix.wav'
    if not raw.exists() or raw.stat().st_mtime < Path(__file__).stat().st_mtime:
        lines = []
        # Chrome only sends frames when the page changes: hold the last one until the last marker.
        tail = max(0.5, max(meta['marks'].values()) - frames[-1]['t'] + 0.2)
        for i, f in enumerate(frames):
            dt = frames[i + 1]['t'] - f['t'] if i + 1 < len(frames) else tail
            lines.append(f"file '{d / f['file']}'\nduration {max(dt, 0.001):.4f}\n")
        lines.append(f"file '{d / frames[-1]['file']}'\n")
        (d / 'frames.txt').write_text(''.join(lines))
        run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(d / 'frames.txt'),
             '-vf', f'fps={FPS},scale={SRC_W}:{SRC_H}:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '12', str(raw)])
    length = duration(raw)
    tracks = meta['audio']
    if not tracks:
        run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', f'{length:.3f}', str(mix)])
    else:
        args, chains = ['ffmpeg', '-y'], []
        for i, a in enumerate(tracks):
            args += ['-i', str(d / a['file'])]
            ms = max(0, round((a['start'] - t0) * 1000))
            chains.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{i}]')
        ins = ''.join(f'[a{i}]' for i in range(len(tracks)))
        graph = ';'.join(chains) + f';{ins}amix=inputs={len(tracks)}:normalize=0,apad,atrim=0:{length:.3f}[out]'
        run(args + ['-filter_complex', graph, '-map', '[out]', str(mix)])
    marks = {k: v - t0 for k, v in meta['marks'].items()}
    return raw, mix, marks


def at(marks, ref):
    if isinstance(ref, tuple):
        return marks[ref[0]] + ref[1]
    return marks[ref] if isinstance(ref, str) else ref


def loudness(wav, t0, t1):
    """Peak level (dB) of a stretch of the mix, to make sure we never speed up audible sound."""
    r = run(['ffmpeg', '-ss', f'{t0:.3f}', '-t', f'{t1 - t0:.3f}', '-i', str(wav), '-af', 'volumedetect', '-f', 'null', '-'])
    line = [ln for ln in r.stderr.splitlines() if 'max_volume' in ln]
    return float(line[0].split('max_volume:')[1].split('dB')[0]) if line else -91.0


# ---------- drawing ----------
def background():
    im = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(g)
    d.ellipse((W * 0.35, -H * 0.25, W * 1.5, H * 0.35), fill=(78, 54, 18))
    d.ellipse((-W * 0.6, H * 0.6, W * 0.6, H * 1.3), fill=(24, 34, 62))
    return Image.blend(im, g.filter(ImageFilter.GaussianBlur(170)), 0.9)


def rich_lines(text, f, d, max_w):
    """Splits 'a [b c]? d' captions into lines of words; each word is a list of (text, accent) runs."""
    out = []
    for para in text.split('\n'):
        words, accent = [], False
        for raw in para.split(' '):
            runs, cur = [], ''
            for ch in raw:
                if ch in '[]':
                    if cur:
                        runs.append((cur, accent))
                    cur, accent = '', ch == '['
                else:
                    cur += ch
            if cur:
                runs.append((cur, accent))
            words.append(runs)
        line = []
        for w in words:
            trial = ' '.join(''.join(t for t, _ in x) for x in line + [w])
            if line and d.textlength(trial, font=f) > max_w:
                out.append(line)
                line = []
            line.append(w)
        out.append(line)
    return out


def draw_caption(im, text, cy, size=74):
    d = ImageDraw.Draw(im)
    f = font(800, size, display=True)
    lines = rich_lines(text, f, d, W - 140)
    lh = size * 1.18
    y = cy - lh * len(lines) / 2
    space = d.textlength(' ', font=f)
    for line in lines:
        total = sum(d.textlength(t, font=f) for w in line for t, _ in w) + space * (len(line) - 1)
        x = (W - total) / 2
        for w in line:
            for t, acc in w:
                d.text((x, y + lh / 2), t, font=f, fill=ACCENT if acc else TEXT, anchor='lm')
                x += d.textlength(t, font=f)
            x += space
        y += lh


def brand_row(im, y):
    d = ImageDraw.Draw(im)
    logo = LOGO.resize((54, 54), Image.LANCZOS)
    f = font(700, 34)
    label = 'Fretlane'
    tw = d.textlength(label, font=f)
    x = (W - 54 - 14 - tw) / 2
    im.paste(logo, (int(x), y), logo)
    d.text((x + 68, y + 27), label, font=f, fill=TEXT, anchor='lm')


def frame_overlay(caption):
    """Everything around the footage, with a transparent rounded hole where the footage goes."""
    im = background().convert('RGBA')
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((FX - 4, FY - 4, FX + FW + 4, FY + FH + 4), radius=30, fill=(70, 76, 92, 255))
    hole = Image.new('L', (W, H), 0)
    ImageDraw.Draw(hole).rounded_rectangle((FX, FY, FX + FW, FY + FH), radius=26, fill=255)
    alpha = im.getchannel('A')
    alpha.paste(0, mask=hole)
    im.putalpha(alpha)
    draw_caption(im, caption, 330)
    d.text((W / 2, FY + FH + 34), 'Real screen recording  ·  sound from the app', font=font(500, 26), fill=MUTED, anchor='mm')
    brand_row(im, FY + FH + 76)
    return im


def end_card():
    im = background()
    d = ImageDraw.Draw(im)
    logo = LOGO.resize((240, 240), Image.LANCZOS)
    im.paste(logo, ((W - 240) // 2, 560), logo)
    d.text((W / 2, 900), 'Fretlane', font=font(900, 132, display=True), fill=TEXT, anchor='mm')
    draw_caption(im, 'The guitar tab player where\nthe [whole band] plays along', 1060, size=52)
    d.text((W / 2, 1210), 'Free  ·  open source  ·  Mac, Windows, Linux', font=font(500, 36), fill=MUTED, anchor='mm')
    f = font(800, 44)
    label = 'Link in bio'
    tw = d.textlength(label, font=f)
    d.rounded_rectangle(((W - tw) / 2 - 44, 1300, (W + tw) / 2 + 44, 1390), radius=45, fill=ACCENT)
    d.text((W / 2, 1345), label, font=f, fill=(27, 27, 27), anchor='mm')
    return im


def cover(reel, still):
    """Cover image: the reel's title over a real frame. Readable inside Instagram's 3:4 grid crop."""
    im = background()
    shot = still.crop((0, 0, SRC_W, SRC_H)).resize((FW, FH), Image.LANCZOS)
    mask = Image.new('L', (FW, FH), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, FW, FH), radius=26, fill=255)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((FX - 4, FY - 4, FX + FW + 4, FY + FH + 4), radius=30, fill=(70, 76, 92))
    im.paste(shot, (FX, FY), mask)
    draw_caption(im, reel['title'], 345, size=88)
    brand_row(im, FY + FH + 76)
    return im


# ---------- assembly ----------
def crop_filter(crop):
    x, y, w, h = crop or (0, 0, SRC_W, SRC_H)
    return f'crop={w}:{h}:{x}:{y},scale={FW}:{FH}:flags=lanczos'


def build(name, preview=False):
    reel = REELS[name]
    raw, mix, marks = assemble(reel['take'])
    tmp = TMP / name
    tmp.mkdir(parents=True, exist_ok=True)
    clips = []
    length = duration(raw)
    for i, s in enumerate(reel['shots']):
        t0, t1 = at(marks, s['t0']), min(at(marks, s['t1']), length - 0.05)
        speed = s.get('speed', 1.0)
        if speed != 1.0 and 'bed' not in reel:
            peak = loudness(mix, t0, t1)
            assert peak < -50, f'{name} shot {i}: refusing to speed up audible sound (peak {peak} dB)'
        ov = tmp / f'overlay-{i}.png'
        frame_overlay(s['say']).save(ov)
        if preview:
            for k, tt in (('a', t0 + 0.05), ('b', t1 - 0.1)):
                run(['ffmpeg', '-y', '-ss', f'{tt:.3f}', '-i', str(raw), '-frames:v', '1', str(tmp / f'src-{i}{k}.png')])
                im = Image.new('RGB', (W, H))
                x, y, w, h = s.get('crop') or (0, 0, SRC_W, SRC_H)
                im.paste(Image.open(tmp / f'src-{i}{k}.png').crop((x, y, x + w, y + h)).resize((FW, FH)), (FX, FY))
                o = Image.open(ov)
                im.paste(o, (0, 0), o)
                im.save(tmp / f'preview-{i}{k}.jpg', quality=85)
            continue
        clip = tmp / f'clip-{i}.mp4'
        dur = (t1 - t0) / speed
        graph = (f'color=c=black:s={W}x{H}:r={FPS}:d={dur:.3f}[base];'
                 f'[0:v]trim={t0:.3f}:{t1:.3f},setpts=(PTS-STARTPTS)/{speed},fps={FPS},{crop_filter(s.get("crop"))}[v];'
                 f'[base][v]overlay={FX}:{FY}:shortest=1[bv];[bv][2:v]overlay=0:0,format=yuv420p[vout];')
        if speed == 1.0:
            graph += f'[1:a]atrim={t0:.3f}:{t1:.3f},asetpts=PTS-STARTPTS[aout]'
        else:
            graph += f'anullsrc=r=48000:cl=stereo,atrim=0:{dur:.3f}[aout]'
        run(['ffmpeg', '-y', '-i', str(raw), '-i', str(mix), '-i', str(ov), '-filter_complex', graph,
             '-map', '[vout]', '-map', '[aout]', '-t', f'{dur:.3f}', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
             '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', str(clip.with_suffix('.mkv'))])
        clips.append(clip.with_suffix('.mkv'))
    if preview:
        print(f'{name}: previews in {tmp}')
        return

    # End card: the app's sound rings on under it (what played next in the take), fading out.
    end_png = tmp / 'end.png'
    end_card().save(end_png)
    last_t1 = min(at(marks, reel['shots'][-1]['t1']), length - 0.05)
    end_dur = 3.0
    end = tmp / 'end.mkv'
    tail = f'[1:a]atrim={last_t1:.3f}:{last_t1 + end_dur:.3f},asetpts=PTS-STARTPTS,apad,atrim=0:{end_dur},afade=t=out:st=0:d={end_dur}[aout]'
    run(['ffmpeg', '-y', '-loop', '1', '-framerate', str(FPS), '-t', str(end_dur), '-i', str(end_png), '-i', str(mix),
         '-filter_complex', f'[0:v]fade=t=in:st=0:d=0.25,format=yuv420p[vout];{tail}', '-map', '[vout]', '-map', '[aout]',
         '-t', str(end_dur), '-c:v', 'libx264', '-crf', '16', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', str(end)])
    clips.append(end)

    lst = tmp / 'clips.txt'
    lst.write_text(''.join(f"file '{c}'\n" for c in clips))
    joined = tmp / 'joined.mkv'
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(joined)])
    total = duration(joined)

    OUT.mkdir(exist_ok=True)
    out = OUT / f'reel-{name}.mp4'
    if 'bed' in reel:
        audio_in = ['-i', str(reel['bed'])]
        afilter = f'[1:a]aresample=48000,atrim=0:{total:.3f},afade=t=out:st={total - 2.5:.3f}:d=2.5,loudnorm=I=-16:TP=-1.5:LRA=11[a]'
    else:
        audio_in = []
        afilter = '[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]'
    run(['ffmpeg', '-y', '-i', str(joined), *audio_in, '-filter_complex', afilter, '-map', '0:v', '-map', '[a]',
         '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', str(FPS),
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', str(out)])

    # Cover: a real frame from the take.
    still = tmp / 'cover-src.png'
    run(['ffmpeg', '-y', '-ss', f'{at(marks, reel["cover_at"]):.3f}', '-i', str(raw), '-frames:v', '1', str(still)])
    cover(reel, Image.open(still).convert('RGB')).save(OUT / f'reel-{name}-cover.jpg', quality=92)
    print(f'{out.name}: {duration(out):.1f} s')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for n in args or REELS:
        build(n, preview='--preview' in sys.argv)
