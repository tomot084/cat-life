"""Build local contact sheets and a frame player from captured browser frames."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

root = Path('artifacts/tower-contact-review')
reports = {}
for cycle in ['baseline', 'cycle-1', 'cycle-2', 'final']:
    path = root / cycle
    reports[cycle] = json.loads((path / 'report.json').read_text())['shots']
    for cat in ['purin', 'kokoro']:
        for mode in ['up', 'down']:
            shots = [s for s in reports[cycle] if s['cat'] == cat and s['mode'] == mode]
            sheet = Image.new('RGB', (1440, ((len(shots) + 3) // 4) * 320), 'white')
            draw = ImageDraw.Draw(sheet)
            for n, shot in enumerate(shots):
                im = Image.open(path / shot['file']); im.thumbnail((360, 290))
                x, y = n % 4 * 360, n // 4 * 320
                sheet.paste(im, (x, y))
                debug = shot.get('traversal', {})
                draw.text((x + 4, y + 295), f"{shot['time']:.2f}s {debug.get('kind', '')} / {debug.get('phase', '')}", fill='black')
            sheet.save(path / f'{cat}-{mode}-sheet.jpg')

html = '''<!doctype html><meta charset="utf-8"><title>タワーの接地動作比較</title>
<style>body{max-width:1050px;margin:24px auto;font-family:sans-serif;background:#eee8de}img{max-width:100%;width:900px}button,select,input{font:inherit;margin:8px;padding:8px}input{width:70%}</style>
<h1>タワーの上り・下り：連続フレーム</h1><p>実タワーGLB、実猫GLBと本番動作制御をブラウザで再生。写真・公開動画の画像は含みません。</p>
<select id="cycle"><option>baseline</option><option>cycle-1</option><option>cycle-2</option><option selected>final</option></select>
<select id="cat"><option value="purin">ぷりん</option><option value="kokoro">こころ</option></select>
<select id="mode"><option value="up">上り</option><option value="down">下り</option></select>
<button id="play">再生 / 停止</button><div><input id="frame" type="range" min="0" value="0"></div><p id="status"></p><img id="image"><p><a id="sheet">一覧画像</a></p>
<script>const data=REPORTS;const $=id=>document.getElementById(id);let running=false,timer;
function shots(){return data[$('cycle').value].filter(s=>s.cat===$('cat').value&&s.mode===$('mode').value)}
function show(){const ss=shots(),i=Math.min(+$('frame').value,ss.length-1),s=ss[i];$('frame').max=ss.length-1;const d=s.traversal||{};$('image').src=$('cycle').value+'/'+s.file;$('status').textContent=`${i+1}/${ss.length}  ${s.time.toFixed(2)}s  ${d.kind||''}  ${d.phase||''}`;$('sheet').href=`${$('cycle').value}/${s.cat}-${s.mode}-sheet.jpg`;}
function step(){if(!running)return;const ss=shots(),i=+$('frame').value;const dt=i<ss.length-1?Math.max(.1,ss[i+1].time-ss[i].time):1;timer=setTimeout(()=>{$('frame').value=(i+1)%ss.length;show();step()},dt*1000)}
$('play').onclick=()=>{running=!running;clearTimeout(timer);step()};$('frame').oninput=show;for(const id of ['cycle','cat','mode'])$(id).onchange=()=>{$('frame').value=0;show()};show();</script>'''
(root / 'comparison.html').write_text(html.replace('REPORTS', json.dumps(reports)), encoding='utf-8')
