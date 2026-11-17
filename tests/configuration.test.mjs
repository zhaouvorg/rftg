import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_EXPANSIONS,GAME_OPTIONS,normalizeConfiguration,changeConfiguration,configurationRequest } from '../shared/configuration.mjs';

test('create dialog exposes only the base game and Arc 1 expansions',()=>{
  assert.deepEqual(PUBLIC_EXPANSIONS,[0,1,2,3]);
  assert.deepEqual(GAME_OPTIONS.map(([key])=>key),['advanced','disableGoals','disableTakeovers']);
  const c=normalizeConfiguration();
  assert.deepEqual(c.selected,[0]);assert.equal(c.expansion,0);assert.equal(c.mode,0);
});
test('Alien Artifacts and Xeno creation inputs are ignored',()=>{
  const c=normalizeConfiguration({selected:[4,5,7,8],orb:true,invasion:true,frontier:true,counterstrike:true});
  assert.deepEqual(c.selected,[0]);assert.equal(c.expansion,0);assert.equal(c.mode,0);
  for(const key of ['orb','invasion','frontier','counterstrike'])assert.equal(c[key],undefined);
  for(const id of [4,5,7,8]){
    const next=changeConfiguration(c,'expansion',id);
    assert.deepEqual(next.selected,[0]);assert.equal(next.expansion,0);assert.equal(next.mode,0);
  }
  for(const key of ['orb','invasion','frontier','counterstrike']){
    const next=changeConfiguration(c,key,true);
    assert.equal(next[key],undefined);assert.equal(next.mode,0);
  }
  assert.deepEqual(configurationRequest(c),{expansion:0,mode:0,arc1Mask:0,minPlayers:2,maxPlayers:2,advanced:false,disableGoals:false,disableTakeovers:false});
});
test('Arc 1 selections still combine and enable their restrictions',()=>{
  let c=normalizeConfiguration();
  for(const id of [1,2,3])c=changeConfiguration(c,'expansion',id);
  assert.deepEqual(c.selected,[1,2,3]);assert.equal(c.expansion,3);assert.equal(c.arc1Mask,7);
  c=changeConfiguration(c,'disableGoals',true);c=changeConfiguration(c,'disableTakeovers',true);
  assert.equal(c.disableGoals,true);assert.equal(c.disableTakeovers,true);
  c=changeConfiguration(c,'expansion',0);
  assert.deepEqual(c.selected,[0]);assert.equal(c.arc1Mask,0);assert.equal(c.disableGoals,false);assert.equal(c.disableTakeovers,false);
});
