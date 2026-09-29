import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString, html } from '@ketvietlab/ketjs-view'
import { FlowEntryPage, FlowChecklist } from '../src/workspace.mjs'
import { FlowInput, FlowButton } from '../src/index.mjs'
import { readFileSync } from 'node:fs'

test('the entry page is one card without the shell, a form only when it submits, and numbered steps with the current one marked', () => {
  const page = renderToStaticString(
    FlowEntryPage({
      brand: 'Flow · Hoa Sen',
      title: 'Sign in',
      description: 'Use your email.',
      onSubmit: () => {},
      children: FlowInput({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username' }),
      actions: FlowButton({ label: 'Sign in', variant: 'primary', type: 'submit' }),
      footer: 'Forgot?',
    }),
  )
  assert.match(page, /^<main data-flow="entry-page">/)
  assert.doesNotMatch(page, /data-flow="shell/)
  assert.match(page, /<h1>Sign in<\/h1><p>Use your email\.<\/p>/)
  assert.match(
    page,
    /<form data-flow="entry-form"><div data-flow="entry-fields">[\s\S]*autocomplete="username"[\s\S]*<\/div><div data-flow="entry-actions"><button[^>]*type="submit"/,
  )
  assert.match(page, /<footer data-flow="entry-footer">Forgot\?<\/footer>/)
  assert.doesNotMatch(page, /entry-steps/)
  const steps = renderToStaticString(
    FlowEntryPage({
      brand: 'Flow',
      title: 'Project',
      stepsLabel: 'Setup steps',
      children: html`<p>x</p>`,
      steps: [
        { id: 'a', label: 'Workspace', complete: true, current: false },
        { id: 'b', label: 'Project', complete: false, current: true },
        { id: 'c', label: 'Invite', complete: false, current: false },
      ],
    }),
  )
  assert.doesNotMatch(steps, /<form/)
  assert.match(
    steps,
    /<ol data-flow="entry-steps" aria-label="Setup steps"><li data-complete="true"><span><svg[\s\S]*?<\/svg><\/span>Workspace<\/li><li data-complete="false" aria-current="step"><span>2<\/span>Project<\/li><li data-complete="false"><span>3<\/span>Invite<\/li><\/ol>/,
  )
})

test('the checklist shows progress, names each state for screen readers and drops the action of a finished step', () => {
  const out = renderToStaticString(
    FlowChecklist({
      title: 'Get started',
      progressLabel: '1 of 2 done',
      done: 1,
      total: 2,
      doneLabel: 'Done',
      todoLabel: 'Not done yet',
      actions: FlowButton({ label: 'Hide', size: 'sm', variant: 'ghost' }),
      items: [
        {
          id: 'project',
          title: 'Create a project',
          done: true,
          action: FlowButton({ label: 'Create project' }),
        },
        {
          id: 'task',
          title: 'Add a task',
          description: 'Write it down.',
          done: false,
          action: FlowButton({ label: 'Create task' }),
        },
      ],
    }),
  )
  assert.match(out, /<section data-flow="checklist" aria-label="Get started">/)
  assert.match(out, /<progress[^>]*max="2"[^>]*value="1"/)
  assert.match(out, /<span>1 of 2 done<\/span>/)
  assert.match(out, /<li data-done="true"><span data-flow="checklist-mark" role="img" aria-label="Done"><svg/)
  assert.doesNotMatch(
    out,
    /Create project<\/button>|Create project\s*<\/button>/,
    'a done step has nothing left to do',
  )
  assert.match(
    out,
    /<li data-done="false"><span data-flow="checklist-mark" role="img" aria-label="Not done yet"><\/span><div><strong>Add a task<\/strong><small>Write it down\.<\/small><\/div><button[\s\S]*?Create task/,
  )
})

test('entry page and checklist styles are scoped and use tokens only', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  // One chunk per rule (selector plus declarations), so the token checks see the values.
  const rules = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((rule) => /"(entry-|checklist)/.test(rule))
  assert.ok(rules.length > 20)
  for (const rule of rules) {
    assert.match(rule, /\[data-flow-ui\]/)
    assert.doesNotMatch(rule, /#[0-9a-f]{3,6}\b|font-size:\s*\d|border-radius:\s*\d/i, rule)
  }
  assert.match(css.replace(/\s+/g, ''), /\[data-flow="entry-page"\]\{min-height:100vh;/)
})
