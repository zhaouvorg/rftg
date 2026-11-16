import { ACTIONS,EXPANSIONS,MODES,GOALS,GOODS,GOOD_COLORS } from '/shared/constants.mjs';
import { describeChoice,makeAnswer,validateChoice,orbImage,automaticAnswer } from '/shared/choices.mjs';
import { designOf,handOf,tableau,military,powerText } from '/shared/rules.mjs';
import { totalVp,xenoPermanentBonus,xenoDefense,xenoDefenseTotal,permanentSettleDiscount } from '/shared/scoring.mjs';
import { PUBLIC_EXPANSIONS,GAME_OPTIONS,normalizeConfiguration,changeConfiguration,configurationRequest } from '/shared/configuration.mjs';
import { ARTIFACT_TOKENS } from '/shared/artifacts.mjs';
import { actionIcon,actionDescription } from '/action-presentation.mjs';
import {resolveConnection} from '/connection-config.mjs';
import { DEFAULT_DISPLAY_SETTINGS,DISPLAY_SCALE,loadDisplaySettings,applyDisplaySettings,saveDisplaySettings,normalizeDisplaySettings } from '/display-settings.mjs';

let displaySettings=loadDisplaySettings();
applyDisplaySettings(displaySettings);

const $=q=>document.querySelector(q),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const [catalog,assets,deployment]=await Promise.all(['/data/cards.json','/data/assets.json','/client-config.json'].map(async u=>{const r=await fetch(u,{cache:u==='/client-config.json'?'no-store':'default'});if(!r.ok)throw new Error(`无法读取 ${u}`);return r.json();}));
const connection=resolveConnection(deployment,location.href);
let config={server:new URL(connection.origin).host};
let state=null,ws=null,online=false,connecting=false,loggedOut=false,retry=null,choiceKey='',autoChoiceKey='',actionDetailKey='',selection={list:[],special:[]},selectedKeys={list:[],special:[]},choiceError='',createConfig=normalizeConfiguration(),toastTimer,renderQueued=false;
const tokenKey=`rftg-mobile-session:${connection.wsUrl}`;
if(connection.origin===location.origin&&sessionStorage.getItem('rftg-mobile-session')){sessionStorage.setItem(tokenKey,sessionStorage.getItem('rftg-mobile-session'));sessionStorage.removeItem('rftg-mobile-session');}
const button=(text,action,kind='',extra='')=>`<button type="button" class="button ${kind}" data-action="${action}" ${extra}>${text}</button>`;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function send(command){if(ws?.readyState!==WebSocket.OPEN){toast('连接正在恢复，请稍候');return false;}ws.send(JSON.stringify(command));return true;}
function connect(){
  clearTimeout(retry);ws=new WebSocket(connection.wsUrl);
  ws.addEventListener('open',()=>{online=true;autoChoiceKey='';});
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.event==='ready'){const token=sessionStorage.getItem(tokenKey);if(token)send({action:'resume',token});else{connecting=false;queueRender();}}
    if(message.event==='session'){sessionStorage.setItem(tokenKey,message.token);loggedOut=false;}
    if(message.event==='state'){
      state=message.state;connecting=state.status==='connecting';
      const key=state.choice?`${state.roomId}:${state.choice.pos}:${state.choice.type}`:'';
      if(key!==choiceKey){choiceKey=key;actionDetailKey='';selection={list:[],special:[]};selectedKeys={list:[],special:[]};choiceError='';$('#toast').classList.remove('visible');}
      const automatic=automaticAnswer(state);if(automatic&&autoChoiceKey!==key){if(send({action:'choice',...automatic}))autoChoiceKey=key;}
      if(state.error&&state.status==='disconnected'){sessionStorage.removeItem(tokenKey);connecting=false;send({action:'logout'});}
      queueRender();
    }
    if(message.event==='error'){connecting=false;choiceError=message.message;toast(message.message);queueRender();}
    if(message.event==='expired'){sessionStorage.removeItem(tokenKey);state=null;connecting=false;queueRender();toast('会话已过期，使用原账号登录即可恢复游戏。');}
  });
  ws.addEventListener('close',event=>{online=false;if(!loggedOut&&event.code!==4001){retry=setTimeout(connect,1500);queueRender();}else if(event.code===4001){toast('此会话已在另一个页面打开');}});
  ws.addEventListener('error',()=>{online=false;});
}
function queueRender(){if(!renderQueued){renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render();});}}
function header(){return `<header class="topbar"><a class="brand" href="/" aria-label="银河竞逐首页"><img src="/mark.svg" alt=""><span><strong>银河竞逐</strong><small>RACE FOR THE GALAXY</small></span></a><div class="top-right"><span class="status"><i class="dot"></i>${online?'已连接':'连接恢复中'}</span>${state&&['lobby','room','playing','finished'].includes(state.status)?`<span class="user-chip"><span class="avatar">${esc(state.user[0].toUpperCase())}</span>${esc(state.user)}</span>`:''}<span class="header-actions">${button('设置','settings','quiet small')}${button('玩法说明','help','quiet small')}</span>${state&&state.status!=='connecting'&&state.status!=='disconnected'?`<span class="header-actions">${state.status==='playing'?button('认输','resign','quiet small'):''}${button('退出','logout','quiet small')}</span>`:''}</div></header>`;}
function footer(){return `<footer class="page-foot"><span>RACE FOR THE GALAXY · 游戏设计 Tom Lehmann · 客户端基于 Keldon Jones 开源项目</span><span>EXPLORE · DEVELOP · SETTLE · CONSUME · PRODUCE</span></footer>`;}
function login(){
  const hero=[catalog.find(c=>c.name==='Old Earth')||catalog[12],catalog.find(c=>c.name==='Galactic Imperium')||catalog[55],catalog.find(c=>c.name==='Alien Tech Institute')||catalog[65]];
  return `<main class="shell landing"><section class="intro"><div class="eyebrow">THE GALAXY IS YOURS TO BUILD</div><h1>从一颗星球，<br>到整个银河。</h1><p class="subtitle">探索未知 · 发展文明 · 竞逐银河</p><p class="description">在每一次选择中建立你的银河帝国。<br>与朋友、AI 和原版客户端玩家同桌竞技。</p><div class="orbit-art" aria-hidden="true"><span class="star">✦</span><span class="star two">✧</span>${hero.map((c,i)=>`<img class="hero-card ${['','middle','last'][i]}" src="${c.image}" alt="">`).join('')}</div></section><section class="login-panel"><div class="eyebrow">WELCOME, EXPLORER</div><h2>进入游戏大厅</h2><p class="description">使用游戏服务器账号登录，开始新的远征。</p>${state?.error?`<div class="error-box" role="alert">${esc(state.error)}</div>`:''}<form id="login-form"><div class="field"><label for="username">玩家名称<input id="username" name="user" autocomplete="username" pattern="[A-Za-z0-9_]{2,20}" minlength="2" maxlength="20" placeholder="例如 StarExplorer" value="${esc(state?.user||localStorage.getItem('rftg-user')||'')}" required></label></div><div class="field"><label for="password">密码<input id="password" name="password" autocomplete="current-password" type="password" maxlength="20" placeholder="你的游戏账号密码" required></label></div><button class="button primary full" type="submit" ${connecting?'disabled':''}>${connecting?'正在连接…':'连接银河　↗'}</button></form><p class="footnote">第一次来到这里？填写新的玩家名称和密码，服务器会自动创建账号。用户名支持 2–20 位字母、数字或下划线。</p><div class="server-label"><span><i class="dot"></i> 游戏服务器</span><span class="mono">${esc(config.server)}</span></div></section></main>`;
}
const expansionName=id=>EXPANSIONS.find(x=>x.id===id)?.name||'未知扩展';
const roomPlayers=room=>Object.values(room?.players||{});
function chat(game=false){return `<div class="chat-lines" id="chat-lines">${(state.chat||[]).filter(x=>x.game===game).slice(-50).map(x=>`<div><b>${esc(x.user||'系统')}</b>　${esc(x.text)}</div>`).join('')||'<span>发条消息，和其他玩家打个招呼。</span>'}</div><form class="chat-form" id="chat-form"><input id="chat-input" maxlength="240" placeholder="输入消息…" aria-label="聊天消息" autocomplete="off" required><button class="button small" type="submit" aria-label="发送消息">↑</button></form>`;}
function lobby(){
  const rooms=Object.values(state.rooms).filter(r=>r.name!==undefined).sort((a,b)=>a.id-b.id),users=Object.values(state.users);
  return `<main class="shell"><div class="page-heading"><div><div class="eyebrow">THE RENDEZVOUS</div><h1>银河大厅</h1><p>加入一场远征，或邀请朋友组建你的牌桌。</p></div>${button('＋ 创建游戏','create','primary')}</div>${state.error?`<div class="error-box">${esc(state.error)}</div>`:''}<div class="lobby-grid"><section><div class="section-top"><h2>等待中的游戏 <span class="count">${String(rooms.length).padStart(2,'0')}</span></h2><span class="tag green"><i class="dot"></i> 实时同步</span></div>${rooms.length?rooms.map(r=>`<article class="room-row"><div class="room-icon"><img src="${catalog[12+r.expansion*10]?.image||catalog[12].image}" alt=""></div><div class="room-info"><h3>${esc(r.name)}${r.password?' <small aria-label="需要密码">⌑</small>':''}</h3><div class="room-meta"><span>${esc(expansionName(r.expansion))}</span><span>· ${esc(MODES[r.mode])}</span><span>· ${esc(r.creator)}</span>${r.advanced?'<span>· 双人进阶</span>':''}</div></div><div class="seat-count">${roomPlayers(r).length}<span> / ${r.maxPlayers}</span></div>${button('加入 ↗','join','small',`data-id="${r.id}" ${roomPlayers(r).length>=r.maxPlayers?'disabled':''}`)}</article>`).join(''):`<div class="empty"><div class="symbol">✧</div><h3>新的银河，等待开拓</h3><p>还没有等待中的牌桌。创建游戏后可以加入 AI 对手。</p></div>`}<div class="divider"></div><div class="section-top"><h2>大厅消息</h2><span class="tag">公共频道</span></div>${chat(false)}</section><aside><section class="side-panel"><h3>在线玩家 <span class="muted mono">${users.length}</span></h3>${users.map(u=>`<div class="online-user"><span class="avatar">${esc(u.name[0]?.toUpperCase())}</span><span>${esc(u.name)}${u.self?' <span class="gold">· 你</span>':''}</span><small>${u.playing?'游戏中':'大厅'}</small></div>`).join('')}</section><section class="side-panel"><div class="eyebrow">YOUR NEXT MOVE</div><h3 style="margin-top:12px">每轮，你选择的阶段<br>会改变所有人的计划。</h3><p class="muted" style="font-size:calc(12px * var(--font-scale,1))">用手牌支付发展与殖民，用货物换取更多选择。把握其他玩家的行动，建立属于你的得分引擎。</p>${button('了解五个阶段 →','help','quiet small','style="margin-top:12px"')}</section></aside></div></main>`;
}
function room(){
  const r=state.rooms[state.roomId];if(!r)return `<main class="shell"><div class="empty">正在同步房间…</div></main>`;
  const players=roomPlayers(r);
  return `<main class="shell"><div class="page-heading"><div><div class="eyebrow">EXPEDITION ${String(r.id+1).padStart(3,'0')}</div><h1>${esc(r.name)}</h1><p>所有玩家就绪后，由房主开始游戏。</p></div><span class="tag green">等待出发</span></div><div class="room-layout"><section><div class="room-seats">${Array.from({length:r.maxPlayers},(_,i)=>{const p=r.players[i];return p?`<article class="seat"><span class="avatar">${esc(p.name[0].toUpperCase())}</span><div><h3>${esc(p.name)}${p.self?' <span class="gold">· 你</span>':''}</h3><p>${p.name===r.creator?'房主 · ':''}${p.online?'已就绪':'离线'}</p>${r.owner&&!p.self?button('移出','remove','quiet small',`data-name="${esc(p.name)}"`):''}</div></article>`:`<article class="seat empty-seat"><span class="avatar">＋</span><div><h3>等待探索者</h3><p>席位 ${i+1}</p></div></article>`;}).join('')}</div><div class="room-actions">${r.owner?`${button('开始远征 →','start','primary',players.length<r.minPlayers?'disabled':'')}${button('加入 AI','addAI','',players.length>=r.maxPlayers?'disabled':'')}`:'<span class="muted">等待房主开始游戏</span>'}${button('离开房间','leave','quiet')}</div><div class="divider"></div>${chat(false)}</section><aside class="side-panel"><h3>本场设定</h3><dl>${[['扩展',expansionName(r.expansion)],['模式',MODES[r.mode]],['人数',`${r.minPlayers}–${r.maxPlayers} 人`],['行动',r.advanced?'双人进阶 · 每轮两个':'标准 · 每轮一个'],['目标',r.disableGoals?'关闭':'按扩展规则'],['夺取',r.disableTakeovers?'关闭':'按扩展规则']].map(([k,v])=>`<div class="rule-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="muted" style="font-size:calc(11px * var(--font-scale,1));margin-top:20px">使用原版客户端的朋友也能在同一服务器找到并加入这场游戏。</p></aside></div></main>`;
}
function card(id,extra=''){
  const c=state.cards[id],d=designOf(state,id,catalog);if(!c)return '';
  return `<button type="button" class="card ${c.damaged?'damaged':''} ${c.misc&64?'unpaid':''} ${extra}" data-action="inspect" data-design="${d?.id??-1}" aria-label="查看 ${esc(d?.name||'未公开卡牌')}" title="${esc(d?.name||'未公开卡牌')}"><img loading="lazy" src="${d?.image||assets.cardBack}" alt="${esc(d?.name||'未公开卡牌')}">${c.numGoods?`<span class="goods-badge" style="--good:${GOOD_COLORS[d?.goodType]||'#ccc'}" title="货物">${c.numGoods}</span>`:''}</button>`;
}
function actionGlyph(value,label,extra=''){
  const id=value&127;
  return `<span class="action-glyph ${extra}" role="img" aria-label="${esc(label)}" title="${esc(label)}"><img src="${actionIcon(value)}" alt="">${id===4||id===6?'<span class="glyph-repeat" aria-hidden="true">2</span>':''}${value&128?'<span class="glyph-prestige" aria-hidden="true">★</span>':''}</span>`;
}
const PHASE_ORDER=[1,3,5,7,9],ADVANCED_PHASE_ORDER=[1,3,4,5,6,7,9];
const PHASE_ART={1:23,3:3,4:3,5:5,6:5,7:24,9:9};
function phaseActive(id){
  const current=(Number(state.currentAction)||0)&127;
  if(id===1)return current===1||current===2||current===11;
  if(id===5)return current===5||current===12;
  if(id===7)return current===7||current===8;
  if(id===9)return current===9||current===10;
  return current===id;
}
function phaseSelected(id){
  const actions=state.actions||[];
  if(id===1)return !!(actions[1]||actions[2]);
  if(id===7)return !!(actions[7]||actions[8]);
  if(id===9)return !!(actions[9]||actions[10]);
  return !!actions[id];
}
function phaseGlyph(id){
  const label=ACTIONS[id]?.name||`阶段 ${id}`,active=phaseActive(id),selected=active||phaseSelected(id);
  return `<span class="phase-icon ${active?'active':selected?'selected':'inactive'}" data-phase="${id}" role="img" aria-label="${esc(label)}" title="${esc(label)}"><img src="/assets/icons/${PHASE_ART[id]}.png" alt="">${id===4||id===6?'<span class="glyph-repeat" aria-hidden="true">2</span>':''}</span>`;
}
function roundHeader(){
  const phases=state.meta?.advanced?ADVANCED_PHASE_ORDER:PHASE_ORDER;
  return `<section class="round-overview game-header" aria-label="回合阶段"><div class="round"><strong>${String(state.round).padStart(2,'0')}</strong><span>ROUND<br>回合</span></div><div class="phases phase-icons" aria-label="本轮阶段">${phases.map(phaseGlyph).join('')}</div><div class="game-info"><span class="tag">${esc(expansionName(state.meta.expansion))} · ${esc(MODES[state.meta.mode])}</span><span>VP 池 <b class="gold">${state.vpPool}</b></span></div></section>`;
}
function playerTable(index){
  const p=state.players[index],own=index===state.seat,active=tableau(state,index).sort((a,b)=>a.order-b.order),hand=state.cards.filter(c=>c?.where===2&&c.owner===index).length;
  const actions=p.actions.filter(x=>x>=0),actionHtml=actions.length?`<span class="player-action-icons">${actions.map(x=>actionGlyph(x,ACTIONS[x&127]?.name||String(x),'player-action-icon')).join('')}</span>`:'<span>阶段尚未揭晓</span>';
  const xenoBonus=xenoPermanentBonus(state,catalog,index),xenoGuard=xenoDefense(state,catalog,index),discount=permanentSettleDiscount(state,catalog,index);
  const xenoTotal=xenoDefenseTotal(state,catalog,index),xenoMilitary=military(state,catalog,index)+xenoBonus;
  const xenoActive=[5,8].includes(state.meta.expansion);
  const prestigeClass=p.prestigeActionUsed?'prestige-stat used':'prestige-stat';
  const totalScore=state.status==='finished'&&Number.isFinite(state.results[p.name])?state.results[p.name]:totalVp(state,catalog,index);
  return `<section class="tableau ${own?'own-tableau':''}"><div class="player-top"><div class="player-name"><span class="avatar">${esc(p.name[0].toUpperCase())}</span><span>${esc(p.name)}${own?' <span class="gold">· 你</span>':''}${p.ai?' <span class="tag">AI</span>':''}</span></div><div class="player-stats"><span title="手牌数">▤ <b>${hand}</b></span><span title="VP 筹码">VP <b>${p.vp}</b></span><span class="stat-total" title="当前总分（含场牌、目标、威望和扩展奖励）">总分 <b>${totalScore}</b></span><span title="基础军力">⚔ <b>${military(state,catalog,index)}</b></span>${xenoActive?`<span class="xeno-stat" title="异星防御 ${xenoTotal} = 对异星军力 ${xenoMilitary} + 永久异星防御 ${xenoGuard}；永久对异星军力加成 +${xenoBonus}"><img src="/assets/xcs/ui/permanent_xeno_military.png" alt="">异星防 <b>${xenoTotal}</b></span>`:''}${discount>0?`<span title="常备殖民减费">减费 <b>-${discount}</b></span>`:''}${state.meta.expansion===3?`<span class="${prestigeClass}" title="威望${p.prestigeActionUsed?'（本轮威望行动已使用）':''}">★ <b>${p.prestige}</b>${p.prestigeActionUsed?'<small>已用</small>':''}</span>`:''}</div></div><div class="player-roles"><span>${actionHtml}</span><span>${state.waiting[index]===1?'正在选择…':state.status==='finished'?'已结束':'已就绪'}</span></div><div class="table-cards">${active.map(c=>card(c.id)).join('')||'<span class="muted" style="font-size:calc(11px * var(--font-scale,1))">等待放置起始世界</span>'}</div></section>`;
}
const orbMeepleFiles=['blue','red','green','yellow','cyan','purple'];
function orbComponentPath(id){
  if(id>=0&&id<30)return `/assets/orb/cards/orbA${String(id).padStart(2,'0')}.png`;
  if(id>=30&&id<45)return `/assets/orb/cards/orbB${String(id-30).padStart(2,'0')}.png`;
  if(id>=100&&id<102)return `/assets/orb/airlocks/airlock_main_${id-100}.png`;
  if(id>=200&&id<202)return `/assets/orb/airlocks/airlock_small_${id-200}.png`;
  return null;
}
function placementGroups(choices){
  const groups=new Map();
  for(const o of choices?.mode==='placement'?choices.options:[]){
    if(!Number.isFinite(o.x)||!Number.isFinite(o.y))continue;
    const key=`${o.x},${o.y}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(o);
  }
  return [...groups.values()];
}
function placementFootprint(option){
  const quarter=Math.round((Number(option?.rotation)||0)/90)%2;
  return quarter?[3,2]:[2,3];
}
function placementPreview(option){
  if(!option?.image)return '';
  const [width,height]=placementFootprint(option),quarter=Math.round((Number(option.rotation)||0)/90)%4,swap=quarter%2===1;
  const imageWidth=swap?height:width,imageHeight=swap?width:height,x=option.x+(width-imageWidth)/2,y=option.y+(height-imageHeight)/2;
  return `<image class="orb-placement-art" href="${esc(option.image)}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" ${quarter?`transform="rotate(${quarter*90} ${option.x+width/2} ${option.y+height/2})"`:''}/><rect class="orb-placement-outline" x="${option.x}" y="${option.y}" width="${width}" height="${height}"/>`;
}
function orbMap(choices=null){
  const orb=state.orb;if(!orb?.cells.length)return '';
  const offered=new Map((choices?.options||[]).filter(o=>o.cell>=0).map(o=>[o.cell,o]));
  const placed=(orb.cards||[]).filter(c=>c.active).map(c=>({...c,path:orbComponentPath(c.cardId)})).filter(c=>c.path);
  const placements=placementGroups(choices),chosenPlacement=placements.flat().find(o=>o.key===selection.option);
  const xs=orb.cells.map(c=>c.x).concat(placed.map(c=>c.x),placed.map(c=>c.x+c.width-1));
  const ys=orb.cells.map(c=>c.y).concat(placed.map(c=>c.y),placed.map(c=>c.y+c.height-1));
  for(const group of placements){const [width,height]=placementFootprint(group[0]);xs.push(group[0].x,group[0].x+width-1);ys.push(group[0].y,group[0].y+height-1);}
  const minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs)+1,maxY=Math.max(...ys)+1;
  const pad=.55,vx=minX-pad,vy=minY-pad,vw=maxX-minX+pad*2,vh=maxY-minY+pad*2;
  const components=placed.map(c=>{
    const q=((Number(c.rotation)||0)%4+4)%4,swap=q%2===1,bw=swap?c.height:c.width,bh=swap?c.width:c.height;
    const bx=c.x+(c.width-bw)/2,by=c.y+(c.height-bh)/2,cx=c.x+c.width/2,cy=c.y+c.height/2;
    return `<image class="orb-component" href="${esc(c.path)}" x="${bx}" y="${by}" width="${bw}" height="${bh}" preserveAspectRatio="none" ${q?`transform="rotate(${q*90} ${cx} ${cy})"`:''}/>`;
  }).join('');
  const artifacts=orb.cells.filter(c=>c.artifact).map(c=>`<image class="orb-artifact" href="/assets/orb/ui/artifact_back_${c.artifact===2?'b':'a'}.png" x="${c.x+.25}" y="${c.y+.25}" width=".5" height=".5"><title>未探索的神器</title></image>`).join('');
  const groups=new Map();orb.teams.forEach((t,i)=>{if(!t.active)return;const k=`${t.x},${t.y}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push({...t,index:i});});
  const teams=[...groups.entries()].map(([,list])=>list.map((t,pos)=>{
    const count=list.length,size=.56,spread=count>1?.16:0,ox=count===1?0:(pos%2?spread:-spread),oy=count>2?(pos>1?.12:-.12):0;
    const second=(orb.teams[t.owner*2+1]?.active)&&orb.teams[t.owner*2+1]?.owner===t.owner,number=(t.index&1)+1;
    return `<g class="orb-team-token"><title>${esc(state.players[t.owner]?.name||`玩家 ${t.owner+1}`)} 调查队${second?' '+number:''}</title><image href="/assets/orb/ui/meeples/meeple_${orbMeepleFiles[t.owner%orbMeepleFiles.length]}.png" x="${t.x+.5-size/2+ox}" y="${t.y+.5-size/2+oy}" width="${size}" height="${size}"/>${second?`<text class="orb-team-number" x="${t.x+.5+ox}" y="${t.y+.5+oy}">${number}</text>`:''}</g>`;
  }).join('')).join('');
  const mapTargets=[...offered.entries()].map(([index,o])=>{const c=orb.cells[index];if(!c)return '';return `<g class="orb-target ${selection.option===o.key?'selected':''}" data-action="option" data-key="${esc(o.key)}" tabindex="0" role="button" aria-label="${esc(o.label)}"><title>${esc(o.label)}</title><rect x="${c.x}" y="${c.y}" width=".96" height=".96" rx=".06"/><circle cx="${c.x+.5}" cy="${c.y+.5}" r=".17"/></g>`;}).join('');
  const placementTargets=placements.map(group=>{
    const option=group[0],selected=group.some(o=>o.key===selection.option);
    return `<g class="orb-target orb-placement-target ${selected?'selected':''}" data-action="option" data-key="${esc(option.key)}" tabindex="0" role="button" aria-label="${esc(option.label)}"><title>${esc(option.label)}</title><rect class="orb-placement-hit" x="${option.x}" y="${option.y}" width="1" height="1" rx=".06"/><circle cx="${option.x+.5}" cy="${option.y+.5}" r=".17"/></g>`;
  }).join('');
  const preview=chosenPlacement?`<g class="orb-placement-preview">${placementPreview(chosenPlacement)}</g>`:'';
  const hint=choices?.mode==='placement'?'点击金色锚点放置卡牌；选择后用“旋转方向”改变朝向。':choices?'点击金色标记选择目的地。':'';
  return `<div class="orb-map-wrap"><svg class="orb-map" style="aspect-ratio:${vw}/${vh}" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Orb 遗迹地图"><rect class="orb-map-bg" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/><g class="orb-components">${components}</g><g class="orb-artifacts">${artifacts}</g><g class="orb-teams">${teams}</g>${preview}<g class="orb-targets">${mapTargets}${placementTargets}</g></svg></div><p class="map-caption">卡牌、气闸、调查队和神器按单机版显示。${hint}</p>`;
}
const ORB_MAP_CHOICES=new Set([36,37,39,40]);
function orbMapChoiceActive(){return ORB_MAP_CHOICES.has(Number(state.choice?.type));}
function expansionBoard(){
  let html='';const i=state.invasion,x=state.xcs,o=state.orb;
  if(i?.initialized){
    const conquest=x?.stage===2,review=!!i.resultReview;
    const rows=state.players.map((p,j)=>{
      const v=i.players[j]||{},damaged=tableau(state,j).filter(c=>c.damaged).length;
      const resolved=conquest?review&&!!(x.retaliationResolvedMask&(1<<j)):review&&!!v.defenseResolved;
      const attack=conquest?x.retaliationAttack[j]:v.invasionStrength,defense=conquest?x.retaliationDefense[j]:v.defenseTotal;
      const success=conquest?x.retaliationSuccess[j]:v.defenseSuccess;
      return `<div class="war-player"><strong>${esc(p.name)}${j===state.seat?' · 你':''}</strong><div class="war-stats"><span>将领军力 ${i.admiralInitialized&&v.admiralStrength>-127?v.admiralStrength:'待分配'}</span><span>贡献 ${v.contribution??0}</span><span>奖章 ${v.awards??0}</span><span>受损世界 ${damaged}</span>${j===state.seat?`<span>修复奖励 ${v.repairRemaining??0}</span>`:''}${conquest?`<span>已征服系统 ${x.systemsConquered[j]}</span>`:''}</div>${resolved?`<p class="${success?'gold':'muted'}">攻击 ${attack} / 防御 ${defense} · ${success?'抵御成功':'抵御失败'}${conquest?' · 本轮奖章 '+x.retaliationAward[j]:''}</p>`:conquest&&x.retaliationLastRound>0?`<p class="muted">上轮反击：${x.previousAttack[j]} / ${x.previousDefense[j]} · ${x.previousSuccess[j]?'成功':'失败'} · 奖章 ${x.previousAward[j]}</p>`:'<p class="muted">本轮防御结果尚未统一揭晓</p>'}</div>`;
    }).join('');
    html+=`<section class="expansion-board"><h3>${conquest?'异星反击 · 征服阶段'+(x.breatherPending?' · 喘息回合':''):'异星入侵 · 第 '+i.wave+' 波'}</h3><div class="expansion-stats">${conquest?`<span>征服目标 <strong>${x.conquestTarget}</strong></span><span>反击修正 <strong>+${x.retaliationModifier}</strong></span><span>剩余系统 <strong>${x.systems.drawCount}</strong></span>`:`<span>击退目标 <strong>${i.repulseValue}</strong></span><span>总军力 <strong>${i.totalMilitary}</strong></span><span>帝国败绩 <strong>${i.empireDefeats}</strong></span><span>剩余入侵牌 <strong>${i.remaining}</strong></span>`}</div><div class="war-players">${rows}</div></section>`;
  }
  if(x){
    const last=x.lastFrontierRound[state.seat],cooldown=last===state.round||!state.meta.advanced&&last>=0&&last===state.round-1;
    html+=`<section class="expansion-board"><h3>边境航图</h3><div class="expansion-stats"><span>近边境 <strong>${x.near.drawCount}</strong> / 弃牌 ${x.near.discardCount}</span><span>远边境 <strong>${x.far.drawCount}</strong> / 弃牌 ${x.far.discardCount}</span></div><p class="map-caption">${cooldown?'本轮不能再次使用边境加成。':'选择殖民阶段后，可以点击边境加成。'}${state.meta.advanced?'双殖民时，边境加成按左侧、右侧、取消循环，左侧先执行。':''}</p></section>`;
  }
  if(o)html+=`<details class="expansion-board" open><summary>Orb 遗迹 · ${o.deckSize} 张待探索</summary>${orbMapChoiceActive()?'<p class="map-caption">当前地图选择已显示在行动面板中。</p>':orbMap()}<div class="hand-cards">${(o.hands[state.seat]||[]).filter(id=>id>=0).map(id=>`<button class="card" data-action="orb-inspect" data-id="${id}"><img src="${orbImage(id)}" alt="Orb 卡 ${id}"></button>`).join('')}</div><div class="muted" style="font-size:calc(11px * var(--font-scale,1))">已收集神器 ${(o.collectedArtifacts[state.seat]||[]).reduce((a,b)=>a+b,0)} · 你的调查队 ${(o.teams||[]).filter(t=>t.active&&t.owner===state.seat).length}</div></details>`;
  if(o?.artifacts[state.seat]?.some(id=>id>=0))html+=`<div class="expansion-board"><h3>你的异星神器</h3><div class="artifact-row">${o.artifacts[state.seat].filter(id=>id>=0).map(id=>{const a=ARTIFACT_TOKENS[id];return a?`<button class="artifact ${o.artifactUsed[id]?'used':''}" data-action="artifact-inspect" data-id="${id}" title="${esc(a.name)}"><img src="${a.image}" alt="${esc(a.name)}"><span>${o.artifactUsed[id]?'已使用':a.vp+' VP'}</span></button>`:'';}).join('')}</div></div>`;
  return html;
}
function optionHtml(o,group='option',selected=false){
  return `<div class="option-wrap"><button type="button" class="choice-option ${selected?'selected':''}" data-action="${group==='option'?'option':'toggle'}" data-group="${group}" data-key="${esc(o.key)}" data-boosted="${!!o.boosted}" aria-pressed="${selected}">${o.image?`<img src="${o.image}" alt="${esc(o.label)}" loading="lazy">`:o.icon?`<span class="role-symbol" style="--role:${o.color}">${o.icon}</span>`:''}<span class="option-name">${esc(o.label)}${o.boosted?'<strong class="boost-badge">↑ 边境加成</strong>':''}</span>${o.detail?`<span class="option-detail">${esc(o.detail)}</span>`:''}</button>${o.design!==undefined?`<button type="button" class="inspect-chip" data-action="inspect" data-design="${o.design}" aria-label="查看 ${esc(o.label)} 详情">⌕</button>`:''}</div>`;
}
function actionOptions(model){
  const current=model.options.find(o=>o.key===actionDetailKey);
  const icons=model.options.map(o=>{
    const id=o.value&127,boosted=selection.frontierBase===o.value,selected=selectedKeys.list.includes(o.key)||boosted;
    return `<button type="button" class="choice-option action-option ${selected?'selected':''}" data-action="toggle" data-group="list" data-key="${esc(o.key)}" data-boosted="${boosted}" aria-label="${esc(o.label)}" aria-describedby="action-description" aria-pressed="${selected}" title="${esc(o.label)}"><img class="action-icon" src="${actionIcon(o.value,boosted)}" alt="">${o.value&128?'<img class="action-prestige-mark" src="/assets/icons/14.png" alt="">':''}${id===4||id===6?'<span class="action-repeat" aria-hidden="true">2</span>':''}</button>`;
  }).join('');
  return `<div class="choice-options action-options" role="group" aria-label="行动阶段">${icons}</div><div id="action-description" class="action-description" aria-live="polite" aria-atomic="true" data-key="${esc(current?.key||'')}">${current?`<strong>${esc(current.label)}</strong><p>${esc(actionDescription(current))}</p>`:'<p class="muted">点击阶段图标查看说明，选好后确认。</p>'}</div>`;
}
function choicePanel(){
  if(state.status==='finished')return `<aside class="choice-panel"><div class="waiting-panel"><div class="symbol">✦</div><h2>远征结束</h2><p>查看最终得分和游戏记录，准备下一次出发。</p></div><div class="choice-footer">${button('返回大厅','finish','primary')}</div></aside>`;
  if(!state.choice){const names=state.players.filter((p,i)=>i!==state.seat&&state.waiting[i]===1).map(p=>p.name);return `<aside class="choice-panel"><div class="waiting-panel"><div class="symbol">◌</div><h2>${online?'等待其他探索者':'正在恢复连接'}</h2><p>${names.length?esc(names.join('、'))+' 正在作出选择。':'服务器正在推进游戏。'}<br>你可以查看场牌与游戏记录。</p></div></aside>`;}
  const m=describeChoice(state,catalog,selection),groupModes=['multi','actions','start','payment','two','defend','takeover','replacement'];
  let body='';
  if(m.target!==undefined&&designOf(state,m.target,catalog))body+=`<div class="payment-summary">当前目标：<b>${esc(designOf(state,m.target,catalog).name)}</b> ${button('查看','inspect','quiet small',`data-design="${designOf(state,m.target,catalog).id}"`)}</div>`;
  if(m.targetDesign!==undefined){const d=catalog[m.targetDesign];body+=`<div class="conquest-target"><button class="card" data-action="inspect" data-design="${d.id}"><img src="${d.image}" alt="${esc(d.name)}"></button><div><strong>${esc(d.name)}</strong><p class="muted">${d.cost===127?'蜂巢系统 · 防御由局面决定':'系统防御 '+d.cost}<br>点击卡牌查看能力</p></div></div>`;}
  if(m.mode==='map'||m.mode==='placement'){
    body+=orbMap(m);
    if(m.mode==='map'){
      const utility=m.options.filter(o=>o.cell<0);
      if(utility.length)body+=`<div class="choice-options map-utility-options">${utility.map(o=>optionHtml({...o,label:Number(state.choice?.type)===37?'留在原地':o.label},'option',selection.option===o.key)).join('')}</div>`;
    }else{
      const chosen=m.options.find(o=>o.key===selection.option),same=chosen?m.options.filter(o=>o.x===chosen.x&&o.y===chosen.y):[];
      body+=`<div class="placement-controls"><span class="placement-status">${chosen?`位置 (${chosen.x}, ${chosen.y}) · ${Math.round(chosen.rotation||0)}°`:'点击地图锚点选择位置'}</span>${button('旋转方向 ↻','rotate-placement','quiet small',!chosen||same.length<2?'disabled':'')}</div>`;
    }
  }
  if(m.specialOptions)body+=`<div class="choice-group-title">${m.mode==='start'?'① 选择起始世界':m.mode==='payment'||m.mode==='defend'?'可用能力（可选）':'目标 / 能力'}</div><div class="choice-options">${m.specialOptions.map(o=>optionHtml(o,'special',selectedKeys.special.includes(o.key))).join('')}</div>`;
  if(m.mode==='actions')body+=actionOptions(m);
  else if(m.mode==='settlePayment'){
    if(m.options.length)body+=`<div class="choice-group-title">激活一项殖民能力</div><div class="choice-options">${m.options.map(o=>optionHtml(o,'option',selection.option===o.key)).join('')}</div>`;
    body+=`<div class="payment-summary">${m.zeroPaid?'费用已支付，确认完成殖民。':m.min<0?'需要先激活能力或选择其他支付方式。':m.min===0?'军力或减费已满足，不需要弃牌。':`需要弃掉 <strong class="gold">${m.min}</strong> 张手牌。`}</div>`;
    if(!m.zeroPaid&&m.min>0)body+=`<div class="choice-options">${m.paymentOptions.map(o=>optionHtml(o,'list',selectedKeys.list.includes(o.key))).join('')}</div>`;
  }else if(m.mode!=='map'&&m.mode!=='placement'){
    if(m.mode==='start')body+=`<div class="choice-group-title">② 弃掉两张手牌</div>`;
    else if(m.mode==='payment')body+=`<div class="payment-summary">${m.min>=0?`需要支付 <strong class="gold">${m.min}</strong> 张手牌`:'当前能力组合无法支付'}</div>`;
    body+=`<div class="choice-options">${m.options.map(o=>optionHtml({...o,boosted:m.mode==='actions'&&selection.frontierBase===o.value},groupModes.includes(m.mode)?'list':'option',groupModes.includes(m.mode)?selectedKeys.list.includes(o.key)||m.mode==='actions'&&selection.frontierBase===o.value:selection.option===o.key)).join('')}</div>`;
  }
  const passLabel=m.mode==='settlePayment'&&!m.zeroPaid?'其他支付方式':'跳过 / 完成';
  if(m.pass)body+=`<div class="choice-options optional-choice"><button type="button" class="choice-option ${selection.pass?'selected':''}" data-action="select-pass" data-group="pass" data-key="pass" aria-pressed="${!!selection.pass}"><span class="option-name">${passLabel}</span><span class="option-detail">选中后点击确认</span></button></div>`;
  let error='';try{error=validateChoice(state,makeAnswer(state,catalog,selection),catalog)||'';}catch{error='请选择一个选项';}
  const actionOrder=m.mode==='actions'?makeAnswer(state,catalog,selection).list.filter(v=>v>=0).map(v=>v===12?'边境殖民':ACTIONS[v&127]?.name+(v&128?' ★':'')).join(' → '):'';
  const count=selection.pass?`已选择：${passLabel}`:groupModes.includes(m.mode)||m.mode==='settlePayment'?`已选 ${selection.list.length}${m.min===m.max&&m.min>=0?' / '+m.min:''} 项${selection.special.length?' · 能力 / 目标 '+selection.special.length+' 项':''}`:selection.option!==undefined?'已选择，等待确认':'尚未选择';
  return `<aside class="choice-panel" data-pos="${state.choice.pos}" data-type="${state.choice.type}" aria-label="当前选择"><div class="choice-head"><div class="eyebrow">YOUR MOVE · 轮到你了</div><h2>${esc(m.title)}</h2><p>${esc(m.hint)}</p></div><div class="choice-content" id="choice-scroll">${body}</div><div class="choice-footer"><div class="choice-counter" aria-live="polite">${count}${actionOrder?`<p class="action-order">执行顺序：${esc(actionOrder)}</p>`:''}</div>${choiceError?`<div class="choice-error" role="alert">${esc(choiceError)}</div>`:''}<div class="choice-buttons">${button('重选','reset','quiet')}${button('确认','confirm','primary',error||!online?'disabled':'')}</div></div></aside>`;
}
function results(){if(state.status!=='finished')return '';return `<section class="results"><div class="eyebrow">EXPEDITION COMPLETE</div><h2>${state.error?'游戏已终止':state.winners.includes(state.user)?'你的银河，闪耀此刻。':'每次远征，都留下新的故事。'}</h2>${state.error?`<p class="muted">${esc(state.error)}</p>`:`<p class="muted">${esc(state.winners.join('、'))} 获胜 · 最终得分由服务器结算</p>`}<div class="scoreboard">${state.players.map(p=>`<div class="score ${state.winners.includes(p.name)?'winner':''}"><span>${esc(p.name)}</span><strong>${state.results[p.name]??'—'} <small>VP</small></strong></div>`).join('')}</div>${button('下载游戏记录','export','small quiet')}</section>`;}
function game(){
  const hand=handOf(state),others=state.players.map((_,i)=>i).filter(i=>i!==state.seat);
  const handHtml=`<section class="hand-section" id="your-hand" aria-label="你的手牌"><div class="hand-title"><h2>你的手牌 <span class="gold">${hand.length}</span></h2><span>点击卡牌查看能力</span></div><div class="hand-cards" id="hand-scroll">${hand.map(c=>card(c.id)).join('')||'<p class="muted">暂时没有手牌</p>'}</div>${state.cards.some(c=>c?.owner===state.seat&&c.where===5)?`<div class="hand-title"><h2>已保存的卡牌</h2></div><div class="hand-cards">${state.cards.filter(c=>c?.owner===state.seat&&c.where===5).map(c=>card(c.id)).join('')}</div>`:''}</section>`;
  const info=`<section class="game-details" aria-label="游戏信息">${results()}${expansionBoard()}<div class="goals-row">${state.goals.filter(g=>g.active).map(g=>`<div class="goal"><img src="${assets.goals[g.id]||assets.cardBack}" alt=""><span>${GOALS[g.id]}<small>${g.available?'尚可争取':'已达成'}${g.most?' · 最高 '+g.most:''}</small></span></div>`).join('')}</div><details class="game-log" open><summary><span>远征记录</span><span>${state.logs.length} 条</span></summary><div class="log-lines" id="log-lines">${state.logs.map(l=>`<div class="log-line ${esc(l.format)}">${esc(l.text)}</div>`).join('')}</div></details><details class="game-log" open><summary>牌桌聊天</summary>${chat(true)}</details></section>`;
  return `<main class="game-shell">${!online?'<div class="error-box">连接中断，正在自动恢复。你的选择会保留。</div>':''}<div class="game-grid"><div class="board">${roundHeader()}<div id="current-choice">${choicePanel()}</div>${handHtml}${playerTable(state.seat)}<div class="opponents" aria-label="其他玩家的牌桌">${others.map(playerTable).join('')}</div>${info}</div></div></main>`;
}
function render(){
  const focus=document.activeElement,focusId=focus?.id,position=focus?.selectionStart;
  const values=new Map([...$('#app').querySelectorAll('input[id]')].map(e=>[e.id,e.value]));
  const scrolls=new Map([...$('#app').querySelectorAll('[id]')].filter(e=>e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth).map(e=>[e.id,{top:e.scrollTop,left:e.scrollLeft,bottom:e.scrollHeight-e.scrollTop-e.clientHeight<30}]));
  const body=!state||['connecting','disconnected'].includes(state.status)?login():state.status==='lobby'?lobby():state.status==='room'?room():state.meta?game():'<main class="shell"><div class="empty">正在同步游戏…</div></main>';
  $('#app').innerHTML=header()+body+(['playing','finished'].includes(state?.status)?'':footer());
  for(const [id,value]of values){const input=document.getElementById(id);if(input)input.value=value;}
  if(focusId){const input=document.getElementById(focusId);if(input){input.focus({preventScroll:true});try{input.setSelectionRange(position,position);}catch{}}}
  for(const id of ['log-lines','chat-lines','hand-scroll','choice-scroll']){const el=document.getElementById(id),saved=scrolls.get(id);if(el){if(saved){el.scrollTop=saved.bottom&&id.endsWith('lines')?el.scrollHeight:saved.top;el.scrollLeft=saved.left;}else if(id.endsWith('lines'))el.scrollTop=el.scrollHeight;}}
}
function openDialog(html){const modal=$('#modal');modal.innerHTML=html;if(!modal.open)modal.showModal();}
const dialogTitle=title=>`<div class="dialog-title"><h2>${title}</h2><button class="close-button" data-action="close" aria-label="关闭">×</button></div>`;
function inspect(id){const d=catalog[id];if(!d)return;openDialog(`${dialogTitle('卡牌详情')}<div class="card-preview"><img src="${d.image}" alt="${esc(d.name)}"><div><h2>${esc(d.name)}</h2><p>${d.type===1?'世界':'发展'} · 费用 ${d.cost===127?'动态':d.cost} · ${d.vp<0?'可变':d.vp} VP${d.goodType?' · '+GOODS[d.goodType]:''}</p>${d.powers.map(p=>`<div class="power-line"><span class="gold">${['','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'][p.phase]||p.phase}</span> ${esc(powerText(p))}</div>`).join('')}${d.bonuses?.length?'<p>额外计分条件详见卡面。</p>':''}</div></div>`);}
function settingsDialog(){
  openDialog(`${dialogTitle('显示设置')}<div class="display-settings">${[['cards','卡牌放大系数'],['text','文字放大系数']].map(([key,label])=>`<div class="scale-setting"><label for="scale-${key}">${label} <output id="scale-${key}-value" for="scale-${key}">${displaySettings[key].toFixed(2)}×</output></label><input id="scale-${key}" data-display="${key}" type="range" min="${DISPLAY_SCALE.min}" max="${DISPLAY_SCALE.max}" step="${DISPLAY_SCALE.step}" value="${displaySettings[key]}" aria-valuetext="${displaySettings[key].toFixed(2)} 倍"><div class="scale-limits"><span>${DISPLAY_SCALE.min.toFixed(2)}×</span><span>${DISPLAY_SCALE.max.toFixed(2)}×</span></div></div>`).join('')}<p class="muted">调整立即生效，刷新页面后仍会记住。卡牌放大后会自动换行。</p></div><div class="dialog-actions">${button('恢复默认','reset-display','quiet')}${button('完成','close','primary')}</div>`);
}
function updateDisplaySettings(next){
  displaySettings=normalizeDisplaySettings(next);applyDisplaySettings(displaySettings);
  if(!saveDisplaySettings(displaySettings))toast('当前浏览器无法保存设置，调整仅在本次页面生效。');
}
function help(){openDialog(`${dialogTitle('五个阶段，一座银河')}<div class="help-content"><p>每轮同时选择一个阶段（双人进阶为两个）。只有被选中的阶段会执行；所有玩家都能参与，选择该阶段的玩家获得奖励。</p><ol><li><b class="gold">探索</b>：抽牌并保留部分。+5 看得更多，+1/+1 留得更多。</li><li><b class="gold">发展</b>：打出发展牌，用手牌支付费用。选择者减 1 费。</li><li><b class="gold">殖民</b>：打出世界。和平世界用手牌支付，军事世界用军力征服。</li><li><b class="gold">消费</b>：使用场上能力，把货物换为胜利点或手牌。交易行动可先卖一件货物。</li><li><b class="gold">生产</b>：在生产世界上放置货物。选择者可额外生产一件横置货物。</li></ol><p>场上达到结束条件或胜利点池用尽时，完成本轮后计分。卡牌、胜利点筹码、目标和部分发展牌的特殊能力共同决定得分。</p><p>点击卡牌可放大阅读。每步选择可先重选，确认后提交；短暂掉线或刷新会自动恢复。房主可以添加服务器 AI，也可以等待原版客户端玩家加入。</p><p class="muted">游戏规则、卡面和各扩展计分以原服务器及正式游戏规则为准。</p></div>`);}
function createControls(){
  const c=createConfig;
  return `<div class="create-columns"><fieldset><legend>卡牌扩展 · Expansion level</legend>${PUBLIC_EXPANSIONS.map(id=>{const e=EXPANSIONS[id];return `<label class="check"><input type="checkbox" data-config="expansion" value="${id}" ${c.selected.includes(id)?'checked':''} ${id===5&&c.counterstrike?'disabled':''}><span>${esc(e.name)}<small>${esc(e.en)}</small></span></label>`;}).join('')}</fieldset><fieldset><legend>游戏选项 · Options</legend>${GAME_OPTIONS.map(([key,name,en])=>`<label class="check"><input type="checkbox" data-config="${key}" name="${key}" ${c[key]?'checked':''} ${c.enabled[key]?'':'disabled'}><span>${name}<small>${en}</small></span></label>`).join('')}</fieldset></div><fieldset><legend>玩家人数 · Number of players</legend><div class="player-options">${[2,3,4,5,6].map(n=>`<label class="check"><input type="radio" name="players" data-config="players" value="${n}" ${n===c.players?'checked':''} ${n>c.maxPlayers?'disabled':''}>${n} 人</label>`).join('')}</div></fieldset><p class="configuration-summary" aria-live="polite">${esc(expansionName(c.expansion))} · ${esc(MODES[c.mode])} · ${c.players} 人${c.advanced?' · 双人进阶':''}</p>`;
}
function createDialog(){
  createConfig=normalizeConfiguration(createConfig);
  openDialog(`${dialogTitle('创建游戏')}<form id="create-form"><div class="form-grid"><label class="span2">房间名称<input id="room-name" name="name" maxlength="35" value="${esc(state.user)} 的远征" required></label></div><div id="create-controls">${createControls()}</div><label>房间密码（可选）<input name="password" type="password" autocomplete="new-password" maxlength="20" placeholder="留空表示公开房间"></label><div class="dialog-actions">${button('取消','close','quiet')}<button type="submit" class="button primary">创建游戏 →</button></div></form>`);
}
function syncCreate(key,value){createConfig=changeConfiguration(createConfig,key,value);$('#create-controls').innerHTML=createControls();}

