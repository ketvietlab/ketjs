import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import * as billingScreens from '../packages/ketsuite/src/modules/hospitality_billing/screens/index.ts'
import { ListScreenFrame as BillingListFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import * as coreScreens from '../packages/ketsuite/src/modules/hospitality_core/screens/index.ts'
import {
  FormScreenFrame as CoreFormFrame,
  ListScreenFrame as CoreListFrame,
} from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('Hospitality exports one focused module for every routed renderer', () => {
  assert.equal(Object.keys(coreScreens).filter((name) => name.endsWith('Screen')).length, 31)
  assert.equal(Object.keys(billingScreens).filter((name) => name.endsWith('Screen')).length, 2)
})

test('Hospitality collection and form adapters use public page contracts', () => {
  const props = { translator: translate, title: 'Hospitality', frame: {}, body: <p>Body</p> }
  assert.match(renderToString(CoreListFrame(props)), /data-ui="list-page"/)
  assert.match(renderToString(CoreFormFrame(props)), /data-ui="form-page"/)
  assert.match(renderToString(BillingListFrame(props)), /data-ui="list-page"/)
})
