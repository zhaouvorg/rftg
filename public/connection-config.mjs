export function httpOrigin(value){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Error('网关地址必须是完整的 HTTP/HTTPS 域名和可选端口，不能包含路径、账号或查询参数。');
  return url.origin;
}

export function resolveConnection(deployment={},pageUrl){
  const page=new URL(pageUrl),origin=httpOrigin(deployment.gatewayOrigin||page.origin);
  if(page.protocol==='https:'&&!origin.startsWith('https:'))throw new Error('HTTPS 页面必须连接 HTTPS/WSS 网关。');
  return {origin,configUrl:new URL('/api/config',origin).href,wsUrl:origin.replace(/^http/,'ws')+'/ws'};
}
