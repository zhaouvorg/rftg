import {httpOrigin} from '../public/connection-config.mjs';

export function originPolicy({publicOrigin='',allowedOrigins=[]}={}){
  const own=publicOrigin?httpOrigin(publicOrigin):null;
  const entries=Array.isArray(allowedOrigins)?allowedOrigins:allowedOrigins.split(',');
  const allowed=new Set(entries.map(s=>s.trim()).filter(Boolean).map(httpOrigin));
  return req=>{
    if(!req.headers.origin)return true; // Native/test clients have no browser Origin.
    try{
      const origin=httpOrigin(req.headers.origin);
      const expected=own||httpOrigin(`${req.socket.encrypted?'https':'http'}://${req.headers.host}`);
      return origin===expected||allowed.has(origin);
    }catch{return false;}
  };
}

export function contentSecurityPolicy(gatewayOrigin='',meta=false){
  const extra=gatewayOrigin?` ${httpOrigin(gatewayOrigin)} ${httpOrigin(gatewayOrigin).replace(/^http/,'ws')}`:'';
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${extra}; object-src 'none'; ${meta?'':"frame-ancestors 'none'; "}base-uri 'self'; form-action 'self'`;
}

export function securityHeaders(gatewayOrigin=''){
  return {'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':contentSecurityPolicy(gatewayOrigin)};
}
