import test from 'node:test';
import assert from 'node:assert/strict';
import { frame,FrameDecoder,decodeMessage,Reader } from '../server/protocol.mjs';
import { newState,applyMessage,publicState } from '../server/state.mjs';
import { MSG } from '../shared/constants.mjs';
import { buildDeckDesigns } from '../shared/deck.mjs';
import { describeChoice,makeAnswer,validateChoice,automaticAnswer } from '../shared/choices.mjs';
import { paymentNeeded,goodsValid,actionsValid,availableActions } from '../shared/rules.mjs';
import { totalVp,xenoPermanentBonus,xenoDefense,xenoDefenseTotal,militaryVsXeno,liveXenoVp } from '../shared/scoring.mjs';
import { readFile } from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../public/data/cards.json',import.meta.url)));
const definition=(id,name,type,cost,flags=[],powers=[],goodType=0)=>({id,name,type,cost,flags,powers,goodType,vp:1});
const power=(phase,flags,value=1,times=1)=>({phase,flags,value,times});
const definitions=[
  definition(0,'Development target',2,4,[],[power(2,['REDUCE'],2)]),
  definition(1,'Research labs',2,2,[],[power(2,['REDUCE'],1)]),
  definition(2,'Military world',1,4,['MILITARY']),
  definition(3,'Military power',2,2,[],[power(3,['EXTRA_MILITARY'],4)]),
  definition(4,'Consume two different colors',2,2,[],[power(4,['CONSUME_TWO','CONSUME_RARE','CONSUME_GENE','GET_VP'])]),
  definition(5,'Rare world',1,2,[],[],3),definition(6,'Genes world',1,2,[],[],4),
  definition(7,'Wildcard world',1,2,[],[],1),definition(8,'Three different',2,2,[],[power(4,['CONSUME_3_DIFF'])]),
  definition(9,'Discard discount',2,1,[],[power(2,['DISCARD_REDUCE'],3)]),
  definition(10,'Contact Specialist',2,1,[],[power(3,['PAY_MILITARY'],1)]),
  definition(11,'Hand military',2,1,[],[power(3,['MILITARY_HAND'],3)])
];
function sample(q){const s=newState('test');s.status='playing';s.meta={expansion:0,advanced:0,mode:0,numPlayers:2};s.players=[{name:'test',actions:[3,-1],prestige:0},{name:'other',actions:[-1,-1]}];s.currentAction=3;s.round=1;s.choice={pos:10,type:0,list:[],special:[],args:[0,0,0],...q};s.cards=definitions.map((d,id)=>({id,design:id,owner:0,startOwner:0,where:2,startWhere:2,misc:1,numGoods:0,damaged:0}));return s;}
function active(s,id){s.cards[id].where=s.cards[id].startWhere=3;return s.cards[id];}

