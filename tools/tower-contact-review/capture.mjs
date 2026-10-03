import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const cycle=process.env.REVIEW_CYCLE??'baseline';const dir=`artifacts/tower-contact-review/${cycle}`;await mkdir(dir,{recursive:true});
await build({configFile:false,root:resolve('tools/tower-contact-review'),base:'./',publicDir:false,build:{outDir:resolve(dir+'/preview'),emptyOutDir:true,assetsInlineLimit:0},logLevel:'warn'});
const server=createServer(async(req,res)=>{try{const path=resolve(dir+'/preview',new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');assert(path.startsWith(resolve(dir+'/preview')+'/'));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.glb':'model/gltf-binary'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const errors=[],shots=[],audits=[];
try {
const page=await browser.newPage({viewport:{width:720,height:600}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin);await page.waitForFunction(()=>window.ready||window.failure,null,{timeout:90000});assert.equal(await page.evaluate(()=>window.failure),undefined);
await writeFile(`${dir}/geometry.json`,JSON.stringify(await page.evaluate(()=>window.review.geometry()),null,2));
for(const i of [0,1])for(const mode of ['up','down']) {
 await page.evaluate(([i,m])=>window.review.start(i,m),[i,mode]);
 const times=process.env.REVIEW_TIMES?JSON.parse(process.env.REVIEW_TIMES):[0,.8,1.55,2.1,2.55,3.2,3.8,4.4,5.1,5.7,6.4,7,7.5,7.95,8.3,8.55,8.9,9.2,9.55,9.9];
 for(const time of times) {
  const snapshot=await page.evaluate(([i,t])=>window.review.advance(i,t),[i,time]);
  assert(snapshot.verticesFinite);
  if(cycle!=='baseline'&&cycle!=='geometry') {
   for(const contact of snapshot.contactSurfaces??[]) assert(contact.actual!==null&&Math.abs(contact.expected-contact.actual)<.035,`Missing real board: ${JSON.stringify(contact)}`);
   for(const foot of snapshot.traversal?.feet??[])if(foot.locked)assert(foot.error<.045,`Planted paw slipped: ${foot.error}`);
  }
  const file=`${i?'kokoro':'purin'}-${mode}-${time.toFixed(2)}.png`;
  await page.screenshot({path:`${dir}/${file}`,timeout:90000});shots.push({cat:i?'kokoro':'purin',mode,time,file,...snapshot});
 }
}
assert.deepEqual(errors,[]);await writeFile(`${dir}/report.json`,JSON.stringify({passed:true,errors,shots,audits},null,2));console.log(`${cycle}: ${shots.length} real-rig poses, ${audits.length} additional cases passed`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