function toggle(key,group){
  const m=describeChoice(state,catalog,selection),options=group==='special'?m.specialOptions:m.mode==='settlePayment'?m.paymentOptions:m.options,o=options.find(o=>o.key===key);if(!o)return;
  if(m.mode==='actions'){
    actionDetailKey=key;
    let values=[...selection.list],base=selection.frontierBase;
    if(o.value===12){
      const left=values.includes(5)||base===5,right=values.includes(6)||base===6;
      if(!left&&!right){render();toast('先选择殖民阶段，再点击边境加成。');return;}
      values=values.map(v=>v===12?base:v);
      base=base===5&&right?6:base===5||base===6?undefined:left?5:6;
      if(base!==undefined)values=values.map(v=>v===base?12:v);
    }else{
      const v=o.value,at=values.findIndex(x=>x===v||x===12&&base===v);
      if(at>=0){if(values[at]===12)base=undefined;values.splice(at,1);}
      else{values=values.filter(x=>(x&127)!==(v&127));if(values.length>=m.max)values.shift();values.push(v);if(!values.includes(12))base=undefined;}
    }
    selection={list:values,special:[],frontierBase:base};selectedKeys={list:values.map(String),special:[]};choiceError='';render();return;
  }

  const single=group==='special'?!['payment','defend'].includes(m.mode):['two','takeover','replacement'].includes(m.mode);
  const max=group==='special'?single?1:options.length:m.mode==='actions'?m.max:m.max<0?options.length:m.max;
  const keys=selectedKeys[group],at=keys.indexOf(key);
  if(at>=0)keys.splice(at,1);else{if(single||max===1)keys.length=0;if(max>0&&keys.length>=max){toast(`最多选择 ${max} 项`);return;}keys.push(key);}
  selection[group]=keys.map(k=>options.find(o=>o.key===k)?.value).filter(v=>v!==undefined);delete selection.option;delete selection.pass;choiceError='';render();
}
function rotatePlacement(){
  const m=describeChoice(state,catalog,selection);if(m.mode!=='placement')return;
  const chosen=m.options.find(o=>o.key===selection.option);if(!chosen)return toast('先点击地图上的放置位置。');
  const same=m.options.filter(o=>o.x===chosen.x&&o.y===chosen.y),at=same.findIndex(o=>o.key===chosen.key),next=same[(at+1)%same.length];
  if(next)selection={list:[],special:[],option:next.key};
  choiceError='';render();
}
function submitChoice(){try{const answer=makeAnswer(state,catalog,selection),error=validateChoice(state,answer,catalog);if(error)throw new Error(error);if(send({action:'choice',...answer})){choiceError='';$('#app [data-action="confirm"]')?.setAttribute('disabled','');}}catch(error){choiceError=error.message;render();}}
document.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action;
  if(action==='close')$('#modal').close();
  else if(action==='help')help();
  else if(action==='settings')settingsDialog();
  else if(action==='reset-display'){updateDisplaySettings({...DEFAULT_DISPLAY_SETTINGS});settingsDialog();}
  else if(action==='create')createDialog();
  else if(action==='inspect')inspect(+el.dataset.design);
  else if(action==='orb-inspect')openDialog(`${dialogTitle('Orb 卡牌')}<img src="${orbImage(+el.dataset.id)}" alt="Orb 卡牌" class="orb-card-preview">`);
  else if(action==='artifact-inspect'){const a=ARTIFACT_TOKENS[+el.dataset.id];if(a)openDialog(`${dialogTitle(esc(a.name))}<div class="card-preview"><img src="${a.image}" alt="${esc(a.name)}"><div><p>${a.vp} 基础胜利点 · ${state.orb.artifactUsed[+el.dataset.id]?'已使用':'尚未使用'}</p><p class="muted">神器能力在对应行动中由服务器提供。使用后仍保留计分。</p></div></div>`);}
  else if(action==='join'){const r=state.rooms[el.dataset.id];if(r.password)openDialog(`${dialogTitle('加入远征')}<form id="join-form" data-id="${r.id}"><label>房间密码<input name="password" type="password" required autofocus></label><div class="dialog-actions"><button class="button primary" type="submit">加入游戏</button></div></form>`);else send({action:'join',id:r.id});}
  else if(['start','addAI','leave','finish'].includes(action))send({action});
  else if(action==='remove')send({action:'remove',name:el.dataset.name});
  else if(action==='toggle')toggle(el.dataset.key,el.dataset.group);
  else if(action==='rotate-placement')rotatePlacement();
  else if(action==='option'){selection={list:[],special:[],option:el.dataset.key};selectedKeys={list:[],special:[]};choiceError='';render();}
  else if(action==='reset'){actionDetailKey='';selection={list:[],special:[]};selectedKeys={list:[],special:[]};choiceError='';render();}
  else if(action==='confirm')submitChoice();
  else if(action==='select-pass'){selection={list:[],special:[],pass:true};selectedKeys={list:[],special:[]};choiceError='';render();}
  else if(action==='resign')openDialog(`${dialogTitle('结束你的远征？')}<p class="muted">认输后，服务器会让 AI 接手你的席位。其他玩家可以继续游戏。</p><div class="dialog-actions">${button('继续游戏','close','quiet')}${button('确认认输','confirm-resign','danger')}</div>`);
  else if(action==='confirm-resign'){send({action:'resign'});$('#modal').close();}
  else if(action==='logout')openDialog(`${dialogTitle('断开连接？')}<p class="muted">以后使用相同账号登录，可以恢复服务器中仍在进行的对局。</p><div class="dialog-actions">${button('取消','close','quiet')}${button('退出登录','confirm-logout','danger')}</div>`);
  else if(action==='confirm-logout'){loggedOut=true;sessionStorage.removeItem(tokenKey);send({action:'logout'});state=null;$('#modal').close();render();connect();}
  else if(action==='export'){const blob=new Blob([state.logs.map(l=>l.text).join('')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`rftg-${new Date().toISOString().slice(0,10)}.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!['login-form','create-form','join-form','chat-form'].includes(form.id))return;event.preventDefault();const data=new FormData(form);
  if(form.id==='login-form'){localStorage.setItem('rftg-user',data.get('user'));connecting=true;send({action:'login',user:data.get('user'),password:data.get('password')});queueRender();}
  if(form.id==='create-form'){if(new TextEncoder().encode(data.get('name')).length>40){toast('房间名称最多 40 字节，请缩短名称。');return;}send({action:'create',name:data.get('name'),password:data.get('password'),...configurationRequest(createConfig)});$('#modal').close();}
  if(form.id==='join-form'){send({action:'join',id:+form.dataset.id,password:data.get('password')});$('#modal').close();}
  if(form.id==='chat-form'){const input=$('#chat-input');if(send({action:'chat',text:input.value}))input.value='';}
});
document.addEventListener('input',event=>{const key=event.target.dataset.display;if(!['cards','text'].includes(key))return;updateDisplaySettings({...displaySettings,[key]:+event.target.value});$(`#scale-${key}-value`).textContent=`${displaySettings[key].toFixed(2)}×`;event.target.setAttribute('aria-valuetext',`${displaySettings[key].toFixed(2)} 倍`);});
document.addEventListener('change',event=>{const key=event.target.dataset.config;if(key)syncCreate(key,['expansion','players'].includes(key)?+event.target.value:event.target.checked);});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('svg [role="button"]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('resize',()=>{if(state?.meta)queueRender();});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#modal').close();}});
render();connect();
// Static content remains usable while the gateway is restarting. WS reconnects independently.
fetch(connection.configUrl,{cache:'no-store',credentials:'omit'}).then(async r=>{if(r.ok){config=await r.json();queueRender();}}).catch(()=>{});