test('TCP framing handles every split boundary and multiple messages',()=>{
  const a=frame(MSG.LOGIN,'ab','pw','0.9.4','0.9.4');assert.equal(a.readInt32BE(4),26);assert.equal(a.subarray(8).toString(),['ab','pw','0.9.4','0.9.4',''].join('\0'));
  const b=frame(MSG.CHOOSE,42,5,-1,2,9,10,0);
  for(let split=0;split<a.length;split++){const decoder=new FrameDecoder();const values=[...decoder.push(a.subarray(0,split)),...decoder.push(Buffer.concat([a.subarray(split),b]))];assert.deepEqual(values,[a,b]);}
  const r=new Reader(b);assert.deepEqual(r.rest(),[42,5,-1,2,9,10,0]);
});
test('malformed upstream sizes and strings fail closed',()=>{
  for(const size of [-1,0,7,32769]){const b=Buffer.alloc(8);b.writeInt32BE(size,4);assert.throws(()=>new FrameDecoder().push(b));}
  const noTerminator=Buffer.alloc(12,1);noTerminator.writeInt32BE(MSG.DENIED,0);noTerminator.writeInt32BE(12,4);assert.throws(()=>decodeMessage(noTerminator));
  assert.throws(()=>frame(1,'bad\0name'));assert.throws(()=>frame(1,2**32));
});
test('choice wire order keeps pos, counts, args and repeated goods distinct',()=>{
  assert.deepEqual(decodeMessage(frame(MSG.CHOOSE,10,15,3,5,5,6,2,4,0,2,2,0)),{type:60,data:{pos:10,type:15,list:[5,5,6],special:[4,0],args:[2,2,0]}});
});
test('catalog physical indices reproduce nine decks and exact Arc 1 composition',()=>{
  assert.deepEqual(Array.from({length:9},(_,expansion)=>buildDeckDesigns(catalog,{expansion}).length),[114,136,180,228,160,165,158,146,197]);
  assert.equal(buildDeckDesigns(catalog,{expansion:2,arc1Mask:2}).length,158);
  assert.ok(buildDeckDesigns(catalog,{expansion:0,promo:1}).length>114);
});
test('public state hides opponent hands and keeps current public tableau',()=>{
  const s=sample();s.cards[0].owner=1;s.cards[0].misc=0;s.cards[1].owner=1;s.cards[1].where=3;s.cards[1].misc=0;
  const visible=publicState(s);assert.equal(visible.cards[0].design,-1);assert.equal(visible.cards[1].design,1);assert.equal(visible.cards[2].design,2);assert.equal(s.cards[0].design,0);
});
test('metadata refresh from another player reconnect preserves outstanding choice',()=>{
  const s=sample(),q=s.choice;applyMessage(s,{type:40,data:{numPlayers:2,expansion:0,names:['test','other'],ai:[0,0],goals:Array(20).fill(0),mode:0}},catalog);assert.equal(s.choice,q);
});
test('start selection rejects duplicated discards and forged worlds',()=>{
  const s=sample({type:1,list:[0,1,5,6],special:[2,3]});
  const r=makeAnswer(s,definitions,{list:[0,1],special:[2]});assert.equal(validateChoice(s,r,definitions),null);
  assert.ok(validateChoice(s,{...r,list:[0,0]},definitions));assert.ok(validateChoice(s,{...r,special:[99]},definitions));
});
test('phase-start powers: new development cannot discount itself',()=>{
  const s=sample({type:6,list:[5,6,7],special:[],args:[0,0,0]});active(s,1);s.cards[0].where=3;s.cards[0].misc|=64;
  assert.equal(paymentNeeded(s,definitions,0),2);
  s.cards[1].damaged=1;assert.equal(paymentNeeded(s,definitions,0),3);
  s.cards[1].damaged=0;s.cards[1].misc|=1<<8;assert.equal(paymentNeeded(s,definitions,0),3);
});
test('develop selected discount sources require exact payment',()=>{
  const s=sample({type:6,list:[5,6,7],special:[9],args:[0,0,0]});active(s,9);
  assert.equal(paymentNeeded(s,definitions,0,[9]),0);
  const r=makeAnswer(s,definitions,{list:[],special:[9]});assert.equal(validateChoice(s,r,definitions),null);
  assert.ok(validateChoice(s,{...r,list:[5]},definitions));
});
test('Settle direct payment sentinel and already-paid confirmation',()=>{
  const s=sample({type:7,args:[1,2,0]});active(s,3);s.currentAction=5;s.cards[2].where=3;s.cards[2].misc|=64;
  assert.equal(paymentNeeded(s,definitions,2),0);
  const r=makeAnswer(s,definitions,{list:[]});assert.deepEqual(r,{pos:10,type:7,rv:0,list:[-99],special:[-99]});assert.equal(validateChoice(s,r,definitions),null);
  s.cards[2].misc|=1<<17;const paid=makeAnswer(s,definitions,{list:[]});assert.deepEqual(paid.list,[]);assert.deepEqual(paid.special,[]);assert.ok(validateChoice(s,r,definitions));
});
test('military cannot be paid with arbitrary hand cards',()=>{
  const s=sample({type:6,list:[0,5,6],special:[10,11],args:[2,0,0]});s.currentAction=5;active(s,10);active(s,11);
  assert.equal(paymentNeeded(s,definitions,2),-1);assert.equal(paymentNeeded(s,definitions,2,[10]),3);
  assert.equal(paymentNeeded(s,definitions,2,[10,11]),-1);
});
test('goods validate colors, multiplicity and wildcard distinctness',()=>{
  const s=sample({type:15,list:[5,5,6,7,7],special:[4,0],args:[2,2,0]});
  assert.equal(goodsValid(s,definitions,s.choice,[5,6]),true);assert.equal(goodsValid(s,definitions,s.choice,[5,5]),false);assert.equal(goodsValid(s,definitions,s.choice,[5,7]),true);
  s.choice.special=[8,0];s.choice.args=[3,3,0];assert.equal(goodsValid(s,definitions,s.choice,[5,7,7]),false);assert.equal(goodsValid(s,definitions,s.choice,[5,6,7]),true);
});
test('paired power choices cannot mix unrelated sources and power slots',()=>{
  const s=sample({type:13,list:[4,8],special:[0,2],args:[0,0,0]});const r=makeAnswer(s,definitions,{option:'0'});assert.deepEqual(r.list,[4]);assert.deepEqual(r.special,[0]);assert.equal(validateChoice(s,r,definitions),null);assert.ok(validateChoice(s,{...r,special:[2]},definitions));
});
test('defense and Orb military responses retain full lists and use one-based index',()=>{
  for(const type of [30,44]){const s=sample({type,list:[3,11],special:[0,0]});const r=makeAnswer(s,definitions,{option:'1'});assert.equal(r.rv,2);assert.deepEqual(r.list,[3,11]);assert.deepEqual(r.special,[0,0]);assert.equal(validateChoice(s,r,definitions),null);}
});
test('Frontier local ids, offer tags, route echoes and confirmation encode separately',()=>{
  let s=sample({type:48,list:[1,2],special:[77],args:[0,9,77]});let r=makeAnswer(s,catalog,{option:'0'});assert.deepEqual(r,{pos:10,type:48,rv:2,list:[1],special:[77]});assert.ok(describeChoice(s,catalog).options[0].image);
  s.choice={pos:11,type:49,list:[0,1],special:[],args:[9,0,0]};r=makeAnswer(s,catalog,{option:'1'});assert.deepEqual(r.special,[9]);
  s.choice={pos:12,type:51,list:[1,4],special:[],args:[9,5,0]};r=makeAnswer(s,catalog,{option:'1'});assert.deepEqual(r.special,[9,5]);assert.deepEqual(r.list,[4]);
});
test('conquest decision exposes the independent System design and gates attempts',()=>{
  const s=sample({type:52,list:[],special:[],args:[0,1,12]});const m=describeChoice(s,catalog);
  assert.equal(catalog[m.targetDesign].xcs.category,'system');assert.equal(catalog[m.targetDesign].xcs.localId,0);
  assert.equal(makeAnswer(s,catalog,{option:'0'}).rv,1);
  s.choice.args[1]=0;assert.deepEqual(describeChoice(s,catalog).options.map(o=>o.value),[0]);
});
test('advanced action restrictions and prestige resources',()=>{
  const s=sample();s.meta.advanced=1;assert.equal(actionsValid(s,[3,4]),true);assert.equal(actionsValid(s,[2,4]),false);assert.equal(actionsValid(s,[2,2]),false);assert.equal(actionsValid(s,[9,2]),false);
  s.meta.expansion=3;s.players[0].prestige=1;assert.equal(actionsValid(s,[2,3|128]),true);assert.equal(actionsValid(s,[2|128,3|128]),false);assert.equal(actionsValid(s,[0,3|128]),false);
});
test('authoritative final score parsing supports ties and never treats VP chips as total',()=>{
  const s=sample();applyMessage(s,{type:45,data:{text:'test ends with 42 VPs.\n'}},definitions);applyMessage(s,{type:45,data:{text:'test wins with 42 VPs and 8 as tie breaker.\n'}},definitions);applyMessage(s,{type:70,data:{values:[]}},definitions);assert.equal(s.results.test,42);assert.deepEqual(s.winners,['test']);assert.equal(s.status,'finished');
});

