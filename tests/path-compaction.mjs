import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('compactMessage removes machine-specific macOS user paths without old checkout knowledge', async () => {
  const source=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\/Users\/dzzk\/WORK\/_bridge-local-execution/);
  const match=source.match(/function compactMessage\(message\) \{[\s\S]*?\n\}/);
  assert.ok(match,'compactMessage function not found');
  const context={};
  vm.createContext(context);
  vm.runInContext(match[0]+'; this.compactMessage=compactMessage;',context);
  assert.equal(
    context.compactMessage('/Users/alice/WORK/project/file.txt'),
    '~/WORK/project/file.txt'
  );
  assert.equal(
    context.compactMessage('/Users/bob/WORK/browser-bridge-runs/2026/run.log'),
    '…/runs/2026/run.log'
  );
  assert.equal(
    context.compactMessage('prefix /Users/carol/tmp/output.txt suffix'),
    'prefix ~/tmp/output.txt suffix'
  );
});
