import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const playerSource = readFileSync(resolve(root, 'pages/drama/play.vue'), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = playerSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function zIndex(rule) {
  const match = rule.match(/z-index:\s*(-?\d+)/);
  return match ? Number(match[1]) : 0;
}

test('locked episode controls stay above the player placeholder for touch input', () => {
  const placeholderLayer = cssRule('.content-placeholder');
  const lockedLayer = cssRule('.locked-layer');

  assert.ok(
    zIndex(lockedLayer) > zIndex(placeholderLayer),
    'the visible unlock button must be in the top hit-testing layer',
  );
});
