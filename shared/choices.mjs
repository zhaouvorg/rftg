import { ACTIONS,CHOICE_NAMES,GOODS } from './constants.mjs';
import { ARTIFACT_TOKENS } from './artifacts.mjs';
import { has,designOf,handOf,paymentNeeded,goodsValid,availableActions,actionsValid,normalizeActions,powerText,defendValid,takeoverValid } from './rules.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameAnswer=(a,b)=>a.rv===b.rv&&equal(a.list,b.list)&&equal(a.special,b.special);
const subset=(selected,offered)=>{const remaining=[...offered];return selected.every(x=>{const i=remaining.indexOf(x);return i<0?false:(remaining.splice(i,1),true);});};
export const orbImage=id=>id>=0&&id<45?`/assets/orb/cards/orb${id<30?'A':'B'}${String(id<30?id:id-30).padStart(2,'0')}.png`:null;
const searchNames=['军事发展','军事横置世界','和平横置世界','染色体世界','异星世界','消费两件货物','防御 5+ 世界','6 费发展','夺取能力'];
export function cardOption(s,catalog,id,key=id){
  const c=s.cards[id],d=designOf(s,id,catalog);
  return {key:String(key),value:id,card:id,design:d?.id,label:d?.name||(id<0?'完成 / 不使用':`卡牌 ${id}`),image:d?.image,
    detail:d?`${d.type===1?'世界':'发展'} · ${d.cost===127?'动态防御':d.cost+' 费'} · ${d.vp<0?'?':d.vp} VP`:''};
}
function powerOption(s,catalog,id,index,key){
  const o=cardOption(s,catalog,id,key);
  if(id<0){o.label=({'-1':'阶段奖励 / 威望交易','-2':'生产阶段奖励','-3':'威望生产奖励','-4':'完成生产','-1001':'掩体：弃 1 手牌，防御 +2','-1002':'修复世界','-1003':'完成生产'})[id]||'阶段能力';o.card=undefined;}
  if(id===-1003)o.label=index===0?'继续生产':'完成生产';
  o.detail=index>=0?powerText(designOf(s,id,catalog)?.powers[index]):({'-20':'殖民这个世界','-21':'翻转世界','-1':'使用支付方式','-2':'激活特殊能力','-3':'激活特殊能力','-4':'激活特殊能力','-5':'激活特殊能力','-6':'激活特殊能力','-11':'消耗工厂货物以支付','-12':'使用机器人殖民','-13':'损伤一个世界以殖民','-14':'使用难民殖民','-15':'使用遗产殖民','-16':'消耗深空边境能力'})[index]||'使用能力';
  if(s.choice?.type===30&&index===-2)o.detail='消耗工厂货物，获得临时军力';
  if(s.choice?.type===30&&index===-3)o.detail='牺牲世界，获得临时军力';
  if(id===-1002)o.detail='选择一个受损世界进行修复';
  return o;
}
export function describeChoice(s,catalog,selection={list:[],special:[]}){
  const q=s.choice;if(!q)return null;
  const [a,b,c]=q.args,m={title:CHOICE_NAMES[q.type]||'作出选择',hint:'选择后确认，行动将发送至游戏服务器。',mode:'single',options:[],min:1,max:1,pass:null};
  const response=(rv=0,list=q.list,special=q.special)=>({pos:q.pos,type:q.type,rv,list:[...list],special:[...special]});
  const single=(o,rv=0,list=[o.value],special=q.special)=>({...o,response:response(rv,list,special)});
  const cards=q.list.map((v,i)=>cardOption(s,catalog,v,i));
  const pairOptions=()=>q.list.map((v,i)=>single(powerOption(s,catalog,v,q.special[i],i),0,[v],[q.special[i]]));
  const multi=(min,max)=>{m.mode='multi';m.min=min;m.max=max;m.options=cards;m.hint=min===max?`选择 ${min} 张卡牌。`:`选择 ${min}–${max} 项。`;};
  const scalar=(values,labels)=>{m.options=values.map((v,i)=>single({key:String(i),value:v,label:labels?.[i]||String(v)},v,q.list,q.special));};
  switch(q.type){
    case 0: {
      m.mode='actions';m.min=m.max=s.meta.advanced&&a===0?2:1;m.hint=`选择 ${m.min} 个阶段。${a===2&&s.meta.advanced?'第一个阶段已确定，请补选第二个。':'所有人都执行所选阶段，选择者获得额外奖励。'}`;
      m.options=availableActions(s).map(v=>{const r=ACTIONS[v&127];return{...r,key:String(v),value:v,label:r.name+(v&128?' ★ 威望加成':''),detail:r.hint};});break;
    }
    case 1: m.mode='start';m.min=m.max=2;m.options=cards;m.specialOptions=q.special.map((v,i)=>cardOption(s,catalog,v,i));m.hint='选一个起始世界，再弃掉两张手牌。';break;
    case 2: multi(a,a);break;
    case 3: multi(1,1);m.hint='选择一张卡牌保存。';break;
    case 4: multi(0,1);m.hint='可以弃一张手牌获得威望，或直接跳过。';break;
    case 5: case 17: case 18:
      m.options=cards.map(o=>single(o,o.value,q.list,q.special));
      if(q.type!==18)m.pass=response(-1);
      m.hint=q.type===5?'选择要建造的卡牌，稍后支付费用；也可以跳过。':q.type===17?'选择一张牌下注，或放弃。':'选择要保留的卡牌。';break;
    case 6: {
      m.mode='payment';m.options=cards;m.target=a;m.specialOptions=q.special.map((v,i)=>({...cardOption(s,catalog,v,i),detail:(designOf(s,v,catalog)?.powers||[]).filter(p=>p.phase===(designOf(s,a,catalog)?.type===2?2:3)).map(powerText).join(' / ')}));
      m.min=m.max=paymentNeeded(s,catalog,a,selection.special||[],b,c);m.hint=`为 ${designOf(s,a,catalog)?.name||'卡牌'} 支付费用；选择手牌和需要使用的能力。`;break;
    }
    case 7: {
      m.options=pairOptions();m.pass=response(0,[],[]);
      if(a!==0&&a!==4&&b>=0&&s.cards[b]?.owner===s.seat){
        m.mode='settlePayment';m.target=b;m.paymentOptions=handOf(s).map((x,i)=>cardOption(s,catalog,x.id,i));
        m.min=m.max=paymentNeeded(s,catalog,b,[],a===3,c);
        m.hint=`殖民 ${designOf(s,b,catalog)?.name||'世界'}：可以先激活能力，再确认支付。`;
        m.zeroPaid=!!(s.cards[b]?.misc&(1<<17))||!(s.cards[b]?.misc&64);
      }else m.hint=a===4?'选择一个世界殖民，或使用场上的殖民能力。':'可以使用额外殖民能力，或结束这一阶段。';
      break;
    }
    case 8: m.mode='takeover';m.options=cards;m.specialOptions=q.special.map((v,i)=>cardOption(s,catalog,v,i));m.pass=response(-1,q.list,[]);m.hint='选择目标世界及一个夺取能力，或放弃夺取。';break;
    case 9: m.mode='defend';m.options=cards;m.specialOptions=q.special.map((v,i)=>cardOption(s,catalog,v,i));m.min=0;m.max=q.list.length;m.hint=`需要增加至少 ${c+1} 军力。可放弃防御。`;m.pass=response(0,[],[]);break;
    case 10: case 13: case 20: case 29:
      m.options=q.type===20?q.list.map((v,i)=>single(powerOption(s,catalog,v,q.special[i],i),0,[v,...q.list.slice(1)],[q.special[i],...q.special.slice(1)])):pairOptions();if(q.type===10||q.type===13&&a)m.pass=response(0,[],[]);
      m.hint=q.type===13?'选择一项消费能力，再选择支付的货物。':q.type===20?'选择要执行的生产能力。':'选择要使用的能力。';break;
    case 11: case 21:
      m.mode='two';m.options=cards;m.specialOptions=q.special.map((v,i)=>cardOption(s,catalog,v,i));m.pass=response(0,[],[]);
      m.hint=q.type===11?'选择新的手牌世界与要被替换的世界。':'选择一张手牌弃掉，再选择一个世界生产。';break;
    case 14: {const p=designOf(s,a,catalog)?.powers[b];multi(0,a<0?2:has(p,'CONSUME_TWO')?2:p?.times||1);m.hint='选择要消费的手牌；不选择即可跳过。';break;}
    case 15: case 42: multi(a,b);m.options=cards.map(o=>o.value>=328?{key:o.key,value:o.value,label:'异星技术神器货物',detail:`神器 ${o.value-328+1}`}:{...o,detail:`${GOODS[designOf(s,o.value,catalog)?.goodType]}货物`});m.hint=`选择 ${a===b?a:a+'–'+b} 件货物，需满足能力的种类要求。`;break;
    case 16: scalar([1,2,3,4,5,6,7]);m.hint='猜一个费用数字。';break;
    case 22: scalar(searchNames.map((_,i)=>i).filter(i=>i!==8||!s.meta.disableTakeovers),searchNames);break;
    case 23: scalar([1,0],['保留这张牌','继续搜索']);m.target=a;break;
    case 24: scalar([2,3,4,5],GOODS.slice(2));break;
    case 25: multi(0,q.list.length);m.hint=`选择贡献给共同防御的货物。当前击退目标 ${a}。`;break;
    case 26: multi(a?1:0,1);m.hint='选择要修复的受损世界。';break;
    case 27: {const vals=[1,2,3,4].filter(v=>a&(1<<v));scalar(vals,vals.map(v=>['','支付两张手牌','消耗一件货物','使用修复能力','使用生产修复奖励'][v]));m.target=b;break;}
    case 30: case 44:
      m.options=q.list.map((v,i)=>single(powerOption(s,catalog,v,q.special[i],i),i+1,q.list,q.special));
      if(q.type===44||!(s.meta.expansion===8&&s.meta.mode===4&&s.xcs?.stage===2&&s.xcs.conquestPending[s.seat]>=0&&a>0))m.pass=response(0);
      m.hint=q.type===30&&s.xcs?.conquestPending?.[s.seat]>=0?`征服支付：当前临时军力 ${c} · 还需 ${Math.max(0,a)} 军力`:q.type===30?`攻击 ${b} · 防御 ${c} · 还需 ${Math.max(0,a)} 军力`:`当前临时军力 ${a}`;break;
    case 31: multi(c?1:0,Math.min(a,q.list.length));m.hint=`弃手牌转化为军力（最多 ${a} 张）。`;break;
    case 32: scalar([1,0],['启用掩体','不启用']);break;
    case 34: scalar([c&2?2:0],['确认防御结果']);m.hint=`攻击 ${a} · 防御 ${b}。提交防御后，统一查看结果。`;break;
    case 35: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:['移动调查队','打出 Orb 卡','抽一张 Orb 卡','结束探索'][v]}));m.hint=`本次探索已用 ${b}/${a} 个行动。`;break;
    case 36: case 37: case 40:
      m.mode='map';m.options=q.list.map((v,i)=>{const cell=s.orb?.cells[v];return single({key:String(i),value:v,cell:v,label:v<0?'完成移动':`位置 (${cell?.x??'?'}, ${cell?.y??'?'})`,detail:cell?.artifact?'有神器可探索':''});});m.hint=q.type===36?`剩余移动 ${b}，军力 ${c}。选择地图上的目的地。`:'选择地图上的气闸。';break;
    case 38: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:v<0?'不打出卡牌':`Orb ${v<30?'A':'B'}-${v<30?v:v-30}`,image:orbImage(v)}));break;
    case 39: m.mode='placement';m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:`(${((v>>10)&1023)-512}, ${(v&1023)-512}) · ${((v>>20)&3)*90}°`,image:orbImage(a),x:((v>>10)&1023)-512,y:(v&1023)-512,rotation:((v>>20)&3)*90}));m.hint='选择卡牌放置位置和方向。';break;
    case 41: m.options=q.list.map((v,i)=>{const artifact=ARTIFACT_TOKENS[Math.floor(v/2)];return single({key:String(i),value:v,label:v<0?'暂不使用神器':`${artifact?.name||'神器'} · ${v&1?'替代用途':'主要用途'}`,image:artifact?.image,detail:v<0?'保留以备后续使用':'使用后翻面，保留计分'});});break;
    case 43: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:`小气闸 ${v+1}`,image:`/assets/orb/airlocks/airlock_small_${v}.png`}));break;
    case 46: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:`调查队 ${(v&1)+1}`}));break;
    case 48: {
      m.options=q.list.map((v,i)=>{const d=catalog.find(d=>d.xcs?.category===(a?'far-frontier':'near-frontier')&&d.xcs.localId===v);return single({key:String(i),value:v,label:d?.name||`${a?'远':'近'}边境 ${v+1}`,image:d?.image,design:d?.id,detail:'选择此世界，再决定保留或殖民'},2,[v],[c]);});
      for(let i=1;i+1<q.special.length;i+=2){const card=q.special[i],power=q.special[i+1];m.options.push(single(powerOption(s,catalog,card,power,`p${i}`),10,[card],[c,power]));}
      m.hint=`从${a?'远':'近'}边境候选世界中选择一个。`;break;
    }
    case 49: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:v?'远边境':'近边境'},0,[v],[a]));break;
    case 50: {
      if([3021,3341,3480].includes(a)){multi(a===3480?0:1,Math.min(b,q.list.length));m.options=cards.map(o=>s.cards[o.value]?.where===4?{...cardOption(s,catalog,s.cards[o.value].covering,o.key),value:o.value,detail:'消耗该世界上的一件货物'}:o);}
      else if(a===3491){m.mode='replacement';m.options=cards;m.specialOptions=q.special.map((v,i)=>cardOption(s,catalog,v,i));m.hint='选择新的发展牌与要替换的世界。';}
      else {m.options=cards.map(o=>single(o,o.value,[],q.special));if(!b)m.pass=response(-1,[],[]);if(a===345)m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:v?'损伤世界':'弃掉世界'},v,[],q.special));}
      break;
    }
    case 51: m.options=q.list.map((v,i)=>single({key:String(i),value:v,label:({1:'探索边境',2:'征服异星系统',4:'标准殖民'})[v]||String(v)},0,[v],[a,b]));break;
    case 52: case 53: scalar(b?[1,0]:[0],b?[q.type===52?'尝试征服':'殖民此世界',q.type===52?'放弃本次征服':'保留在手中']:[q.type===52?'放弃本次征服':'保留在手中']);if(q.type===53)m.target=a;else{m.targetDesign=catalog.find(d=>d.xcs?.category==='system'&&d.xcs.localId===a)?.id;m.hint=`你的常备军力 ${c}。${b?'可以尝试征服这个异星系统，之后选择临时军力支付。':'当前无法征服这个系统，可以放弃此次尝试。'}`;}break;
    case 54: scalar([0],['确认防御结果']);m.hint=`攻击 ${a} · 防御 ${b} · ${c?'防御成功':'防御失败'}`;break;
    default: m.options=cards.map(o=>single(o));break;
  }
  return m;
}
export function makeAnswer(s,catalog,selection={}){
  const q=s.choice,m=describeChoice(s,catalog,selection),selected=selection.list||[],special=selection.special||[];
  const result={pos:q.pos,type:q.type,rv:0,list:[...selected],special:[...q.special]};
  if(selection.pass){if(!m.pass)throw new Error('这一步不能跳过');return {...m.pass};}
  switch(m.mode){
    case 'actions': {
      result.list=normalizeActions(s,selected,selection.frontierBase);result.special=[];result.rv=q.args[0];break;
    }
    case 'start':case 'payment':case 'defend':case 'two':result.special=[...special];break;
    case 'takeover': result.rv=selected[0];result.list=[...q.list];result.special=[...special];break;
    case 'replacement':result.rv=selected[0];result.list=[];result.special=[...special];break;
    case 'settlePayment':
      if(selection.option!==undefined)return {...m.options.find(o=>o.key===selection.option)?.response};
      if(m.zeroPaid)return {...m.pass};
      result.list=[-99,...selected];result.special=[-99];break;
    case 'multi':break;
    default: {
      const option=m.options.find(o=>o.key===selection.option);if(!option)throw new Error('请选择一个选项');return {...option.response};
    }
  }
  return result;
}
export function validateChoice(s,r,catalog){
  const q=s.choice;
  if(!q||r.pos!==q.pos||r.type!==q.type)return '选择已过期';
  if(!Number.isInteger(r.rv)||!Array.isArray(r.list)||!Array.isArray(r.special)||r.list.length>1280||r.special.length>1280||[...r.list,...r.special].some(v=>!Number.isInteger(v)||v<-2147483648||v>2147483647))return '选择格式错误';
  const m=describeChoice(s,catalog,{special:r.special});
  if(m.pass&&sameAnswer(m.pass,r))return null;
  if(m.options.some(o=>o.response&&sameAnswer(o.response,r)))return null;
  const length=(values,min,max)=>values.length>=min&&values.length<=max;
  switch(m.mode){
    case 'actions':return r.rv===q.args[0]&&r.special.length===0&&actionsValid(s,r.list)?null:'请选择有效且不重复的行动组合';
    case 'start':return r.rv===0&&length(r.list,2,2)&&length(r.special,1,1)&&subset(r.list,q.list)&&subset(r.special,q.special)?null:'请选择一个起始世界并弃两张手牌';
    case 'payment':return r.rv===0&&subset(r.list,q.list)&&subset(r.special,q.special)&&m.min>=0&&r.list.length===m.min?null:m.min<0?'这些能力无法完成支付':`需要准确支付 ${m.min} 张手牌`;
    case 'settlePayment': {
      if(r.list[0]!==-99||!equal(r.special,[-99])||r.rv!==0||m.zeroPaid)return '请选择提供的能力或支付手牌';
      return m.min>=0&&r.list.length===m.min+1&&subset(r.list.slice(1),handOf(s).map(c=>c.id))?null:m.min<0?'当前军力不足，请先使用能力或选择支付方式':`需要准确支付 ${m.min} 张手牌`;
    }
    case 'multi': {
      if(r.rv!==0||!subset(r.list,q.list)||!equal(r.special,q.special)||!length(r.list,m.min,m.max))return `请选择 ${m.min===m.max?m.min:m.min+'–'+m.max} 项`;
      if([15,42].includes(q.type)&&!goodsValid(s,catalog,q,r.list))return '货物种类或数量不符合能力要求';
      if(q.type===14&&has(designOf(s,q.args[0],catalog)?.powers[q.args[1]],'CONSUME_TWO')&&![0,2].includes(r.list.length))return '需要选择两张手牌，或跳过';
      return null;
    }
    case 'two':case 'replacement': {
      const first=m.mode==='replacement'?r.rv:r.list[0];
      if(!q.list.includes(first)||r.special.length!==1||!q.special.includes(r.special[0])||m.mode==='two'&&r.list.length!==1)return '请选择一张手牌和一个目标世界';
      if(q.type===11){const to=designOf(s,first,catalog),from=designOf(s,r.special[0],catalog);if(!to||!from||to.type!==1||has(to,'MILITARY')||has(from,'MILITARY')||to.cost>from.cost+3||to.cost<from.cost||(to.goodType!==from.goodType&&!(to.goodType&&from.goodType&&(to.goodType===1||from.goodType===1))))return '这两个世界不能升级替换';}
      if(q.type===50&&q.args[0]===3491){const d=designOf(s,first,catalog),world=designOf(s,r.special[0],catalog);if(!d||d.type!==2||d.cost>5||world?.type!==1||r.special[0]===q.args[1])return '请选择费用不超过 5 的发展牌和可替换的世界';}
      return null;
    }
    case 'defend':if(r.rv===0&&subset(r.list,q.list)&&subset(r.special,q.special)&&defendValid(s,catalog,r.list,r.special,q.args[2]))return null;return '所选防御能力不足，或手牌超过可转化的军力';
    case 'takeover':if(q.list.includes(r.rv)&&equal(r.list,q.list)&&r.special.length===1&&q.special.includes(r.special[0])&&takeoverValid(s,catalog,r.rv,r.special[0]))return null;return '这个夺取能力不能用于所选世界';
  }
  return '请选择当前提供的合法选项';
}
// gui_choose_invasion_confirm returns immediately when the defense chooser's
// Done already committed this defense. Keep the native zero-click marker.
export function automaticAnswer(s){
  const q=s.choice;
  return q?.type===34&&(q.args[2]&2)?{pos:q.pos,type:q.type,rv:2,list:[...q.list],special:[...q.special]}:null;
}
