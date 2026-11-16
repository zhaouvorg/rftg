import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizeConfiguration,changeConfiguration } from '../shared/configuration.mjs';
import { root } from './helpers.mjs';
import path from 'node:path';

test('new-game checkboxes match actual PC local and online callbacks for 10100 transitions',()=>{
  const source=process.env.RFTG_SOURCE?path.resolve(process.env.RFTG_SOURCE,'..'):path.resolve(root,'../rftgp');
  const result=JSON.parse(execFileSync('python3',['tests/native/create-oracle.py','--source',source,'--trials','100','--steps','100'],{cwd:root,maxBuffer:40*1024*1024}));
  let c;
  for(const [i,step] of result.trace.entries()){
    c=step.action?changeConfiguration(c,step.action.key,step.action.value):normalizeConfiguration();
    for(const key of ['local','online']){
      const {disabledExpansions,...expected}=step[key];
      assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k=>[k,c[k]])),expected,`${key} at ${i}: ${JSON.stringify(step.action)}`);
      assert.deepEqual(c.counterstrike?[5]:[],disabledExpansions);
    }
  }
});