test('current score includes chips, printed VP, goals and prestige',()=>{
  const s=sample();s.players[0].vp=4;s.players[0].prestige=2;s.players[0].goals=Array(20).fill(0);s.players[0].progress=Array(20).fill(0);
  s.players[0].goals[0]=1;s.players[0].goals[12]=1;s.players[0].progress[12]=6;
  s.goals=Array.from({length:20},(_,i)=>({active:i===0||i===12,available:false,most:i===12?6:0}));
  const scoreCatalog=[{id:0,name:'Scoring world',type:1,cost:2,flags:[],powers:[],vp:2,bonuses:[]}];
  s.cards=[{id:0,design:0,owner:0,startOwner:0,where:3,startWhere:3,misc:0,numGoods:0,damaged:0}];
  assert.equal(totalVp(s,scoreCatalog,0),4+2+3+5+2);
});

test('a scored card uses only its highest matching VP clause',()=>{
  const s=sample();s.players[0].vp=0;s.players[0].goals=Array(20).fill(0);s.players[0].progress=Array(20).fill(0);s.goals=[];
  const scoreCatalog=[
    {id:0,name:'Six-cost league',type:2,cost:6,flags:[],vp:1,powers:[],bonuses:[{kind:'DEVEL',value:1,name:'N/A'},{kind:'SIX_DEVEL',value:2,name:'N/A'}]},
    {id:1,name:'Six-cost lab',type:2,cost:6,flags:[],vp:1,powers:[],bonuses:[]}
  ];
  s.cards=[0,1].map(id=>({id,design:id,owner:0,startOwner:0,where:3,startWhere:3,misc:0,numGoods:0,damaged:0}));
  assert.equal(totalVp(s,scoreCatalog,0),6,'two printed VP plus +2 for each six-cost development');
});

