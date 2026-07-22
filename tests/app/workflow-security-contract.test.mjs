import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('every production-capable workflow is restricted to master', () => {
  for (const workflow of [
    '.github/workflows/cicd.yml',
    '.github/workflows/android-production.yml',
    '.github/workflows/hot-update.yml',
  ]) {
    assert.match(read(workflow), /if: github\.ref == 'refs\/heads\/master'/, workflow);
  }
});

test('app source deployment uses the pinned production SSH host key', () => {
  const workflow = read('.github/workflows/cicd.yml');
  assert.doesNotMatch(workflow, /ssh-keyscan/);
  assert.match(workflow, /install -m 600 deploy\/known_hosts ~\/\.ssh\/known_hosts/);
  assert.match(read('deploy/known_hosts'), /^124\.221\.50\.30 ssh-ed25519 /m);
});

test('self-hosted production workflows always erase materialized secrets', () => {
  const apk = read('.github/workflows/android-production.yml');
  const hot = read('.github/workflows/hot-update.yml');
  for (const [name, workflow, directory] of [
    ['apk', apk, '$RUNNER_TEMP/skit-production'],
    ['hot update', hot, '$RUNNER_TEMP/skit-hot-update'],
  ]) {
    assert.match(workflow, /if: always\(\)/, name);
    assert.ok(workflow.includes(`rm -rf "${directory}"`), name);
  }
});

test('production APK manifest checks cannot trip pipefail after grep exits early', () => {
  const verifier = read('android-djx-runtime/verify-production-apk.sh');

  assert.doesNotMatch(verifier, /printf[^\n]*MANIFEST_TREE[^\n]*\|[^\n]*grep -q/);
  assert.match(verifier, /\[\[ "\$MANIFEST_TREE" =~ android:debuggable\.\*0xffffffff \]\]/);
  assert.match(verifier, /\[\[ "\$MANIFEST_TREE" =~ android:usesCleartextTraffic\.\*0x0 \]\]/);
  assert.match(verifier, /\[\[ "\$MANIFEST_TREE" =~ android:networkSecurityConfig \]\]/);
});

test('production APK local-reward scan cannot hide a match behind unzip SIGPIPE', () => {
  const verifier = read('android-djx-runtime/verify-production-apk.sh');

  assert.doesNotMatch(
    verifier,
    /unzip -p "\$APK_FILE" 'assets\/www\/assets\/\*\.js' \|\s*\\?\s*grep -Eq/,
  );
  assert.match(verifier, /FRONTEND_JS_BUNDLE="\$TMP_DIR\/frontend-js\.txt"/);
  assert.match(verifier, /grep -Eq\s*\\?\s*'[^']+'\s*\\?\s*"\$FRONTEND_JS_BUNDLE"/);
});

test('agent APK gate verifies the protected production Pangle settings input', () => {
  const verifier = read('android-djx-runtime/verify-agent-apk.sh');

  assert.match(
    verifier,
    /PANGLE_SOURCE="\$\{SKIT_PANGLE_SETTINGS_JSON:-\$PROFILE_PANGLE_SOURCE\}"/,
  );
  assert.match(
    verifier,
    /PROFILE_PANGLE_SOURCE="\$PROJECT_DIR\/\$\(profile_value pangle\.settingsSource\)"/,
  );
});
