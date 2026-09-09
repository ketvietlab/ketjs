import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { materializeAtlasDesignSystem } from '../packages/design-system/src/atlas-cli.ts'

test('design system: KetAtlas materialization is complete and reproducible', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ket-design-system-atlas-'))
  try {
    writeFileSync(
      join(directory, 'atlas.json'),
      `${JSON.stringify({ version: 1, name: 'Design-system fixture', screens: [] }, null, 2)}\n`,
    )

    materializeAtlasDesignSystem(directory)
    materializeAtlasDesignSystem(directory, 'check')

    const css = readFileSync(join(directory, 'assets/ket-design-system.css'), 'utf8')
    const contracts = readFileSync(join(directory, 'assets/ket-design-system-contracts.js'), 'utf8')
    const runtime = readFileSync(join(directory, 'assets/ket-design-system-runtime.js'), 'utf8')
    const lock = JSON.parse(readFileSync(join(directory, 'design-system.lock.json'), 'utf8')) as {
      schemaVersion: string
      adapterSchemaVersion: string
      adapter: string
      registeredComponents: number
      files: Array<{ path: string; sha256: string }>
    }

    assert.match(css, /data-ui="action"/u)
    assert.doesNotMatch(css, /^@import\s+["']/mu)
    assert.match(contracts, /window\["ATLAS_DESIGN_SYSTEM"\]\["templates"\]/u)
    assert.match(runtime, /window\["ATLAS_DESIGN_SYSTEM"\]\["attach"\] = attachDesignSystemInteractions/u)
    assert.match(contracts, /__ATLAS_SLOT_TITLE__/u)
    assert.doesNotMatch(runtime, /\bexport\s/u)
    for (const contract of ['list', 'record', 'record-solo', 'flow', 'canvas', 'shell', 'section', 'metric'])
      assert.match(contracts, new RegExp(`"${contract}"`, 'u'))
    assert.equal(lock.schemaVersion, 'ketatlas.design-system-lock.v1')
    assert.equal(lock.adapterSchemaVersion, 'ketatlas.design-system-adapter.v1')
    assert.equal(lock.adapter, '@ketvietlab/design-system')
    assert.equal(lock.registeredComponents, 106)
    assert.deepEqual(
      lock.files.map((file) => file.path),
      [
        'assets/ket-design-system.css',
        'assets/ket-design-system-contracts.js',
        'assets/ket-design-system-runtime.js',
      ],
    )

    writeFileSync(join(directory, 'assets/ket-design-system.css'), `${css}/* stale */\n`)
    assert.throws(
      () => materializeAtlasDesignSystem(directory, 'check'),
      /KetAtlas design-system materialization is stale/u,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
