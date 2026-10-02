import { clickRoomAction } from './room-test-actions.mjs';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
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
const errors = [], badResponses = [];
try {
  await mkdir('artifacts/furniture-adoption', { recursive: true });
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 760 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) badResponses.push(r.url()); });
    await page.goto(origin + base);
    await page.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
    await clickRoomAction(page, 'ぷりん');
    await clickRoomAction(page, 'タワーにのぼる');
    await page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('ぷりん：タワーの上'), null, { timeout: 90000 });
    await clickRoomAction(page, '一時停止');
    await page.screenshot({ path: `artifacts/furniture-adoption/${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true, timeout: 90000 });
    await page.close();
    console.log(`${mobile ? 'mobile' : 'desktop'}: adopted furniture and tower landing captured`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
