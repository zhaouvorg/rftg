import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture,Peer,catalog,delay } from './helpers.mjs';
import { validateChoice } from '../shared/choices.mjs';
import { autoPlayerAnswer } from './auto-player.mjs';
import { makeAnswer,describeChoice } from '../shared/choices.mjs';
import { availableActions,designOf,paymentNeeded,handOf } from '../shared/rules.mjs';

async function completeGame(t,{expansion=0,mode=0,advanced=false,seed=41,arc1Mask=0,policy=null,required=[]}={}){
  const f=await fixture(seed);t.after(()=>f.close());
  const a=await new Peer(f.wsUrl).login('web_alice'),b=await new Peer(f.wsUrl).login('web_bob');
  a.send({action:'create',name:'Web acceptance',expansion,mode,minPlayers:2,maxPlayers:2,advanced,arc1Mask});
  await a.wait(s=>s.status==='room');const id=a.state.roomId;await b.wait(s=>s.rooms[id]);b.send({action:'join',id});
  await b.wait(s=>s.status==='room');await a.wait(s=>Object.keys(s.rooms[id].players).length===2);
  a.send({action:'start'});
  const types=new Set(),sent=[new Set(),new Set()];let moves=0,lastProgress=Date.now(),failure=null;
  const process=(peer,index)=>{
    const s=peer.state,q=s?.choice;if(!q||s.status!=='playing'||sent[index].has(`${q.pos}:${q.type}`))return;
    try{
      const answer=policy?.(s)||autoPlayerAnswer(s,catalog);assert.ok(answer,`No answer for ${JSON.stringify(q)}`);
      assert.equal(validateChoice(s,answer,catalog),null,JSON.stringify({q,answer}));
      sent[index].add(`${q.pos}:${q.type}`);types.add(q.type);moves++;lastProgress=Date.now();
      peer.send({action:'choice',...answer});
    }catch(error){failure=error;}
  };
  const end=Date.now()+120000;
  while(Date.now()<end){
    if(failure)throw failure;
    process(a,0);process(b,1);
    if(a.errors.length||b.errors.length)throw new Error([...a.errors,...b.errors].join('; '));
    if(a.state?.status==='finished'&&b.state?.status==='finished')break;
    if(Date.now()-lastProgress>15000)throw new Error(`Stalled ${JSON.stringify({a:a.state?.choice,b:b.state?.choice,waiting:a.state?.waiting,logs:a.state?.logs.slice(-8),log:(await readFile(f.log,'utf8')).slice(-4000)})}`);
    await delay(2);
  }
  assert.equal(a.state.status,'finished');
  assert.ok(!a.state.error,`${a.state.error}\n${(await readFile(f.log,'utf8')).slice(-4000)}`);
  assert.equal(Object.keys(a.state.results).length,2,JSON.stringify(a.state.logs.slice(-8)));
  assert.ok(moves>20);assert.ok(a.state.winners.length>=1);
  for(const type of required)assert.ok(types.has(type),`Expected choice type ${type}; saw ${[...types]}`);
  t.diagnostic(`expansion=${expansion} mode=${mode} advanced=${advanced}: ${moves} choices; types ${[...types].sort((a,b)=>a-b)}; round ${a.state.round}; scores ${JSON.stringify(a.state.results)}`);
  a.send({action:'finish'});await a.wait(s=>s.status==='lobby');
  return {types,moves};
}
test('two JavaScript clients complete a real base game', {timeout:150000}, t=>completeGame(t));
test('normal production server without debug seed completes a game', {timeout:150000}, t=>completeGame(t,{seed:null}));
test('advanced two-player game', {timeout:150000}, t=>completeGame(t,{advanced:true,seed:23}));
test('Alien Artifacts Orb game', {timeout:150000}, t=>completeGame(t,{expansion:4,mode:2,seed:17}));
test('Xeno Invasion game', {timeout:150000}, t=>completeGame(t,{expansion:5,mode:1,seed:71}));
test('XCS Frontier game', {timeout:150000}, t=>completeGame(t,{expansion:7,mode:3,seed:41}));
test('Counterstrike game', {timeout:150000}, t=>completeGame(t,{expansion:8,mode:4,seed:19}));
test('Brink of War exact Arc 1 selection', {timeout:150000}, t=>completeGame(t,{expansion:3,mode:0,arc1Mask:5,seed:29}));
function role(s,action){if(s.choice.type!==0||!availableActions(s).includes(action))return null;const r=makeAnswer(s,catalog,{list:s.meta.advanced?[2,action]:[action]});return !validateChoice(s,r,catalog)?r:null;}
function economy(s){
  const q=s.choice;
  if(q.type===1){const r=autoPlayerAnswer(s,catalog);r.special=[q.special.find(id=>designOf(s,id,catalog)?.goodType>1)??q.special[0]];return r;}
  if(q.type===0&&s.round>3){const action=({0:9,1:7,2:8})[s.round%5];if(action!==undefined)return role(s,action);}
  if(q.type===7&&q.args[0]===4){const m=describeChoice(s,catalog);return m.options.find(o=>o.response.special[0]===-20&&designOf(s,o.value,catalog)?.goodType>1&&paymentNeeded(s,catalog,o.value)>=0&&paymentNeeded(s,catalog,o.value)<=handOf(s).length-1)?.response;}
  return null;
}
test('trade, production and consume goods through real protocol', {timeout:150000},t=>completeGame(t,{seed:9,policy:economy,required:[12,13,15]}));
test('Frontier role, independent deck offers and confirmation', {timeout:150000},t=>completeGame(t,{expansion:7,mode:3,seed:31,policy:s=>s.round%3===1?role(s,12):null,required:[48,49,53]}));
test('Orb exploration moves survey teams and places cards', {timeout:150000},t=>completeGame(t,{expansion:4,mode:2,seed:12,policy:s=>{
  const q=s.choice,m=describeChoice(s,catalog);
  if(q.type===0&&s.round%3===1)return role(s,11);
  if(q.type===35)return m.options.find(o=>o.value===0)?.response||m.options.find(o=>o.value===1)?.response;
  if([36,38,41].includes(q.type))return m.options.find(o=>o.value>=0)?.response;
  return null;
},required:[35,36,38,39,40]}));
test('Invasion plus Frontier full game', {timeout:150000},t=>completeGame(t,{expansion:8,mode:5,seed:72,policy:s=>s.round%3===1?role(s,12):null,required:[48,49,53,30]}));
test('session resume preserves private state; invalid/stale choices are rejected', {timeout:30000},async t=>{
  const f=await fixture();t.after(()=>f.close());const a=await new Peer(f.wsUrl).login('resume_test');
  a.send({action:'create',name:'Reconnect',expansion:0,mode:0,minPlayers:2,maxPlayers:2});await a.wait(s=>s.status==='room');
  a.send({action:'addAI'});await a.wait(s=>Object.keys(s.rooms[s.roomId].players).length===2);a.send({action:'start'});await a.wait(s=>s.choice);
  const before=a.state,token=a.token;a.close();const b=await new Peer(f.wsUrl).open();b.send({action:'resume',token});await b.wait(s=>s?.choice);
  assert.deepEqual(b.state.choice,before.choice);assert.equal(b.state.user,'resume_test');
  const hidden=b.state.cards.filter(c=>c?.owner!==b.state.seat&&c?.where===2);assert.ok(hidden.length);assert.ok(hidden.every(c=>c.design===-1));
  b.send({action:'choice',pos:-1,type:before.choice.type,rv:0,list:[],special:[]});await delay(50);assert.equal(b.errors.length,1);assert.ok(b.state.choice);
});
test('JavaScript client plays a complete game with the existing server AI', {timeout:150000},async t=>{
  const f=await fixture(61);t.after(()=>f.close());const a=await new Peer(f.wsUrl).login('web_vs_server_ai');
  a.send({action:'create',name:'Mixed clients',expansion:0,mode:0,minPlayers:2,maxPlayers:2});await a.wait(s=>s.status==='room');
  a.send({action:'addAI'});await a.wait(s=>Object.keys(s.rooms[s.roomId].players).length===2);a.send({action:'start'});
  const seen=new Set(),types=new Set();const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const s=a.state;if(s?.status==='finished')break;
    if(s?.choice&&!seen.has(s.choice.pos)){const answer=autoPlayerAnswer(s,catalog);assert.ok(answer,JSON.stringify(s.choice));assert.equal(validateChoice(s,answer,catalog),null);seen.add(s.choice.pos);types.add(s.choice.type);a.send({action:'choice',...answer});}
    assert.deepEqual(a.errors,[]);await delay(10);
  }
  assert.equal(a.state.status,'finished');assert.ok(!a.state.error,`${a.state.error}\n${(await readFile(f.log,'utf8')).slice(-3000)}`);assert.equal(Object.keys(a.state.results).length,2);
  t.diagnostic(`Native server AI interoperability: ${seen.size} browser-side choices; types ${[...types].sort((a,b)=>a-b)}; ${JSON.stringify(a.state.results)}`);
});
test('upstream account reconnect restores a game after TCP disconnect', {timeout:20000},async t=>{
  const f=await fixture(2);t.after(()=>f.close());const a=await new Peer(f.wsUrl).login('tcp_restore');
  a.send({action:'create',name:'TCP restoration',expansion:0,mode:0,minPlayers:2,maxPlayers:2});await a.wait(s=>s.status==='room');
  a.send({action:'addAI'});await a.wait(s=>Object.keys(s.rooms[s.roomId].players).length===2);a.send({action:'start'});await a.wait(s=>s.choice);
  const pending=a.state.choice;a.send({action:'logout'});await delay(200);
  const b=await new Peer(f.wsUrl).open();b.send({action:'login',user:'tcp_restore',password:'testpw'});await b.wait(s=>s?.choice);
  assert.equal(b.state.choice.pos,pending.pos);assert.equal(b.state.choice.type,pending.type);assert.equal(b.state.players[b.state.seat].name,'tcp_restore');
});
