import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fixture,Peer,catalog,root,delay } from './helpers.mjs';
import { describeChoice,validateChoice } from '../shared/choices.mjs';
import { autoPlayerAnswer } from './auto-player.mjs';
import {clickAnswer} from './browser-actions.mjs';
import {checkActionControls} from './action-controls.mjs';

test('headless mobile browser: login, room, real game, reconnect and result', {timeout:150000},async t=>{
  const f=await fixture(41);t.after(()=>f.close());
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await context.addInitScript(()=>{const Native=window.WebSocket;window.__testSent=[];window.WebSocket=class extends Native{send(data){window.__testSent.push(JSON.parse(data));return super.send(data);}constructor(...args){super(...args);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.event==='state')window.__testState=m.state;}catch{}});}};});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const failedAssets=[];page.on('response',r=>{if(r.status()>=400)failedAssets.push(`${r.status()} ${r.url()}`);});
  await page.goto(f.url);await page.getByRole('heading',{name:'进入游戏大厅'}).waitFor();
  await mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/login-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,'login horizontal overflow');
  await page.getByLabel('玩家名称').fill('browser_alice');await page.getByLabel('密码',{exact:true}).fill('testpw');
  await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('heading',{name:'银河大厅',exact:true}).waitFor();
  await page.getByRole('button',{name:'创建游戏',exact:false}).click();await page.locator('#room-name').fill('Browser table');
  await page.locator('#create-form button[type="submit"]').click();await page.getByRole('heading',{name:'Browser table',exact:true}).waitFor();
  const b=await new Peer(f.wsUrl).login('browser_bob');const id=await page.evaluate(()=>window.__testState.roomId);await b.wait(s=>s.rooms[id]);b.send({action:'join',id});await b.wait(s=>s.status==='room');
  const seen=new Set();let botError=null;
  const advance=s=>{const q=s.choice;if(!q||s.status!=='playing'||seen.has(q.pos))return;try{const r=autoPlayerAnswer(s,catalog);assert.equal(validateChoice(s,r,catalog),null);seen.add(q.pos);b.send({action:'choice',...r});}catch(e){botError=e;}};
  b.onState=advance;
  await page.getByRole('button',{name:'开始远征'}).click();await page.locator('.choice-panel[data-pos]').waitFor();
  await page.screenshot({path:path.join(root,'test-results/game-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,'game horizontal overflow');
  assert.match(await page.locator('.own-tableau .player-stats').innerText(),/VP\s+\d+[\s\S]*总分\s+\d+/,'status strip shows VP chips and current total');
  assert.equal(await page.locator('.own-tableau .xeno-stat').count(),0,'base game has no permanent Xeno value');
  await checkDisplaySettings(page);
  const pending=await page.evaluate(()=>window.__testState.choice.pos);await page.reload();await page.locator('.choice-panel[data-pos]').waitFor();
  assert.equal(await page.evaluate(()=>window.__testState.choice.pos),pending,'refresh must retain pending choice');
  let turns=0,phaseLayoutChecked=false;const end=Date.now()+90000;
  while(Date.now()<end){
    if(botError)throw botError;
    const s=await page.evaluate(()=>window.__testState);if(s?.status==='finished')break;
    if(!s?.choice){await page.waitForTimeout(25);continue;}
    await page.locator(`.choice-panel[data-pos="${s.choice.pos}"]`).waitFor();
    const model=describeChoice(s,catalog);
    if(model.mode==='actions'&&!phaseLayoutChecked){await checkCompactPhases(page,model);phaseLayoutChecked=true;}
    if(model.pass){
      const count=await page.evaluate(()=>window.__testSent.filter(m=>m.action==='choice').length);
      await page.locator('[data-action="select-pass"]').click();
      assert.equal(await page.locator('[data-action="select-pass"]').getAttribute('aria-pressed'),'true');
      assert.ok(await page.locator('[data-action="confirm"]').isEnabled());
      assert.equal(await page.evaluate(()=>window.__testSent.filter(m=>m.action==='choice').length),count,'optional action must wait for confirmation');
      await page.locator('[data-action="reset"]').click();
      assert.equal(await page.locator('[data-action="select-pass"]').getAttribute('aria-pressed'),'false');
    }
    await clickAnswer(page,s,model,autoPlayerAnswer(s,catalog));
    turns++;await page.waitForFunction(pos=>!window.__testState.choice||window.__testState.choice.pos!==pos,s.choice.pos,{timeout:8000});
  }
  await page.getByRole('heading',{name:'远征结束',exact:true}).waitFor();
  const final=await page.evaluate(()=>window.__testState);assert.equal(final.status,'finished');assert.ok(!final.error,final.error);assert.equal(Object.keys(final.results).length,2);assert.ok(turns>20);assert.ok(phaseLayoutChecked,'phase layout checked during a real game');
  await page.screenshot({path:path.join(root,'test-results/result-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'返回大厅',exact:true}).click();await page.getByRole('heading',{name:'银河大厅',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(root,'test-results/lobby-desktop.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
  t.diagnostic(`Headless Chromium completed ${turns} real UI choices; screenshots saved in test-results/.`);
});

test('headless create dialog exposes the same checkbox list and state as PC callbacks', {timeout:40000}, async t=>{
  const {execFileSync}=await import('node:child_process');
  const source=process.env.RFTG_SOURCE?path.resolve(process.env.RFTG_SOURCE,'..'):path.resolve(root,'../rftgp');
  const native=JSON.parse(execFileSync('python3',['tests/native/create-oracle.py','--source',source,'--trials','1','--steps','80'],{cwd:root,maxBuffer:2e6}));
  const f=await fixture();t.after(()=>f.close());
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:800}});
  await page.goto(f.url);await page.getByLabel('玩家名称').fill('config_checker');await page.getByLabel('密码',{exact:true}).fill('testpw');
  await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('button',{name:'创建游戏',exact:false}).click();
  for(const row of native.trace){
    if(row.action){
      const {key,value}=row.action;
      const input=page.locator(`[data-config="${key}"]${['players','expansion'].includes(key)?`[value="${value}"]`:''}`);
      if(await input.isEnabled()){
        if(key==='expansion')await input.click();else if(key==='players')await input.check();else await input.setChecked(value);
      }
    }
    const dom=await page.locator('#create-controls').evaluate(el=>{
      const expansions=[...el.querySelectorAll('[data-config="expansion"]')],options=[...el.querySelectorAll('input[type="checkbox"]')].filter(e=>e.dataset.config!=='expansion');
      return {order:expansions.map(e=>+e.value),selected:expansions.filter(e=>e.checked).map(e=>+e.value),players:+el.querySelector('[data-config="players"]:checked').value,disabledExpansions:expansions.filter(e=>e.disabled).map(e=>+e.value),checked:Object.fromEntries(options.map(e=>[e.dataset.config,e.checked])),enabled:Object.fromEntries(options.map(e=>[e.dataset.config,!e.disabled]))};
    });
    assert.deepEqual(dom.order,[0,1,2,3,4,5,8]);
    for(const key of ['selected','players','disabledExpansions','enabled'])assert.deepEqual(dom[key],row.local[key],`${key}: ${JSON.stringify(row.action)}`);
    for(const [key,checked]of Object.entries(dom.checked))assert.equal(checked,row.local[key]);
  }
  assert.equal(await page.locator('#create-form select').count(),0);
  assert.equal(await page.locator('#modal').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
});

test('headless advanced phase bar uses seven PC role icons at the top', {timeout:60000}, async t=>{
  const f=await fixture(73);t.after(()=>f.close());
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.event==='state')window.__testState=m.state;});}};});
  await page.goto(f.url);await page.getByLabel('玩家名称').fill('advanced_ui');await page.getByLabel('密码',{exact:true}).fill('testpw');
  await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('button',{name:'创建游戏',exact:false}).click();
  await page.locator('#room-name').fill('Advanced phase UI');
  await page.locator('[data-config="advanced"]').check();
  await page.locator('#create-form button[type="submit"]').click();await page.getByRole('heading',{name:'Advanced phase UI',exact:true}).waitFor();
  const bob=await new Peer(f.wsUrl).login('advanced_bob'),id=await page.evaluate(()=>window.__testState.roomId);await bob.wait(s=>s.rooms[id]);bob.send({action:'join',id});await bob.wait(s=>s.status==='room');t.after(()=>bob.close());
  await page.getByRole('button',{name:'开始远征'}).click();await page.locator('.choice-panel[data-pos]').waitFor();
  await page.waitForFunction(()=>!!window.__testState?.meta?.advanced);
  const phases=await page.locator('.round-overview .phase-icon').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),src:e.querySelector('img').getAttribute('src'),repeat:e.querySelector('.glyph-repeat')?.textContent||''})));
  assert.deepEqual(phases.map(p=>p.label),['探索 +5','发展','再次发展','殖民','再次殖民','消费：交易','生产']);
  assert.deepEqual(phases.map(p=>p.src),['/assets/icons/23.png','/assets/icons/3.png','/assets/icons/3.png','/assets/icons/5.png','/assets/icons/5.png','/assets/icons/24.png','/assets/icons/9.png']);
  assert.equal(phases.filter(p=>p.repeat==='2').length,2,'second Develop and Settle are marked');
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const layout=await page.evaluate(()=>{const header=document.querySelector('.round-overview'),choice=document.querySelector('#current-choice'),icons=[...document.querySelectorAll('.round-overview .phase-icon')];const h=header.getBoundingClientRect(),c=choice.getBoundingClientRect();return {headerTop:h.top,headerBottom:h.bottom,choiceTop:c.top,position:getComputedStyle(header).position,right:Math.max(...icons.map(e=>e.getBoundingClientRect().right)),wide:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(layout.wide,false,`advanced phase bar overflow at ${width}`);
    assert.ok(layout.headerBottom<=layout.choiceTop,'advanced phase bar precedes the action panel');
    assert.equal(layout.position,'sticky','phase bar stays at the top while scrolling');
    assert.ok(layout.right<=width,'all seven phase icons fit the viewport');
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(root,'test-results/advanced-phases-top-mobile.png')});
});

