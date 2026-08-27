import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  FormScreenFrame as LoyaltyFormFrame,
  ListScreenFrame as LoyaltyListFrame,
} from '../packages/ketsuite/src/modules/loyalty_backend/screens/page-frame.tsx'
import {
  reportEditorScreen,
  reportsScreen,
} from '../packages/ketsuite/src/modules/report_backend/screens/index.tsx'
import {
  FormScreenFrame as WebsiteFormFrame,
  ListScreenFrame as WebsiteListFrame,
} from '../packages/ketsuite/src/modules/website_backend/screens/page-frame.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('Website and Loyalty page frames use the shared ListPage and FormPage contracts', () => {
  for (const frame of [WebsiteListFrame, LoyaltyListFrame]) {
    assert.match(
      renderToString(frame({ translator: translate, title: 'List', frame: {}, body: <p>Rows</p> })),
      /data-ui="list-page"/,
    )
  }
  for (const frame of [WebsiteFormFrame, LoyaltyFormFrame]) {
    assert.match(
      renderToString(frame({ translator: translate, title: 'Form', frame: {}, body: <p>Fields</p> })),
      /data-ui="form-page"/,
    )
  }
})

test('Report list uses ListPage while the editor retains its specialized workspace', () => {
  const list = renderToString(reportsScreen(translate, {}, [], '?lang=en'))
  const editor = renderToString(
    reportEditorScreen(
      translate,
      {},
      {
        title: 'orders.report',
        action: '/admin/reports/orders.report?lang=en',
        previewAction: '/admin/reports/orders.report/preview?lang=en',
        template: { revision: 2, draft: '<report />' },
        versions: [],
      },
    ),
  )

  assert.match(list, /data-ui="list-page"/)
  assert.match(editor, /data-ui="record-form"/)
  assert.match(editor, /formaction="\/admin\/reports\/orders\.report\/preview\?lang=en"/)
})
