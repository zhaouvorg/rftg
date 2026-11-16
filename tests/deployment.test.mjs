import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WebSocket} from 'ws';
import {chromium} from 'playwright-core';
import {createGateway,DEFAULT_SESSION_GRACE_MS} from '../server/index.mjs';
import {resolveConnection} from '../public/connection-config.mjs';
import {buildStatic} from '../scripts/build-static.mjs';
import {createStaticServer} from '../scripts/serve-static.mjs';
import {fixture,Peer,catalog,root,delay,freePort} from './helpers.mjs';
import {autoPlayerAnswer} from './auto-player.mjs';
import {describeChoice,validateChoice} from '../shared/choices.mjs';
import {clickAnswer} from './browser-actions.mjs';

const run=promisify(execFile);
async function websocketStatus(url,origin){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url,{origin});
    ws.once('open',()=>{ws.close();resolve(101);});
    ws.once('unexpected-response',(_,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});
    ws.once('error',error=>{if(!/before the connection was established/.test(error.message))reject(error);});
  });
}

test('connection config uses the page locally and an explicit HTTPS/WSS gateway in production',()=>{
  assert.deepEqual(resolveConnection({},'http://127.0.0.1:3000/'),{origin:'http://127.0.0.1:3000',configUrl:'http://127.0.0.1:3000/api/config',wsUrl:'ws://127.0.0.1:3000/ws'});
  assert.equal(resolveConnection({gatewayOrigin:'https://game.example.net/'},'https://cards.example.net/').wsUrl,'wss://game.example.net/ws');
  assert.equal(resolveConnection({gatewayOrigin:'http://127.0.0.1:30001'},'http://127.0.0.1:3000/').configUrl,'http://127.0.0.1:30001/api/config');
  for(const gatewayOrigin of ['https://game.example.net/api','https://user:secret@game.example.net','https://game.example.net?host=elsewhere','ws://game.example.net'])assert.throws(()=>resolveConnection({gatewayOrigin},'https://cards.example.net/'));
  assert.throws(()=>resolveConnection({gatewayOrigin:'http://game.example.net'},'https://cards.example.net/'),/HTTPS/);
});

test('gateway-only mode applies the same exact origin policy to HTTP and WebSocket',async t=>{
  const app=await createGateway({host:'127.0.0.1',port:0,serveStatic:false,publicOrigin:'https://game.example.net',allowedOrigins:' https://cards.example.net, http://127.0.0.1:3000 ',serverLabel:'game.example.net:16309'});
  t.after(()=>app.close());const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
  const allowed=await fetch(base+'/api/config',{headers:{Origin:'https://cards.example.net'}});
  assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://cards.example.net');assert.equal(allowed.headers.get('vary'),'Origin');assert.equal(allowed.headers.get('cache-control'),'no-store');
  const allowedConfig=await allowed.json();assert.equal(allowedConfig.server,'game.example.net:16309');assert.equal(allowedConfig.sessionGraceMs,DEFAULT_SESSION_GRACE_MS);
  const preflight=await fetch(base+'/api/config',{method:'OPTIONS',headers:{Origin:'https://cards.example.net','Access-Control-Request-Method':'GET'}});
  assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-methods'),/GET/);
  for(const origin of ['https://cards.example.net.evil.invalid','http://cards.example.net','https://cards.example.net:444','null']){
    const response=await fetch(base+'/api/config',{headers:{Origin:origin,'X-Forwarded-Host':'cards.example.net','X-Forwarded-Proto':'https'}});
    assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.equal(await websocketStatus(base.replace('http:','ws:')+'/ws',origin),403);
  }
  assert.equal(await websocketStatus(base.replace('http:','ws:')+'/ws','https://cards.example.net'),101);
  for(const file of ['/','/app.mjs','/shared/choices.mjs','/data/cards.json','/assets/cards/6.jpg'])assert.equal((await fetch(base+file)).status,404,'Node must not serve static '+file);
});

