import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/cicd.yml', import.meta.url), 'utf8')

test('ordinary app pushes compile and test the Android runtime', () => {
  assert.match(workflow, /actions\/setup-java@v5/)
  assert.match(workflow, /gradle\/actions\/setup-gradle@v6/)
  assert.match(workflow, /gradle-version:\s*['"]?8\.10\.2/)
  assert.match(workflow, /:app:testDebugUnitTest/)
  assert.match(workflow, /:app:assembleDebug/)
})