test('permanent Xeno defense excludes paid and temporary powers',()=>{
  const s=sample();s.players[0].bonusMilitaryXeno=10;
  const xenoCatalog=[
    {id:0,name:'Base military',type:2,cost:1,flags:[],vp:0,powers:[power(3,['EXTRA_MILITARY'],3)],bonuses:[]},
    {id:1,name:'Permanent Xeno military',type:1,cost:1,flags:['MILITARY','XENO'],vp:0,powers:[power(3,['EXTRA_MILITARY','XENO'],2)],bonuses:[]},
    {id:2,name:'Permanent Xeno defense',type:1,cost:1,flags:['ANTI_XENO'],vp:0,powers:[power(3,['XENO_DEFENSE'],1)],bonuses:[]},
    {id:3,name:'Paid Xeno military',type:1,cost:1,flags:['MILITARY','XENO'],vp:0,powers:[power(3,['EXTRA_MILITARY','XENO','DISCARD_HAND'],4)],bonuses:[]},
    {id:4,name:'Paid Xeno defense',type:1,cost:1,flags:['ANTI_XENO'],vp:0,powers:[power(3,['XENO_DEFENSE','DISCARD_HAND'],5)],bonuses:[]}
  ];
  s.cards=xenoCatalog.map((_,id)=>({id,design:id,owner:0,startOwner:0,where:3,startWhere:3,misc:0,numGoods:0,damaged:0}));
  assert.equal(xenoPermanentBonus(s,xenoCatalog,0),2);
  assert.equal(xenoDefense(s,xenoCatalog,0),1);
  assert.equal(militaryVsXeno(s,xenoCatalog,0),5);
  assert.equal(xenoDefenseTotal(s,xenoCatalog,0),6);
});

