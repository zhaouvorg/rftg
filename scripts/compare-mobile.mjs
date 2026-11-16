import {clickAnswer} from '../tests/browser-actions.mjs';
import {checkActionControls} from '../tests/action-controls.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture,catalog,root} from '../tests/helpers.mjs';
import {describeChoice,makeAnswer,validateChoice,automaticAnswer} from '../shared/choices.mjs';
import {buildOracle,reference,run,stop,pause,hash,source,testEnv} from './native-reference.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const matrix=[
  {name:'base',expansion:0,mode:0,seed:424242},
  {name:'advanced',expansion:0,mode:0,advanced:true,seed:1001},
  {name:'arc1',expansion:3,mode:0,arc1Mask:7,seed:1001},
  {name:'arc1-subset',expansion:3,mode:0,arc1Mask:5,seed:1002},
  {name:'orb',expansion:4,mode:2,seed:1001},
  {name:'invasion',expansion:5,mode:1,seed:1001},
  {name:'xcs-cards',expansion:8,mode:0,seed:1001},
  {name:'frontier',expansion:8,mode:3,seed:1001},
  {name:'invasion-frontier',expansion:8,mode:5,seed:1001},
  {name:'counterstrike',expansion:8,mode:4,advanced:true,seed:1001},
  {name:'counterstrike-1002',expansion:8,mode:4,advanced:true,seed:1002},
  {name:'counterstrike-conquest',expansion:8,mode:4,advanced:true,seed:1008,required:[26,27,30,33,34,51,52,54]},
  {name:'invasion-4',expansion:5,mode:1,players:4,seed:1001},
];
const selected=option('--case','all'),cases=matrix.filter(c=>selected==='all'||selected.split(',').includes(c.name));
assert.ok(cases.length,'Unknown --case');
const out=path.resolve(option('--out',`test-results/consistency-${new Date().toISOString().replace(/[:.]/g,'-')}`));
await mkdir(out,{recursive:true});
assert.equal((await readdir(out)).length,0,'Output directory must be empty; use a new --out to preserve earlier evidence');
const manifest={started:new Date().toISOString(),source,cases,node:process.version,binaries:{},sources:{},runtime:{},network:{},headless:true};
for(const name of ['rftg','rftgserver','ai_client','learner'])manifest.binaries[name]=await hash(path.join(source,name));
for(const name of (await readdir(source)).filter(f=>/\.(c|h)$/.test(f)||f==='cards.txt'))manifest.sources[name]=await hash(path.join(source,name));
for(const folder of ['shared','server','public'])for(const name of (await readdir(path.join(root,folder))).filter(f=>/\.(mjs|css|html)$/.test(f)))manifest.runtime[folder+'/'+name]=await hash(path.join(root,folder,name));
for(const name of ['cards.json','assets.json','provenance.json'])manifest.runtime['public/data/'+name]=await hash(path.join(root,'public/data',name));
for(const name of (await readdir(path.join(source,'network'))).filter(f=>f.endsWith('.net')))manifest.network[name]=await hash(path.join(source,'network',name));
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Headless consistency artifacts: ${out}`);
let browser,xvfb;const summary=[];
try{
  const oracle=await buildOracle(path.join(out,'native-oracle'));
  manifest.oracles={gui:await hash(oracle.binary),learner:await hash(oracle.learner)};
  await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
  // Xvfb chooses an unused display; no connection to the user's desktop.
  xvfb=spawn('Xvfb',['-displayfd','1','-screen','0','1280x900x24','-nolisten','tcp','-ac','-noreset'],{detached:true,stdio:['ignore','pipe','pipe']});
  const display=await new Promise((resolve,reject)=>{xvfb.stdout.once('data',b=>resolve(':'+b.toString().trim()));xvfb.once('error',reject);});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  for(const config of cases){
    const dir=path.join(out,config.name);await mkdir(dir,{recursive:true});
    console.log(`${config.name}: native reference / locked replay`);
    const ref=await reference(config,dir,oracle,display);
    const f=await fixture(config.seed,{dir:path.join(dir,'server'),keep:true,transcript:ref.transcript});
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{
      const Native=window.WebSocket;window.__observed={state:null,choices:{},sent:[],errors:[]};
      window.WebSocket=class extends Native{
        constructor(...a){super(...a);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.event==='state'){window.__observed.state=m.state;if(m.state.choice)window.__observed.choices[m.state.choice.pos]=m.state;}if(m.event==='error')window.__observed.errors.push(m.message);});}
        send(data){window.__observed.sent.push(JSON.parse(data));return super.send(data);}
      };
    });
    const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    const trace=[],types=new Set(),roles=new Set();let boostChecked=false;
    try{
      await page.goto(f.url);await page.getByLabel('玩家名称').fill('MobileOracle');await page.getByLabel('密码',{exact:true}).fill('testpw');
      await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('button',{name:'创建游戏',exact:false}).click();
      await page.locator('#room-name').fill(config.name);
      const expansions=config.arc1Mask?[1,2,3].filter(id=>config.arc1Mask&(1<<(id-1))):[config.expansion];
      for(const id of expansions)if(id)await page.locator(`[data-config="expansion"][value="${id}"]`).check();
      if([1,5].includes(config.mode)&&config.expansion===8)await page.locator('[data-config="expansion"][value="5"]').check();
      if((config.players||2)!==2)await page.locator(`[data-config="players"][value="${config.players}"]`).check();
      if(config.advanced)await page.locator('[data-config="advanced"]').check();
      for(const [key,modes] of [['orb',[2]],['invasion',[1,5]],['frontier',[3,5]],['counterstrike',[4]]])if(modes.includes(config.mode))await page.locator(`[data-config="${key}"]`).check();
      assert.equal(await page.locator('#create-form select').count(),0,'PC-style options must be visible together');
      await page.screenshot({path:path.join(dir,'create-mobile.png'),fullPage:true});
      await page.locator('#create-form button[type="submit"]').click();
      await page.waitForFunction(()=>window.__observed.state?.status==='room');
      for(let i=1;i<(config.players||2);i++){
        await page.locator('[data-action="addAI"]').click();
        await page.waitForFunction(count=>Object.keys(window.__observed.state.rooms[window.__observed.state.roomId].players).length===count,i+1);
      }
      await page.locator('[data-action="start"]').click();
      for(const record of ref.decisions){
        await page.waitForFunction(pos=>window.__observed.choices[pos]||window.__observed.state?.status==='finished',record.pos);
        const s=await page.evaluate(pos=>window.__observed.choices[pos]||window.__observed.state,record.pos),q=s.choice;
        const tag=`${config.name} pos ${record.pos} type ${record.type}`;
        assert.ok(q,`${tag}: premature game over`);
        assert.equal(q.type,record.type,tag+' choice type');assert.deepEqual(q.args,record.args,tag+' args');
        if(q.type!==0)assert.deepEqual(q.list,record.list,tag+' offered cards/operations');
        assert.deepEqual(q.special,record.special,tag+' offered special metadata');
        assert.equal(s.seat,record.seat,tag+' rotation');assert.equal(s.round,record.state.round,tag+' round');
        assert.equal(s.currentAction,record.state.currentAction,tag+' current phase');assert.equal(s.vpPool,record.state.vpPool,tag+' VP pool');
        const visible=s.cards.filter(c=>c&&(c.where===3||c.where===6||c.owner===s.seat&&[2,5].includes(c.where))).map(c=>[c.id,c.design,c.owner,c.where,c.numGoods,c.damaged]);
        assert.deepEqual(visible,record.state.cards,tag+' own hand / public tableaux / goods / damage');
        const automatic=automaticAnswer(s);
        if(automatic){
          assert.equal(record.type,34);assert.ok(record.args[2]&2);assert.ok([0,2].includes(record.answer.rv));
          await page.waitForFunction(pos=>window.__observed.sent.some(m=>m.action==='choice'&&m.pos===pos),q.pos);
          const sent=await page.evaluate(pos=>window.__observed.sent.find(m=>m.action==='choice'&&m.pos===pos),q.pos);
          assert.deepEqual(sent,{action:'choice',...automatic},tag+' PC zero-click defense acknowledgement');
          trace.push({tag,request:q,native:record.state,answer:record.answer,automatic:true,sent});types.add(q.type);continue;
        }
        const m=describeChoice(s,catalog);
        if(q.type===0){
          assert.deepEqual(m.options.map(o=>o.value).sort((a,b)=>a-b),record.state.roles.sort((a,b)=>a-b),tag+' legal role set');
          for(const o of m.options)roles.add(o.value);
        }
        await page.waitForFunction(pos=>document.querySelector('.choice-panel[data-pos="'+pos+'"]'),q.pos);
        const dom=await page.locator('.choice-option').evaluateAll(es=>es.map(e=>({key:e.dataset.key,group:e.dataset.group,label:e.getAttribute('aria-label')||e.textContent,disabled:e.disabled,selected:e.getAttribute('aria-pressed')})));
        const modelOptions=[...m.options.map(o=>({key:o.key,group:['multi','actions','start','payment','two','defend','takeover','replacement'].includes(m.mode)?'list':'option'})),...(m.specialOptions||[]).map(o=>({key:o.key,group:'special'})),...(m.pass?[{key:'pass',group:'pass'}]:[]),...(m.mode==='settlePayment'&&!m.zeroPaid&&m.min>0?m.paymentOptions.map(o=>({key:o.key,group:'list'})):[])];
        assert.deepEqual(dom.map(({key,group})=>({key,group})).sort(byKey),modelOptions.sort(byKey),tag+' every option rendered');
        if(q.type===0)await checkActionControls(page,m);
        await checkLayout(page,tag);
        if(!types.has(q.type)){await page.screenshot({path:path.join(dir,`choice-${q.type}.png`),fullPage:true});types.add(q.type);}
        const frame={tag,request:q,native:record.state,expansion:{xcs:s.xcs,invasion:s.invasion,orb:s.orb},model:m,dom,answer:record.answer};trace.push(frame);
        assert.equal(validateChoice(s,record.answer,catalog),null,tag+' native answer must be accepted');
        if(!boostChecked&&q.type===0&&s.meta.advanced&&q.args[0]===0&&m.options.some(o=>o.value===12)){
          const role=id=>page.locator(`.choice-option[data-group="list"][data-key="${id}"]`);
          await role(5).click();await role(6).click();await role(12).click();
          assert.equal(await role(5).getAttribute('data-boosted'),'true');assert.match(await page.locator('.action-order').textContent(),/边境殖民 → 殖民/);
          assert.ok(await page.locator('[data-action="confirm"]').isEnabled());
          await role(12).click();assert.equal(await role(6).getAttribute('data-boosted'),'true');assert.match(await page.locator('.action-order').textContent(),/殖民 → 边境殖民/);
          await role(12).click();assert.equal(await role(12).getAttribute('aria-pressed'),'false');
          await page.locator('[data-action="reset"]').click();boostChecked=true;
        }
        await clickAnswer(page,s,m,record.answer);
        const sent=await page.evaluate(()=>window.__observed.sent.filter(m=>m.action==='choice').at(-1));
        assert.deepEqual(sent,{action:'choice',...record.answer},tag+' real UI answer');
        await page.waitForFunction(pos=>window.__observed.state?.choice?.pos!==pos,q.pos);
        const observed=await page.evaluate(()=>window.__observed.errors);assert.deepEqual(observed,[],tag+' gateway errors');
      }
      await page.waitForFunction(()=>window.__observed.state?.status==='finished');
      const final=await page.evaluate(()=>window.__observed.state);
      assert.equal(final.error,null,'clean terminal state');assert.equal(final.round,ref.round);
      assert.deepEqual(ref.scores.map(({seat,score})=>[seat,score]).sort((a,b)=>a[0]-b[0]),final.players.map((p,seat)=>[seat,final.results[p.name]]),'native and browser scores by rotated seat');
      assert.equal(final.results.MobileOracle,ref.aScores.find(s=>s.initialSeat===0).score,'reference human score');
      const database=JSON.parse((await run('python3',['-c',`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