test('headless Orb map renders pieces and accepts direct map clicks', {timeout:90000}, async t=>{
  const f=await fixture(17);t.after(()=>f.close());
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.event==='state')window.__testState=m.state;});}};});
  const failedAssets=[];page.on('response',r=>{if(r.status()>=400)failedAssets.push(`${r.status()} ${r.url()}`);});
  await page.goto(f.url);await page.getByLabel('玩家名称').fill('orb_ui');await page.getByLabel('密码',{exact:true}).fill('testpw');
  await page.getByRole('button',{name:'连接银河'}).click();await page.getByRole('button',{name:'创建游戏',exact:false}).click();
  await page.locator('#room-name').fill('Orb map UI');
  await page.locator('[data-config="expansion"][value="4"]').check();
  await page.locator('[data-config="orb"]').check();
  await page.locator('#create-form button[type="submit"]').click();await page.getByRole('heading',{name:'Orb map UI',exact:true}).waitFor();
  const bob=await new Peer(f.wsUrl).login('orb_bob'),id=await page.evaluate(()=>window.__testState.roomId);await bob.wait(s=>s.rooms[id]);bob.send({action:'join',id});await bob.wait(s=>s.status==='room');t.after(()=>bob.close());
  const seen=new Set();
  bob.onState=s=>{const q=s.choice;if(!q||s.status!=='playing'||seen.has(q.pos))return;const answer=autoPlayerAnswer(s,catalog);assert.equal(validateChoice(s,answer,catalog),null);seen.add(q.pos);bob.send({action:'choice',...answer});};
  await page.getByRole('button',{name:'开始远征'}).click();
  const advanceUntil=async type=>{
    const end=Date.now()+30000;
    while(Date.now()<end){
      const current=await page.evaluate(()=>window.__testState);
      if(current?.choice?.type===type)return current;
      if(!current?.choice){await page.waitForTimeout(30);continue;}
      const model=describeChoice(current,catalog),answer=autoPlayerAnswer(current,catalog);
      assert.equal(validateChoice(current,answer,catalog),null,'Orb setup answer is legal');
      await clickAnswer(page,current,model,answer);
      const pos=current.choice.pos;
      await page.waitForFunction(old=>!window.__testState.choice||window.__testState.choice.pos!==old,pos,{timeout:15000});
    }
    throw new Error(`Timed out waiting for Orb choice type ${type}`);
  };

  const placementState=await advanceUntil(39);
  const placementUi=describeChoice(placementState,catalog);
  assert.equal(await page.locator('.choice-option').count(),0,'placement is not a long coordinate-button list');
  assert.equal(await page.locator('.game-details .orb-map').count(),0,'the permanent board does not duplicate the placement map');
  assert.ok(await page.locator('.orb-placement-target').count()>0,'placement anchors are shown on the map');
  assert.ok(await page.locator('.orb-placement-target').count()<placementState.choice.list.length,'rotations are grouped by map anchor');
  const placementsByPosition=new Map();
  for(const option of placementUi.options){const key=`${option.x},${option.y}`;if(!placementsByPosition.has(key))placementsByPosition.set(key,[]);placementsByPosition.get(key).push(option);}
  const rotationGroup=[...placementsByPosition.values()].find(group=>group.length>1);assert.ok(rotationGroup,'at least one map anchor has multiple legal rotations');
  await page.locator(`.orb-placement-target[data-key="${rotationGroup[0].key}"]`).click();
  assert.equal(await page.locator('.orb-target.selected').count(),1,'placement anchor selection is visible');
  assert.equal(await page.locator('.orb-placement-preview .orb-placement-art').count(),1,'selected card preview is drawn on the map');
  const rotation=page.locator('[data-action="rotate-placement"]');assert.ok(await rotation.isEnabled(),'legal rotations use a rotate control');
  const beforeRotation=await page.locator('.placement-status').textContent();await rotation.click();assert.notEqual(await page.locator('.placement-status').textContent(),beforeRotation,'rotation changes the pending placement');
  assert.ok(await page.locator('[data-action="confirm"]').isEnabled(),'map placement can be confirmed');
  await page.screenshot({path:path.join(root,'test-results/orb-placement-map-mobile.png')});
  const placementPos=await page.evaluate(()=>window.__testState.choice.pos);
  await page.locator('[data-action="confirm"]').click();
  await page.waitForFunction(old=>!window.__testState.choice||window.__testState.choice.pos!==old,placementPos,{timeout:15000});

  const mapState=await advanceUntil(40);
  const model=mapState.choice;
  const map=page.locator('.choice-panel .orb-map');
  await map.waitFor();
  assert.equal(await page.locator('.choice-panel .orb-map').count(),1,'the active map is shown once');
  assert.equal(await page.locator('.game-details .orb-map').count(),0,'the permanent board does not duplicate the active map');
  assert.equal(await page.locator('.orb-target').count(),model.list.length,'every legal map cell is directly clickable');
  assert.ok(await page.locator('.orb-component').count()>=2,'both Main Airlock art components are visible');
  const artwork=await page.locator('.orb-component').evaluateAll(es=>[...new Set(es.map(e=>e.getAttribute('href')))]);
  assert.ok(artwork.some(href=>href.includes('/airlocks/airlock_main_')),'Main Airlock artwork is used');
  for(const href of artwork)assert.equal((await page.request.get(f.url+href)).ok(),true,`Orb artwork loads: ${href}`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('.orb-map-wrap').scrollWidth>document.querySelector('.orb-map-wrap').clientWidth+1);
  assert.equal(overflow,false,'Orb map has no page or container overflow');
  await page.locator('.orb-target').first().click();
  assert.equal(await page.locator('.orb-target.selected').count(),1,'map click selects the destination');
  assert.ok(await page.locator('[data-action="confirm"]').isEnabled(),'map selection can be confirmed');
  await page.screenshot({path:path.join(root,'test-results/orb-map-direct-mobile.png')});
  assert.deepEqual(failedAssets,[]);
});

