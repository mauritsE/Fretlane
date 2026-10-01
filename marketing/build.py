"""
Builds the Fretlane marketing video (1920x1080, ~75 s) from a real screen recording of the app.

  1. npx tsx marketing/record.ts <url>            -> marketing/work/frames + marks.json
  2. npx tsx marketing/export-audio.ts <url> "In the Hall of the Mountain King" marketing/work/king.wav
  3. python3 marketing/build.py                   -> marketing/out/fretlane-demo.mp4

Needs ffmpeg, Pillow, kokoro-onnx + soundfile (local text-to-speech; kokoro-v1.0.onnx and
voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 in marketing/work),
and Inter as TTF in marketing/work/fonts. Every product screen is real footage; the only drawn
frames are the title, feature and end cards.
"""
import hashlib
import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
WORK = ROOT / 'work'
OUT = ROOT / 'out'
FONTS = WORK / 'fonts'
SEG = WORK / 'segments'
TTS = WORK / 'tts'
W, H, FPS = 1920, 1080, 30
BOX = (192, 96, 1536, 864)  # footage frame: x, y, w, h
BG = (18, 20, 25)
ACCENT = (245, 176, 65)
TEXT = (232, 234, 239)
MUTED = (154, 161, 177)
VOICE = 'am_michael'



def assemble_recording():
    """frames/*.jpg + frames.json (from record.ts) -> raw.mp4 at 30 fps; marks relative to its start."""
    frames = json.loads((WORK / 'frames.json').read_text())
    lines = []
    for i, f in enumerate(frames):
        d = frames[i + 1]['t'] - f['t'] if i + 1 < len(frames) else 0.5
        lines.append(f"file '{WORK / f['file']}'\nduration {max(d, 0.001):.4f}\n")
    lines.append(f"file '{WORK / frames[-1]['file']}'\n")
    (WORK / 'frames.txt').write_text(''.join(lines))
    raw = WORK / 'raw.mp4'
    if not raw.exists() or raw.stat().st_mtime < (WORK / 'frames.json').stat().st_mtime:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(WORK / 'frames.txt'),
                        '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14', str(raw)], check=True)
    t0 = frames[0]['t']
    return {k: round(v - t0, 3) for k, v in json.loads((WORK / 'marks.json').read_text()).items()}


marks = assemble_recording()

# One shot = one narration line = one caption. Footage shots cut the recording between two
# markers; `speed` is the most the footage may be sped up, `realtime` keeps it at 1x so the app's
# own audio stays in sync. `crop` (x, y, w, h in the 1920x1080 recording, 16:9) zooms in so the
# UI is readable on a phone.
YT_REC = WORK / 'youtube-sync.mov'

SHOTS = [
    dict(card='intro', say='Meet Fretlane: a free, open-source guitar tab player.'),
    dict(chapter='Songbook', t0=marks['library'], t1=marks['open'], speed=1.35, crop=(240, 0, 1440, 810),
         say='Twenty-two well-known songs come built in, from Greensleeves to Beethoven, each tagged by level.'),
    dict(chapter='Play along', t0=marks['open'], t1=marks['tracks'], realtime=True,
         say='Open one and the whole band plays, with a cursor that follows every note.'),
    dict(chapter='Play along', t0=marks['tracks'], t1=marks['speed'], realtime=True,
         say='Switch to the bass line or the drum part at any time.'),
    dict(chapter='Practice', t0=marks['speed'], t1=marks['metronome'], speed=1.25,
         say='Too fast? Drop it to half speed until your fingers catch up.'),
    dict(chapter='Metronome', t0=marks['metronome'], t1=marks['tap'], speed=1.25, crop=(1100, 40, 820, 461),
         say="The metronome picks up the song's tempo, at your practice speed."),
    dict(chapter='Metronome', t0=marks['tap'], t1=marks['favorite'], speed=1.35, crop=(1100, 40, 820, 461),
         say='Or tap in a tempo of your own.'),
    dict(chapter='Favorites', t0=marks['favorite'], t1=marks['archive'], speed=1.45,
         say='Star your favorite songs and they jump to the top of your library.'),
    dict(chapter='Archive', t0=marks['archive'], t1=marks['import'], speed=1.3, crop=(240, 0, 1440, 810),
         say='Learned one? Mark it as done, and it moves to your archive.'),
    dict(chapter='Your own tabs', t0=marks['import'], t1=marks['end'], speed=1.3, crop=(400, 60, 1120, 630),
         say='And bring your own tabs: Guitar Pro files, links, or plain text.'),
    # Recorded by Maurits on his own Mac (work/youtube-sync.mov, not in git): a tab he imported,
    # synced to the song's YouTube video. Cropped to the app window, so no browser chrome.
    dict(chapter='YouTube sync', src=YT_REC, t0=0.3, t1=10.3, realtime=True, crop=(50, 112, 1820, 1066),
         say='Link a YouTube video, and the tab follows the recording, bar by bar.'),
    dict(chapter='YouTube sync', src=YT_REC, t0=15.5, t1=28.0, speed=1.4, crop=(50, 112, 1820, 1066),
         say='Switch between lead, rhythm and bass while the video keeps playing.'),
    dict(card='features',
         say='It runs on Mac, Windows and Linux, and keeps everything on your own computer.'),
    dict(card='outro', say='Fretlane. Free and open source. The link is in the post.'),
]
# How the voice should pronounce things (captions keep the written form).
SPEECH = {'Fretlane': 'Fret-lane', 'open-source': 'open source'}


