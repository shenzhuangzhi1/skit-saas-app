import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function loadDramaScore() {
  try {
    return await import(pathToFileURL(resolve(root, 'pages/drama/services/drama-score.mjs')).href);
  } catch {
    return {};
  }
}

test('missing or invalid provider scores never render as a rating', async () => {
  const { normalizeDramaScore } = await loadDramaScore();

  assert.equal(typeof normalizeDramaScore, 'function', 'score normalizer must exist');
  for (const value of [
    undefined,
    null,
    '',
    ' ',
    'not-a-score',
    '0xA',
    '1e1',
    '+8.5',
    -1,
    10.1,
    Infinity,
  ]) {
    assert.equal(normalizeDramaScore(value), '', `invalid score ${String(value)} must stay hidden`);
  }
});

test('real provider scores are bounded and formatted consistently', async () => {
  const { normalizeDramaScore } = await loadDramaScore();

  assert.equal(normalizeDramaScore(0), '0.0');
  assert.equal(normalizeDramaScore('8.6'), '8.6');
  assert.equal(normalizeDramaScore(9), '9.0');
  assert.equal(normalizeDramaScore(9.26), '9.3');
  assert.equal(normalizeDramaScore(10), '10.0');
});

test('cached drama records are normalized again after an APK upgrade', async () => {
  const { normalizeDramaRecordScore } = await loadDramaScore();
  const dataSource = readFileSync(resolve(root, 'pages/drama/data.js'), 'utf8');

  assert.equal(typeof normalizeDramaRecordScore, 'function');
  assert.deepEqual(normalizeDramaRecordScore({ id: 1, score: '0xA' }), {
    id: 1,
    score: '',
  });
  assert.deepEqual(normalizeDramaRecordScore({ id: 2, score: '8.65' }), {
    id: 2,
    score: '8.7',
  });
  assert.deepEqual(
    normalizeDramaRecordScore({
      id: 3,
      source: 'pangle-drama-sdk',
      score: '9.0',
      raw: {},
    }),
    {
      id: 3,
      source: 'pangle-drama-sdk',
      score: '',
      raw: {},
    },
  );
  assert.deepEqual(
    normalizeDramaRecordScore({
      id: 4,
      source: 'pangle-drama-sdk',
      score: '9.0',
      raw: { score: 8.64 },
    }),
    {
      id: 4,
      source: 'pangle-drama-sdk',
      score: '8.6',
      raw: { score: 8.64 },
    },
  );
  assert.match(
    dataSource,
    /import \{ normalizeDramaRecordScore \} from '.\/services\/drama-score\.mjs'/,
  );
  assert.match(dataSource, /\.map\(normalizeDramaRecordScore\)/);
});

test('drama cards omit the entire score badge when the provider has no score', () => {
  const card = readFileSync(resolve(root, 'pages/drama/components/DramaCard.vue'), 'utf8');
  const service = readFileSync(resolve(root, 'pages/drama/services/pangle-content.js'), 'utf8');

  assert.match(card, /v-if="drama\.score"\s+class="poster-score"/);
  assert.match(service, /score:\s*normalizeDramaScore\(raw\.score\)/);
  assert.doesNotMatch(service, /score:\s*raw\.score\s*\?\?\s*''/);
});
