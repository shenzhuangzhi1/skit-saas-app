import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function loadQueryGate() {
  const moduleUrl = pathToFileURL(resolve(root, 'pages/user/wallet/point-record-query.mjs'));
  moduleUrl.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

test('a new point-record filter invalidates the older in-flight response', async () => {
  const { createPointRecordQueryGate } = await loadQueryGate();
  const gate = createPointRecordQueryGate();
  const incomeRequest = gate.tryStart({ pageNo: 1, filterSignature: 'income' });

  gate.invalidate();
  const expenseRequest = gate.tryStart({ pageNo: 1, filterSignature: 'expense' });

  assert.equal(gate.isCurrent(incomeRequest), false);
  assert.equal(gate.isCurrent(expenseRequest), true);
  assert.equal(gate.finish(expenseRequest), true);
  assert.equal(gate.isLoading(), false);
});

test('point-record pagination permits only one in-flight page per filter', async () => {
  const { createPointRecordQueryGate } = await loadQueryGate();
  const gate = createPointRecordQueryGate();
  const pageTwo = gate.tryStart({ pageNo: 2, filterSignature: 'all' });
  const duplicateReachBottom = gate.tryStart({ pageNo: 3, filterSignature: 'all' });

  assert.ok(pageTwo);
  assert.equal(duplicateReachBottom, null);
  assert.equal(gate.finish(pageTwo), true);
  assert.ok(gate.tryStart({ pageNo: 3, filterSignature: 'all' }));
});

test('point page wires the request gate into filter reset and load-more guards', () => {
  const source = readFileSync(resolve(root, 'pages/user/wallet/score.vue'), 'utf8');

  assert.match(source, /createPointRecordQueryGate/);
  assert.match(source, /pointQueryGate\.invalidate\(\)/);
  assert.match(source, /pointQueryGate\.isCurrent\(request\)/);
  assert.match(source, /state\.loadStatus === 'loading'/);
  assert.match(source, /pointQueryGate\.isLoading\(\)/);
});
