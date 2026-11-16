import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { frame,FrameDecoder,decodeMessage } from './protocol.mjs';
import { applyMessage,newState,publicState } from './state.mjs';
import { MSG,EXPANSIONS } from '../shared/constants.mjs';
import { validateChoice } from '../shared/choices.mjs';
import {originPolicy,securityHeaders} from './origins.mjs';
import {serveFile} from './static-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
export const DEFAULT_SESSION_GRACE_MS=7*24*60*60*1000;
const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
function textField(x,max,name,empty=true){if(typeof x!=='string'||x.includes('\0')||Buffer.byteLength(x)>max||(!empty&&!x))throw new Error(`${name}格式不正确（最多 ${max} 字节）`);return x;}

export async function createGateway(options={}) {
  const config={host:options.host??process.env.HOST??'0.0.0.0',port:options.port??+(process.env.PORT||3000),
    upstreamHost:options.upstreamHost??process.env.RFTG_HOST??'127.0.0.1',upstreamPort:options.upstreamPort??+(process.env.RFTG_PORT||16309),
    grace:options.grace??+(process.env.SESSION_GRACE_MS||DEFAULT_SESSION_GRACE_MS),
    serveStatic:options.serveStatic??!['0','false'].includes(process.env.SERVE_STATIC||''),
    publicOrigin:options.publicOrigin??process.env.PUBLIC_ORIGIN??'',
    allowedOrigins:options.allowedOrigins??process.env.ALLOWED_ORIGINS??'',
    serverLabel:options.serverLabel??process.env.SERVER_LABEL??''};
  const originAllowed=originPolicy(config);
  const catalog=JSON.parse(await readFile(path.join(root,'public/data/cards.json'),'utf8'));
  const sessions=new Map();
  const server=http.createServer(async(req,res)=>{
    const headers=securityHeaders(config.publicOrigin);
    const json=(status,body)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(body));};
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{return json(400,{error:'Invalid path'});}
    if(pathname==='/api/config'||pathname==='/healthz'){
      headers.Vary='Origin';
      if(!originAllowed(req))return json(403,{error:'Origin not allowed'});
      if(req.headers.origin)headers['Access-Control-Allow-Origin']=req.headers.origin;
      if(req.method==='OPTIONS'){
        if(!['GET','HEAD'].includes(req.headers['access-control-request-method']||'GET'))return json(405,{error:'Method not allowed'});
        res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'});return res.end();
      }
      if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Method not allowed'});
      if(pathname==='/healthz')return json(200,{ok:true,service:'rftg-mobile'});
      return json(200,{server:config.serverLabel||`${config.upstreamHost}:${config.upstreamPort}`,release:'0.9.4',sessionGraceMs:config.grace});
    }
    if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Method not allowed'});
    if(!config.serveStatic)return json(404,{error:'Not found'});
    const directory=path.join(root,pathname.startsWith('/shared/')?'shared':'public');
    const relative=pathname.startsWith('/shared/')?pathname.slice(8):pathname.slice(1)||'index.html';
    if(!await serveFile(req,res,{directory,relative,pathname,headers}))json(404,{error:'Not found'});
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/ws'||!originAllowed(req)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  function send(ws,value){if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>2*1024*1024){ws.close(1013,'Slow connection');return;}ws.send(JSON.stringify(value));}}
  function snapshot(s){send(s.ws,{event:'state',state:publicState(s.state)});}
  function queueSnapshot(s){if(!s.flush)s.flush=setTimeout(()=>{s.flush=null;snapshot(s);},15);}
  function destroy(s){clearTimeout(s.expire);clearTimeout(s.flush);s.tcp?.destroy();sessions.delete(s.token);s.ws?.close(1000,'Disconnected');}
  function connect(ws,command){
    if(sessions.size>=128)throw new Error('连接已满，请稍后重试');
    const user=textField(command.user,20,'用户名',false),password=textField(command.password,20,'密码',false);
    if(!/^[A-Za-z0-9_]{2,20}$/.test(user))throw new Error('用户名需为 2–20 位英文字母、数字或下划线');
    const token=randomBytes(32).toString('base64url'), s={token,ws,state:newState(user),tcp:null,expire:null,flush:null};
    sessions.set(token,s);ws.session=s;const decoder=new FrameDecoder();
    const tcp=s.tcp=net.createConnection({host:config.upstreamHost,port:config.upstreamPort});tcp.setNoDelay(true);
    tcp.setTimeout(10000);
    tcp.on('timeout',()=>{s.state.error='连接游戏服务器超时';tcp.destroy();});
    tcp.on('connect',()=>{tcp.setTimeout(0);tcp.write(frame(MSG.LOGIN,user,password,'0.9.4','0.9.4'));});
    tcp.on('data',bytes=>{
      try {
        for(const bytesFrame of decoder.push(bytes)){
          const event=decodeMessage(bytesFrame);
          if(event.type===MSG.PING){tcp.write(frame(MSG.PING));continue;}
          // Preparation is an optional native prediction optimization. Acknowledge
          // readiness without appending a choice; the server asks direct questions.
          if(event.type===MSG.PREPARE){tcp.write(frame(MSG.PREPARE,event.data.values[1]));continue;}
          applyMessage(s.state,event,catalog);
        }
        queueSnapshot(s);
      }catch(error){s.state.error=`服务器协议错误：${error.message}`;tcp.destroy();}
    });
    tcp.on('error',error=>{s.state.error=`无法连接游戏服务器：${error.code||error.message}`;});
    tcp.on('close',()=>{s.state.status='disconnected';s.state.choice=null;s.state.error||='与游戏服务器的连接已断开';queueSnapshot(s);});
    send(ws,{event:'session',token});snapshot(s);
  }
  function command(s,c) {
    const state=s.state,tcp=s.tcp,room=state.rooms[state.roomId];
    if(!tcp||tcp.destroyed)throw new Error('游戏服务器已断开，请重新登录');
    const write=(type,...fields)=>{if(tcp.writableLength>128*1024)throw new Error('连接繁忙，请稍后重试');tcp.write(frame(type,...fields));};
    const owner=()=>{if(state.status!=='room'||!room?.owner)throw new Error('仅房主可执行此操作');};
    switch(c.action){
      case 'create': {
        if(state.status!=='lobby')throw new Error('请先返回大厅');
        const e=EXPANSIONS.find(e=>e.id===c.expansion);
        if(!e||!e.modes.includes(c.mode)||!integer(c.minPlayers,2,e.max)||!integer(c.maxPlayers,c.minPlayers,e.max))throw new Error('无效的扩展、模式或人数');
        if(c.advanced&&c.maxPlayers!==2)throw new Error('进阶模式仅支持双人');
        const mask=c.arc1Mask||0;
        if(!integer(mask,0,7)||(mask&&(c.expansion<1||c.expansion>3||((mask&4)?3:(mask&2)?2:1)!==c.expansion)))throw new Error('扩展组合不正确');
        write(MSG.CREATE,textField(c.password||'',20,'房间密码'),textField(c.name||`${state.user} 的游戏`,40,'房间名'),c.minPlayers,c.maxPlayers,c.expansion,+!!c.advanced,+!!c.disableGoals,+!!c.disableTakeovers,0,c.mode,mask);break;
      }
      case 'join': if(state.status!=='lobby'||!integer(c.id,0,100000)||!state.rooms[c.id])throw new Error('房间不存在');write(MSG.JOIN,c.id,textField(c.password||'',20,'房间密码'));break;
      case 'leave': if(state.status!=='room')throw new Error('当前不在等待房间');write(MSG.LEAVE);state.roomId=null;state.status='lobby';snapshot(s);break;
      case 'addAI': owner();if(Object.keys(room.players).length>=room.maxPlayers)throw new Error('房间已满');write(MSG.ADD_AI,state.roomId);break;
      case 'remove': owner();if(!Object.values(room.players).some(p=>p.name===c.name&&!p.self))throw new Error('玩家不存在');write(MSG.REMOVE,state.roomId,textField(c.name,20,'用户名'));break;
      case 'start': owner();if(Object.keys(room.players).length<room.minPlayers)throw new Error('还需要更多玩家');write(MSG.START,state.roomId);break;
      case 'chat': if(!['lobby','room','playing','finished'].includes(state.status))throw new Error('请先登录');write(MSG.CHAT,textField(c.text,800,'消息',false));break;
      case 'choice': {
        if(state.status!=='playing'||!state.choice||c.pos!==state.choice.pos||c.type!==state.choice.type)throw new Error('此选择已过期，请按当前提示操作');
        const error=validateChoice(state,c,catalog);if(error)throw new Error(error);
        write(MSG.CHOOSE,c.pos,c.type,c.rv,c.list.length,...c.list,c.special.length,...c.special);
        state.choice=null;state.error=null;snapshot(s);break;
      }
      case 'resign': if(state.status!=='playing')throw new Error('当前未在游戏中');write(MSG.RESIGN);state.status='lobby';state.roomId=null;state.choice=null;snapshot(s);break;
      case 'finish': if(state.status!=='finished')throw new Error('游戏尚未结束');write(MSG.GAMEOVER);state.status='lobby';state.roomId=null;snapshot(s);break;
      default: throw new Error('未知操作');
    }
  }
  wss.on('connection',ws=>{
    ws.isAlive=true;ws.count=0;ws.period=Date.now();ws.on('pong',()=>{ws.isAlive=true;});
    const unauth=setTimeout(()=>{if(!ws.session)ws.close(1008,'Login timeout');},15000);
    send(ws,{event:'ready'});
    ws.on('message',(bytes,isBinary)=>{
      try{
        if(isBinary)throw new Error('仅支持 JSON 消息');
        if(Date.now()-ws.period>5000){ws.period=Date.now();ws.count=0;}if(++ws.count>100)throw new Error('操作过于频繁');
        const c=JSON.parse(bytes.toString());if(!c||typeof c!=='object')throw new Error('消息格式错误');
        if(c.action==='login'){if(ws.session)throw new Error('已有登录会话');connect(ws,c);clearTimeout(unauth);return;}
        if(c.action==='resume'){
          if(ws.session||typeof c.token!=='string')throw new Error('无效的恢复请求');
          const s=sessions.get(c.token);if(!s){send(ws,{event:'expired'});return;}
          clearTimeout(s.expire);if(s.ws&&s.ws!==ws){s.ws.session=null;s.ws.close(4001,'Session moved');}
          s.ws=ws;ws.session=s;clearTimeout(unauth);send(ws,{event:'session',token:s.token});snapshot(s);return;
        }
        const s=ws.session;if(!s)throw new Error('请先登录');
        if(c.action==='logout'){destroy(s);return;}
        command(s,c);
      }catch(error){send(ws,{event:'error',message:error.message});}
    });
    ws.on('close',()=>{clearTimeout(unauth);const s=ws.session;if(s&&s.ws===ws){s.ws=null;s.expire=setTimeout(()=>destroy(s),config.grace);}});
    ws.on('error',()=>{});
  });
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},30000);heartbeat.unref();
  return {server,sessions,config,
    async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});return server.address();},
    async close(){clearInterval(heartbeat);for(const s of sessions.values())destroy(s);for(const ws of wss.clients)ws.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createGateway();const address=await app.listen();
  console.log(`RFTG Mobile ${app.config.serveStatic?'web + gateway':'gateway only'}: http://localhost:${address.port} → ${app.config.upstreamHost}:${app.config.upstreamPort}`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
