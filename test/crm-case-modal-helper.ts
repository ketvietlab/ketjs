import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  caseModalDefinition,
  type CaseModalData,
} from '../packages/ketsuite/src/modules/crm_backend/modal/case-modal-view.tsx'

export type CaseModalPayload = { data: CaseModalData; messages: Record<string, string> }
export const caseContext = (
  payload: CaseModalPayload,
  tab = 'overview',
  dialog?: string,
): RecordModalContext<CaseModalData> => ({
  kind: 'crm.case',
  id: String(payload.data.record.id || 'new'),
  creating: !payload.data.record.id,
  tab,
  data: payload.data,
  t: (key) => payload.messages[key] ?? key,
  fieldError: () => null,
  draft: (_name, fallback = '') => fallback,
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: dialog ? { name: dialog, params: {} } : null,
  href: () => '',
  state: (_name, fallback = '') => fallback,
})
export const renderCaseModal = (payload: CaseModalPayload, tab = 'overview', dialog?: string) => {
  const c = caseContext(payload, tab, dialog)
  const render = (view: JSXChild) => renderToString(view as TemplateResult)
  if (dialog) {
    const definition = caseModalDefinition.dialogs![dialog]!
    return (
      (typeof definition.title === 'function' ? definition.title(c) : definition.title) +
      render(definition.view(c))
    )
  }
  return (
    render(
      c.creating
        ? caseModalDefinition.body!(c)
        : caseModalDefinition.tabs!.find((item) => item.id === tab)!.view(c),
    ) + render(caseModalDefinition.actions!(c))
  )
}
