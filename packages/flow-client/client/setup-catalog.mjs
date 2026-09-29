import { tr } from './i18n.mjs'
import { FlowCatalogEditor } from '@ketvietlab/flow-ui/workspace'

// Project setup edits a draft; no catalog is mutated before the project is saved.
export function setupCatalog(props) {
  return FlowCatalogEditor({
    ...props,
    kindOptions: [
      { value: 'todo', label: tr('flow.ui.not.started') },
      { value: 'progress', label: tr('flow.ui.in.progress') },
      {
        value: 'review',
        label:
          props.id === 'projectStatuses'
            ? tr('flow.ui.paused.pending.approval')
            : tr('flow.ui.awaiting.acceptance.9782f0'),
      },
      { value: 'done', label: tr('flow.ui.done') },
    ],
  })
}
