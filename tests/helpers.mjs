import { spawn } from 'node:child_process';
import { mkdtemp,symlink,readFile,rm,mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createGateway } from '../server/index.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const catalog=JSON.parse(await readFile(path.join(root,'public/data/cards.json'),'utf8'));
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export async function fixture(seed=41,options={}){
  const source=process.env.RFTG_SOURCE||path.resolve(root,'../rftgp/src'),dir=options.dir||await mkdtemp(path.join(tmpdir(),'rftg-mobile-'));
  await mkdir(dir,{recursive:true});
  for(const name of ['cards.txt','network','ai_client'])await symlink(path.join(source,name),path.join(dir,name));
  const port=await freePort(),log=path.join(dir,'server.log'),output=createWriteStream(log);
  const args=['-p',String(port),'-d',path.join(dir,'game.sqlite'),'-t','0','-k','0','-gt','3600','-e',dir];
  if(seed!==null)args.push('--debug-seed',String(seed));
  if(options.transcript)args.push('--replay-ai-transcript',options.transcript);
  const processServer=spawn(path.join(source,'rftgserver'),args,{cwd:dir,env:{...process.env,RFTG_AI_NO_SAVE_NET:'1'},detached:true,stdio:['ignore','pipe','pipe']});
  processServer.stdout.pipe(output,{end:false});processServer.stderr.pipe(output,{end:false});
  for(let i=0;i<100;i++){
    if(processServer.exitCode!==null)throw new Error(await readFile(log,'utf8'));
    try{await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('error',reject);socket.once('connect',()=>{socket.end();resolve();});});break;}catch{await delay(30);}
  }
  const gateway=await createGateway({host:'127.0.0.1',port:0,upstreamPort:port,upstreamHost:'127.0.0.1',grace:2500,serveStatic:true,publicOrigin:'',allowedOrigins:[],serverLabel:'',...options.gateway});
  const address=await gateway.listen();
  return {dir,port,log,gateway,url:`http://127.0.0.1:${address.port}`,wsUrl:`ws://127.0.0.1:${address.port}/ws`,
    async close(){await gateway.close();try{process.kill(-processServer.pid,'SIGTERM');}catch{}await delay(100);try{process.kill(-processServer.pid,'SIGKILL');}catch{}processServer.stdout.unpipe(output);processServer.stderr.unpipe(output);output.end();if(!options.keep)await rm(dir,{recursive:true,force:true});}};
}
export class Peer {
  constructor(url){this.url=url;this.state=null;this.errors=[];this.events=[];this.ws=new WebSocket(url);
    this.ws.on('message',bytes=>{const e=JSON.parse(bytes);this.events.push(e);if(e.event==='state'){this.state=e.state;this.onState?.(e.state);}if(e.event==='session')this.token=e.token;if(e.event==='error')this.errors.push(e.message);});
  }
  async open(){if(this.ws.readyState!==WebSocket.OPEN)await new Promise((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});return this;}
  send(command){this.ws.send(JSON.stringify(command));}
  async login(user,password='testpw'){await this.open();this.send({action:'login',user,password});await this.wait(s=>s?.status==='lobby');return this;}
  async wait(predicate,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate(this.state))return this.state;if(this.errors.length)throw new Error(this.errors.join('; '));await delay(10);}throw new Error(`Timed out: ${JSON.stringify(this.state)?.slice(-1700)}`);}
  close(){this.ws.close();}
}
