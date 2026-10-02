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
const errors = [], warnings = [], badResponses = [], report = [];
const out = `artifacts/direct-touch/cycle-${process.env.REVIEW_CYCLE ?? 'verification'}`;
await mkdir(out, { recursive: true });
try {
 for (const mobile of (process.env.MOBILE_ONLY ? [true] : [false, true])) {
  const label = mobile ? 'mobile' : 'desktop';
  const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1100, height: 850 } });
  page.on('crash', () => errors.push('Page crashed'));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); if(m.type()==='warning') warnings.push(m.text()); });
  page.on('response', r => { if(r.status()>=400) badResponses.push(r.url()); });
  await page.goto(origin + base); await page.waitForSelector('canvas[data-ready="true"]', {timeout:90000});
  const canvas = page.locator('canvas');
  const data = key => canvas.getAttribute('data-'+key);
  const coord = async key => { const b=await canvas.boundingBox(), p=JSON.parse(await data(key+'-screen')); return { x:b.x+p.x,y:b.y+p.y }; };
  let occlusionAdjustments = 0;
  const select = async key => {
    for(let attempt=0;attempt<4;attempt++) {
      const p=await coord(key);
      if(mobile) await page.touchscreen.tap(p.x,p.y); else await page.mouse.click(p.x,p.y);
      await page.waitForTimeout(100);
      if(await page.locator('#cat-actions').isVisible() && await data('selected-cat')===key) return;
      // A projected bone can be behind the other cat. Expose it by orbiting,
      // as a person would, rather than selecting through the visible animal.
      if(await page.locator('#cat-actions').isVisible()) await page.locator('#close-actions').click();
      const b=await canvas.boundingBox();
      await page.mouse.move(b.x+25,b.y+35); await page.mouse.down();
      await page.mouse.move(b.x+85,b.y+35,{steps:6}); await page.mouse.up();
      await page.waitForTimeout(100); occlusionAdjustments++;
    }
    assert.fail(`Could not touch the visible ${key}`);
  };
  const click = name => page.getByRole('button',{name,exact:true}).click();
  const more = () => page.locator('#more-actions summary').click();
  const settings = () => page.locator('.global-menu summary').click();
  const quality = await canvas.evaluate(c => {
    const blocked = type => !c.dispatchEvent(new Event(type, {bubbles:true,cancelable:true}));
    return {ratio:c.width/c.clientWidth, touchAction:getComputedStyle(c).touchAction,
      userSelect:getComputedStyle(c).userSelect, nativeBlocked:['contextmenu','dragstart','selectstart'].every(blocked)};
  });
  assert.equal(quality.touchAction,'none'); assert.equal(quality.userSelect,'none'); assert(quality.nativeBlocked);
  if(mobile) assert(quality.ratio>=1.95,'DPR 2 canvas resolution');
  assert(!(await page.locator('#cat-actions').isVisible()));
  assert.equal(await page.locator('[data-cat]').count(),0);
  await click('並んでおすわり');
  for(const key of ['purin','kokoro']) { await select(key); await click('なでる'); await page.waitForTimeout(350); await page.screenshot({timeout:90000,path:`${out}/${label}-${key}-pet.png`}); await click('ちゅーる'); assert((await page.locator('#interaction-status').innerText()).includes('にちゅーる')); await page.waitForTimeout(3800); }
  if(mobile) for (const button of await page.locator('#cat-actions button:visible').all()) {
    const rect=await button.boundingBox(); assert(rect.width>=44 && rect.height>=44,'Touch target at least 44px');
  }
  await page.locator('#close-actions').click();
  const p=await coord('purin'); const camera=await data('camera');
  const session= mobile ? await page.context().newCDPSession(page):null;
  const touch=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id}))});
  if(mobile) { await touch('touchStart',[[p.x,p.y,1]]); await touch('touchMove',[[p.x+12,p.y+8,1]]); }
  else { await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+12,p.y+8); }
  await page.waitForTimeout(500); assert.equal(await data('gesture'),'cat-carry'); assert.equal(await data('camera'),camera,'Drift on cat must never orbit');
  if(mobile) await touch('touchMove',[[p.x+65,p.y+45,1]]); else await page.mouse.move(p.x+65,p.y+45,{steps:8});
  if(!mobile) await page.mouse.wheel(0,-180);
  await page.screenshot({timeout:90000,path:`${out}/${label}-carry.png`}); assert.equal(await data('camera'),camera,'Carry locks camera');
  if(mobile) await touch('touchEnd',[]); else await page.mouse.up();
  await page.waitForTimeout(1000); assert.equal(await data('gesture'),'idle');
  await page.screenshot({timeout:90000,path:`${out}/${label}-land.png`});
  if (await page.locator('#cat-actions').isVisible()) await page.locator('#close-actions').click();
  const b=await canvas.boundingBox();
  if(mobile) { await touch('touchStart',[[b.x+30,b.y+60,2]]); await touch('touchMove',[[b.x+95,b.y+100,2]]); await touch('touchEnd',[]); }
  else { await page.mouse.move(b.x+30,b.y+60); await page.mouse.down(); await page.mouse.move(b.x+95,b.y+100,{steps:6}); await page.mouse.up(); }
  assert.notEqual(await data('camera'),camera,'Empty area orbits');
  if(mobile) {
   const before=await data('camera'); await touch('touchStart',[[b.x+80,b.y+80,3],[b.x+230,b.y+80,4]]); await touch('touchMove',[[b.x+50,b.y+80,3],[b.x+260,b.y+80,4]]); await touch('touchEnd',[]); await page.waitForTimeout(100); assert.notEqual(await data('camera'),before,'Pinch zoom');
  } else { const before=await data('camera'); await page.mouse.wheel(0,-200); await page.waitForTimeout(150); assert.notEqual(await data('camera'),before); }
  await settings(); await click('配置を戻す'); await settings();
  await click('並んでおすわり');
  // Cancelled capture must land safely and release gesture ownership.
  const cancelPoint = await coord('purin');
  if (mobile) await touch('touchStart', [[cancelPoint.x,cancelPoint.y,9]]);
  else { await page.mouse.move(cancelPoint.x,cancelPoint.y); await page.mouse.down(); }
  await page.waitForTimeout(500); assert.equal(await data('gesture'),'cat-carry');
  if (mobile) await touch('touchCancel',[]);
  else { await canvas.evaluate(c => c.releasePointerCapture(1)); await page.mouse.up(); }
  await page.waitForTimeout(900); assert.equal(await data('gesture'),'idle');
  if (mobile) {
    const q=await coord('purin');
    await touch('touchStart',[[q.x,q.y,10]]);
    await page.waitForTimeout(100);
    await touch('touchStart',[[q.x,q.y,10],[q.x+90,q.y,11]]);
    await page.waitForTimeout(500); assert.equal(await data('gesture'),'pinch-zoom');
    await touch('touchEnd',[]); assert.equal(await data('gesture'),'idle');
  }
  await select('purin'); await more(); await click('タワーにのぼる');
  await page.waitForFunction(()=>document.querySelector('#daily-life').textContent.includes('ぷりん：タワーをのぼる'),null,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#daily-life').textContent.includes('ぷりん：タワーの上'),null,{timeout:60000});
  assert(Math.abs(JSON.parse(await data('purin-position'))[1]-2.6505)<.05);
  await click('一時停止'); await page.screenshot({timeout:90000,path:`${out}/${label}-tower-seated.png`}); await click('再生');
  await select('purin'); await click('なでる'); await page.waitForTimeout(350); await click('ふたりでおさんぽ'); await page.waitForTimeout(4000);
  await select('purin'); await more(); await click('ボールで遊ぶ');
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.purinToyPhase!==undefined,null,{timeout:60000});
  await page.waitForTimeout(1800); await page.screenshot({timeout:90000,path:`${out}/${label}-ball.png`});
  await select('purin'); await more(); await click('ねずみで遊ぶ');
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.purinActivity==='mouse' && document.querySelector('#daily-life').textContent.includes('ぷりん：ねずみ遊び'),null,{timeout:60000});
  await page.waitForTimeout(1200); await page.screenshot({timeout:90000,path:`${out}/${label}-mouse.png`});
  await select('purin'); await more(); await click('呼ぶ');
  await page.waitForFunction(()=>document.querySelector('#interaction-status').textContent.includes('がそばに来ました'),null,{timeout:60000});
  await click('一時停止'); const frozen=await data('purin-position'); await page.waitForTimeout(400); assert.equal(await data('purin-position'),frozen); await click('再生');
  await settings(); await click('UIを隠す'); assert(await page.locator('#show-ui').isVisible()); await click('操作を表示'); await settings();
  await settings(); await click('配置を戻す'); await settings();
  await click('並んでおすわり');
  const source=await coord('purin'), target=await coord('tower');
  if(mobile) await touch('touchStart',[[source.x,source.y,12]]);
  else { await page.mouse.move(source.x,source.y); await page.mouse.down(); }
  await page.waitForTimeout(500);
  if(mobile) await touch('touchMove',[[target.x,target.y,12]]);
  else await page.mouse.move(target.x,target.y,{steps:10});
  if(mobile) await touch('touchEnd',[]); else await page.mouse.up();
  assert((await page.locator('#interaction-status').innerText()).includes('タワーの上にのせました'),'Manual tower placement');
  await page.waitForTimeout(1000); await click('一時停止');
  await page.screenshot({timeout:90000,path:`${out}/${label}-final.png`,fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.push({label,passed:true,quality,occlusionAdjustments}); await page.close(); console.log(label+' review completed');
 }
 await writeFile(`${out}/report.json`,JSON.stringify({base,report,errors,warnings,badResponses},null,2));
 assert.deepEqual(errors,[]); assert.deepEqual(warnings,[]); assert.deepEqual(badResponses,[]);
 await writeFile(`${out}/report.json`,JSON.stringify({base,report,errors,warnings,badResponses},null,2));
} catch(error) { await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),errors,warnings,badResponses},null,2)); throw error; } finally { await browser.close(); await new Promise(r=>server.close(r)); }
