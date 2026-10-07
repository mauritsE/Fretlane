"""Cuts the take from record.ts into the Mac App Store preview.
    python3 appstore/preview/build.py            -> appstore/preview/fretlane-preview.mp4
    python3 appstore/preview/build.py --sheet    -> contact sheet of the raw take, for picking cuts

Apple's spec (App Store Connect, app preview specifications, macOS): 1920x1080, 15-30 s, at most
30 fps, H.264 at 10-12 Mbps, stereo 256 kbps AAC at 44.1/48 kHz. The sound is the app's own
(captured from the page), the footage is the real app, and the captions are plain text, since
previews start muted in the store.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TAKE = ROOT.parent.parent / 'marketing' / 'work' / 'preview'
OUT = ROOT / 'fretlane-preview.mp4'
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
W, H, FPS = 1920, 1080, 30
FADE = 0.35  # crossfade between shots

# (from mark, offset, length, caption). Times are seconds of the raw take relative to a mark.
SHOTS = [
    ('library', 0.0, 2.4, 'Your tabs in one library'),
    ('play', 0.0, 6.0, 'Play along with the whole band'),
    ('tracks', 0.0, 3.8, 'Switch to any instrument'),
    ('loop', 2.0, 4.0, 'Loop the hard part'),
    ('loop-play', 0.0, 5.0, 'and slow it down'),
    ('paste', 0.0, 3.6, 'Paste any plain-text tab'),
    ('riff-playing', 0.0, 4.6, 'and hear it play'),
]


def run(args):
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f'{args[0]} failed:\n{r.stderr[-3000:]}')
    return r


def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.strip())


def assemble():
    """frames + audio taps -> raw.mp4 (30 fps) and mix.wav, both starting at the first frame
    (the same method as marketing/youtube/build.py)."""
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


def sheet(raw):
    run(['ffmpeg', '-y', '-i', raw, '-vf', 'fps=2,scale=384:-1,drawtext=fontfile=' + FONT +
         ":text='%{pts\\:hms}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x10",
         '-frames:v', '1', TAKE / 'sheet-%d.png'])
    print('wrote', TAKE / 'sheet-1.png')


def esc(text):
    return text.replace('\\', '\\\\').replace(':', '\\:').replace("'", '’')


def build(raw, mix, marks):
    total = sum(s[2] for s in SHOTS) - FADE * (len(SHOTS) - 1)
    if not 15 <= total <= 30:
        raise SystemExit(f'preview would be {total:.2f} s; Apple needs 15-30 s')
    args, chains = ['ffmpeg', '-y'], []
    for i, (ref, off, length, caption) in enumerate(SHOTS):
        start = marks[ref] + off
        args += ['-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', raw,
                 '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', mix]
        # caption: a dark pill at the bottom centre, fading in after the crossfade
        text = (f"drawtext=fontfile={FONT}:text='{esc(caption)}':fontsize=46:fontcolor=white:"
                f"x=(w-text_w)/2:y=h-150:box=1:boxcolor=0x12141a@0.82:boxborderw=26:"
                f"alpha='min(1,max(0,(t-{FADE:.2f})/0.3))'")
        chains.append(f'[{2 * i}:v]setpts=PTS-STARTPTS,fps={FPS},{text},format=yuv420p[v{i}]')
        chains.append(f'[{2 * i + 1}:a]asetpts=PTS-STARTPTS,aresample=48000[a{i}]')
    v, a, at = '[v0]', '[a0]', SHOTS[0][2]
    for i in range(1, len(SHOTS)):
        at -= FADE
        chains.append(f'{v}[v{i}]xfade=transition=fade:duration={FADE}:offset={at:.3f}[x{i}]')
        chains.append(f'{a}[a{i}]acrossfade=d={FADE}[y{i}]')
        v, a = f'[x{i}]', f'[y{i}]'
        at += SHOTS[i][2]
    chains.append(f'{v}fade=t=in:d=0.4,fade=t=out:st={total - 0.6:.3f}:d=0.6[vout]')
    chains.append(f'{a}afade=t=in:d=0.2,afade=t=out:st={total - 0.8:.3f}:d=0.8,'
                  'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]')
    run(args + ['-filter_complex', ';'.join(chains), '-map', '[vout]', '-map', '[aout]',
                '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
                '-b:v', '11M', '-minrate', '11M', '-maxrate', '11M', '-bufsize', '11M', '-x264-params', 'nal-hrd=cbr', '-r', str(FPS),
                '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
                '-movflags', '+faststart', OUT])
    print(f'wrote {OUT} ({duration(OUT):.2f} s)')


if __name__ == '__main__':
    raw, mix, marks = assemble()
    if '--sheet' in sys.argv:
        sheet(raw)
    else:
        build(raw, mix, marks)