async function checkDisplaySettings(page){
  assert.equal(await page.title(),'银河竞逐 · Race for the Galaxy');
  assert.equal(await page.locator('[data-action="suggest"]').count(),0);
  assert.deepEqual(await page.locator('.topbar [data-action]').evaluateAll(es=>es.map(e=>e.dataset.action)),['settings','help','resign','logout']);
  assert.equal(await page.locator('.game-details [data-action="resign"]').count(),0);
  assert.deepEqual(await page.locator('.choice-footer button').evaluateAll(es=>es.map(e=>e.dataset.action)),['reset','confirm']);
  assert.equal(await page.locator('.round-overview .phase-icon').count(),5,'standard game shows five phase icons');
  assert.equal(await page.locator('.game-details .game-header').count(),0,'round status is not repeated at the bottom');
  const footer=await page.locator('.choice-buttons button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y};}));
  assert.ok(footer[0].x<footer[1].x);assert.equal(footer[0].y,footer[1].y);
  const sizes=()=>page.evaluate(()=>({card:document.querySelector('#your-hand .card').getBoundingClientRect().width,font:parseFloat(getComputedStyle(document.querySelector('.hand-title h2')).fontSize)}));
  const defaults=await sizes();assert.ok(defaults.card>=120,'default hand cards enlarged');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('#scale-cards').press('End');
  let scaled=await sizes();assert.ok(Math.abs(scaled.card/defaults.card-2)<.02);assert.equal(scaled.font,defaults.font,'card scaling must not alter text');
  await page.locator('#scale-text').press('End');
  scaled=await sizes();assert.ok(Math.abs(scaled.font/defaults.font-2)<.02);assert.equal(scaled.card,defaults.card*2,'text scaling must not alter card width');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('html,#modal,.header-actions,.hand-cards,.table-cards,.choice-options,.choice-buttons')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.tagName+'.'+e.className));
    assert.deepEqual(overflow,[],`display at 2×, width ${width}`);
    const order=await page.evaluate(()=>['.round-overview','#current-choice','#your-hand','.own-tableau','.opponents','.game-details'].map(q=>document.querySelector(q).getBoundingClientRect().top));
    assert.deepEqual(order,[...order].sort((a,b)=>a-b),'round/action/hand/own/opponents/info vertical order');
  }
  await page.setViewportSize({width:390,height:844});
  await page.reload();await page.locator('.choice-panel[data-pos]').waitFor();
  assert.deepEqual(await sizes(),{card:defaults.card*2,font:defaults.font*2},'both settings survive reload');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  assert.equal(await page.locator('#scale-cards').inputValue(),'2');assert.equal(await page.locator('#scale-text').inputValue(),'2');
  await page.locator('#scale-cards').press('Home');await page.locator('#scale-text').press('Home');
  const smallest=await sizes();assert.equal(smallest.card,defaults.card*.75);assert.equal(smallest.font,defaults.font*.75);
  await page.getByRole('button',{name:'恢复默认',exact:true}).click();
  assert.deepEqual(await sizes(),defaults);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.reload();await page.locator('.choice-panel[data-pos]').waitFor();assert.deepEqual(await sizes(),defaults,'reset values also persist');
}