test('Xeno per-peaceful strength uses the started tableau',()=>{
  const s=sample();
  const xenoCatalog=[
    {id:0,name:'Peaceful home',type:1,cost:1,flags:['PEACEFUL'],vp:0,powers:[],bonuses:[]},
    {id:1,name:'Peaceful lost',type:1,cost:1,flags:['PEACEFUL'],vp:0,powers:[],bonuses:[]},
    {id:2,name:'Captured peaceful',type:1,cost:1,flags:['PEACEFUL'],vp:0,powers:[],bonuses:[]},
    {id:3,name:'Anti-Xeno League',type:2,cost:1,flags:[],vp:0,powers:[power(3,['EXTRA_MILITARY','XENO','PER_PEACEFUL'],1)],bonuses:[]}
  ];
  s.cards=[
    {id:0,design:0,owner:0,startOwner:0,where:3,startWhere:3,misc:0,damaged:0},
    {id:1,design:1,owner:1,startOwner:0,where:3,startWhere:3,misc:0,damaged:0},
    {id:2,design:2,owner:0,startOwner:1,where:3,startWhere:3,misc:0,damaged:0},
    {id:3,design:3,owner:0,startOwner:0,where:3,startWhere:3,misc:0,damaged:0}
  ];
  assert.equal(xenoPermanentBonus(s,xenoCatalog,0),2);
});

test('an Oort owner scores any-good VP clauses with the best legal kind',()=>{
  const s=sample();s.players[0].vp=0;
  const oortCatalog=[
    {id:0,name:'Oort Cloud',type:1,cost:1,flags:['WINDFALL'],vp:0,powers:[],goodType:1,bonuses:[]},
    {id:1,name:'Novelty collector',type:2,cost:1,flags:[],vp:0,powers:[],bonuses:[{kind:'NOVELTY_WINDFALL',value:3,name:'N/A'}]}
  ];
  s.cards=[
    {id:0,design:0,owner:0,startOwner:0,where:3,startWhere:3,misc:0,damaged:0},
    {id:1,design:1,owner:0,startOwner:0,where:3,startWhere:3,misc:0,damaged:0}
  ];
  assert.equal(totalVp(s,oortCatalog,0),3);
});

test('live Xeno scoreboard awards defense chips and both current 5-VP leaders',()=>{
  const s=sample();s.meta={expansion:5,mode:1,numPlayers:2,advanced:0};s.players[0].vp=s.players[1].vp=0;s.players[0].goals=s.players[1].goals=Array(20).fill(0);s.players[0].progress=s.players[1].progress=Array(20).fill(0);s.goals=[];
  const xenoCatalog=[
    {id:0,name:'Admiral',type:1,cost:1,flags:['MILITARY','XENO'],vp:0,powers:[power(3,['EXTRA_MILITARY','XENO'],2)],bonuses:[]},
    {id:1,name:'Other world',type:1,cost:1,flags:['PEACEFUL'],vp:0,powers:[],bonuses:[]}
  ];
  s.cards=[{id:0,design:0,owner:0,startOwner:0,where:3,startWhere:3,misc:0,numGoods:0,damaged:0},{id:1,design:1,owner:1,startOwner:1,where:3,startWhere:3,misc:0,numGoods:0,damaged:0}];
  s.invasion={initialized:1,empireDefeats:0,players:[{awards:3,contribution:5},{awards:1,contribution:7}]};
  assert.equal(liveXenoVp(s,xenoCatalog,0),8);
  assert.equal(liveXenoVp(s,xenoCatalog,1),6);
  assert.equal(totalVp(s,xenoCatalog,0),8);
  assert.equal(totalVp(s,xenoCatalog,1),6);
});


