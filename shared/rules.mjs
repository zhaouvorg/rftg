// Client-side presentation and payment checks; authoritative turns stay in rftgserver.
export const has=(x,flag)=>!!x?.flags?.includes(flag);
export const designOf=(s,id,catalog)=>catalog[s.cards[id]?.design];
export const handOf=s=>s.cards.filter(c=>c&&c.owner===s.seat&&c.where===2);
export const tableau=(s,who=s.seat)=>s.cards.filter(c=>c&&c.owner===who&&c.where===3);
export function powers(s,catalog,phase,who=s.seat) {
  return s.cards.flatMap(c=>{
    if(!c||c.startOwner!==who||c.startWhere!==3||c.damaged)return [];
    return (designOf(s,c.id,catalog)?.powers||[]).flatMap((p,i)=>p.phase===phase&&!(c.misc&(i===5?1<<16:1<<(8+i)))&&!(phase===3&&has(p,'DISCARD')&&c.where!==3)?[{...p,card:c.id,index:i}]:[]);
  });
}
function count(s,catalog,predicate,who=s.seat){return s.cards.filter(c=>c&&c.startOwner===who&&c.startWhere===3&&!c.damaged&&predicate(designOf(s,c.id,catalog))).length;}
function amount(s,catalog,p,who=s.seat){
  if(has(p,'PER_NONMIL_PAIR'))return p.value*Math.floor(count(s,catalog,d=>d?.type===1&&!has(d,'MILITARY'),who)/2);
  if(has(p,'PER_FRONTIER'))return p.value*count(s,catalog,d=>has(d,'NEAR_FRONTIER')||has(d,'FAR_FRONTIER'),who);
  for(const [flag,needed] of [['PER_CHROMO',['CHROMO']],['PER_IMPERIUM',['IMPERIUM']],['PER_REBEL_MILITARY',['REBEL','MILITARY']]])if(has(p,flag))return p.value*count(s,catalog,d=>needed.every(f=>has(d,f)),who);
  return p.value;
}
export function military(s,catalog,who=s.seat){
  let strength=0;
  for(const p of powers(s,catalog,3,who)){
    if(!has(p,'EXTRA_MILITARY'))continue;
    if(p.flags.length===1)strength+=p.value;
    else if(p.flags.length===2){
      if(['PER_FRONTIER','PER_NONMIL_PAIR'].some(f=>has(p,f)))strength+=amount(s,catalog,p,who);
      for(const [a,b] of [['PER_MILITARY','MILITARY'],['PER_CHROMO','CHROMO'],['PER_IMPERIUM','IMPERIUM']])if(has(p,a))strength+=count(s,catalog,d=>has(d,b),who);
      if(has(p,'PER_REBEL_MILITARY'))strength+=count(s,catalog,d=>has(d,'REBEL')&&has(d,'MILITARY'),who);
      if(has(p,'IF_IMPERIUM')&&count(s,catalog,d=>has(d,'IMPERIUM'),who))strength+=p.value;
    }
  }
  return strength;
}
function chose(s,role,prestige=false){return s.players[s.seat]?.actions.some(a=>prestige?a===(role|128):(a&127)===role&&a>=0);}
function matchesGood(p,good,prefix=''){return !['NOVELTY','RARE','GENE','ALIEN'].some((f,i)=>has(p,prefix+f)&&good!==i+2);}
function goods(s,catalog,color){return tableau(s).reduce((n,c)=>{const good=designOf(s,c.id,catalog)?.goodType;return n+(good===color||good===1?c.numGoods:0);},0);}
export function paymentNeeded(s,catalog,target,special=[],milOnly=0,milBonus=0){
  const d=designOf(s,target,catalog),card=s.cards[target],p=s.players[s.seat];if(!d||!p)return -1;
  if(card.misc&(1<<17))return 0;
  if(d.type===2){
    let reduction=(chose(s,s.currentAction)?1:0)+(chose(s,s.currentAction,true)?2:0)+(p.artifactDevelopReduce||0);
    for(const power of powers(s,catalog,2))if(has(power,'REDUCE'))reduction+=has(power,'PER_NONMIL_PAIR')?power.value*Math.floor(tableau(s).filter(c=>!c.damaged&&designOf(s,c.id,catalog)?.type===1&&!has(designOf(s,c.id,catalog),'MILITARY')).length/2):power.value;
    const needs={3:0,5:0};
    for(const id of special){const source=s.cards[id];if(!source||source.damaged||source.owner!==s.seat||source.where!==3)return -1;
      for(const power of designOf(s,id,catalog).powers.filter(x=>x.phase===2)){
        if(has(power,'DISCARD_REDUCE')||has(power,'CONSUME_RARE')||has(power,'CONSUME_ALIEN'))reduction+=power.value;
        if(has(power,'CONSUME_RARE'))needs[3]++;if(has(power,'CONSUME_ALIEN'))needs[5]++;
      }
    }
    const wild=goods(s,catalog,1);
    if(needs[3]>goods(s,catalog,3)||needs[5]>goods(s,catalog,5)||needs[3]+needs[5]>goods(s,catalog,3)+goods(s,catalog,5)-wild)return -1;
    return Math.max(0,d.cost-reduction);
  }
  const takeover=card.owner!==s.seat;
  let cost=d.cost-(p.bonusReduce||0)-(p.artifactSettleReduce||0),strength=military(s,catalog)+(p.bonusMilitary||0)+milBonus;
  if(d.goodType===4)strength+=p.artifactGeneMilitary||0;if(has(d,'XENO'))strength+=p.bonusMilitaryXeno||0;
  let conquer=has(d,'MILITARY'),pay=false,conquerPeace=false,zero=false,hand=0,consumeReduce=0,consumeMilitary=0;
  const needs={2:0,3:0,4:0,5:0};
  for(const id of special){const source=s.cards[id];if(!source||source.damaged||source.owner!==s.seat||source.where!==3)return -1;
    for(const power of designOf(s,id,catalog).powers.filter(x=>x.phase===3)){
      if(has(power,'PAY_MILITARY')){
        if(!conquer||takeover||pay||has(d,'XENO')||has(power,'ALIEN')!==(d.goodType===5)||has(power,'AGAINST_CHROMO')&&!has(d,'CHROMO')||has(power,'AGAINST_REBEL')&&!has(d,'REBEL'))return -1;
        pay=true;cost=Math.max(0,cost-power.value);
      }
      if(has(power,'DISCARD')){
        if(has(power,'REDUCE_ZERO')){zero=true;if(d.goodType!==5)cost=0;}
        if(has(power,'EXTRA_MILITARY'))strength+=power.value;
        if(has(power,'CONQUER_SETTLE')){strength+=power.value;conquer=true;conquerPeace=true;}
        break;
      }
      if(has(power,'MILITARY_HAND'))hand+=power.value;
      if(has(power,'CONSUME_GENE')){consumeReduce++;cost=Math.max(0,cost-power.value);needs[4]++;}
      for(const [flag,color] of [['CONSUME_NOVELTY',2],['CONSUME_RARE',3],['CONSUME_ALIEN',5]])if(has(power,flag)){
        consumeMilitary++;if(!has(power,'XENO')||has(d,'XENO'))strength+=power.value;needs[color]++;
      }
      if(has(power,'CONSUME_PRESTIGE')){if(!p.prestige)return -1;strength+=power.value;}
    }
  }
  if(hand&&(pay||!conquer)||milOnly&&!conquer||conquerPeace&&pay||zero&&conquer&&!pay)return -1;
  for(const color of [2,3,4,5])if(needs[color]>goods(s,catalog,color))return -1;
  if(chose(s,s.currentAction,true))cost-=3;
  for(const power of powers(s,catalog,3)){
    if(has(power,'REDUCE')&&!(has(power,'ONLY_NONMILITARY')&&has(d,'MILITARY'))&&(!has(power,'IF_FRONTIER')||has(d,'NEAR_FRONTIER')||has(d,'FAR_FRONTIER'))&&matchesGood(power,d.goodType)&&!has(power,'CONSUME_GENE'))cost-=power.value;
    if(has(power,'EXTRA_MILITARY')){
      if(!['NOVELTY','RARE','GENE','ALIEN','DISCARD','AGAINST_REBEL','CONSUME_NOVELTY','CONSUME_RARE','CONSUME_ALIEN','CONSUME_PRESTIGE','XENO'].some(f=>has(power,f)))continue;
      if(['CONSUME_NOVELTY','CONSUME_RARE','CONSUME_ALIEN','CONSUME_PRESTIGE','DISCARD'].some(f=>has(power,f)))continue;
      if(!matchesGood(power,d.goodType)||has(power,'AGAINST_REBEL')&&!has(d,'REBEL')||has(power,'XENO')&&!has(d,'XENO'))continue;
      strength+=has(power,'PER_PEACEFUL')?count(s,catalog,d=>has(d,'PEACEFUL')):amount(s,catalog,power);
    }else if(pay&&has(power,'PAY_DISCOUNT'))cost-=power.value;
  }
  if(!takeover&&conquer&&!pay&&strength+hand<d.cost)return -1;
  if(conquer&&!pay&&consumeReduce||consumeReduce&&consumeMilitary)return -1;
  return !conquer||pay?Math.max(0,cost):takeover?0:Math.max(0,d.cost-strength);
}
export function goodsValid(s,catalog,q,selected){
  if(selected.length<q.args[0]||selected.length>q.args[1])return false;
  const power=designOf(s,q.special[0],catalog)?.powers[q.special[1]];
  if(!power)return true;
  const colors=selected.map(id=>id>=328?5:designOf(s,id,catalog)?.goodType||0),wild=colors.filter(c=>c===1).length;
  if(power.phase!==4)return power.phase!==2||!(has(power,'CONSUME_RARE')||has(power,'CONSUME_ALIEN'))||colors.length===1&&(colors[0]===1||colors[0]===(has(power,'CONSUME_ALIEN')?5:3));
  const types=new Set(colors);
  if(has(power,'CONSUME_3_DIFF')&&selected.length!==0&&(selected.length!==3||types.size!==3))return false;
  if(has(power,'CONSUME_N_DIFF')&&types.size!==selected.length)return false;
  if(has(power,'CONSUME_TWO')&&selected.length!==2)return false;
  if(!['CONSUME_TWO','CONSUME_3_DIFF','CONSUME_N_DIFF','CONSUME_ALL'].some(f=>has(power,f))&&selected.length>power.times)return false;
  const allowed=[2,3,4,5].filter((n,i)=>has(power,'CONSUME_'+['NOVELTY','RARE','GENE','ALIEN'][i]));
  if(has(power,'CONSUME_TWO')&&allowed.length>1){if(allowed.filter(c=>!colors.includes(c)).length>wild)return false;}
  else if(allowed.length&&!has(power,'CONSUME_ANY')&&colors.some(c=>c!==1&&!allowed.includes(c)))return false;
  return true;
}
export function availableActions(s){
  const m=s.meta||{},p=s.players[s.seat]||{},q=s.choice,first=m.advanced&&q?.args[0]===2?p.actions?.[0]:-1;
  const result=[1,2,3,5,7,8,9];
  if(m.advanced)result.push(4,6);
  if(m.expansion===3&&!p.prestigeActionUsed&&!(first>=0&&(first&128)))result.push(0);
  if(s.invasion?.initialized&&([5,8].includes(m.expansion)&&m.mode===1||m.expansion===8&&(m.mode===5&&s.xcs?.mode===1||m.mode===4&&s.xcs?.mode===2&&(s.xcs.stage===1||s.xcs.stage===2&&s.xcs.players===m.numPlayers))))result.push(10);
  if(m.expansion===4&&m.mode===2&&s.orb?.initialized&&s.orb.setupReady&&s.orb.priorityCount===m.numPlayers&&s.orb.openingPos<0)result.push(11);
  const last=s.xcs?.lastFrontierRound[s.seat];
  if([7,8].includes(m.expansion)&&[3,4,5].includes(m.mode)&&s.round>=1&&s.status!=='finished'&&s.xcs&&s.xcs.players===m.numPlayers&&s.xcs.mode===(m.mode===4?2:1)&&!s.xcs.frontierPhaseArmed&&s.xcs.flow.stage===0&&last!==s.round&&(m.advanced||last!==s.round-1))result.push(12);
  if(m.expansion===3&&!p.prestigeActionUsed&&p.prestige>0&&first!==0&&!(first>=0&&(first&128)))result.push(...result.filter(a=>a!==0).map(a=>a|128));
  return result.filter(a=>first<0||(a&127)!==(first&127)).sort((a,b)=>(a&127)-(b&127)||a-b);
}
// gui_choose_action emits sorted roles, except the advanced Frontier/Settle
// pair whose order follows the left/right Settle buttons (or SELECT_LAST).
export function normalizeActions(s,selected,frontierBase){
  const q=s.choice,values=[...selected],first=q.args[0]===2&&s.meta.advanced?s.players[s.seat].actions[0]:-1;
  if(first>=0&&!values.includes(first))values.unshift(first);
  const pair=values.includes(12)&&values.some(a=>a===5||a===6);
  if(pair){
    if(first>=0)return first===12?[12,5]:[5,12];
    if(frontierBase===5)return [12,5];
    if(frontierBase===6)return [5,12];
    return values.map(a=>a===6?5:a);
  }
  values.sort((a,b)=>(a&127)-(b&127));
  for(let i=0;i<values.length;i++){
    const raw=values[i]&127;
    if(raw===4&&!values.some(a=>(a&127)===3))values[i]=3|(values[i]&128);
    if(raw===6&&!values.some(a=>(a&127)===5))values[i]=5|(values[i]&128);
  }
  return [values[0]??-1,values[1]??-1];
}
export function actionsValid(s,actions){
  const q=s.choice,allowed=availableActions(s),first=q.args[0]===2&&s.meta.advanced?s.players[s.seat].actions[0]:-1;
  const active=actions.filter(a=>a>=0),n=s.meta.advanced&&q.args[0]!==1?2:1;
  if(actions.length!==2||active.length!==n||new Set(active.map(a=>a&127)).size!==n||active.some(a=>!allowed.includes(a)&&a!==first))return false;
  if(first>=0&&!active.includes(first))return false;
  if(n===2&&(actions[0]&127)>=(actions[1]&127)&&!(actions[0]===12&&actions[1]===5&&[3,4,5].includes(s.meta.mode)))return false;
  if(first>=0&&active.includes(12)&&active.includes(5)&&actions[0]!==first)return false;
  if(active.filter(a=>a&128).length>1||active.includes(0)&&active.some(a=>a&128))return false;
  if(active.some(a=>(a&127)===4)&&!active.some(a=>(a&127)===3))return false;
  if(active.some(a=>(a&127)===6)&&!active.some(a=>(a&127)===5))return false;
  return true;
}
export function defendValid(s,catalog,list,special,deficit){
  if(!list.length&&!special.length)return true;
  let strength=list.length,capacity=0,prestige=0;const required={3:0,5:0};
  for(const id of special)for(const p of designOf(s,id,catalog)?.powers||[]){
    if(p.phase!==3)continue;
    if(p.flags.length===2&&has(p,'DISCARD')&&has(p,'EXTRA_MILITARY'))strength+=p.value;
    if(has(p,'MILITARY_HAND'))capacity+=p.value;
    if(has(p,'CONSUME_RARE')){strength+=p.value;required[3]++;}
    if(has(p,'CONSUME_ALIEN')){strength+=p.value;required[5]++;}
    if(has(p,'CONSUME_PRESTIGE')){strength+=p.value;prestige++;}
  }
  return list.length<=capacity&&prestige<=s.players[s.seat].prestige&&required[3]<=goods(s,catalog,3)&&required[5]<=goods(s,catalog,5)&&strength>deficit;
}
export function takeoverValid(s,catalog,target,source){
  const world=designOf(s,target,catalog),owner=s.cards[target]?.owner;
  return owner>=0&&owner!==s.seat&&powers(s,catalog,3).some(p=>p.card===source&&(
    has(p,'TAKEOVER_REBEL')&&has(world,'REBEL')||has(p,'TAKEOVER_IMPERIUM')&&count(s,catalog,d=>has(d,'IMPERIUM'),owner)>0||
    has(p,'TAKEOVER_MILITARY')&&military(s,catalog,owner)>0||has(p,'TAKEOVER_PRESTIGE')&&s.players[s.seat].prestige>0));
}
export function powerText(p){
  if(!p)return '特殊能力';
  const names={DRAW:'抽牌',KEEP:'保留',REDUCE:'减费',DRAW_AFTER:'完成后抽牌',DISCARD_REDUCE:'弃此牌减费',MILITARY_HAND:'手牌转军力',EXTRA_MILITARY:'军力',PAY_MILITARY:'支付殖民军事世界',CONQUER_SETTLE:'征服和平世界',CONSUME_ANY:'消费任意货物',CONSUME_TWO:'消费两件',CONSUME_3_DIFF:'三种不同货物',CONSUME_N_DIFF:'不同种类货物',GET_VP:'获得胜利点',GET_CARD:'抽牌',GET_2_CARD:'抽两牌',GET_3_CARD:'抽三牌',PRODUCE:'生产',WINDFALL_ANY:'生产横置货物',DISCARD:'弃此牌',CONSUME_RARE:'消耗稀有货物',CONSUME_GENE:'消耗基因货物',CONSUME_ALIEN:'消耗异星货物',CONSUME_NOVELTY:'消耗新奇货物',XENO:'对抗异星',PRESTIGE:'威望',PER_FRONTIER:'每个边境世界',PER_NONMIL_PAIR:'每对和平世界'};
  return p.flags.map(f=>names[f]||f.toLowerCase().replaceAll('_',' ')).join(' · ')+(p.value?` ${p.value}`:'')+(p.times>1?` ×${p.times}`:'');
}
