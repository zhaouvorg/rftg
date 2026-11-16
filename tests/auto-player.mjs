// Test-only player policy. Never served to the browser.
import {describeChoice,makeAnswer,validateChoice} from '../shared/choices.mjs';
import {designOf,handOf,paymentNeeded} from '../shared/rules.mjs';

function combinations(values,n,start=0,chosen=[],out=[]){if(out.length>5000)return out;if(chosen.length===n){out.push([...chosen]);return out;}for(let i=start;i<values.length;i++){chosen.push(values[i]);combinations(values,n,i+1,chosen,out);chosen.pop();}return out;}
export function autoPlayerAnswer(s,catalog){
  const q=s.choice,m=describeChoice(s,catalog);if(!q)return null;
  const answer=selection=>makeAnswer(s,catalog,selection);
  const cost=(id)=>paymentNeeded(s,catalog,id,[],0,0);
  const value=id=>{const d=designOf(s,id,catalog);return (d?.vp||0)*2+(d?.powers?.length||0)+((d?.goodType||0)>1?3:0)-(d?.cost||0);};
  const discard=ids=>[...ids].sort((a,b)=>value(a)-value(b));
  const valid=r=>r&&!validateChoice(s,r,catalog);
  if(m.mode==='actions'){
    const hand=handOf(s),can=(type)=>hand.some(c=>designOf(s,c.id,catalog)?.type===type&&cost(c.id)>=0&&cost(c.id)<=hand.length-1);
    const role=hand.length<4?2:can(2)?3:can(1)?5:2;
    let selected=s.meta.advanced&&q.args[0]!==1?[2,role===2?1:role]:[role];
    if(q.args[0]===2&&s.meta.advanced){const first=s.players[s.seat].actions[0];selected=[first,role===first?2:role];if(selected[0]===selected[1])selected[1]=1;}
    let r=answer({list:selected});if(valid(r))return r;
    for(const a of m.options)for(const b of m.options){r=answer({list:m.max===2?[a.value,b.value]:[a.value]});if(valid(r))return r;}
  }
  if(m.mode==='start')return answer({list:discard(q.list).slice(0,2),special:[q.special[0]]});
  if(m.mode==='payment'){
    for(let n=0;n<=Math.min(q.special.length,5);n++)for(const special of combinations(q.special,n)){
      const needed=paymentNeeded(s,catalog,q.args[0],special,q.args[1],q.args[2]);if(needed<0||needed>q.list.length)continue;
      const r=answer({list:discard(q.list).slice(0,needed),special});if(valid(r))return r;
    }
  }
  if(m.mode==='settlePayment'){
    if(m.zeroPaid)return {...m.pass};
    if(m.min>=0&&m.min<=handOf(s).length){const r=answer({list:discard(handOf(s).map(c=>c.id)).slice(0,m.min)});if(valid(r))return r;}
    if(m.options.length)return {...m.options[0].response};return m.pass;
  }
  if(q.type===7){const play=m.options.filter(o=>o.response.special[0]===-20&&cost(o.value)>=0&&cost(o.value)<=handOf(s).length-1).sort((a,b)=>cost(a.value)-cost(b.value));return play[0]?.response||m.pass;}
  if(q.type===5){const play=m.options.filter(o=>cost(o.value)>=0&&cost(o.value)<=handOf(s).length-1).sort((a,b)=>cost(a.value)-cost(b.value));return play[0]?.response||m.pass;}
  if(m.mode==='multi'){
    for(let n=m.min;n<=m.max;n++){for(const list of combinations(discard(q.list),n)){const r=answer({list});if(valid(r))return r;}if(![15,42].includes(q.type))break;}
  }
  if(m.mode==='two'||m.mode==='takeover'||m.mode==='defend')return m.pass;
  if(m.mode==='replacement')for(const first of q.list)for(const second of q.special){const r=answer({list:[first],special:[second]});if(valid(r))return r;}
  if([30,44].includes(q.type)&&m.pass)return m.pass;
  if(q.type===41)return m.options.find(o=>o.value===-1)?.response||m.options[0]?.response;
  if([52,53].includes(q.type))return m.options.find(o=>o.value===0)?.response;
  if(q.type===51)return m.options.find(o=>o.value===4)?.response||m.options[0]?.response;
  if(q.type===35)return m.options.find(o=>o.value===3)?.response||m.options.find(o=>o.value===2)?.response||m.options[0]?.response;
  if(q.type===36||q.type===37||q.type===38)return m.options.find(o=>o.value===-1)?.response||m.options[0]?.response;
  if(m.pass&&[10,17,50].includes(q.type))return m.pass;
  return m.options[0]?.response||m.pass;
}

