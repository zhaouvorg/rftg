import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {serveFile} from '../server/static-files.mjs';
import {securityHeaders} from '../server/origins.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createStaticServer({directory=path.join(root,'dist/static'),host='127.0.0.1',port=3000}={}){
  const config=JSON.parse(await readFile(path.join(directory,'client-config.json'),'utf8'));
  const headers=securityHeaders(config.gatewayOrigin);
  const server=http.createServer(async(req,res)=>{
    if(['GET','HEAD'].includes(req.method)){
      try{
        const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
        if(await serveFile(req,res,{directory,relative:pathname.slice(1)||'index.html',pathname,headers}))return;
      }catch{}
    }
    res.writeHead(404,{...headers,'Cache-Control':'no-store'});res.end('Not found');
  });
  return {server,
    async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return server.address();},
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createStaticServer({host:process.env.STATIC_HOST||'127.0.0.1',port:+(process.env.STATIC_PORT||3000)});
  const address=await app.listen();console.log(`Static entry: http://127.0.0.1:${address.port}`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
