import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

async function loadContextCore() {
  const moduleUrl = pathToFileURL(
    resolve(root, 'sheep/services/member-app-context-core.mjs'),
  );
  moduleUrl.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

test('white-label bootstrap binds the resolved numeric tenant before returning', async () => {
  const { createMemberAppContextManager } = await loadContextCore();
  const storage = new Map([['tenant-id', 1]]);
  const manager = createMemberAppContextManager({
    read: (key) => storage.get(key),
    write: (key, value) => storage.set(key, value),
    remove: (key) => storage.delete(key),
    now: () => Date.parse('2026-07-24T00:00:00Z'),
    bootstrap: async ({ agentCode }) => ({
      code: 0,
      data: {
        token: `context-${agentCode}`,
        tenantId: 162,
        expiresTime: '2026-07-24T00:30:00Z',
      },
    }),
  });

  const context = await manager.resolve('ag162');

  assert.equal(context.agentCode, 'AG162');
  assert.equal(context.tenantId, 162);
  assert.equal(storage.get('tenant-id'), 162);
  assert.equal(storage.get('skit-member-app-context').tenantId, 162);
});

test('concurrent white-label consumers share one bootstrap request', async () => {
  const { createMemberAppContextManager } = await loadContextCore();
  const storage = new Map();
  let bootstrapCalls = 0;
  const manager = createMemberAppContextManager({
    read: (key) => storage.get(key),
    write: (key, value) => storage.set(key, value),
    remove: (key) => storage.delete(key),
    now: () => Date.parse('2026-07-24T00:00:00Z'),
    bootstrap: async () => {
      bootstrapCalls += 1;
      return {
        code: 0,
        data: {
          token: 'shared-context',
          tenantId: 162,
          expiresTime: '2026-07-24T00:30:00Z',
        },
      };
    },
  });

  const [first, second] = await Promise.all([manager.resolve('AG162'), manager.resolve('AG162')]);

  assert.equal(bootstrapCalls, 1);
  assert.equal(first, second);
  assert.equal(storage.get('tenant-id'), 162);
});

test('app and ad-config paths wait for the white-label tenant and reject env tenant fallback', () => {
  const app = read('App.vue');
  const context = read('sheep/services/member-app-context.js');
  const userStore = read('sheep/store/user.js');
  const request = read('sheep/request/index.js');

  assert.match(app, /await resolveMemberAppContext\(builtAgentCode\)[\s\S]*await ShoproInit\(\)/);
  assert.match(context, /result\.data\.tenantId|createMemberAppContextManager/);
  assert.match(userStore, /ensureMemberAppContext\(BUILT_AGENT_CODE\)[\s\S]*activeTenantScope\(\)/);
  assert.match(
    userStore,
    /ensureMemberAppContext\(BUILT_AGENT_CODE\)[\s\S]*?catch[\s\S]*?clearDisplayAdConfig\(\)[\s\S]*?throw/,
  );
  assert.match(request, /BUILT_AGENT_CODE[\s\S]*return storedTenantId \|\| undefined/);
});