def font(weight, size):
    return ImageFont.truetype(str(FONTS / f'Inter-{weight}.ttf'), size)


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(path):
    out = subprocess.run(['ffmpeg', '-i', str(path)], capture_output=True, text=True).stderr
    h, m, s = out.split('Duration: ')[1].split(',')[0].split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


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
        k = Kokoro(str(WORK / 'kokoro-v1.0.onnx'), str(WORK / 'voices-v1.0.bin'))
        samples, sr = k.create(spoken, voice=VOICE, speed=1.0, lang='en-us')
        raw = TTS / f'{key}.raw.wav'
        sf.write(str(raw), samples, sr)
        run(['ffmpeg', '-y', '-i', str(raw), '-af',
             'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
             '-ar', '44100', '-ac', '2', str(wav)])
        raw.unlink()
    return wav


# ---------- drawing ----------
LOGO = Image.open(ROOT.parent / 'build' / 'icon.png').convert('RGBA')


def base(glow=True):
    im = Image.new('RGB', (W, H), BG)
    if glow:
        g = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(g)
        d.ellipse((W * 0.55, -H * 0.5, W * 1.35, H * 0.6), fill=(70, 50, 20))
        d.ellipse((-W * 0.3, H * 0.55, W * 0.35, H * 1.5), fill=(25, 35, 60))
        im = Image.blend(im, g.filter(ImageFilter.GaussianBlur(160)), 0.9)
    return im


def header(im, chapter=None):
    d = ImageDraw.Draw(im)
    im.paste(LOGO.resize((44, 44), Image.LANCZOS), (192, 30), LOGO.resize((44, 44), Image.LANCZOS))
    d.text((248, 52), 'Fretlane', font=font(700, 30), fill=TEXT, anchor='lm')
    if chapter:
        f = font(600, 24)
        tw = d.textlength(chapter, font=f)
        x1 = 192 + 1536
        d.rounded_rectangle((x1 - tw - 44, 30, x1, 74), radius=22, fill=ACCENT)
        d.text((x1 - tw / 2 - 22, 52), chapter, font=f, fill=(27, 27, 27), anchor='mm')