async function checkCompactPhases(page,model){
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    await checkActionControls(page,model);
    for(const option of model.options){
      await page.locator(`.action-option[data-key="${option.key}"]`).click();
      assert.equal(await page.locator('#action-description strong').textContent(),option.label);
      const box=await page.locator('#current-choice').boundingBox();
      assert.ok(box.height<500,'ordinary phase selector fits a phone screen');
    }
    const before=await page.locator('.action-option').first().boundingBox();
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.locator('#scale-cards').press('End');await page.locator('#scale-text').press('End');
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await checkActionControls(page,model);
    const after=await page.locator('.action-option').first().boundingBox();
    assert.equal(after.width,before.width,'card/text magnification must not turn phase icons into wide cards');
    await page.screenshot({path:path.join(root,`test-results/phases-${width}-scale2.png`),fullPage:true});
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('button',{name:'恢复默认',exact:true}).click();
    await page.getByRole('button',{name:'完成',exact:true}).click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-action="reset"]').click();
  assert.equal(await page.locator('.action-option[aria-pressed="true"]').count(),0);
  assert.equal(await page.locator('#action-description').getAttribute('data-key'),'');
  await page.locator('.action-option').first().click();
  await page.screenshot({path:path.join(root,'test-results/phases-mobile.png'),fullPage:true});
  await page.locator('[data-action="reset"]').click();
}
