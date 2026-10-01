import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE ?? '/';
assert(/^\/[A-Za-z0-9_.-]*\/$/.test(base) || base === '/');
const out = 'artifacts/interaction-controls'; await mkdir(out, { recursive: true });
const label = base === '/' ? 'root' : 'subpath';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); assert(url.pathname.startsWith(base));
    const path = resolve('dist', decodeURIComponent(url.pathname.slice(base.length) || 'index.html'));
    assert(path.startsWith(resolve('dist') + '/')); assert((await stat(path)).isFile());
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary' })[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], badResponses = [], requests = [];
function monitor(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
  page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText));
  return page.route('**/*', route => {
    requests.push(route.request().url());
    if (!route.request().url().startsWith(origin + base)) { errors.push('Unexpected request ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
}
const status = page => page.locator('#interaction-status').innerText();
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const more = page => page.locator('#more-actions summary').click();
const frame = canvas => canvas.evaluate(element => element.toDataURL('image/png'));
try {
  if (!process.env.MOBILE_ONLY) {
  const desktop = await browser.newPage({ viewport: { width: 960, height: 760 } });
  await monitor(desktop); await desktop.goto(origin + base); await desktop.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
  const canvas = desktop.locator('canvas');
  const box = await canvas.boundingBox();
  const catX = box.x + 430, catY = box.y + 250; // Kokoro, within the rendered body at this viewport.
  await desktop.mouse.click(catX, catY);
  assert((await status(desktop)).includes('こころを選びました'), 'Desktop tap should select Kokoro');
  await desktop.mouse.move(catX, catY); await desktop.mouse.down();
  await desktop.waitForTimeout(500);
  assert((await status(desktop)).includes('こころをつかみました'), 'Desktop long press must grab the cat');
  await desktop.mouse.move(catX - 65, catY + 48, { steps: 10 });
  await desktop.mouse.up();
  assert((await status(desktop)).includes('こころをここに置きました'), 'Desktop release must place the cat');
  await desktop.screenshot({ path: `${out}/${label}-desktop-placed.png`, timeout: 90000 });
  const beforeOrbit = await frame(canvas);
  await desktop.mouse.move(box.x + 870, box.y + 150); await desktop.mouse.down();
  await desktop.mouse.move(box.x + 740, box.y + 210, { steps: 10 }); await desktop.mouse.up();
  assert.notEqual(beforeOrbit, await frame(canvas), 'Empty-floor drag must orbit the camera');
  await click(desktop, '視点を戻す');
  await click(desktop, 'なでる');
  await desktop.waitForTimeout(650);
  await more(desktop); await click(desktop, '呼ぶ');
  assert((await status(desktop)).includes('こころ、おいで'), 'Call action should start');
  await desktop.waitForFunction(() => document.querySelector('#interaction-status').textContent.includes('がそばに来ました'), null, { timeout: 30000 });
  await more(desktop); await click(desktop, 'ボールで遊ぶ');
  assert((await status(desktop)).includes('ボールで遊ぼう'));
  await desktop.waitForTimeout(650);
  await more(desktop); await click(desktop, '猫に寄る');
  assert((await status(desktop)).includes('の近くへ'));
  await more(desktop); await click(desktop, 'UIを隠す');
  assert(await desktop.getByRole('button', { name: '操作を表示' }).isVisible());
  assert(!(await desktop.getByRole('button', { name: 'のんびり過ごす' }).isVisible()));
  await click(desktop, '操作を表示');
  assert(await desktop.getByRole('button', { name: 'のんびり過ごす' }).isVisible());
  await more(desktop); await click(desktop, '配置を戻す');
  assert((await status(desktop)).includes('元の場所へ'));
  const modeFrames = [];
  for (const name of ['のんびり過ごす', 'ふたりでおさんぽ', '並んでおすわり']) {
    await click(desktop, name);
    assert.equal(await desktop.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
    await desktop.waitForTimeout(250);
    modeFrames.push(await frame(canvas));
  }
  assert(modeFrames[0] !== modeFrames[1] && modeFrames[1] !== modeFrames[2], 'All three modes must render differently');
  await click(desktop, 'ぷーたん'); await click(desktop, 'ちゅーる');
  assert((await status(desktop)).includes('ぷーたんにちゅーる'));
  await click(desktop, 'なでる'); assert((await status(desktop)).includes('ぷーたんをなでなで'));
  await click(desktop, 'こころ'); await click(desktop, 'ちゅーる');
  assert((await status(desktop)).includes('こころにちゅーる'));
  await desktop.waitForFunction(() => document.querySelector('#interaction-status').textContent === 'ふたりの時間に、もどりました。', null, { timeout: 60000 });
  await click(desktop, '一時停止'); await desktop.waitForTimeout(350);
  const pausedFrame = await frame(canvas); await desktop.waitForTimeout(350);
  assert.equal(pausedFrame, await frame(canvas), 'Pause must freeze the room');
  await desktop.mouse.move(box.x + 700, box.y + 350);
  await desktop.mouse.wheel(0, -350);
  assert.notEqual(pausedFrame, await frame(canvas), 'Wheel must zoom while paused');
  await click(desktop, '視点を戻す'); await click(desktop, '再生');
  await desktop.locator('footer summary').click();
  const credits = await desktop.locator('footer').innerText();
  for (const name of ['DreamNoms', 'Kenney', '3D Assets', 'CC BY 4.0', 'CC0 1.0']) assert(credits.includes(name));
  console.log('desktop actions passed');
  await desktop.close();
  }

  const mobileDpr = Number(process.env.TEST_DPR ?? 1);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: mobileDpr, isMobile: true, hasTouch: true });
  await monitor(mobile); await mobile.goto(origin + base); await mobile.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile must not overflow horizontally');
  for (const name of ['のんびり過ごす', 'ふたりでおさんぽ', '並んでおすわり', 'ちゅーる', 'なでる']) assert(await mobile.getByRole('button', { name, exact: true }).isVisible());
  const mobileCanvas = mobile.locator('canvas');
  const quality = await mobileCanvas.evaluate(canvas => {
    const style = getComputedStyle(canvas);
    const blocked = type => !canvas.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    return { pixelsPerCssPixel: canvas.width / canvas.getBoundingClientRect().width,
      userSelect: style.userSelect, touchAction: style.touchAction, draggable: canvas.draggable,
      contextMenuBlocked: blocked('contextmenu'), dragBlocked: blocked('dragstart'), selectionBlocked: blocked('selectstart') };
  });
  assert(quality.pixelsPerCssPixel >= Math.min(mobileDpr, 2) - .05, `Mobile canvas too blurry: ${JSON.stringify(quality)}`);
  assert.equal(quality.userSelect, 'none'); assert.equal(quality.touchAction, 'none');
  assert.equal(quality.draggable, false);
  assert(quality.contextMenuBlocked && quality.dragBlocked && quality.selectionBlocked, 'Native copy/drag menu must be suppressed on the room');
  let mb = await mobileCanvas.boundingBox();
  let mx = mb.x + 160, my = mb.y + 230;
  const session = await mobile.context().newCDPSession(mobile);
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  await mobileCanvas.tap({ position: { x: mx - mb.x, y: my - mb.y } });
  assert((await status(mobile)).includes('こころを選びました'), `Mobile tap should select Kokoro: ${await status(mobile)}`);
  console.log('mobile tap passed');
  mb = await mobileCanvas.boundingBox(); mx = mb.x + 160; my = mb.y + 230;
  await touch('touchStart', [[mx, my, 2]]);
  await mobile.waitForTimeout(500);
  assert((await status(mobile)).includes('こころをつかみました'), `Mobile long press must grab the cat: ${await status(mobile)}`);
  console.log('mobile hold passed');
  await touch('touchMove', [[mx + 48, my + 42, 2]]);
  await touch('touchEnd', []);
  assert((await status(mobile)).includes('こころをここに置きました'));
  await click(mobile, '一時停止');
  const frozen = await frame(mobileCanvas);
  await touch('touchStart', [[mb.x + 80, mb.y + 70, 3], [mb.x + 240, mb.y + 70, 4]]);
  await touch('touchMove', [[mb.x + 55, mb.y + 70, 3], [mb.x + 265, mb.y + 70, 4]]);
  await touch('touchEnd', []);
  await mobile.waitForTimeout(300);
  assert.notEqual(frozen, await frame(mobileCanvas), 'Mobile pinch must zoom');
  console.log('mobile pinch passed');
  await click(mobile, '再生'); await more(mobile); await click(mobile, 'UIを隠す');
  await mobile.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas.height / canvas.getBoundingClientRect().height >= Math.min(devicePixelRatio, 2) - .05;
  });
  await click(mobile, '操作を表示');
  await mobile.screenshot({ path: `${out}/${label}-mobile-controls.png`, fullPage: true, timeout: 90000 });
  await mobile.close();
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(badResponses.length, 0, JSON.stringify(badResponses));
  const report = { passed: true, base, desktop: process.env.MOBILE_ONLY ? [] : ['tap select', 'hold grab', 'floor drag', 'release', 'orbit', 'pet pose', 'call', 'toy', 'focus', 'hide and restore UI', 'reset', 'three modes', 'treat and pet both cats', 'natural completion', 'pause and resume', 'wheel zoom', 'credits'], mobile: ['responsive controls', 'tap select', 'hold grab', 'floor drag', 'release', 'pinch zoom', 'native callout blocked', 'fullscreen resolution'], quality, errors, badResponses, requests: [...new Set(requests.map(url => url.replace(origin, '')))] };
  await writeFile(`${out}/${label}-controls.json`, JSON.stringify(report, null, 2));
  console.log(`${base}: ${process.env.MOBILE_ONLY ? 'mobile' : 'desktop and mobile'} gesture controls passed, console error 0, asset 404 0`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
