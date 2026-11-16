import { MSG } from '../shared/constants.mjs';
export const MAX_FRAME = 32768;
export function frame(type, ...fields) {
  const parts = fields.map(x => {
    if (typeof x === 'string') {
      if (x.includes('\0')) throw new Error('NUL is not allowed');
      return Buffer.from(x + '\0', 'utf8');
    }
    if (!Number.isInteger(x) || x < -2147483648 || x > 2147483647) throw new Error('Invalid protocol integer');
    const b = Buffer.alloc(4); b.writeInt32BE(x); return b;
  });
  const size = 8 + parts.reduce((n,b) => n + b.length, 0);
  if (size > MAX_FRAME) throw new Error('Frame too large');
  const header = Buffer.alloc(8); header.writeInt32BE(type); header.writeInt32BE(size,4);
  return Buffer.concat([header,...parts]);
}
export class FrameDecoder {
  #pending = Buffer.alloc(0);
  push(bytes) {
    this.#pending = Buffer.concat([this.#pending,bytes]);
    const output=[];
    while (this.#pending.length >= 8) {
      const size=this.#pending.readInt32BE(4);
      if (size < 8 || size > MAX_FRAME) throw new Error('Invalid upstream frame length');
      if (this.#pending.length < size) break;
      output.push(this.#pending.subarray(0,size)); this.#pending=this.#pending.subarray(size);
    }
    return output;
  }
}
export class Reader {
  constructor(buffer, offset=8) { this.buffer=buffer; this.pos=offset; }
  get remaining() { return this.buffer.length-this.pos; }
  int() { if(this.remaining<4) throw new Error('Truncated integer'); const x=this.buffer.readInt32BE(this.pos); this.pos+=4; return x; }
  string() { const end=this.buffer.indexOf(0,this.pos); if(end<0) throw new Error('Unterminated string'); const s=this.buffer.toString('utf8',this.pos,end); this.pos=end+1; return s; }
  ints(n) { if (!Number.isInteger(n) || n<0 || n>8192 || n*4>this.remaining) throw new Error('Invalid array length'); return Array.from({length:n},()=>this.int()); }
  rest() { return this.ints(this.remaining/4); }
}
export function decodeMessage(buffer) {
  const r=new Reader(buffer), type=buffer.readInt32BE(0);
  let data;
  switch(type) {
    case MSG.HELLO: data={version:r.remaining?r.string():''}; break;
    case MSG.DENIED: case MSG.GOODBYE: case MSG.JOINNAK: case MSG.LOG: data={text:r.string()}; break;
    case MSG.LOG_FORMAT: data={text:r.string(),format:r.string()}; break;
    case MSG.CHAT: case MSG.GAMECHAT: data={user:r.string(),text:r.string()}; break;
    case MSG.PLAYER_NEW: data={name:r.string(),playing:r.int(),self:r.remaining?r.int():0}; break;
    case MSG.PLAYER_LEFT: data={name:r.string()}; break;
    case MSG.OPENGAME: {
      data={id:r.int(),name:r.string(),creator:r.string()};
      for(const key of ['password','minPlayers','maxPlayers','expansion','advanced','disableGoals','disableTakeovers','speed','owner']) data[key]=r.int();
      data.mode=r.remaining?r.int():0; data.arc1Mask=r.remaining?r.int():0; break;
    }
    case MSG.GAME_PLAYER: data={id:r.int(),seat:r.int(),name:r.string(),online:r.int(),self:r.int()}; break;
    case MSG.STATUS_META: {
      data={};
      for(const key of ['numPlayers','expansion','advanced','disableGoals','disableTakeovers']) data[key]=r.int();
      if(data.numPlayers<2||data.numPlayers>6) throw new Error('Invalid player count');
      data.goals=r.ints(20); data.names=Array.from({length:data.numPlayers},()=>r.string());
      data.ai=r.ints(data.numPlayers); data.mode=r.remaining?r.int():0; data.arc1Mask=r.remaining?r.int():0;
      data.promo=r.remaining?r.int():0; if(r.remaining) data.seed=r.int()>>>0; break;
    }
    case MSG.CHOOSE: data={pos:r.int(),type:r.int()}; data.list=r.ints(r.int()); data.special=r.ints(r.int()); data.args=r.ints(3); break;
    default: data={values:r.rest()};
  }
  return {type,data};
}