test('static build is self contained and can be served independently on a local port',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rftg-static-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await buildStatic({outDir:dir,gatewayOrigin:'http://127.0.0.1:30001'});
  for(const name of ['index.html','app.mjs','connection-config.mjs','shared/choices.mjs','shared/constants.mjs','data/cards.json','assets/icons/25.png','LICENSE'])await access(path.join(dir,name));
  for(const name of ['server/index.mjs','.env','node_modules','tests/helpers.mjs'])await assert.rejects(access(path.join(dir,name)));
  const app=await createStaticServer({directory:dir,port:0});t.after(()=>app.close());const {port}=await app.listen(),base=`http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(base+'/client-config.json')).json()).gatewayOrigin,'http://127.0.0.1:30001');
  const index=await fetch(base);assert.match(await index.text(),/connect-src[^\"]+http:\/\/127.0.0.1:30001 ws:\/\/127.0.0.1:30001/);
  assert.match((await fetch(base+'/shared/choices.mjs')).headers.get('content-type'),/javascript/);
  assert.equal((await fetch(base+'/client-config.json')).headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/assets/icons/25.png')).headers.get('cache-control'),'public, max-age=86400');
  assert.equal((await fetch(base+'/api/config')).status,404);
  assert.equal((await fetch(base+'/.rftg-static-build')).status,404);
});

test('headless split deployment through real nginx: TLS, CORS, WSS, redirects, reload and complete game',{timeout:150000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rftg-nginx-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const tlsPort=await freePort(),redirectPort=await freePort();
  const gatewayOrigin=`https://gateway.rftg.test:${tlsPort}`,staticOrigin=`https://static.rftg.test:${tlsPort}`;
  const f=await fixture(41,{gateway:{serveStatic:false,publicOrigin:gatewayOrigin,allowedOrigins:[staticOrigin],serverLabel:'Split deployment test'}});t.after(()=>f.close());
  const built=await buildStatic({outDir:path.join(dir,'static'),gatewayOrigin});
  const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=gateway.rftg.test','-addext','subjectAltName=DNS:gateway.rftg.test,DNS:static.rftg.test']);
  const adapt=source=>source.replaceAll('listen 443 ssl;',`listen 127.0.0.1:${tlsPort} ssl;`).replaceAll('listen 80;',`listen 127.0.0.1:${redirectPort};`)
    .replaceAll('/etc/letsencrypt/live/rftg.a.com/fullchain.pem',cert).replaceAll('/etc/letsencrypt/live/rftgm.a.com/fullchain.pem',cert)
    .replaceAll('/etc/letsencrypt/live/rftg.a.com/privkey.pem',key).replaceAll('/etc/letsencrypt/live/rftgm.a.com/privkey.pem',key)
    .replaceAll('https://rftg.a.com',gatewayOrigin).replaceAll('wss://rftg.a.com',gatewayOrigin.replace('https:','wss:')).replaceAll('https://rftgm.a.com',staticOrigin)
    .replaceAll('server_name rftg.a.com;','server_name gateway.rftg.test;').replaceAll('server_name rftgm.a.com;','server_name static.rftg.test;')
    .replaceAll('http://127.0.0.1:30001',f.url).replaceAll('/srv/rftg-mobile/dist/static',built.directory);
  const gatewayConf=adapt(await readFile(path.join(root,'deploy/nginx-gateway.conf.example'),'utf8'));
  const staticConf=adapt(await readFile(path.join(root,'deploy/nginx-static.conf.example'),'utf8'));
  const config=path.join(dir,'nginx.conf');
  await writeFile(config,`daemon off;\nmaster_process off;\npid ${dir}/nginx.pid;\nerror_log ${dir}/nginx-error.log;\nevents { worker_connections 128; }\nhttp {\naccess_log ${dir}/nginx-access.log;\nclient_body_temp_path ${dir}/body;\nproxy_temp_path ${dir}/proxy;\n${gatewayConf}\n${staticConf}\n}\n`);
  await run(process.env.NGINX_BIN||'/usr/sbin/nginx',['-t','-p',dir+'/', '-c',config]);
  const nginx=spawn(process.env.NGINX_BIN||'/usr/sbin/nginx',['-p',dir+'/', '-c',config],{stdio:'ignore'});
  t.after(async()=>{if(nginx.exitCode===null){nginx.kill('SIGTERM');await new Promise(resolve=>nginx.once('exit',resolve));}});
  for(let i=0;i<100;i++){if(nginx.exitCode!==null)throw new Error(await readFile(path.join(dir,'nginx-error.log'),'utf8'));try{await fetch(`http://127.0.0.1:${redirectPort}`,{redirect:'manual'});break;}catch{await delay(30);}}
  for(const file of ['/','/app.mjs?v=1','/api/config','/healthz','/ws']){
    const response=await fetch(`http://127.0.0.1:${redirectPort}`+file,{redirect:'manual',headers:{Host:'gateway.rftg.test'}});
    assert.equal(response.status,301);
    assert.equal(response.headers.get('location'),(['/api/config','/healthz','/ws'].includes(file)?gatewayOrigin:staticOrigin)+file,'HTTP redirect follows the same dynamic/static split');
  }
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP gateway.rftg.test 127.0.0.1, MAP static.rftg.test 127.0.0.1']});t.after(()=>browser.close());
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  await context.addInitScript(()=>{const Native=window.WebSocket;window.__split={urls:[],sent:[],state:null};window.WebSocket=class extends Native{constructor(url,...args){super(url,...args);window.__split.urls.push(url);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.event==='state')window.__split.state=m.state;});}send(data){window.__split.sent.push(JSON.parse(data));return super.send(data);}};});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // No external DNS is consulted: both test hostnames resolve only to loopback.
  for(const file of ['/','/app.mjs?release=1','/shared/choices.mjs','/assets/icons/25.png','/client-config.json']){
    const redirect=await page.goto(gatewayOrigin+file);assert.equal(new URL(page.url()).origin,staticOrigin);assert.ok(redirect.ok());
    assert.equal(await page.evaluate(()=>location.pathname+location.search),file);
  }
  await page.goto(staticOrigin);await page.getByRole('heading',{name:'进入游戏大厅'}).waitFor();
  const notFound=await page.goto(gatewayOrigin+'/api/missing');assert.equal(notFound.status(),404);assert.equal(new URL(page.url()).origin,gatewayOrigin);
  await page.goto(staticOrigin);await page.getByRole('heading',{name:'进入游戏大厅'}).waitFor();
  const api=await page.evaluate(async url=>{const r=await fetch(url,{credentials:'omit'});return {status:r.status,body:await r.json()};},gatewayOrigin+'/api/config');
  assert.equal(api.status,200);assert.equal(api.body.server,'Split deployment test');
  await page.getByLabel('玩家名称').fill('split_alice');await page.getByLabel('密码',{exact:true}).fill('testpw');
  await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('button',{name:'创建游戏',exact:false}).click();
  await page.locator('#room-name').fill('Split TLS game');await page.locator('#create-form button[type="submit"]').click();
  await page.getByRole('heading',{name:'Split TLS game',exact:true}).waitFor();
  const bob=await new Peer(f.wsUrl).login('split_bob'),id=await page.evaluate(()=>window.__split.state.roomId);await bob.wait(s=>s.rooms[id]);bob.send({action:'join',id});await bob.wait(s=>s.status==='room');
  const seen=new Set();let botError;
  bob.onState=s=>{if(s?.status==='playing'&&s.choice&&!seen.has(s.choice.pos)){try{const answer=autoPlayerAnswer(s,catalog);assert.equal(validateChoice(s,answer,catalog),null);seen.add(s.choice.pos);bob.send({action:'choice',...answer});}catch(e){botError=e;}}};
  await page.getByRole('button',{name:'开始远征'}).click();await page.locator('.choice-panel[data-pos]').waitFor();
  const pending=await page.evaluate(()=>window.__split.state.choice.pos);await page.reload();await page.locator('.choice-panel[data-pos]').waitFor();
  assert.equal(await page.evaluate(()=>window.__split.state.choice.pos),pending,'resume on the same WSS gateway after reloading the CDN entry');
  assert.deepEqual(await page.evaluate(()=>window.__split.urls),[gatewayOrigin.replace('https:','wss:')+'/ws']);
  assert.ok(await page.evaluate(()=>window.__split.sent.some(m=>m.action==='resume')));
  let choices=0;const end=Date.now()+90000;
  while(Date.now()<end){
    if(botError)throw botError;
    const s=await page.evaluate(()=>window.__split.state);if(s?.status==='finished')break;
    if(!s?.choice){await delay(20);continue;}
    await page.locator(`.choice-panel[data-pos="${s.choice.pos}"]`).waitFor();
    await clickAnswer(page,s,describeChoice(s,catalog),autoPlayerAnswer(s,catalog));choices++;
    await page.waitForFunction(pos=>window.__split.state.choice?.pos!==pos,s.choice.pos);
  }
  const final=await page.evaluate(()=>window.__split.state);assert.equal(final.status,'finished');assert.equal(final.error,null);assert.equal(Object.keys(final.results).length,2);assert.ok(choices>20);
  assert.ok(requests.some(url=>url===gatewayOrigin+'/api/config'));
  assert.equal(requests.some(url=>url===staticOrigin+'/api/config'),false,'the CDN must receive no API requests');
  assert.equal(requests.filter(url=>new URL(url).origin===gatewayOrigin).some(url=>!['/api/config','/api/missing','/','/app.mjs','/shared/choices.mjs','/assets/icons/25.png','/client-config.json'].includes(new URL(url).pathname)),false);
  assert.deepEqual(errors,[]);
  const log=await readFile(path.join(dir,'nginx-access.log'),'utf8');
  for(const file of ['/app.mjs?release=1','/shared/choices.mjs','/assets/icons/25.png','/client-config.json'])assert.ok(log.includes(`GET ${file} HTTP/1.1" 301`),'nginx static redirect '+file);
  await mkdir(path.join(root,'test-results/deployment'),{recursive:true});
  await writeFile(path.join(root,'test-results/deployment/summary.json'),JSON.stringify({result:'PASS',headless:true,nginx:true,https:true,crossOrigin:true,wss:true,staticRedirectStatus:301,choices,scores:final.results},null,2));
  await page.screenshot({path:path.join(root,'test-results/deployment/split-final.png'),fullPage:true});
  t.diagnostic(`Real nginx TLS split deployment completed ${choices} browser UI choices, reload/resume, CORS and static 301 redirects.`);
});
