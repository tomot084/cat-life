"""Encode the recorded timeline in numeric time order (including t=10.00)."""
import json
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
import imageio_ffmpeg

path=Path('artifacts/tower-contact-review')/(sys.argv[1] if len(sys.argv)>1 else 'retry-final-approved')
report=json.loads((path/'report.json').read_text())
for cat in ['purin','kokoro']:
    for mode in ['up','down']:
        shots=sorted([s for s in report['shots'] if s['cat']==cat and s['mode']==mode],key=lambda s:s['time'])
        if len(shots)<2:
            continue
        fps=1/statistics.median(b['time']-a['time'] for a,b in zip(shots,shots[1:]))
        with tempfile.TemporaryDirectory(prefix='video-frames-',dir=path) as directory:
            frames=Path(directory)
            for index,shot in enumerate(shots):
                (frames/f'{index:04d}.png').symlink_to((path/shot['file']).resolve())
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-loglevel','error',
                '-framerate',str(fps),'-i',str(frames/'%04d.png'),'-frames:v',str(len(shots)),
                '-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',
                str(path/f'{cat}-{mode}.mp4')],check=True)
print(f'{path}: four videos in recorded time order')
