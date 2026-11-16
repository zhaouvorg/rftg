class Cursor {
  constructor(values) { this.v=values; this.p=0; }
  int() { if(this.p>=this.v.length) throw new Error('Truncated expansion snapshot'); return this.v[this.p++]; }
  array(n) { if(n<0||n>7000) throw new Error('Invalid snapshot count'); return Array.from({length:n},()=>this.int()); }
  object(keys) { return Object.fromEntries(keys.split(' ').map(k=>[k,this.int()])); }
}
export function unpackOrb(values) {
  const [magic,count,...payload]=values;
  if(magic!==0x4f524231||count!==payload.length) throw new Error('Invalid Orb snapshot');
  const c=new Cursor(payload), s=c.object('version initialized setupReady numPlayers grayRemoved greenRemoved deckSize deckPos');
  if(s.version!==3) throw new Error('Orb v3 is required');
  s.hands=Array.from({length:5},()=>c.array(c.int()));
  s.artifactPoolPos=c.array(2); s.artifactPoolReady=c.int();
  s.artifacts=Array.from({length:5},()=>c.array(c.int()));
  s.artifactUsed=c.array(45); s.artifactGoodWorld=c.array(45); s.artifactProduceUnplaced=c.array(5);
  s.collectedArtifacts=Array.from({length:5},()=>c.array(2));
  s.priorityCount=c.int(); s.priority=c.array(5); s.openingPos=c.int(); s.openingDone=c.array(5); s.smallAirlockUsed=c.array(2);
  Object.assign(s,c.object('stepActive stepPos stepOrderCount')); s.stepOrder=c.array(5);
  Object.assign(s,c.object('stepExploreMask stepOrbMask'));
  for(const key of ['stepActionMask','stepActionCount','stepLastAction','stepPassed']) s[key]=c.array(5);
  s.cells=Array.from({length:c.int()},()=>{const x=c.object('x y flags artifact artifactToken topCardId'); x.edges=Array.from({length:4},()=>c.object('kind strength'));return x;});
  s.cards=Array.from({length:c.int()},()=>c.object('active airlock cardId x y width height rotation'));
  s.teams=Array.from({length:10},()=>c.object('active owner x y'));
  return s;
}
export function unpackXcs(values) {
  const [magic,count,...payload]=values;
  if(magic!==0x58435331||count!==payload.length) throw new Error('Invalid XCS snapshot');
  const c=new Cursor(payload),s=c.object('version mode stage players advanced vpInitial round frontierPlacedRound');
  if(s.version!==1) throw new Error('Unsupported XCS snapshot');
  s.lastFrontierRound=c.array(5);
  const deck=()=>{const d=c.object('drawCount discardCount initiallySelected selectedMask drawnMask'); d.draw=c.array(28);d.discard=c.array(28); return d;};
  s.near=deck();s.far=deck();
  s.pending=Array.from({length:5},()=>({...c.object('active deck count'),cards:c.array(28)}));
  s.flow={...c.object('round count current stage'),players:c.array(5),decks:c.array(5)};
  s.decisions=Array.from({length:5},()=>c.object('physicalCard round decision')); s.frontierPhaseArmed=c.int();
  s.systems=deck();s.retaliation=deck();
  Object.assign(s,c.object('conquestTarget breatherPending retaliationSuppressed'));s.conquestPending=c.array(5);
  Object.assign(s,c.object('retaliationModifier systemsConqueredThisRound retaliationLastRound retaliationTopMask retaliationPrepared retaliationResolvedMask'));
  for(const key of ['retaliationAssigned','retaliationAttack','retaliationDefense','retaliationSuccess','retaliationAward','previousCard','previousAttack','previousDefense','previousSuccess','previousAward','systemsConquered','repulseBonus','repulseAdmiralBonus','repulseContributorBonus']) s[key]=c.array(5);
  return s;
}
export function unpackInvasion(values) {
  const c=new Cursor(values),s=c.object('version numPlayers initialized repulseValue empireDefeats wave remaining admiralInitialized totalMilitary assignmentReady repulsed lastRound stepPending');
  s.players=Array.from({length:s.numPlayers},()=>c.object('admiralStrength admiralOrder assignedValid wave kind value invasionStrength defenseTotal damagedWorld defenseResolved defenseSuccess bunkerUsed contribution awards repairRemaining'));
  if(c.p<values.length) Object.assign(s,c.object('logDefer resultReview'));
  return s;
}
