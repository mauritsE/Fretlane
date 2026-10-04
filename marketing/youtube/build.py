"""
Builds the YouTube videos from real recordings of the app.

  1. npx tsx marketing/youtube/record.ts <url>      -> marketing/work/yt (frames, marks, the app's audio)
  2. python3 marketing/youtube/build.py              -> marketing/youtube/out/
       fretlane-walkthrough.mp4 + .srt + chapters.txt   the narrated tour (~4 min, 1920x1080)
       fretlane-trailer.mp4                             the LinkedIn demo with a YouTube end card
       thumbnail-walkthrough.jpg, thumbnail-trailer.jpg 1280x720
     --preview writes one still per shot to marketing/work/yt/preview/ instead.
     --no-sync-footage leaves out Maurits's YouTube-sync recording (it shows a copyrighted song's
       video and tab, which YouTube's Content ID may claim).

Needs ffmpeg, Pillow, kokoro-onnx + soundfile and Inter as TTF in marketing/work/fonts (see
marketing/README.md). Every app screen is real footage. The YouTube-sync shots are cut out of
marketing/fretlane-demo.mp4, which holds Maurits's own recording (the raw file is not in git).
Captions are not burned in: upload the .srt to YouTube instead, so viewers can switch them off.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
MKT = ROOT.parent
WORK = MKT / 'work'
TAKE = WORK / 'yt'
TMP = TAKE / 'build'
OUT = ROOT / 'out'
FONTS = WORK / 'fonts'
TTS = WORK / 'tts'
DEMO = MKT / 'fretlane-demo.mp4'
W, H, FPS = 1920, 1080, 30
BOX = (128, 84, 1664, 936)  # footage frame: x, y, w, h (16:9)
BG = (18, 20, 25)
ACCENT = (245, 176, 65)
TEXT = (232, 234, 239)
MUTED = (154, 161, 177)
VOICE = 'am_michael'
SPEECH = {'Fretlane': 'Fret-lane', 'open-source': 'open source', 'MusicXML': 'Music X M L'}

# One shot = one narration line = one caption. Footage shots cut the take between two markers
# (a marker name, or (name, seconds after it)). `speed` > 1 is only allowed where the app was
# silent; shots at speed 1 keep the app's own sound, and must be long enough for their line.
# `chapter` starts a YouTube chapter when it changes.
SHOTS = [
    dict(card='intro', chapter='Intro',
         say='This is Fretlane: a free, open-source guitar tab player where the whole band plays along.'),
    dict(card='intro', say="Here's a quick tour of everything it does."),

    dict(chapter='The library', t0='library', t1='filter', speed=1.0,
         say='Your library starts out full: twenty-two well-known songs, arranged for the whole band.'),
    dict(t0='filter', t1='search', speed=1.0,
         say='Each one is tagged by level, so you can start with the beginner songs.'),
    dict(t0='search', t1='open', speed=1.0,
         say='Or search by title, artist or tag.'),

    dict(chapter='Play along', t0='open', t1='tracks',
         say='Open a song and press play. The whole band plays, and the cursor follows every note.'),
    dict(t0='tracks', t1='solo',
         say='Click a track to read that part: the bass line, the drums, or back to the melody.'),
    dict(t0='solo', t1=('notation', 1.2),
         say='Solo or mute any instrument to hear exactly what it plays.'),
    dict(t0=('notation', 1.2), t1=('notation', 6.0), speed=1.0,
         say='Zoom in when you need a closer look.'),

    dict(chapter='Practice tools', t0='speed', t1=('loop', 1.0),
         say='Too fast? Slow it down, from a quarter of the speed up to one and a half times.'),
    dict(t0=('loop', 1.0), t1=('loop', 4.3), speed=1.0,
         say='To drill a tricky passage, drag across the bars and press L to loop them.'),
    dict(t0=('loop', 4.3), t1='loop-play', speed=1.0,
         say='Add a count-in, and a click track that follows the tab.'),
    dict(t0='loop-play', t1='metronome',
         say='Now it counts you in, and keeps repeating those bars until you have them.'),

    dict(chapter='Metronome', t0='metronome', t1='subdivision',
         say="The metronome sets itself to the song's tempo, at your practice speed, in one click."),
    dict(t0='subdivision', t1='tap',
         say='Pick eighths, triplets or sixteenths.'),
    dict(t0='tap', t1='favorite',
         say='Or tap in any tempo you like.'),

    dict(chapter='Favorites and archive', t0='favorite', t1='archive', speed=1.3,
         say="Star the songs you're working on, and find them all under Favorites."),
    dict(t0='archive', t1='import', speed=1.2,
         say='Learned a song? Mark it as done and it moves to the archive. One click brings it back.'),

    dict(chapter='Your own tabs', t0='import', t1='paste', speed=1.0,
         say='Add your own tabs: a Guitar Pro or MusicXML file, or a link to one.'),
    dict(t0='paste', t1='riff', speed=1.0,
         say='Or paste a plain-text tab, the kind you find all over the web.'),
    dict(t0='riff', t1=('riff-playing', 3.2),
         say='Fretlane turns it into a real tab you can play, slow down and loop.'),
    dict(t0=('riff-playing', 3.2), t1='end',
         say="Text tabs don't carry rhythm, so the timing inside a bar is a best guess."),

    # Maurits's own recording: a tab he imported, synced to the song's YouTube video.
    dict(chapter='YouTube and Spotify sync', src='demo', t0=65.95, t1=75.6, sync=True,
         say='Link a YouTube video, and the tab follows the recording, bar by bar.'),
    dict(src='demo', t0=75.6, t1=84.8, sync=True,
         say='Switch between lead, rhythm and bass while the video keeps playing.'),
    dict(card='sync', reveal=1,
         say='To set it up, pause the video on the first beat, and pin bar one to that moment.'),
    dict(card='sync', reveal=2,
         say='If the band speeds up or slows down, pin more bars, or tap along on every downbeat.'),
    dict(card='sync', reveal=3,
         say='Spotify tracks work the same way, always at normal speed.'),

    dict(chapter='Download', card='download', reveal=1,
         say='Fretlane is a normal desktop app for Mac, Windows and Linux.'),
    dict(card='download', reveal=2,
         say='Your songs are plain files in a folder on your own computer. No account, nothing uploaded.'),
    dict(card='outro',
         say="It's free and open source. The download link is in the description."),
]


def run(args):
    import subprocess
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f'{args[0]} failed:\n{r.stderr[-3000:]}')
    return r


def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.strip())


def font(weight, size, display=False):
    return ImageFont.truetype(str(FONTS / f'{"InterDisplay" if display else "Inter"}-{weight}.ttf'), size)


# ---------- the recording ----------
def assemble():
    """frames + audio taps -> raw.mp4 (30 fps) and mix.wav, both starting at the first frame."""
    frames = json.loads((TAKE / 'frames.json').read_text())
    meta = json.loads((TAKE / 'marks.json').read_text())
    t0 = frames[0]['t']
    raw, mix = TAKE / 'raw.mp4', TAKE / 'mix.wav'
    if not raw.exists() or raw.stat().st_mtime < (TAKE / 'frames.json').stat().st_mtime:
        lines = []
        tail = max(0.5, max(meta['marks'].values()) - frames[-1]['t'] + 0.2)
        for i, f in enumerate(frames):
            dt = frames[i + 1]['t'] - f['t'] if i + 1 < len(frames) else tail
            lines.append(f"file '{TAKE / f['file']}'\nduration {max(dt, 0.001):.4f}\n")
        lines.append(f"file '{TAKE / frames[-1]['file']}'\n")
        (TAKE / 'frames.txt').write_text(''.join(lines))
        run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', TAKE / 'frames.txt',
             '-vf', f'fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '12', raw])
        length = duration(raw)
        args, chains = ['ffmpeg', '-y'], []
        for i, a in enumerate(meta['audio']):
            args += ['-i', TAKE / a['file']]
            ms = max(0, round((a['start'] - t0) * 1000))
            chains.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{i}]')
        n = len(meta['audio'])
        graph = ';'.join(chains) + f";{''.join(f'[a{i}]' for i in range(n))}amix=inputs={n}:normalize=0,apad,atrim=0:{length:.3f}[out]"
        run(args + ['-filter_complex', graph, '-map', '[out]', mix])
    return raw, mix, {k: v - t0 for k, v in meta['marks'].items()}


def at(marks, ref):
    if isinstance(ref, tuple):
        return marks[ref[0]] + ref[1]
    return marks[ref] if isinstance(ref, str) else ref


def peak(wav, t0, t1):
    r = run(['ffmpeg', '-ss', f'{t0:.3f}', '-t', f'{t1 - t0:.3f}', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'])
    line = [ln for ln in r.stderr.splitlines() if 'max_volume' in ln]
    return float(line[0].split('max_volume:')[1].split('dB')[0]) if line else -91.0


# ---------- narration ----------
def narrate(text):
    spoken = text
    for k, v in SPEECH.items():
        spoken = spoken.replace(k, v)
    key = hashlib.sha1(f'{VOICE}|{spoken}'.encode()).hexdigest()[:12]
    wav = TTS / f'{key}.wav'
    if not wav.exists():
        from kokoro_onnx import Kokoro
        import soundfile as sf
        TTS.mkdir(parents=True, exist_ok=True)
        k = Kokoro(str(WORK / 'kokoro-v1.0.onnx'), str(WORK / 'voices-v1.0.bin'))
        samples, sr = k.create(spoken, voice=VOICE, speed=1.0, lang='en-us')
        raw = TTS / f'{key}.raw.wav'
        sf.write(str(raw), samples, sr)
        run(['ffmpeg', '-y', '-i', raw, '-af',
             'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
             '-ar', '48000', '-ac', '2', wav])
        raw.unlink()
    return wav


# ---------- drawing ----------
LOGO = Image.open(MKT.parent / 'build' / 'icon.png').convert('RGBA')


def base(size=(W, H)):
    w, h = size
    im = Image.new('RGB', size, BG)
    g = Image.new('RGB', size, BG)
    d = ImageDraw.Draw(g)
    d.ellipse((w * 0.55, -h * 0.5, w * 1.35, h * 0.6), fill=(70, 50, 20))
    d.ellipse((-w * 0.3, h * 0.55, w * 0.35, h * 1.5), fill=(25, 35, 60))
    return Image.blend(im, g.filter(ImageFilter.GaussianBlur(160 * w / W)), 0.9)


def logo(px):
    return LOGO.resize((px, px), Image.LANCZOS)


def header(im, chapter):
    d = ImageDraw.Draw(im)
    x0 = BOX[0]
    im.paste(logo(40), (x0, 22), logo(40))
    d.text((x0 + 52, 42), 'Fretlane', font=font(700, 28), fill=TEXT, anchor='lm')
    if chapter:
        f = font(600, 22)
        tw = d.textlength(chapter, font=f)
        x1 = BOX[0] + BOX[2]
        d.rounded_rectangle((x1 - tw - 40, 22, x1, 62), radius=20, fill=ACCENT)
        d.text((x1 - tw / 2 - 20, 42), chapter, font=f, fill=(27, 27, 27), anchor='mm')


def footage_bg(chapter, label):
    im = base()
    header(im, chapter)
    d = ImageDraw.Draw(im)
    x, y, w, h = BOX
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x - 6, y + 4, x + w + 6, y + h + 14), radius=18, fill=(0, 0, 0, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    im.paste(shadow, (0, 0), shadow)
    d.rounded_rectangle((x - 3, y - 3, x + w + 3, y + h + 3), radius=10, outline=(70, 76, 92), width=3)
    d.text((x + w, y + h + 14), label, font=font(400, 20), fill=(120, 126, 140), anchor='ra')
    return im


def bullets(d, items, reveal, y, gap=118):
    for i, (title, sub) in enumerate(items):
        on = i < reveal
        d.ellipse((204, y + 12, 228, y + 36), fill=ACCENT if on else (60, 64, 74))
        d.text((256, y), title, font=font(700, 42), fill=TEXT if on else (70, 74, 84))
        d.text((256, y + 54), sub, font=font(400, 29), fill=MUTED if on else (60, 64, 74))
        y += gap


def card(kind, reveal=0):
    im = base()
    d = ImageDraw.Draw(im)
    cx = W // 2
    if kind in ('intro', 'outro'):
        im.paste(logo(200), (cx - 100, 230), logo(200))
        d.text((cx, 530), 'Fretlane', font=font(800, 124, True), fill=TEXT, anchor='mm')
        if kind == 'intro':
            d.text((cx, 645), 'The whole band plays along.', font=font(600, 48), fill=ACCENT, anchor='mm')
            d.text((cx, 718), 'A free, open-source guitar tab player', font=font(400, 34), fill=MUTED, anchor='mm')
        else:
            d.text((cx, 645), 'Free and open source', font=font(600, 48), fill=ACCENT, anchor='mm')
            d.text((cx, 718), 'Download: github.com/mauritsE/Fretlane', font=font(500, 36), fill=TEXT, anchor='mm')
            d.text((cx, 776), 'Link in the description', font=font(400, 30), fill=MUTED, anchor='mm')
    elif kind == 'sync':
        header(im, 'YouTube and Spotify sync')
        d.text((200, 190), 'Syncing a tab to a recording', font=font(800, 66, True), fill=TEXT)
        bullets(d, [
            ('1  Pin bar 1', 'Pause on the first beat, then "Pin to video time"'),
            ('2  Pin more bars, or tap along', 'For live recordings that speed up or slow down'),
            ('3  Spotify works the same way', 'Paste a track link instead; it always plays at 100%'),
        ], reveal, 360, gap=150)
        d.text((W - 200, H - 90), 'Steps from the README, not a screen of the app', font=font(400, 22), fill=(110, 116, 130), anchor='rm')
    elif kind == 'download':
        header(im, 'Download')
        d.text((200, 190), 'Get Fretlane', font=font(800, 66, True), fill=TEXT)
        bullets(d, [
            ('Mac, Windows and Linux', 'A normal desktop app: its own window, icon and menu'),
            ('Your songs stay yours', 'Plain files in a Fretlane folder in your home folder'),
        ], reveal, 360, gap=150)
        d.text((200, 720), 'github.com/mauritsE/Fretlane/releases', font=font(600, 40), fill=ACCENT)
    return im


# ---------- the walkthrough ----------
def plan(marks, length):
    """Timing per shot: narration, footage range and how long the shot lasts."""
    shots, t = [], 0.0
    for i, s in enumerate(SHOTS):
        s = dict(s)
        if s.get('sync') and '--no-sync-footage' in sys.argv:
            continue
        prev = shots[-1] if shots else None
        s['chapter'] = s.get('chapter') or prev['chapter']
        s['wav'] = narrate(s['say'])
        s['speech'] = duration(s['wav'])
        scene_start = prev is None or prev['chapter'] != s['chapter'] or ('card' in s) != ('card' in prev)
        s['lead'] = 0.6 if scene_start else 0.2
        need = s['lead'] + s['speech'] + 0.45
        if 'card' in s:
            s['dur'] = max(need + 0.3, 3.0)
        else:
            if s.get('src') == 'demo':
                s['a'], s['b'] = s['t0'], s['t1']
            else:
                s['a'], s['b'] = at(marks, s['t0']), min(at(marks, s['t1']), length - 0.05)
            src = s['b'] - s['a']
            speed = s.get('speed', 1.0)
            s['live'] = 'speed' not in s and s.get('src') != 'demo'  # keeps the app's sound
            if s['live'] and need > src:
                raise SystemExit(f"shot {i}: line needs {need:.1f}s, real-time footage is {src:.1f}s: {s['say']}")
            s['dur'] = max(need, src / speed) if not s['live'] else src
            s['k'] = min(s['dur'], src / speed) / src  # setpts factor; any rest holds the last frame
        s['start'] = t
        t += s['dur']
        shots.append(s)
    return shots, t


def render_shot(i, s, raw, prev_card):
    seg = TMP / f'{i:02d}.mp4'
    png = TMP / f'{i:02d}.png'
    if 'card' in s:
        im = card(s['card'], s.get('reveal', 0))
        im.save(png)
        dur = s['dur']
        if prev_card is not None and prev_card[0] == s['card']:
            # Same card, next bullet: cross-fade from the previous state.
            run(['ffmpeg', '-y', '-loop', '1', '-framerate', FPS, '-t', dur, '-i', prev_card[1], '-loop', '1', '-framerate', FPS,
                 '-t', dur, '-i', png, '-filter_complex', f'[0:v][1:v]xfade=transition=fade:duration=0.35:offset=0,trim=duration={dur:.3f},format=yuv420p',
                 '-c:v', 'libx264', '-crf', '16', '-r', FPS, seg])
        else:
            run(['ffmpeg', '-y', '-loop', '1', '-framerate', FPS, '-t', f'{dur:.3f}', '-i', png,
                 '-vf', 'fade=in:st=0:d=0.35,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-r', FPS, seg])
        return seg, (s['card'], png)
    label = ("Maurits's own screen recording: Fretlane synced to a YouTube video" if s.get('src') == 'demo'
             else 'Real screen recording of the app')
    footage_bg(s['chapter'], label).save(png)
    x, y, w, h = BOX
    src_file, crop = (DEMO, 'crop=1470:864:224:96,') if s.get('src') == 'demo' else (raw, '')
    run(['ffmpeg', '-y', '-loop', '1', '-framerate', FPS, '-t', f"{s['dur']:.3f}", '-i', png,
         '-ss', f"{s['a']:.3f}", '-t', f"{s['b'] - s['a']:.3f}", '-an', '-i', src_file, '-filter_complex',
         f"[1:v]{crop}setpts=(PTS-STARTPTS)*{s['k']:.5f},fps={FPS},scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
         f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x16181d,tpad=stop_mode=clone:stop_duration=20[c];'
         f"[0:v][c]overlay={x}:{y},trim=duration={s['dur']:.3f},format=yuv420p",
         '-c:v', 'libx264', '-crf', '16', '-r', FPS, seg])
    return seg, None


def srt_time(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def walkthrough():
    raw, mix, marks = assemble()
    length = duration(raw)
    shots, total = plan(marks, length)
    TMP.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    for i, s in enumerate(shots):
        if 'card' not in s and s.get('src') != 'demo' and not s['live']:
            p = peak(mix, s['a'], s['b'])
            assert p < -50, f"shot {i}: refusing to speed up or hold audible app sound (peak {p} dB): {s['say']}"

    if '--preview' in sys.argv:
        pv = TAKE / 'preview'
        pv.mkdir(exist_ok=True)
        for i, s in enumerate(shots):
            seg, _ = render_shot(i, s, raw, None) if 'card' not in s else (None, None)
            if seg:
                for k, f in (('a', 0.1), ('b', 0.9)):
                    run(['ffmpeg', '-y', '-ss', f"{s['dur'] * f:.3f}", '-i', seg, '-frames:v', '1', pv / f'{i:02d}{k}.jpg'])
            else:
                card(s['card'], s.get('reveal', 0)).save(pv / f'{i:02d}a.jpg', quality=85)
            print(f"{i:02d} {s['start']:6.1f}s {s['dur']:5.1f}s  {s['say']}")
        print(f'total {total:.1f}s, previews in {pv}')
        return

    segs, prev_card = [], None
    for i, s in enumerate(shots):
        seg, prev_card = render_shot(i, s, raw, prev_card)
        segs.append(seg)
    (TMP / 'concat.txt').write_text(''.join(f"file '{p}'\n" for p in segs))
    video = TMP / 'video.mp4'
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', TMP / 'concat.txt', '-c', 'copy', video])

    # App sound: the take's own audio under the real-time shots, silence elsewhere. The narration
    # ducks it (sidechain) so the voice stays clear while the band keeps playing underneath.
    parts = []
    for n, s in enumerate(shots):
        if s.get('live'):
            parts.append(f"[0:a]atrim={s['a']:.3f}:{s['b']:.3f},asetpts=PTS-STARTPTS,apad,atrim=0:{s['dur']:.3f}[p{n}]")
        else:
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{s['dur']:.3f}[p{n}]")
    graph = parts + [f"{''.join(f'[p{n}]' for n in range(len(shots)))}concat=n={len(shots)}:v=0:a=1,volume=0.9[app]"]
    inputs, voice = ['-i', mix], []
    for n, s in enumerate(shots):
        inputs += ['-i', s['wav']]
        ms = int((s['start'] + s['lead']) * 1000)
        graph.append(f'[{n + 1}:a]adelay={ms}|{ms}[v{n}]')
        voice.append(f'[v{n}]')
    graph += [
        f"{''.join(voice)}amix=inputs={len(voice)}:normalize=0,apad,atrim=0:{total:.3f},asplit=2[voice][key]",
        '[app][key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[ducked]',
        f'[voice][ducked]amix=inputs=2:normalize=0,atrim=0:{total:.3f},loudnorm=I=-14:TP=-1.5:LRA=11[a]',
    ]
    audio = TMP / 'audio.wav'
    run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(graph), '-map', '[a]', '-ar', '48000', audio])

    out = OUT / 'fretlane-walkthrough.mp4'
    run(['ffmpeg', '-y', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-crf', '19',
         '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', FPS, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out])

    srt = []
    for n, s in enumerate(shots):
        a = s['start'] + s['lead'] - 0.1
        b = min(s['start'] + s['dur'] - 0.05, s['start'] + s['lead'] + s['speech'] + 0.4)
        srt.append(f"{n + 1}\n{srt_time(a)} --> {srt_time(b)}\n{s['say']}\n")
    out.with_suffix('.srt').write_text('\n'.join(srt))
    chapters, last = [], None
    for s in shots:
        if s['chapter'] != last:
            m, sec = divmod(int(s['start']), 60)
            chapters.append(f"{m}:{sec:02d} {s['chapter']}")
            last = s['chapter']
    (OUT / 'chapters.txt').write_text('\n'.join(chapters) + '\n')
    (TMP / 'timeline.json').write_text(json.dumps([{k: (str(v) if isinstance(v, Path) else v) for k, v in s.items()} for s in shots], indent=1))
    print(f'{out.name}: {duration(out):.1f}s')
    print('\n'.join(chapters))
    thumbnail(raw, 'walkthrough', at(marks, ('playing', 4.5)), 'The whole\nband plays\nalong', 'Full tour')
    # The trailer's thumbnail also uses this take: the demo's sync footage shows a copyrighted tab.
    thumbnail(raw, 'trailer', at(marks, ('tracks', 5.5)), 'Free guitar\ntab player', 'Slow it down. Loop it.')


# ---------- the trailer: the LinkedIn demo with a YouTube end card ----------
CUT = 91.03  # where marketing/fretlane-demo.mp4's features card has faded out, before its end card


def trailer():
    TMP.mkdir(parents=True, exist_ok=True)
    line = "Fretlane. Free and open source. The link is in the description."
    wav = narrate(line)
    speech = duration(wav)
    dur = 0.5 + speech + 1.2
    png = TMP / 'trailer-end.png'
    card('outro').save(png)
    end = TMP / 'trailer-end.mp4'
    run(['ffmpeg', '-y', '-loop', '1', '-framerate', FPS, '-t', f'{dur:.3f}', '-i', png, '-i', wav, '-filter_complex',
         f'[0:v]fade=in:st=0:d=0.35,format=yuv420p[v];[1:a]adelay=500|500,apad,atrim=0:{dur:.3f},aresample=48000[a]',
         '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-r', FPS, '-c:a', 'pcm_s16le', '-ac', '2', end.with_suffix('.mkv')])
    head = TMP / 'trailer-head.mkv'
    run(['ffmpeg', '-y', '-i', DEMO, '-t', f'{CUT:.3f}', '-c:v', 'libx264', '-crf', '16', '-r', FPS,
         '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', head])
    lst = TMP / 'trailer.txt'
    lst.write_text(f"file '{head}'\nfile '{end.with_suffix('.mkv')}'\n")
    out = OUT / 'fretlane-trailer.mp4'
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c:v', 'libx264', '-crf', '19', '-preset', 'slow',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
    # The burned-in caption of the new line, matching the demo's style.
    subs = TMP / 'trailer.ass'
    a, b = CUT + 0.4, CUT + 0.5 + speech + 0.5
    def t(x):
        return f'{int(x // 3600)}:{int(x // 60 % 60):02d}:{x % 60:05.2f}'
    subs.write_text('\n'.join([
        '[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', '', '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Inter SemiBold,36,&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,14,0,2,200,200,26,1',
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        f'Dialogue: 0,{t(a)},{t(b)},Default,,0,0,0,,{line}', '']))
    final = OUT / 'fretlane-trailer.final.mp4'
    run(['ffmpeg', '-y', '-i', out, '-vf', f'subtitles={subs}:fontsdir={FONTS}', '-c:v', 'libx264', '-crf', '19', '-preset', 'slow',
         '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', final])
    final.replace(out)
    print(f'{out.name}: {duration(out):.1f}s')


# ---------- thumbnails (1280x720, a real frame of the app on the right) ----------
def thumbnail(src, name, when, title, chip):
    tw, th = 1280, 720
    still = TMP / f'thumb-{name}.png'
    run(['ffmpeg', '-y', '-ss', f'{when:.3f}', '-i', src, '-frames:v', '1', still])
    shot = Image.open(still).convert('RGB')
    im = base((tw, th))
    # The app, big and slightly cut off on the right, so the tab is readable at thumbnail size.
    sw = 820
    shot = shot.resize((sw, round(shot.height * sw / shot.width)), Image.LANCZOS)
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=18, fill=255)
    sx, sy = 600, (th - shot.height) // 2 + 30
    sh = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((sx - 8, sy + 6, sx + shot.width + 8, sy + shot.height + 20), radius=22, fill=(0, 0, 0, 200))
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    im.paste(sh, (0, 0), sh)
    im.paste(shot, (sx, sy), mask)
    d = ImageDraw.Draw(im)
    im.paste(logo(76), (56, 52), logo(76))
    d.text((146, 90), 'Fretlane', font=font(800, 54, True), fill=TEXT, anchor='lm')
    y = 180
    for ln in title.split('\n'):
        d.text((54, y), ln, font=font(900, 76, True), fill=TEXT)
        y += 86
    f = font(700, 34)
    w = d.textlength(chip, font=f)
    d.rounded_rectangle((54, y + 30, 54 + w + 44, y + 92), radius=31, fill=ACCENT)
    d.text((76, y + 61), chip, font=f, fill=(27, 27, 27), anchor='lm')
    d.text((56, th - 58), 'Free · Open source · Mac, Windows, Linux', font=font(600, 28), fill=MUTED)
    im.save(OUT / f'thumbnail-{name}.jpg', quality=92)


if __name__ == '__main__':
    which = [a for a in sys.argv[1:] if not a.startswith('--')] or ['walkthrough', 'trailer']
    if 'walkthrough' in which:
        walkthrough()
    if 'trailer' in which and '--preview' not in sys.argv:
        trailer()
