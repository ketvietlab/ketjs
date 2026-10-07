import assert from 'node:assert/strict'
import test from 'node:test'
import { diagramTheme } from '../site/diagram-theme.ts'

test('diagram colors resolve from DS tokens and theme directives cannot replace the site theme', () => {
  const tokens = {
    '--kv-panel-bg': '#ffffff',
    '--kv-panel-bg-subtle': '#f4f4f5',
    '--kv-text-main': '#24262a',
    '--kv-text-secondary': '#565b62',
    '--kv-accent': '#4f5ed0',
    '--kv-border-default': '#dedfe2',
  }
  const config = diagramTheme((name) => tokens[name])
  assert.equal(config.theme, 'base')
  assert.equal(config.securityLevel, 'strict')
  assert.equal(config.themeVariables.primaryBorderColor, tokens['--kv-accent'])
  assert.equal(config.themeVariables.primaryTextColor, tokens['--kv-text-main'])
  assert.equal(config.themeVariables.background, tokens['--kv-panel-bg'])
  assert.equal(config.themeVariables.lineColor, tokens['--kv-text-secondary'])
  assert.equal(config.themeVariables.actorTextColor, tokens['--kv-text-main'])
  assert.equal(config.themeVariables.actorBkg, tokens['--kv-panel-bg'])
  assert.match(config.themeCSS, /rx: var\(--kv-radius-md\)/)
  assert.match(config.themeCSS, /filter: none !important/)
  assert.equal(config.sequence.messageFontSize, 13)
  assert.ok(config.secure.includes('themeVariables'))
  assert.ok(config.secure.includes('theme'))
})
