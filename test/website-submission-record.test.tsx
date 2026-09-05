import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  type SubmissionAuditRow,
  type SubmissionRecord,
  submissionRecordScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const record = (over: Partial<SubmissionRecord> = {}): SubmissionRecord => ({
  id: 's1',
  formId: 'f1',
  payload: { email: 'mai@example.test', message: 'Can bao gia' },
  consent: true,
  consentText: 'Toi dong y duoc lien he.',
  status: 'new',
  createdAt: '2026-09-05T00:00:00.000Z',
  ...over,
})

const audit = (over: Partial<SubmissionAuditRow> = {}): SubmissionAuditRow => ({
  id: 'a1',
  action: 'read',
  actorKey: 'boss',
  submissionId: 's1',
  occurredAt: '2026-09-05T01:00:00.000Z',
  ...over,
})

const render = (r = record(), rows: SubmissionAuditRow[] = []) =>
  renderToString(submissionRecordScreen(translate, r, rows, {}))

/**
 * readSubmission has filed an audit row for every read since it was written,
 * and until this screen existed it was recording calls nobody could make: the
 * queue carries no answers on purpose, and there was no other way in.
 */
test('submission record: the answers are readable here, which is the only place they are', () => {
  const html = render()
  assert.match(html, /mai@example\.test/u)
  assert.match(html, /Can bao gia/u)
})

test('submission record: the notice the visitor agreed to is shown verbatim', () => {
  const html = render()
  assert.match(html, /Toi dong y duoc lien he\./u)
  assert.match(html, /state\.yes/u)
})

test('submission record: an erased submission says so instead of showing an empty table', () => {
  const html = render(record({ payload: {}, purgedAt: '2026-09-05T02:00:00.000Z' }))
  assert.match(html, /state\.purged/u)
  assert.match(html, /submission\.noAnswers/u)
  // The consent record outlives the answers, and the screen still shows it.
  assert.match(html, /Toi dong y duoc lien he\./u)
})

test('submission record: a hold is shown as a notice and as the reason in its own box', () => {
  const html = render(record({ holdReason: 'tranh chap hop dong' }))
  assert.match(html, /tranh chap hop dong/u)
  assert.match(html, /submission\.holdReasonHint/u, 'and it says that blank releases the hold')
})

test('submission record: who looked is shown beside what they looked at', () => {
  const html = render(record(), [audit(), audit({ id: 'a2', action: 'hold', reason: 'kiem tra' })])
  assert.match(html, /boss/u)
  assert.match(html, /kiem tra/u)
})

test('submission record: a record nobody has opened says so rather than showing an empty table', () => {
  const html = render()
  assert.match(html, /submission\.noAudit/u)
})
