// Native executables are test oracles only; the shipped client never imports this.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const run=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
export const source=path.resolve(process.env.RFTG_SOURCE||'../rftgp/src');
export const testEnv={...process.env,RFTG_AI_NO_SAVE_NET:'1'};
export async function stop(p){if(!p)return;try{process.kill(-p.pid,'SIGTERM');}catch{}await pause(60);try{process.kill(-p.pid,'SIGKILL');}catch{}}
export async function hash(file){return createHash('sha256').update(await readFile(file)).digest('hex');}
export async function buildOracle(dir){
  await mkdir(dir,{recursive:true});
  const {stdout:flags}=await run('pkg-config',['--cflags','--libs','gtk+-2.0']);
  const {stdout:dry}=await run('make',['-n','-W','gui.c','rftg'],{cwd:source,maxBuffer:2e6});
  const link=dry.split('\n').find(l=>l.includes(' -o rftg rftg-counterstrike.o'));
  if(!link)throw new Error('Cannot find native rftg linker inputs');
  const objects=link.match(/\brftg-[\w-]+\.o\b/g).filter(f=>f!=='rftg-gui.o');
  let gui=await readFile(path.join(source,'gui.c'),'utf8');
  gui=gui.replace('char offered[512], offered_special[512], expected[512], expected_special[512];','char offered[32768], offered_special[32768], expected[32768], expected_special[32768];');
  const marker='\t        frame_rv);';
  if(!gui.includes(marker))throw new Error('Native AUTOPLAY probe insertion point changed');
  gui=gui.replace(marker,marker+'\n'+await readFile('tests/native/decision-probe.c.inc','utf8'));
  const guiFile=path.join(dir,'gui-probe.c'),obj=path.join(dir,'gui-probe.o'),binary=path.join(dir,'rftg-probe');
  await writeFile(guiFile,gui);
  const common=['-DHAVE_CONFIG_H','-I'+source,'-DRFTGDIR="'+source+'"','-O1','-w','-pthread',...flags.trim().split(/\s+/)];
  await run('cc',[...common,'-c',guiFile,'-o',obj],{maxBuffer:4e6});
  await run('cc',['-o',binary,obj,...objects.map(f=>path.join(source,f)),...flags.trim().split(/\s+/),'-lm','-pthread'],{maxBuffer:4e6});
  // The upstream learner has no Arc 1 CLI flag. Supply only that setup field
  // in a temporary copy; do not modify transcript bytes, RNG or AI policy.
  let learner=await readFile(path.join(source,'learner.c'),'utf8');
  learner=learner.replace('my_game.takeover_disabled = 0;', 'my_game.takeover_disabled = 0;\n my_game.arc1_mask = getenv("RFTG_TEST_ARC1_MASK") ? atoi(getenv("RFTG_TEST_ARC1_MASK")) : 0;');
  const learnerFile=path.join(dir,'learner-probe.c'),learnerObj=path.join(dir,'learner-probe.o'),learnerBin=path.join(dir,'learner-probe');
  await writeFile(learnerFile,learner);
  const {stdout:learnerDry}=await run('make',['-n','-W','learner.c','learner'],{cwd:source,maxBuffer:2e6});
  const learnerLink=learnerDry.split('\n').find(l=>l.includes(' -o learner '));
  const nativeLearnerObjects=learnerLink.match(/\b[\w-]+\.o\b/g).filter(f=>!['learner.o','learner-learner.o'].includes(f));
  await run('cc',[...common,'-c',learnerFile,'-o',learnerObj],{maxBuffer:4e6});
  // Human-path AI proposes a world, while PC always opens the separate
  // KEEP/PLACE chooser. Adapt the controller BEFORE generating a transcript;
  // never edit recorded frames or skip a decision during replay.
  let ai=await readFile(path.join(source,'ai.c'),'utf8');
  const append='\t/* The entire frame must fit before any log contents are written. */';
  if(!ai.includes(append))throw new Error('Native AI append point changed');
  ai=ai.replace(append,`if (!g->simulation && !g->p[who].ai) {
    if (type==CHOICE_XCS_FRONTIER_WORLD && rv==XCS_FRONTIER_DECISION_KEEP) rv=XCS_FRONTIER_DECISION_PLACE;
    if (type==CHOICE_INVASION_CONFIRM) rv=(arg3 & 2) ? 2 : 0;
    if (type==CHOICE_ACTION) rv=arg1;
    if (type==CHOICE_CONSUME && nl && ns) { *nl=*nl ? 1 : 0; *ns=*nl; }
    if ((type==CHOICE_DISCARD_PRODUCE || type==CHOICE_UPGRADE) && nl && ns && (!*nl || !*ns)) *nl=*ns=0;
  }
  if (!g->simulation && getenv("RFTG_TEST_LOCKED_ABORT")) {
    fprintf(stderr,"Unexpected live AI during locked reference replay\\n"); exit(87);
  }
`+append);
  const aiFile=path.join(dir,'ai-human-controller.c'),aiObj=path.join(dir,'ai-human-controller.o');
  await writeFile(aiFile,ai);await run('cc',[...common,'-c',aiFile,'-o',aiObj],{maxBuffer:4e6});
  await run('cc',['-o',learnerBin,learnerObj,aiObj,...nativeLearnerObjects.filter(f=>f!=='ai.o').map(f=>path.join(source,f)),'-lm','-pthread']);
  return {binary,learner:learnerBin};
}
export function parseDecisions(log){
  const records=[];
  const rx=/AUTOPLAY decision=(\d+) seat=(\d+) type=(\d+) args=(-?\d+),(-?\d+),(-?\d+) offered=(\d+):\[([^\]]*)\] offered_special=(\d+):\[([^\]]*)\] expected=(\d+):\[([^\]]*)\] expected_special=(\d+):\[([^\]]*)\] rv=(-?\d+)/g;
  const list=s=>s?s.split(',').map(Number):[];
  for(const m of log.matchAll(rx)){
    const r={pos:+m[1],seat:+m[2],type:+m[3],args:m.slice(4,7).map(Number),list:list(m[8]),special:list(m[10]),answer:{pos:+m[1],type:+m[3],rv:+m[15],list:list(m[12]),special:list(m[14])}};
    if(r.list.length!==+m[7]||r.special.length!==+m[9]||r.answer.list.length!==+m[11]||r.answer.special.length!==+m[13])throw new Error('Truncated native choice log');
    records.push(r);
  }
  const states=new Map([...log.matchAll(/^MOBILE_STATE (.+)$/gm)].map(m=>{const o=JSON.parse(m[1]);return [o.pos,o];}));
  for(const r of records){r.state=states.get(r.pos);if(!r.state)throw new Error('Missing native state');}
  return records;
}
export async function reference(config,dir,oracle,display){
  for(const sub of ['reference','local','local/config','local/exports'])await mkdir(path.join(dir,sub),{recursive:true});
  const local=path.join(dir,'local'),transcript=path.join(dir,'reference/choices.transcript');
  for(const name of ['cards.txt','images.data','campaign.txt','network','assets'])await symlink(path.join(source,name),path.join(local,name));
  const env={...testEnv,RFTG_TEST_ARC1_MASK:String(config.arc1Mask||0)};
  const args=['-p',String(config.players||2),'-e',String(config.expansion),'-o','-r',String(config.seed),'-n','1','--human-seat','0'];
  if(config.advanced)args.push('-a');
  const modeFlag=['','-i','-b','--frontier','--counterstrike','--invasion-frontier'][config.mode];if(modeFlag)args.push(modeFlag);
  const saved=await run(oracle.learner,[...args,'--save-ai-transcript',transcript],{cwd:source,env,maxBuffer:4e6,timeout:120000});
  await writeFile(path.join(dir,'reference/save.log'),saved.stdout+saved.stderr);
  const verify=await run(oracle.learner,[...args,'--verify-ai-transcript',transcript],{cwd:source,env:{...env,RFTG_TEST_LOCKED_ABORT:'1'},maxBuffer:4e6,timeout:120000});
  const verified=verify.stdout+verify.stderr;
  await writeFile(path.join(dir,'reference/verify.log'),verified);
  if(!verified.includes('RFTG_AI_TRANSCRIPT_REPLAY_PASS')||(/Role hit:/.test(verified)? !/Role hit: 0, Role miss: 0/.test(verified):![7,8].includes(config.expansion)))throw new Error('Native locked replay failed');
  const scoreLines=text=>[...text.matchAll(/Player (\d+): (-?\d+)/g)].map(m=>m[1]+':'+m[2]).sort().join(',');
  if(scoreLines(verified)!==scoreLines(saved.stdout))throw new Error('Locked reference replay score mismatch');
  const prefs=`[game]\nnum_players=${config.players||2}\nname=MobileOracle\nexpansion=${config.expansion}\narc1_mask=${config.arc1Mask||0}\ngame_mode=${config.mode}\nadvanced=${!!config.advanced}\npromo=true\nno_goals=false\nno_takeover=false\n[gui]\nwindow_width=1280\nwindow_height=900\nauto_select=false\nauto_save=false\nauto_export=true\nexport_cards=true\n[folders]\ndata_folder=${local}\nexport_folder=${local}/exports\n`;
  await writeFile(path.join(local,'config/rftg'),prefs);
  let log='',out='';
  const p=spawn(oracle.binary,['-p',String(config.players||2),'-e',String(config.expansion),'-r',String(config.seed),'--replay-ai-transcript',transcript,'--autoplay-human-transcript',transcript],{cwd:local,env:{...testEnv,DISPLAY:display,XDG_CONFIG_HOME:path.join(local,'config')},detached:true,stdio:['ignore','pipe','pipe']});
  p.stderr.on('data',b=>{log+=b;});p.stdout.on('data',b=>{out+=b;});
  let xml;
  try{
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      if(/AUTOPLAY (cannot|transcript exhausted|type mismatch|malformed)|transcript.*mismatch/i.test(log))throw new Error('Native GUI transcript mismatch: '+log.slice(-2000));
      const files=await readdir(path.join(local,'exports'));
      if(files.some(f=>f.endsWith('.xml'))){xml=await readFile(path.join(local,'exports',files.find(f=>f.endsWith('.xml'))),'utf8');if(xml.includes('<GameOver'))break;}
      if(p.exitCode!==null)throw new Error('Native GUI exited: '+log.slice(-1000));
      await pause(50);
    }
    if(!xml?.includes('<GameOver'))throw new Error('Native GUI did not finish');
  }finally{await stop(p);await writeFile(path.join(local,'stderr.log'),log);await writeFile(path.join(local,'stdout.log'),out);}
  const decisions=parseDecisions(log),scores=[...xml.matchAll(/<Player id="(\d+)"[^>]*>[\s\S]*?<Score>(-?\d+)<\/Score>/g)].map(m=>({seat:+m[1],score:+m[2]}));
  const aScores=[...saved.stdout.matchAll(/Player (\d+): (-?\d+)/g)].map(m=>({initialSeat:+m[1],score:+m[2]}));
  const result={decisions,scores,aScores,round:+xml.match(/<Round>(\d+)/)[1],transcript};
  await writeFile(path.join(local,'decisions.json'),JSON.stringify(result,null,2));
  return result;
}
