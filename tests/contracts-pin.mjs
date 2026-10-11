import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const lock=JSON.parse(await readFile(path.join(root,'contracts.lock.json'),'utf8'));
const contracts=path.resolve(root,process.env.EDH_CONTRACTS_DIR||lock.local_default);

test('Observer consumes the pinned EDH Contracts revision',async()=>{
  const git=spawnSync('git',['-C',contracts,'rev-parse','HEAD'],{encoding:'utf8'});
  assert.equal(git.status,0,git.stderr||git.stdout);
  assert.equal(git.stdout.trim(),lock.revision);
  for(const rel of lock.required_files) await access(path.join(contracts,rel));
});

test('pinned dashboard fixture satisfies the X1 public envelope',async()=>{
  const fixture=JSON.parse(await readFile(path.join(contracts,'fixtures/dashboard-state.min.json'),'utf8'));
  for(const k of ['schema_version','revision','generated_at','observer','project_tasks','rdc','prepared_dispatch','executor_policy']){
    assert.ok(Object.hasOwn(fixture,k),'missing '+k);
  }
  assert.equal(fixture.schema_version,'1.0');
  assert.ok(['AUTO','EDH','RDC','COMPARE'].includes(fixture.executor_policy.mode));
});
