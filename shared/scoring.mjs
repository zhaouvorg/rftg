import { ARTIFACT_TOKENS } from './artifacts.mjs';
import { designOf,has,military,powers,tableau } from './rules.mjs';

const GOAL_MINIMUM=[5,4,3,1,6,6,3,4,8,1,2,4,6,3,4,4,3,3,3,3];
const TRADE_FLAGS=new Set(['TRADE_ANY','TRADE_NOVELTY','TRADE_RARE','TRADE_GENE','TRADE_ALIEN','TRADE_THIS','TRADE_BONUS_CHROMO','NO_TRADE']);
const MILITARY_TEMP=['DISCARD','DISCARD_HAND','MILITARY_HAND','CONSUME_NOVELTY','CONSUME_RARE','CONSUME_GENE','CONSUME_ALIEN','CONSUME_ANY','CONSUME_PRESTIGE','XENO_DEFENSE'];
const DEFENSE_TEMP=['DISCARD','DISCARD_HAND','MILITARY_HAND','CONSUME_NOVELTY','CONSUME_RARE','CONSUME_GENE','CONSUME_ALIEN','CONSUME_ANY','CONSUME_PRESTIGE'];
const FLAG_BONUS={REBEL_FLAG:'REBEL',ALIEN_FLAG:'ALIEN',TERRAFORMING_FLAG:'TERRAFORMING',UPLIFT_FLAG:'UPLIFT',IMPERIUM_FLAG:'IMPERIUM',CHROMO_FLAG:'CHROMO',MILITARY:'MILITARY',ANTI_XENO_FLAG:'ANTI_XENO'};
const PRODUCTION_BONUS={NOVELTY_PRODUCTION:2,RARE_PRODUCTION:3,GENE_PRODUCTION:4,ALIEN_PRODUCTION:5};
const WINDFALL_BONUS={NOVELTY_WINDFALL:2,RARE_WINDFALL:3,GENE_WINDFALL:4,ALIEN_WINDFALL:5};

function startedDesigns(s,catalog,who){return s.cards.filter(c=>c&&c.startOwner===who&&c.startWhere===3&&!c.damaged).map(c=>designOf(s,c.id,catalog)).filter(Boolean);}
function tradePower(d){return d?.powers?.some(p=>p.phase===4&&p.flags?.some(flag=>TRADE_FLAGS.has(flag)));}
function consumePower(d){return d?.powers?.some(p=>p.phase===4&&!p.flags?.some(flag=>TRADE_FLAGS.has(flag)));}
function frontierWorld(d){return d?.type===1&&(has(d,'NEAR_FRONTIER')||has(d,'FAR_FRONTIER'));}
function permanentPowerAmount(active,p){
  const count=predicate=>active.filter(predicate).length;
  if(has(p,'PER_NONMIL_PAIR'))return p.value*Math.floor(count(d=>d.type===1&&!has(d,'MILITARY'))/2);
  if(has(p,'PER_FRONTIER'))return p.value*count(frontierWorld);
  if(has(p,'PER_CHROMO'))return p.value*count(d=>has(d,'CHROMO'));
  if(has(p,'PER_IMPERIUM'))return p.value*count(d=>has(d,'IMPERIUM'));
  if(has(p,'PER_REBEL_MILITARY'))return p.value*count(d=>has(d,'REBEL')&&has(d,'MILITARY'));
  if(has(p,'PER_PEACEFUL'))return p.value*count(d=>has(d,'PEACEFUL'));
  return p.value;
}

export function xenoPermanentBonus(s,catalog,who=s.seat){
  let amount=0;const active=startedDesigns(s,catalog,who);
  for(const p of powers(s,catalog,3,who)){
    if(!has(p,'EXTRA_MILITARY')||!has(p,'XENO')||MILITARY_TEMP.some(flag=>has(p,flag)))continue;
    amount+=has(p,'PER_PEACEFUL')?p.value*active.filter(d=>has(d,'PEACEFUL')).length:permanentPowerAmount(active,p);
  }
  return amount;
}

export function xenoDefense(s,catalog,who=s.seat){
  let amount=0;const active=startedDesigns(s,catalog,who);
  for(const p of powers(s,catalog,3,who)){
    if(!has(p,'XENO_DEFENSE')||DEFENSE_TEMP.some(flag=>has(p,flag)))continue;
    amount+=permanentPowerAmount(active,p);
  }
  return amount;
}

export function militaryVsXeno(s,catalog,who=s.seat){return military(s,catalog,who)+xenoPermanentBonus(s,catalog,who);}
export function xenoDefenseTotal(s,catalog,who=s.seat){return militaryVsXeno(s,catalog,who)+xenoDefense(s,catalog,who);}
export function permanentSettleDiscount(s,catalog,who=s.seat){
  return powers(s,catalog,3,who).filter(p=>p.flags?.length===1&&has(p,'REDUCE')).reduce((sum,p)=>sum+p.value,0);
}

