import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const base = '/cat-life/';
const out = 'artifacts/fidelity'; await mkdir(out, { recursive: true });
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
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 760 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(origin + base); await page.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
    const label = mobile ? 'mobile' : 'desktop';
    await page.screenshot({ path: `${out}/${label}-room.png`, fullPage: true });
    await page.getByRole('button', { name: 'ぷーたん', exact: true }).click();
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: '猫に寄る' }).click();
    await page.getByRole('button', { name: 'ちゅーる', exact: true }).click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${out}/${label}-treat.png`, fullPage: true });
    await page.getByRole('button', { name: 'なでる', exact: true }).click();
    await page.waitForTimeout(1350);
    await page.screenshot({ path: `${out}/${label}-pet.png`, fullPage: true });
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: '窓辺でひなたぼっこ' }).click();
    await page.waitForTimeout(5200);
    assert.equal(await page.locator('canvas').getAttribute('data-purin-activity'), 'window');
    await page.screenshot({ path: `${out}/${label}-window.png`, fullPage: true });
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: 'タワーにのぼる' }).click();
    await page.getByRole('button', { name: '視点を戻す' }).click();
    await page.waitForTimeout(8800);
    assert.equal(await page.locator('canvas').getAttribute('data-purin-activity'), 'tower');
    await page.screenshot({ path: `${out}/${label}-tower.png`, fullPage: true });
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: '配置を戻す' }).click();
    await page.locator('#more-actions summary').click();
    await page.getByRole('button', { name: 'ねずみで遊ぶ' }).click();
    await page.waitForFunction(() => document.querySelector('#daily-life')?.textContent?.includes('ぷーたん：ねずみ遊び'), null, { timeout: 12000 });
    await page.waitForTimeout(900);
    assert.equal(await page.locator('canvas').getAttribute('data-purin-activity'), 'mouse');
    await page.screenshot({ path: `${out}/${label}-mouse.png`, fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('fidelity screenshots saved, console error and 404 zero');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