print(json.dumps({"games":c.execute("select gid,state from games").fetchall(),"results":c.execute("select u.user,r.vp,r.tie,r.winner from results r join users u on u.uid=r.uid order by u.user").fetchall()}))`,path.join(f.dir,'game.sqlite')])).stdout);
      assert.deepEqual(database.games,[[1,'DONE']]);assert.equal(database.results.length,config.players||2);
      await writeFile(path.join(dir,'database-result.json'),JSON.stringify(database,null,2));
      const nativeXml=await readFile(path.join(dir,'local/exports',(await readdir(path.join(dir,'local/exports'))).find(f=>f.endsWith('.xml'))),'utf8');
      const serverXml=await readFile(path.join(f.dir,'Game_000001.xml'),'utf8');
      assert.deepEqual(terminalXml(serverXml),terminalXml(nativeXml),'native/server final tableaux, goods, damage, hand counts, score and winners');
      const transcript=(await readFile(ref.transcript,'utf8')).split('\n'),humanInts=+transcript[6].split(' ')[0],last=ref.decisions.at(-1);
      assert.equal(last.pos+4+last.answer.list.length+last.answer.special.length,humanInts,'consume the complete controlled-seat transcript');
      const serverLog=await readFile(f.log,'utf8');assert.doesNotMatch(serverLog,/transcript.*(?:mismatch|exhaust)|abandoning game|internal game error/i);
      assert.deepEqual(errors,[]);
      await checkLayout(page,config.name+' final');
      await page.screenshot({path:path.join(dir,'final-mobile.png'),fullPage:true});
      for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});await checkLayout(page,config.name+' width '+width);}
      for(const type of config.required||[])assert.ok(types.has(type),`Required native choice ${type} absent`);
      if(config.name==='counterstrike-conquest'){
        assert.ok(trace.some(t=>t.request.type===52&&t.answer.rv===1),'actually attempt a system conquest');
        assert.ok(trace.some(t=>t.request.type===30&&t.expansion?.xcs?.stage===2&&t.expansion.xcs.conquestPending[recordSeat(t)]<0&&t.answer.rv===0),'Done remains usable during retaliation defense');
      }
      summary.push({...config,result:'PASS',decisions:trace.length,clickDecisions:trace.filter(t=>!t.automatic).length,automatic:trace.filter(t=>t.automatic).length,types:[...types].sort((a,b)=>a-b),roles:[...roles].sort((a,b)=>a-b),chosenRoles:[...new Set(trace.filter(t=>t.request.type===0).flatMap(t=>t.answer.list).filter(v=>v>=0))].sort((a,b)=>a-b),scores:final.results,round:final.round});
      console.log(`${config.name}: PASS ${trace.filter(t=>!t.automatic).length} real UI choices / ${trace.filter(t=>t.automatic).length} PC automatic acknowledgements, round ${final.round}, ${JSON.stringify(final.results)}`);
    }catch(error){
      await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});
      await writeFile(path.join(dir,'failure.json'),JSON.stringify({error:error.stack,observed:await page.evaluate(()=>window.__observed).catch(()=>null)},null,2));
      summary.push({...config,result:'FAIL',decisions:trace.length,error:error.message});throw error;
    }finally{
      await writeFile(path.join(dir,'mobile-decisions.json'),JSON.stringify(trace,null,2));
      await context.close();await f.close();await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
    }
  }
}finally{await browser?.close();await stop(xvfb);}
for(const [file,digest] of Object.entries(manifest.runtime))assert.equal(await hash(path.join(root,file)),digest,'Runtime changed during verification: '+file);
for(const [file,digest] of Object.entries(manifest.network))assert.equal(await hash(path.join(source,'network',file)),digest,'Native AI weights changed: '+file);
manifest.finished=new Date().toISOString();manifest.result='PASS';await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`PASS ${summary.length} complete games / ${summary.reduce((n,r)=>n+r.clickDecisions,0)} real UI decisions`);

function byKey(a,b){return (a.group+':'+a.key).localeCompare(b.group+':'+b.key);}
async function checkLayout(page,tag){
  const geometry=await page.evaluate(()=>{
    const round=document.querySelector('.round-overview'),action=document.querySelector('#current-choice'),hand=document.querySelector('#your-hand'),own=document.querySelector('.own-tableau'),others=document.querySelector('.opponents'),info=document.querySelector('.game-details');
    const scrolls=[...document.querySelectorAll('.hand-cards,.table-cards,.goals-row,.choice-options,.orb-map-wrap,.player-top,.game-info')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className);
    return {wide:document.documentElement.scrollWidth>innerWidth,scrolls,order:round&&action&&hand&&own&&others&&info&&round.compareDocumentPosition(action)&4&&action.compareDocumentPosition(hand)&4&&action.getBoundingClientRect().bottom<=hand.getBoundingClientRect().top+1&&hand.compareDocumentPosition(own)&4&&own.compareDocumentPosition(others)&4&&others.compareDocumentPosition(info)&4,tabs:document.querySelectorAll('[data-action="tab"]').length};
  });
  assert.equal(geometry.wide,false,tag+' page horizontal overflow');assert.deepEqual(geometry.scrolls,[],tag+' internal horizontal scrolling');assert.ok(geometry.order,tag+' action/hand/own/opponents/info order');assert.equal(geometry.tabs,0);
}

function terminalXml(xml){
  const players=[...xml.matchAll(/<Player id="(\d+)"([^>]*)>([\s\S]*?)<\/Player>/g)].map(m=>{
    const body=m[3],table=body.match(/<Tableau[^>]*>([\s\S]*?)<\/Tableau>/)?.[1]||'';
    return {seat:+m[1],winner:m[2].includes('winner="yes"'),score:+body.match(/<Score>(-?\d+)/)[1],chips:+body.match(/<Chips>(-?\d+)/)[1],hand:+body.match(/<Hand count="(\d+)"/)[1],table:[...table.matchAll(/<Card ([^>]+)>/g)].map(x=>x[1]).sort()};
  }).sort((a,b)=>a.seat-b.seat);
  return {round:+xml.match(/<Round>(\d+)/)[1],pool:+xml.match(/<Pool>(-?\d+)/)[1],players};
}

function recordSeat(t){return t.native.seat;}
