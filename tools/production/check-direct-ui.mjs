import { clickRoomAction, selectRoomCat } from './room-test-actions.mjs';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE ?? '/';
assert(/^\/[A-Za-z0-9_.-]*\/$/.test(base) || base === '/');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    assert(pathname.startsWith(base));
    const path = resolve('dist', decodeURIComponent(pathname.slice(base.length) || 'index.html'));
    assert(path.startsWith(resolve('dist') + '/'));
    assert((await stat(path)).isFile());
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary' })[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors=[],warnings=[],badResponses=[];
const out='artifacts/direct-touch/final-ui';await mkdir(out,{recursive:true});
try {
 for(const mobile of [false,true]) {
  const label=mobile?'mobile':'desktop';
  const page=await browser.newPage(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1100,height:850}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)badResponses.push(r.url());});
  await page.goto(origin+base);await page.waitForSelector('canvas[data-ready="true"]',{timeout:90000});
  await clickRoomAction(page,'並んでおすわり');
  for(const key of ['purin','kokoro']) {
   await selectRoomCat(page,key);const panel=await page.locator('#cat-actions').boundingBox(),canvas=page.locator('canvas'),box=await canvas.boundingBox();
   assert(await page.locator('#cat-actions').isVisible());
   for(const cat of ['purin','kokoro']) { const p=JSON.parse(await canvas.getAttribute(`data-${cat}-screen`));const x=p.x+box.x,y=p.y+box.y;assert(!(x>panel.x&&x<panel.x+panel.width&&y>panel.y&&y<panel.y+panel.height),'Menu must leave both heads visible'); }
   for(const button of await page.locator('#cat-actions button:visible').all()){const b=await button.boundingBox();assert(b.width>=44&&b.height>=44);}
   await page.screenshot({path:`${out}/${label}-${key}-menu.png`,timeout:90000});
   await clickRoomAction(page,'猫に寄る');await page.waitForFunction(()=>Math.abs(JSON.parse(document.querySelector('canvas').dataset.camera)[2]-5.6)<.01);
   assert(!(await page.locator('#cat-actions').isVisible()));
   await clickRoomAction(page,'視点を戻す');
  }
  await page.close();console.log(label+' final menu/focus passed');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(badResponses,[]);
 await writeFile(`${out}/report.json`,JSON.stringify({base,passed:true,errors,warnings,badResponses},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
