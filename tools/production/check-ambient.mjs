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
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 760 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + base);
    await page.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('canvas').dataset.purinActivity === 'wander', null, { timeout: 45000 });
    if (!mobile && process.env.OBSERVE_DAILY_CYCLE) {
      await Promise.all([
        page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('ぷーたん：ごはん'), null, { timeout: 120000 }),
        page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('こころ：ボール遊び'), null, { timeout: 120000 }),
      ]);
      await mkdir('artifacts/ambient-life', { recursive: true });
      await page.screenshot({ path: 'artifacts/ambient-life/desktop-daily-cycle.png', fullPage: true, timeout: 90000 });
      await page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('こころ：お水'), null, { timeout: 120000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'artifacts/ambient-life/desktop-water.png', fullPage: true, timeout: 90000 });
      console.log('desktop: natural eating and ball play observed');
    }
    await page.getByRole('button', { name: 'ぷーたん', exact: true }).click();
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: 'タワーにのぼる' }).click();
    await mkdir('artifacts/ambient-life', { recursive: true });
    await page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('ぷーたん：タワーをのぼる'), null, { timeout: 90000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `artifacts/ambient-life/${mobile ? 'mobile' : 'desktop'}-jump-up.png`, fullPage: true, timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('ぷーたん：タワーの上'), null, { timeout: 90000 });
    await mkdir('artifacts/ambient-life', { recursive: true });
    await page.screenshot({ path: `artifacts/ambient-life/${mobile ? 'mobile' : 'desktop'}-tower.png`, fullPage: true, timeout: 90000 });
    await page.getByRole('button', { name: 'なでる', exact: true }).click();
    assert((await page.locator('#interaction-status').innerText()).includes('ぷーたんをなでなで'));
    await page.getByRole('button', { name: '並んでおすわり', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#daily-life').textContent.includes('ぷーたん：タワーからジャンプ'), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/ambient-life/${mobile ? 'mobile' : 'desktop'}-jump-down.png`, fullPage: true, timeout: 90000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.getByRole('button', { name: '並んでおすわり', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: '配置を戻す' }).click();
    assert((await page.locator('#interaction-status').innerText()).includes('元の場所へ'));
    if (!mobile) {
      await page.getByRole('button', { name: '並んでおすわり', exact: true }).click();
      await page.screenshot({ path: 'artifacts/ambient-life/desktop-before-manual.png', fullPage: true, timeout: 90000 });
      const box = await page.locator('canvas').boundingBox();
      await page.mouse.move(box.x + 555, box.y + 250);
      await page.mouse.down(); await page.waitForTimeout(500);
      assert((await page.locator('#interaction-status').innerText()).includes('ぷーたんをつかみました'), await page.locator('#interaction-status').innerText());
      await page.mouse.move(box.x + 570, box.y + 84, { steps: 12 });
      await page.mouse.up();
      assert((await page.locator('#interaction-status').innerText()).includes('タワーの上にのせました'));
      await page.screenshot({ path: 'artifacts/ambient-life/desktop-manual-perch.png', fullPage: true, timeout: 90000 });
    } else {
      const box = await page.locator('canvas').boundingBox();
      const session = await page.context().newCDPSession(page);
      const touch = (type, points) => session.send('Input.dispatchTouchEvent', {
        type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
      });
      await touch('touchStart', [[box.x + 160, box.y + 230, 1]]);
      await page.waitForTimeout(600);
      assert((await page.locator('#interaction-status').innerText()).includes('つかみました'));
      await touch('touchMove', [[box.x + 250, box.y + 112, 1]]);
      await page.waitForTimeout(250);
      await touch('touchEnd', []);
      assert((await page.locator('#interaction-status').innerText()).includes('タワーの上にのせました'));
      await page.waitForTimeout(650);
      await page.screenshot({ path: 'artifacts/ambient-life/mobile-manual-perch.png', fullPage: true, timeout: 90000 });
    }
    await page.close();
    console.log(`${mobile ? 'mobile' : 'desktop'}: daily walk, tower climb, pet on perch, mode change, reset, manual tower placement passed`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
  console.log(`${base}: ambient life passed, console error 0, asset 404 0`);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
