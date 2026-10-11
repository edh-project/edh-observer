import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const py=String.raw`
import importlib.util, json, os, tempfile
from pathlib import Path
p=Path('scripts/run-observer.py').resolve()

with tempfile.TemporaryDirectory() as td:
    os.environ.pop('EDH_RUNS_ROOT',None)
    os.environ.pop('EDH_OBSERVED_REPO',None)
    os.environ.pop('EDH_COMMANDS_LOG',None)
    old=os.getcwd(); os.chdir(td)
    spec=importlib.util.spec_from_file_location('obs_default',p)
    m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert m.DEFAULT_REPO == Path(td).resolve()
    assert m.DEFAULT_ROOT == (Path.home()/'.local/state/execution-delivery-harness/agent-runs').resolve()
    assert m.DEFAULT_COMMANDS == (Path.home()/'.local/state/execution-delivery-harness/commands.log').resolve()
    os.chdir(old)

with tempfile.TemporaryDirectory() as td:
    runs=Path(td)/'runs'; repo=Path(td)/'repo'; commands=Path(td)/'commands.log'
    os.environ['EDH_RUNS_ROOT']=str(runs)
    os.environ['EDH_OBSERVED_REPO']=str(repo)
    os.environ['EDH_COMMANDS_LOG']=str(commands)
    spec=importlib.util.spec_from_file_location('obs_env',p)
    m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert m.DEFAULT_ROOT == runs.resolve()
    assert m.DEFAULT_REPO == repo.resolve()
    assert m.DEFAULT_COMMANDS == commands.resolve()
print('portable-defaults-pass')
`;

test('run-observer defaults are portable and env-overridable',()=>{
  const r=spawnSync('python3',['-c',py],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/portable-defaults-pass/);
});
