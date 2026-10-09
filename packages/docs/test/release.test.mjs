import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { expandVersion, frameworkVersion } from '../site/release.ts'

test('the website displays its installed npm runtime version independently of framework source', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/@ketvietlab/ketjs-view/package.json', import.meta.url), 'utf8'),
  )
  assert.equal(frameworkVersion, installed.version)
  assert.equal(frameworkVersion, manifest.dependencies['@ketvietlab/ketjs-view'])
  assert.equal(frameworkVersion, manifest.devDependencies['@ketvietlab/ketjs-view-tools'])
  assert.match(frameworkVersion, /^\d+\.\d+\.\d+$/)
})

test('learning labs pin the same published framework version as the documentation runtime', () => {
  const projects = [
    { directory: 'api', packages: ['@ketvietlab/ketjs'] },
    { directory: 'view', packages: ['@ketvietlab/ketjs-view', '@ketvietlab/ketjs-view-tools'] },
  ]
  for (const project of projects) {
    const manifest = JSON.parse(
      readFileSync(new URL(`../tutorials/${project.directory}/package.json`, import.meta.url), 'utf8'),
    )
    const lock = JSON.parse(
      readFileSync(new URL(`../tutorials/${project.directory}/package-lock.json`, import.meta.url), 'utf8'),
    )
    for (const name of project.packages) {
      const declared = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]
      const locked = lock.packages[''].dependencies?.[name] ?? lock.packages[''].devDependencies?.[name]
      assert.equal(declared, frameworkVersion, `${project.directory}: ${name} manifest`)
      assert.equal(locked, frameworkVersion, `${project.directory}: ${name} lock declaration`)
      assert.equal(
        lock.packages[`node_modules/${name}`]?.version,
        frameworkVersion,
        `${project.directory}: ${name} installed version`,
      )
    }
  }
  const roadmap = readFileSync(new URL('../content/learn/index.md', import.meta.url), 'utf8')
  assert.ok(expandVersion(roadmap).includes(`KetJS ${frameworkVersion} preview`))
})
