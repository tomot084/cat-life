import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE ?? '/';
assert(/^\/[A-Za-z0-9_.-]*\/$/.test(base) || base === '/');
const label = base === '/' ? 'root' : 'subpath';
const out = 'artifacts/room-enhancement'; await mkdir(out, { recursive: true });
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
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  const errors = [], warnings = [], badResponses = [], requests = [];
  function monitor(page) {
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) badResponses.push({ url: r.url(), status: r.status() }); });
    page.on('requestfailed', r => errors.push(r.url() + ': ' + r.failure()?.errorText));
    return page.route('**/*', r => {
      requests.push(r.request().url());
      if (!r.request().url().startsWith(origin + base)) { errors.push('Unexpected request ' + r.request().url()); return r.abort(); }
      return r.continue();
    });
  }
  await monitor(page);
  const started = Date.now();
  await page.goto(origin + base);
  await page.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
  const readyMs = Date.now() - started;
  assert.equal(await page.title(), 'ぷーたんとこころのお部屋');
  const canvas = page.locator('canvas');
  const frame = () => canvas.evaluate(element => element.toDataURL('image/png'));
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const modes = [], interactions = [];
  for (const [mode, title] of [['relax', 'のんびり過ごす'], ['walk', 'ふたりでおさんぽ'], ['sit', '並んでおすわり']]) {
    await click(title);
    assert.equal(await page.getByRole('button', { name: title, exact: true }).getAttribute('aria-pressed'), 'true');
    const a = await frame(); await page.waitForTimeout(400);
    assert.notEqual(a, await frame(), mode + ' must animate');
    modes.push({ mode, frames_change: true });
    for (const cat of ['ぷーたん', 'こころ']) {
      await click(cat);
      await click('ちゅーる');
      assert((await page.locator('output').innerText()).includes(cat + 'にちゅーる'));
      // Replacing an active reaction must clean up its meshes and saved pose.
      await click('なでる');
      assert((await page.locator('output').innerText()).includes(cat + 'をなでなで'));
      interactions.push({ mode, cat, treat: true, pet: true });
      await click(title); // A mode change cancels any reaction immediately.
      assert.equal(await page.locator('output').innerText(), 'ふたりの、いつものひととき。');
    }
  }
  // Natural completion, rapid repetition, and pause/resume in mid-reaction.
  await click('のんびり過ごす');
  for (const action of ['ちゅーる', 'なでる']) {
    await click(action); await click(action); await click('一時停止');
    assert(await page.getByRole('button', { name: action, exact: true }).isDisabled());
    await page.waitForTimeout(350); const frozen = await frame();
    await page.waitForTimeout(300); assert.equal(frozen, await frame(), 'Pause must freeze reaction');
    await click('再生');
    await page.waitForFunction(() => document.querySelector('output').textContent === 'ふたりの時間に、もどりました。', null, { timeout: 60000 });
  }
  await click('並んでおすわり'); await click('一時停止');
  await page.waitForTimeout(350); const stopped = await frame();
  await page.waitForTimeout(300); assert.equal(stopped, await frame(), 'Pause must freeze');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .56, { steps: 15 }); await page.mouse.up();
  await page.waitForTimeout(700); const rotated = await frame();
  assert.notEqual(rotated, stopped, 'Drag must rotate');
  await page.mouse.wheel(0, -400); await page.waitForTimeout(700);
  assert.notEqual(rotated, await frame(), 'Wheel must zoom');
  await click('視点を戻す'); await page.waitForTimeout(700);
  assert.equal(stopped, await frame(), 'Reset must restore camera');
  await page.locator('footer summary').click();
  const credits = await page.locator('footer').innerText();
  for (const name of ['DreamNoms', 'Kenney', '3D Assets', 'Connor Adams', 'Dollhouse Cat Furniture', 'Cushion Bed', 'CC0 1.0', 'Public Domain', 'CC BY 4.0', 'bookcaseOpenLow', 'books', 'pillow', 'plantSmall1']) assert(credits.includes(name));
  assert.equal(new Set(requests.filter(u => u.endsWith('.glb'))).size, 10);
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await monitor(mobile); await mobile.goto(origin + base);
  await mobile.waitForSelector('canvas[data-ready="true"]', { timeout: 90000 });
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  for (const name of ['のんびり過ごす', 'ふたりでおさんぽ', '並んでおすわり', 'ちゅーる', 'なでる']) assert(await mobile.getByRole('button', { name, exact: true }).isVisible());
  await mobile.getByRole('button', { name: 'こころ', exact: true }).tap();
  await mobile.getByRole('button', { name: 'なでる', exact: true }).tap();
  assert((await mobile.locator('output').innerText()).includes('こころをなでなで'));
  await mobile.close();
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(badResponses.length, 0, JSON.stringify(badResponses));
  await writeFile(`${out}/${label}-browser.json`, JSON.stringify({ passed: true, base, readyMs, modes, interactions, rapidRepeat: true, cancelOnModeChange: true, completion: true, pauseReaction: true, drag: true, zoom: true, reset: true, mobile: true, errors, warnings, badResponses, requests: [...new Set(requests.map(u => u.replace(origin, '')))] }, null, 2));
  console.log(`${base}: 10 models, 3 modes, both interactions × both cats × all modes, pause/resume, drag, zoom, reset, credits, mobile; zero errors/404 passed`);
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