def footage_bg(chapter):
    im = base()
    header(im, chapter)
    d = ImageDraw.Draw(im)
    x, y, w, h = BOX
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x - 6, y + 4, x + w + 6, y + h + 14), radius=18, fill=(0, 0, 0, 170))
    im.paste(shadow.filter(ImageFilter.GaussianBlur(14)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
    d.rounded_rectangle((x - 3, y - 3, x + w + 3, y + h + 3), radius=12, outline=(70, 76, 92), width=3)
    d.text((x + w, y + h + 12), 'Real screen recording of the app', font=font(400, 18), fill=(110, 116, 130), anchor='ra')
    return im


def card(kind):
    im = base()
    d = ImageDraw.Draw(im)
    cx = W // 2
    if kind in ('intro', 'outro'):
        logo = LOGO.resize((200, 200), Image.LANCZOS)
        im.paste(logo, (cx - 100, 250), logo)
        d.text((cx, 540), 'Fretlane', font=font(800, 120), fill=TEXT, anchor='mm')
        if kind == 'intro':
            d.text((cx, 650), 'Learn songs, not software.', font=font(600, 46), fill=ACCENT, anchor='mm')
            d.text((cx, 720), 'A free guitar tab player', font=font(400, 32), fill=MUTED, anchor='mm')
        else:
            d.text((cx, 650), 'Free and open source', font=font(600, 46), fill=ACCENT, anchor='mm')
            d.text((cx, 720), 'github.com/mauritsE/Fretlane', font=font(400, 36), fill=TEXT, anchor='mm')
    else:
        header(im, 'And also')
        d.text((200, 230), 'Everything you need to practise', font=font(800, 64), fill=TEXT)
        items = [
            ('Loops and count-in', 'Drag across the tab to loop the tricky part'),
            ('Mac, Windows and Linux', 'A normal desktop app, no account needed'),
            ('Private', 'Your library stays on your own computer'),
            ('Open source', 'MIT licence, built on alphaTab'),
        ]
        y = 390
        for title, sub in items:
            d.ellipse((204, y + 10, 226, y + 32), fill=ACCENT)
            d.text((256, y), title, font=font(700, 40), fill=TEXT)
            d.text((256, y + 52), sub, font=font(400, 28), fill=MUTED)
            y += 130
    return im


# ---------- segments ----------
def build():
    for p in (SEG, TTS, OUT):
        p.mkdir(parents=True, exist_ok=True)
    raw = WORK / 'raw.mp4'
    timeline = []
    t = 0.0
    for i, shot in enumerate(SHOTS):
        wav = narrate(shot['say'])
        speech = duration(wav)
        lead, tail = (0.5, 0.6) if 'card' in shot else (0.25, 0.35)
        need = lead + speech + tail
        seg = SEG / f'{i:02d}.mp4'
        if 'card' in shot:
            dur = max(need, 3.2)
            png = SEG / f'{i:02d}.png'
            card(shot['card']).save(png)
            run(['ffmpeg', '-y', '-loop', '1', '-framerate', str(FPS), '-t', f'{dur:.3f}', '-i', str(png),
                 '-vf', f'fade=in:st=0:d=0.35,fade=out:st={dur - 0.35:.3f}:d=0.35,format=yuv420p',
                 '-c:v', 'libx264', '-crf', '16', '-r', str(FPS), str(seg)])
        else:
            src = shot['t1'] - shot['t0']
            if shot.get('realtime'):
                if need > src:
                    raise SystemExit(f'shot {i}: narration ({need:.1f}s) longer than real-time footage ({src:.1f}s)')
                dur = src
            else:
                dur = max(need, src / shot['speed'])
            k = dur / src
            png = SEG / f'{i:02d}.png'
            footage_bg(shot['chapter']).save(png)
            x, y, w, h = BOX
            run(['ffmpeg', '-y', '-loop', '1', '-framerate', str(FPS), '-t', f'{dur:.3f}', '-i', str(png),
                 '-ss', f"{shot['t0']:.3f}", '-t', f'{src:.3f}', '-i', str(shot.get('src', raw)), '-filter_complex',
                 f"[1:v]{'crop=%d:%d:%d:%d,' % (shot['crop'][2], shot['crop'][3], shot['crop'][0], shot['crop'][1]) if 'crop' in shot else ''}"
                 f'setpts=(PTS-STARTPTS)*{k:.5f},fps={FPS},scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,'
                 f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x16181d,'
                 f'tpad=stop_mode=clone:stop_duration=10[c];[0:v][c]overlay={x}:{y},trim=duration={dur:.3f},format=yuv420p',
                 '-an', '-c:v', 'libx264', '-crf', '16', '-r', str(FPS), str(seg)])
        timeline.append(dict(shot=i, start=t, dur=dur, lead=lead, speech=speech, wav=str(wav), text=shot['say']))
        t += dur
    return timeline, t


def ass_time(s):
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f'{int(h)}:{int(m):02d}:{sec:05.2f}'


def subtitles(timeline):
    lines = [
        '[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Inter SemiBold,36,&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,14,0,2,200,200,26,1',
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]
    for e in timeline:
        a = e['start'] + e['lead'] - 0.1
        b = min(e['start'] + e['dur'] - 0.05, e['start'] + e['lead'] + e['speech'] + 0.5)
        lines.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{e['text']}")
    (WORK / 'subs.ass').write_text('\n'.join(lines) + '\n')


def main():
    timeline, total = build()
    (WORK / 'concat.txt').write_text(''.join(f"file '{SEG / ('%02d.mp4' % e['shot'])}'\n" for e in timeline))
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(WORK / 'concat.txt'), '-c', 'copy', str(WORK / 'video.mp4')])
    subtitles(timeline)

    # Audio: narration lines, plus the app's own synth under the real-time playback shots.
    inputs, filters, mix = [], [], []
    for n, e in enumerate(timeline):
        inputs += ['-i', e['wav']]
        ms = int((e['start'] + e['lead']) * 1000)
        filters.append(f'[{n}:a]adelay={ms}|{ms}[v{n}]')
        mix.append(f'[v{n}]')
    play = next(e for e, s in zip(timeline, SHOTS) if s.get('realtime'))
    last_rt = [e for e, s in zip(timeline, SHOTS) if s.get('realtime')][-1]
    music_start = play['start'] + (marks['playing'] - SHOTS[play['shot']]['t0'])
    music_len = last_rt['start'] + last_rt['dur'] - music_start
    m = len(timeline)
    inputs += ['-i', str(WORK / 'king.wav')]
    ms = int(music_start * 1000)
    filters.append(f'[{m}:a]atrim=0:{music_len:.3f},afade=t=out:st={music_len - 0.6:.3f}:d=0.6,volume=0.28,adelay={ms}|{ms}[mus]')
    mix.append('[mus]')
    filters.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[a]")
    run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[a]', '-ar', '44100', str(WORK / 'audio.wav')])

    out = OUT / 'fretlane-demo.mp4'
    run(['ffmpeg', '-y', '-i', str(WORK / 'video.mp4'), '-i', str(WORK / 'audio.wav'),
         '-vf', f"subtitles={WORK / 'subs.ass'}:fontsdir={FONTS}", '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', str(out)])
    (WORK / 'timeline.json').write_text(json.dumps(timeline, indent=1))
    print(f'{out} {total:.1f}s')
    for e in timeline:
        print(f"{e['start']:6.2f}s  {e['dur']:5.2f}s  {e['text']}")


if __name__ == '__main__':
    os.chdir(ROOT)
    main()
