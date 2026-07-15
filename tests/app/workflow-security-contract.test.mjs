import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

test('every production-capable workflow is restricted to master', () => {
  for (const workflow of [
    '.github/workflows/cicd.yml',
    '.github/workflows/android-production.yml',
    '.github/workflows/hot-update.yml'
  ]) {
    assert.match(read(workflow), /if: github\.ref == 'refs\/heads\/master'/, workflow)
  }
})

test('app source deployment uses the pinned production SSH host key', () => {
  const workflow = read('.github/workflows/cicd.yml')
  assert.doesNotMatch(workflow, /ssh-keyscan/)
  assert.match(workflow, /install -m 600 deploy\/known_hosts ~\/\.ssh\/known_hosts/)
  assert.match(read('deploy/known_hosts'), /^124\.221\.50\.30 ssh-ed25519 /m)
})

test('self-hosted production workflows always erase materialized secrets', () => {
  const apk = read('.github/workflows/android-production.yml')
  const hot = read('.github/workflows/hot-update.yml')
  for (const [name, workflow, directory] of [
    ['apk', apk, '$RUNNER_TEMP/skit-production'],
    ['hot update', hot, '$RUNNER_TEMP/skit-hot-update']
  ]) {
    assert.match(workflow, /if: always\(\)/, name)
    assert.ok(workflow.includes(`rm -rf "${directory}"`), name)
  }
})
