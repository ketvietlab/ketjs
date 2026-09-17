import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { scaffoldView } from '@ketvietlab/create-view'
import { buildProject, checkProject } from '@ketvietlab/ketjs-view-tools'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-view-test-'))
  scaffoldView('static-site', dir)
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

test('create-view scaffolds a complete static project without overwriting files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-view-test-'))
  try {
    const output = scaffoldView('example-site', dir)
    assert.ok(output.some((line) => line.includes('npm run dev')))
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name, 'example-site')
    assert.ok(existsSync(join(dir, 'src/pages/index.ts')))
    assert.throws(() => scaffoldView('example-site', dir), /refusing to overwrite/)
    assert.throws(() => scaffoldView('Not Valid', join(dir, 'invalid')), /invalid project name/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('view tools emit static pages and preserve markers only inside islands', async () => {
  const dir = project()
  try {
    const checked = await checkProject(dir)
    assert.deepEqual(
      checked.pages.map((page) => page.route),
      ['/about/', '/'],
    )

    const result = await buildProject(dir)
    assert.equal(result.pages.length, 2)
    assert.ok(result.assets.some((asset) => asset.endsWith('.css')))
    assert.ok(result.assets.some((asset) => asset.endsWith('.js')))

    const home = readFileSync(join(dir, 'dist/index.html'), 'utf8')
    assert.match(home, /<div data-ket-island="" data-island="counter"/)
    assert.equal(home.match(/<!--k(?:\[)?-->/g)?.length, 2)
    assert.match(home, /<script type="module" src="\.\/assets\/app-[A-Z0-9]+\.js"><\/script>/)

    const about = readFileSync(join(dir, 'dist/about/index.html'), 'utf8')
    assert.ok(!about.includes('<!--k'))
    assert.ok(!about.includes('<script type="module"'))
    assert.match(about, /href="\.\.\/assets\/app-[A-Z0-9]+\.css"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('view tools reject an island that is absent from the client registry', async () => {
  const dir = project()
  try {
    await buildProject(dir)
    const previous = readFileSync(join(dir, 'dist/index.html'), 'utf8')
    writeFileSync(
      join(dir, 'ket-view.config.ts'),
      `import { defineConfig } from '@ketvietlab/ketjs-view-tools'\nexport default defineConfig({ styles: ['src/styles/main.css'] })\n`,
    )
    await assert.rejects(() => checkProject(dir), /does not register it/)
    await assert.rejects(() => buildProject(dir), /does not register it/)
    assert.equal(readFileSync(join(dir, 'dist/index.html'), 'utf8'), previous)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a site without islands emits CSS and no JavaScript', async () => {
  const dir = project()
  try {
    writeFileSync(
      join(dir, 'src/pages/index.ts'),
      `import { html } from '@ketvietlab/ketjs-view'\nimport { definePage } from '@ketvietlab/ketjs-view-tools'\nexport default definePage({ head: { title: 'Static' }, view: () => html\`<h1>Static</h1>\` })\n`,
    )
    writeFileSync(
      join(dir, 'ket-view.config.ts'),
      `import { defineConfig } from '@ketvietlab/ketjs-view-tools'\nexport default defineConfig({ styles: ['src/styles/main.css'] })\n`,
    )
    const result = await buildProject(dir)
    assert.ok(result.assets.some((asset) => asset.endsWith('.css')))
    assert.ok(!result.assets.some((asset) => asset.endsWith('.js')))
    assert.ok(!readFileSync(join(dir, 'dist/index.html'), 'utf8').includes('<script'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