function bonusMatches(s,b,d){
  if(PRODUCTION_BONUS[b.kind]!==undefined)return d.goodType===PRODUCTION_BONUS[b.kind]&&!has(d,'WINDFALL')&&!has(d,'NO_PRODUCE');
  if(WINDFALL_BONUS[b.kind]!==undefined){
    const good=d.goodType===1?s.oortKind:d.goodType;
    return !!good&&has(d,'WINDFALL')&&good===WINDFALL_BONUS[b.kind];
  }
  if(b.kind==='DEVEL_EXPLORE'||b.kind==='WORLD_EXPLORE'){
    if(b.kind==='DEVEL_EXPLORE'&&d.type!==2||b.kind==='WORLD_EXPLORE'&&d.type!==1)return false;
    return d.powers?.some(p=>p.phase===1&&!has(p,'ORB_MOVEMENT'))||false;
  }
  if(b.kind==='DEVEL_TRADE'||b.kind==='WORLD_TRADE')return (b.kind==='DEVEL_TRADE'?d.type===2:d.type===1)&&tradePower(d);
  if(b.kind==='DEVEL_CONSUME'||b.kind==='WORLD_CONSUME')return (b.kind==='DEVEL_CONSUME'?d.type===2:d.type===1)&&consumePower(d);
  if(b.kind==='SIX_DEVEL')return d.type===2&&d.cost===6;
  if(b.kind==='DEVEL')return d.type===2;
  if(b.kind==='WORLD')return d.type===1;
  if(b.kind==='NONMILITARY_WORLD')return d.type===1&&!has(d,'MILITARY');
  if(b.kind==='NONMILITARY_TRADE')return d.type===1&&!has(d,'MILITARY')&&tradePower(d);
  if(b.kind==='REBEL_MILITARY')return has(d,'MILITARY')&&has(d,'REBEL');
  if(b.kind==='NAME')return b.name===d.name;
  if(b.kind==='NEAR_FRONTIER')return d.type===1&&has(d,'NEAR_FRONTIER');
  if(b.kind==='FAR_FRONTIER')return d.type===1&&has(d,'FAR_FRONTIER');
  if(b.kind==='FRONTIER_WORLD')return frontierWorld(d);
  if(b.kind==='PAY_MILITARY_CARD')return d.powers?.some(p=>p.phase===3&&has(p,'PAY_MILITARY'))||false;
  if(b.kind==='ANTI_XENO_WORLD')return d.type===1&&has(d,'ANTI_XENO');
  if(b.kind==='ANTI_XENO_DEVEL')return d.type===2&&has(d,'ANTI_XENO');
  if(b.kind==='XENO_MILITARY')return d.type===1&&has(d,'XENO')&&has(d,'MILITARY');
  if(FLAG_BONUS[b.kind])return has(d,FLAG_BONUS[b.kind]);
  if(b.kind==='THREE_VP'||b.kind==='TOTAL_MILITARY'||b.kind==='NEGATIVE_MILITARY'||b.kind==='PRESTIGE'||b.kind==='TOTAL_GOODS'||b.kind==='KIND_GOOD')return false;
  return false;
}

function cardBonus(s,catalog,who,design){
  const p=s.players[who],active=tableau(s,who).filter(c=>!c.damaged),bonuses=design.bonuses||[];
  let total=0;const matching=[];
  for(const bonus of bonuses){
    if(bonus.kind==='THREE_VP')total+=Math.floor((p.vp||0)/3);
    else if(bonus.kind==='TOTAL_MILITARY')total+=military(s,catalog,who);
    else if(bonus.kind==='NEGATIVE_MILITARY')total-=military(s,catalog,who);
    else if(bonus.kind==='PRESTIGE')total+=p.prestige||0;
    else if(bonus.kind==='TOTAL_GOODS')total+=bonus.value*active.reduce((sum,c)=>sum+(c.numGoods||0),0);
    else if(bonus.kind==='KIND_GOOD'){
      const kinds=new Set(active.map(c=>designOf(s,c.id,catalog)).filter(d=>d&&d.type===1).map(d=>d.goodType===1?s.oortKind:d.goodType).filter(g=>g>=2&&g<=5));
      total+=[0,1,3,6,10][kinds.size]||0;
    }else matching.push(bonus);
  }
  for(const target of active){
    const targetDesign=designOf(s,target.id,catalog);if(!targetDesign)continue;
    let best=0;
    for(const bonus of matching)if(bonusMatches(s,bonus,targetDesign))best=Math.max(best,bonus.value);
    total+=best;
  }
  return total;
}

function hasOortWorld(s,catalog,who){
  return tableau(s,who).some(c=>!c.damaged&&designOf(s,c.id,catalog)?.goodType===1);
}

