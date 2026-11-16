import { MSG } from '../shared/constants.mjs';
import { buildDeckDesigns } from '../shared/deck.mjs';
import { unpackOrb,unpackXcs,unpackInvasion } from '../shared/snapshots.mjs';

export function newState(user='') {
  return {user,status:'connecting',version:'',roomId:null,rooms:{},users:{},meta:null,seat:0,
    players:[],cards:[],round:0,vpPool:0,actions:[],currentAction:-2,goals:[],waiting:[],
    choice:null,logs:[],chat:[],results:{},winners:[],orb:null,xcs:null,invasion:null,error:null};
}
export function applyMessage(s,{type,data:d},catalog) {
  const v=d.values;
  switch(type) {
    case MSG.HELLO: s.status='lobby';s.version=d.version;s.error=null;break;
    case MSG.DENIED: case MSG.GOODBYE: s.status='disconnected';s.error=d.text;s.choice=null;break;
    case MSG.PLAYER_NEW: s.users[d.name]=d;break;
    case MSG.PLAYER_LEFT: delete s.users[d.name];break;
    case MSG.OPENGAME: s.rooms[d.id]={...s.rooms[d.id],...d,players:s.rooms[d.id]?.players||{}};break;
    case MSG.GAME_PLAYER: {
      const room=s.rooms[d.id]??={id:d.id,players:{}};
      if(d.name) room.players[d.seat]=d;else delete room.players[d.seat];break;
    }
    case MSG.CLOSE_GAME: delete s.rooms[v[0]];break;
    case MSG.JOINACK: s.roomId=v[0];s.status='room';s.error=null;break;
    case MSG.JOINNAK: s.error=d.text;break;
    case MSG.LEAVE: s.roomId=null;s.status='lobby';s.choice=null;break;
    case MSG.START: s.status='playing';s.logs=[];s.results={};s.winners=[];s.choice=null;s.error=null;break;
    case MSG.STATUS_META: {
      s.meta=d;s.status='playing';s.orb=null;s.xcs=null;s.invasion=null;
      s.players=d.names.map((name,i)=>({name,ai:d.ai[i],actions:[-1,-1],vp:0,prestige:0,goals:[],progress:[]}));
      s.cards=buildDeckDesigns(catalog,d).map((design,id)=>({id,design,owner:-1,startOwner:-1,where:0,startWhere:0,misc:0,order:0,numGoods:0,covering:-1,damaged:0}));
      s.goals=d.goals.map((active,id)=>({id,active,available:active,most:0}));break;
    }
    case MSG.STATUS_PLAYER: {
      let i=0;const seat=v[i++],p=s.players[seat];if(!p)throw new Error('Unknown player');
      p.actions=[v[i++],v[i++]];p.prestigeActionUsed=v[i++];
      p.goals=[];p.progress=[];for(let j=0;j<20;j++){p.goals.push(v[i++]);p.progress.push(v[i++]);}
      for(const key of ['prestige','vp','phaseBonusUsed','bonusMilitary'])p[key]=v[i++];
      if([5,7,8].includes(s.meta?.expansion))p.bonusMilitaryXeno=v[i++];
      for(const key of ['bonusReduce','prestigeTurn','artifactDevelopReduce','artifactSettleReduce','artifactGeneMilitary'])p[key]=v[i++]||0;
      break;
    }
    case MSG.STATUS_CARD: {
      const [id,owner,startOwner,where,startWhere,misc,order,numGoods,covering,damaged=0,design]=v;
      if(id<0||id>4096)throw new Error('Invalid card index');
      s.cards[id]={...s.cards[id],id,owner,startOwner,where,startWhere,misc,order,numGoods,covering,damaged};
      if(design!==undefined)s.cards[id].design=design;break;
    }
    case MSG.STATUS_GOAL: for(let i=0;i<20;i++)Object.assign(s.goals[i]??={}, {available:v[i*2],most:v[i*2+1]});break;
    case MSG.STATUS_MISC: {
      s.round=v[0];s.vpPool=v[1];s.actions=v.slice(2,13);s.currentAction=v[13];
      if(v.length>14 && v[15]>=13)s.invasion=unpackInvasion(v.slice(16,16+v[15]));break;
    }
    case MSG.STATUS_ORB: s.orb=unpackOrb(v);break;
    case MSG.STATUS_XCS: s.xcs=unpackXcs(v);break;
    case MSG.SEAT: s.seat=v[0];break;
    case MSG.WAITING: s.waiting=v;break;
    case MSG.CHOOSE: s.choice=d;break;
    case MSG.LOG: case MSG.LOG_FORMAT: {
      s.logs.push({text:d.text,format:d.format||'',id:(s.logSequence=(s.logSequence||0)+1)});if(s.logs.length>500)s.logs.shift();
      const score=d.text.match(/^(.+) ends with (\d+) VPs?\./);if(score)s.results[score[1]]=+score[2];
      for(const p of s.players)if(d.text.startsWith(`${p.name} wins`))s.winners.push(p.name);
      if(/abandoning game|internal game error/i.test(d.text))s.error=d.text.trim();
      break;
    }
    case MSG.CHAT: case MSG.GAMECHAT: s.chat.push({...d,game:type===MSG.GAMECHAT,id:(s.chatSequence=(s.chatSequence||0)+1)});if(s.chat.length>100)s.chat.shift();break;
    case MSG.GAMEOVER: s.status='finished';s.choice=null;break;
  }
  return s;
}
export function publicState(s) {
  // Preserve public counts and positions, never expose placeholder design identities.
  return {...s,cards:s.cards.map(c=>{
    if(!c)return c;
    const known=(c.misc&(1<<s.seat)) || c.where===3 || c.where===6 || (c.owner===s.seat&&[2,5].includes(c.where));
    return {...c,design:known?c.design:-1};
  })};
}
