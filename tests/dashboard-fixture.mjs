import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const lock=JSON.parse(await readFile(path.join(root,'contracts.lock.json'),'utf8'));
const contracts=path.resolve(root,process.env.EDH_CONTRACTS_DIR||lock.local_default);

test('X1 dashboard fixture is accepted by the actual Observer envelope consumer',async()=>{
  const source=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const match=source.match(/function requireDashboardEnvelope\(dashboard\) \{[\s\S]*?\n\}/);
  assert.ok(match,'requireDashboardEnvelope function not found');
  const context={};
  vm.createContext(context);
  vm.runInContext(match[0]+'; this.requireDashboardEnvelope=requireDashboardEnvelope;',context);
  const fixture=JSON.parse(await readFile(path.join(contracts,'fixtures/dashboard-state.min.json'),'utf8'));
  assert.equal(context.requireDashboardEnvelope(fixture).revision,fixture.revision);
  assert.throws(()=>context.requireDashboardEnvelope({...fixture,schema_version:'2.0'}),/dashboard_schema_unsupported/);
  const missing={...fixture}; delete missing.project_tasks;
  assert.throws(()=>context.requireDashboardEnvelope(missing),/dashboard_state_missing_project_tasks/);
});
