import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  submissionsScreen,
  type SubmissionRow,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const row = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1',
  summary: {},
  consent: true,
  status: 'new',
  createdAt: '2026-09-05T00:00:00.000Z',
  ...over,
})

const render = (rows: SubmissionRow[]) => renderToString(submissionsScreen(translate, rows, {}))

/**
 * This screen printed the whole payload, and kept printing it after
 * listSubmissions stopped carrying one - the route cast the result to
 * `never[]`, so the compiler had nothing to compare and the column quietly
 * rendered `undefined` for four merges. What follows is the contract that
 * would have caught it.
 */
test('submissions screen: a form that declares no preview says so, rather than printing nothing', () => {
  const html = render([row()])
  assert.match(html, /state\.noPreview/u)
  assert.equal(html.includes('undefined'), false, 'a blank column must read as a decision')
})

test('submissions screen: the declared preview answers are shown', () => {
  const html = render([row({ summary: { company: 'Moc Lam' } })])
  assert.match(html, /Moc Lam/u)
})

test('submissions screen: an erased submission is labelled, not shown as empty preview', () => {
  const html = render([row({ purgedAt: '2026-09-05T01:00:00.000Z', summary: {} })])
  assert.match(html, /state\.purged/u)
  assert.equal(html.includes('state.noPreview'), false, 'erased and never-previewable are not the same')
})

test('submissions screen: a hold shows the reason someone wrote down', () => {
  const html = render([row({ held: true, holdReason: 'tranh chap hop dong' })])
  assert.match(html, /tranh chap hop dong/u)
})

test('submissions screen: the payload never reaches the queue, whatever a caller passes', () => {
  // The row type has no payload, and a caller that smuggles one in must not
  // find it rendered: the queue is not where anyone reads what a visitor wrote.
  const smuggled = { ...row(), payload: { phone: '0900000000' } } as SubmissionRow
  const html = render([smuggled])
  assert.equal(html.includes('0900000000'), false)
})