test('PC stage normalization, SELECT_LAST and Frontier reveal order',()=>{
  const s=sample();s.meta.advanced=1;
  for(const [selected,expected]of [[[2,4],[2,3]],[[2,6],[2,5]],[[3,4],[3,4]],[[5,6],[5,6]]]){
    const a=makeAnswer(s,definitions,{list:selected});assert.deepEqual(a.list,expected);assert.equal(validateChoice(s,a,definitions),null);
  }
  s.choice.args[0]=2;s.players[0].actions=[5,-1];
  let a=makeAnswer(s,definitions,{list:[2]});assert.deepEqual(a.list,[2,5]);assert.equal(validateChoice(s,a,definitions),null);
  s.meta.expansion=8;s.meta.mode=4;s.meta.numPlayers=2;
  s.xcs={mode:2,players:2,stage:1,advanced:1,lastFrontierRound:[-1,-1],frontierPhaseArmed:0,flow:{stage:0}};
  s.players[0].actions=[12,-1];a=makeAnswer(s,definitions,{list:[6]});assert.deepEqual(a.list,[12,5]);assert.equal(validateChoice(s,a,definitions),null);
  s.choice.args[0]=0;
  for(const [base,expected]of [[5,[12,5]],[6,[5,12]]])assert.deepEqual(makeAnswer(s,definitions,{list:base===5?[12,6]:[5,12],frontierBase:base}).list,expected);
});
test('Frontier cooldown, Orb setup and Xeno war role gates match PC',()=>{
  const s=sample();s.meta={expansion:8,mode:4,numPlayers:2,advanced:0};s.round=5;
  s.xcs={mode:2,players:2,stage:1,lastFrontierRound:[3,-1],frontierPhaseArmed:0,flow:{stage:0}};
  assert.ok(availableActions(s).includes(12));assert.ok(!availableActions(s).includes(10));
  s.invasion={initialized:1};assert.ok(availableActions(s).includes(10));s.xcs.stage=2;assert.ok(availableActions(s).includes(10));
  for(const advanced of [0,1])for(const last of [3,4,5]){s.meta.advanced=advanced;s.xcs.lastFrontierRound[0]=last;assert.equal(availableActions(s).includes(12),last!==5&&(advanced===1||last!==4));}
  s.xcs.lastFrontierRound[0]=3;s.xcs.frontierPhaseArmed=1;assert.ok(!availableActions(s).includes(12));
  s.meta={expansion:4,mode:2,numPlayers:2};s.orb={initialized:1,setupReady:1,priorityCount:2,openingPos:0};assert.ok(!availableActions(s).includes(11));s.orb.openingPos=-1;assert.ok(availableActions(s).includes(11));
});
test('Counterstrike retaliation may pass; only pending conquest payment requires enough military',()=>{
  const s=sample({type:30,list:[-1001],special:[0],args:[4,7,3]});s.meta.expansion=8;s.meta.mode=4;s.xcs={stage:2,conquestPending:[-1,-1]};
  assert.ok(describeChoice(s,definitions).pass);assert.match(describeChoice(s,definitions).options[0].label,/掩体/);
  s.xcs.conquestPending[0]=2;assert.equal(describeChoice(s,definitions).pass,null);s.choice.args[0]=0;assert.ok(describeChoice(s,definitions).pass);
});
test('Produce preserves native output-buffer tails and distinguishes Continue from Done',()=>{
  const s=sample({type:20,list:[1,3,-1003],special:[2,0,0]});
  let m=describeChoice(s,definitions);assert.deepEqual(m.options[1].response.list,[3,3,-1003]);assert.deepEqual(m.options[1].response.special,[0,0,0]);assert.equal(m.options[2].label,'继续生产');
  s.choice.special[2]=1;assert.equal(describeChoice(s,definitions).options[2].label,'完成生产');
});

test('only an already committed defense is acknowledged without another click',()=>{
  const s=sample({type:34,args:[5,7,3]});assert.deepEqual(automaticAnswer(s),{pos:10,type:34,rv:2,list:[],special:[]});
  s.choice.args[2]=1;assert.equal(automaticAnswer(s),null);s.choice.type=54;s.choice.args[2]=3;assert.equal(automaticAnswer(s),null);
});