function goalVp(s,catalog,who){
  const p=s.players[who];let total=0;
  let goals=p.goals||[],progress=p.progress||[],mosts=s.goals||[];
  if(hasOortWorld(s,catalog,who)&&mosts[13]?.active&&goals[13]){
    const raw=tableau(s,who).filter(c=>!c.damaged).map(c=>designOf(s,c.id,catalog)).filter(d=>d?.type===1&&(d.goodType===2||d.goodType===3||d.goodType===1&&[1,2,3].includes(s.oortKind))).length;
    const count=raw<GOAL_MINIMUM[13]?0:raw;
    const most=Math.max(...s.players.map((q,j)=>j===who?raw:q.progress?.[13]||0));
    goals=goals.slice();goals[13]=count===most&&count!==0?1:0;
    progress=progress.slice();progress[13]=raw;
    mosts=mosts.slice();mosts[13]={...mosts[13],most};
  }
  for(let i=0;i<20;i++){
    if(!mosts[i]?.active)continue;
    if(i<12){if(goals[i])total+=3;continue;}
    const value=progress[i]||0;
    if(value<GOAL_MINIMUM[i])continue;
    if(goals[i])total+=5;
    else if(value===(mosts[i].most||0))total+=3;
  }
  return total;
}

function artifactVp(s,catalog,who){
  if(s.meta?.expansion!==4||s.meta?.mode!==2||!s.orb?.initialized)return 0;
  const stations=(s.orb.cells||[]).filter(cell=>(cell.flags&0x80)!==0).length;
  const categoryCount={science:0,technology:0,uplift:0};
  let total=0;
  for(const token of s.orb.artifacts?.[who]||[]){
    const artifact=ARTIFACT_TOKENS[token];if(!artifact)continue;
    total+=artifact.vp+(artifact.upliftStationVp||0)*stations;
    if(artifact.category)categoryCount[artifact.category]++;
  }
  for(const card of tableau(s,who)){
    if(card.damaged)continue;
    const name=designOf(s,card.id,catalog)?.name;
    if(name==='Alien Researchers')total+=categoryCount.technology;
    else if(name==='Terraforming Unlimited')total+=categoryCount.science;
    else if(name==='Uplift Alliance')total+=categoryCount.uplift;
  }
  return total;
}

function invasionActive(s){
  const exp=s.meta?.expansion,mode=s.meta?.mode,x=s.xcs;
  if(!s.invasion?.initialized)return false;
  if((exp===5||exp===8)&&mode===1)return true;
  return exp===8&&((mode===4&&x?.mode===2&&x.stage===1)||(mode===5&&x?.mode===1));
}

function invasionLiveVp(s,catalog,who){
  if(!invasionActive(s))return 0;
  const p=s.invasion.players?.[who]||{};let bonus=p.awards||0;
  if((s.invasion.empireDefeats||0)<2){
    const strengths=s.players.map((_,i)=>militaryVsXeno(s,catalog,i));
    const contributions=(s.invasion.players||[]).map(x=>x.contribution||0);
    if(strengths[who]===Math.max(...strengths))bonus+=5;
    if((p.contribution||0)===Math.max(...contributions))bonus+=5;
  }
  return bonus;
}

function counterstrikeLiveVp(s,who){
  const x=s.xcs;
  if(s.meta?.expansion!==8||s.meta?.mode!==4||x?.mode!==2||x.stage!==2||x.players!==s.meta.numPlayers)return 0;
  const p=s.invasion?.players?.[who]||{},conquered=x.systemsConquered||[],chips=s.players.map(player=>player.vp||0);
  return (p.awards||0)+(x.repulseBonus?.[who]||0)+(conquered[who]===Math.max(...conquered)?7:0)+(chips[who]===Math.max(...chips)?7:0);
}

export function liveXenoVp(s,catalog,who=s.seat){
  return s.meta?.expansion===8&&s.meta?.mode===4&&s.xcs?.mode===2&&s.xcs?.stage===2?counterstrikeLiveVp(s,who):invasionLiveVp(s,catalog,who);
}

function totalVpForOort(s,catalog,who,oortKind){
  const p=s.players[who],view=oortKind===undefined?s:{...s,oortKind};
  let total=p.vp||0;
  for(const card of tableau(s,who)){
    if(card.damaged)continue;
    const design=designOf(s,card.id,catalog);if(!design)continue;
    total+=design.vp||0;
    total+=cardBonus(view,catalog,who,design);
  }
  total+=artifactVp(s,catalog,who);
  total+=goalVp(view,catalog,who);
  total+=p.prestige||0;
  total+=liveXenoVp(view,catalog,who);
  return total;
}

export function totalVp(s,catalog,who=s.seat){
  if(!s.players?.[who])return 0;
  if(!hasOortWorld(s,catalog,who))return totalVpForOort(s,catalog,who);
  return Math.max(...[2,3,4,5].map(oortKind=>totalVpForOort(s,catalog,who,oortKind)));
}
