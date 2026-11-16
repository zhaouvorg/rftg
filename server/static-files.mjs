import path from 'node:path';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';

const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
export async function serveFile(req,res,{directory,relative,pathname,headers={}}){
  const file=path.resolve(directory,relative);
  if(!file.startsWith(path.resolve(directory)+path.sep)||relative.includes('\0')||relative.split(/[\\/]/).some(p=>p.startsWith('.')))return false;
  try{
    const info=await stat(file);if(!info.isFile())return false;
    res.writeHead(200,{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':info.size,
      'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=86400':pathname==='/client-config.json'?'no-store':'no-cache'});
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    return true;
  }catch{return false;}
}
