import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const out = 'artifacts/scruff-carry'; await mkdir(out, { recursive: true });
const base = '/cat-life/';
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
const errors = [];
async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(origin + base); await page.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
  return page;
}
try {
  const desktop = await open({ width: 960, height: 760 }, false);
  const box = await desktop.locator('canvas').boundingBox();
  const x = box.x + 430, y = box.y + 250;
  await desktop.mouse.move(x, y); await desktop.mouse.down(); await desktop.waitForTimeout(1100);
  assert((await desktop.locator('#interaction-status').innerText()).includes('つかみました'));
  await desktop.waitForTimeout(700);
  await desktop.screenshot({ path: `${out}/desktop-grab.png` });
  await desktop.mouse.move(x - 70, y + 40, { steps: 10 }); await desktop.waitForTimeout(350);
  await desktop.screenshot({ path: `${out}/desktop-carry.png` });
  await desktop.mouse.up(); await desktop.waitForTimeout(650);
  await desktop.screenshot({ path: `${out}/desktop-landed.png` });
  await desktop.close();
  const mobile = await open({ width: 390, height: 844 }, true);
  const mb = await mobile.locator('canvas').boundingBox();
  const mx = mb.x + 160, my = mb.y + 230;
  const session = await mobile.context().newCDPSession(mobile);
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([px, py, id]) => ({ x: px, y: py, id })) });
  await touch('touchStart', [[mx, my, 1]]); await mobile.waitForTimeout(1100);
  assert((await mobile.locator('#interaction-status').innerText()).includes('つかみました'));
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: `${out}/mobile-grab.png`, fullPage: true });
  await touch('touchMove', [[mx + 45, my + 35, 1]]); await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: `${out}/mobile-carry.png`, fullPage: true });
  await touch('touchEnd', []); await mobile.waitForTimeout(650);
  await mobile.screenshot({ path: `${out}/mobile-landed.png`, fullPage: true });
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('desktop and mobile scruff carry passed; screenshots saved in ' + out);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
