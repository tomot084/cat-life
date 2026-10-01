import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const hash = b => createHash('sha256').update(b).digest('hex');
const cats = JSON.parse(await readFile('config/production-models.json', 'utf8'));
const props = JSON.parse(await readFile('config/production-room-assets.json', 'utf8'));
const approved = new Map();
for (const [kind, manifest] of [['cat', cats], ['room', props]]) {
  for (const [name, item] of Object.entries(manifest)) {
    assert.equal(hash(await readFile(item.file)), item.sha256, `Source changed: ${name}`);
    assert(!approved.has(item.sha256), `Duplicate approval: ${name}`);
    if (kind === 'room') {
      assert.equal(item.license, 'CC0-1.0');
      assert(item.author && item.source.startsWith('https://'));
    }
    approved.set(item.sha256, { name, kind, ...item });
  }
}
const seen = new Set(), files = [];
const privateMarker = /(?:input\/|artifacts\/|photo-review|external-cat-audit|state\.npz|__cat-preview|__cat-glb|\/home\/tomot|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})/;
async function scan(dir) {
  for (const name of await readdir(dir)) {
    const path = `${dir}/${name}`, stat = await lstat(path);
    assert(!stat.isSymbolicLink(), `Symlink: ${path}`);
    if (stat.isDirectory()) {
      assert(path === 'dist/assets', `Unexpected directory: ${path}`);
      await scan(path); continue;
    }
    const rel = path.slice(5);
    assert(rel === 'index.html' || /^assets\/[A-Za-z0-9_.-]+\.(js|css|glb)$/.test(rel), `Unexpected output: ${rel}`);
    const bytes = await readFile(path), digest = hash(bytes);
    if (rel.endsWith('.glb')) {
      const item = approved.get(digest);
      assert(item, `Unapproved model: ${rel}`);
      assert(!seen.has(item.name), `Duplicate model: ${rel}`); seen.add(item.name);
      assert.equal(bytes.readUInt32LE(0), 0x46546c67);
      assert.equal(bytes.readUInt32LE(4), 2);
      assert.equal(bytes.readUInt32LE(8), bytes.length);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
      assert.equal(gltf.images?.length ?? 0, 0, 'Approved assets contain no images');
      assert.equal(gltf.textures?.length ?? 0, 0);
      assert(gltf.buffers.every(b => !b.uri), 'No external buffer URI');
      assert(!privateMarker.test(JSON.stringify(gltf)) && !/file:\/|\/home\//i.test(JSON.stringify(gltf)));
      if (item.kind === 'cat') {
        assert.equal(gltf.skins.length, 1); assert.equal(gltf.skins[0].joints.length, 46);
        for (const clip of ['IdleNorm', 'WalkCycle', 'IdleSit']) assert(gltf.animations.some(a => a.name === clip));
        assert(gltf.meshes.some(m => m.primitives.some(p => p.attributes.COLOR_0 !== undefined)));
      } else {
        assert.equal(bytes.length, item.bytes);
        assert.equal(gltf.skins?.length ?? 0, 0);
        const triangles = gltf.meshes.reduce((n, m) => n + m.primitives.reduce((s, p) => {
          assert.equal(p.mode ?? 4, 4);
          return s + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3;
        }, 0), 0);
        assert.equal(triangles, item.triangles);
        assert((gltf.extensionsRequired ?? []).every(e => e === 'KHR_mesh_quantization'));
      }
    } else {
      const text = bytes.toString('utf8');
      assert(!privateMarker.test(text), `Private content marker: ${rel}`);
      if (rel === 'index.html') {
        for (const credit of ['DreamNoms', '783fcb78b55b4394a212c2b6392e1113', 'creativecommons.org/licenses/by/4.0/', '改変', 'Kenney', '3D Assets', 'creativecommons.org/publicdomain/zero/1.0/', ...Object.values(props).map(p => p.source)]) {
          assert(text.includes(credit), `Missing credit: ${credit}`);
        }
      }
    }
    files.push({ path: rel, bytes: bytes.length, sha256: digest });
  }
}
await scan('dist');
assert.equal(seen.size, approved.size, 'Every approved model must be present');
console.log(JSON.stringify({ passed: true, models: [...seen], files, totalBytes: files.reduce((n, f) => n + f.bytes, 0) }, null, 2));
