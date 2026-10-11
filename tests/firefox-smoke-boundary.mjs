import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firefox live smoke crosses only the authenticated runtime boundary',async()=>{
  const src=await readFile(new URL('../scripts/firefox-smoke-live.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/server\/index\.mjs|createBridgeServer/);
  assert.match(src,/EDH_PAIRING_TOKEN/);
  assert.match(src,/EDH_COMPANION_BASE/);
  assert.match(src,/EDH_MCP_RESOURCE/);
  assert.match(src,/EDH_OAUTH_ISSUER/);
  assert.match(src,/EDH_FIREFOX_ADDON/);
  assert.match(src,/pairingToken/);
});
