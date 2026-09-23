import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup, Button, LinkButton } from '../../primitives/actions/index.tsx'
import type { ActionVariant } from '../../primitives/actions/index.tsx'
import { ModalSheet } from '../../patterns/modal-sheet/index.tsx'

export const HOOKS = ['dialog', 'confirm-dialog-message'] as const

export type DialogProps = {
  id: string
  title: string
  body: JSXChild
  closeHref: string
  closeLabel: string
  description?: string
  actions?: JSXChild
  mode?: 'overlay' | 'embedded'
  unsavedPrompt?: string
}

export const Dialog = (props: DialogProps): TemplateResult => (
  <div data-ui="dialog">
    <ModalSheet {...props} presentation="dialog" />
  </div>
)

export type ConfirmDialogProps = Omit<DialogProps, 'body' | 'actions'> & {
  message: string
  confirmLabel: string
  confirmName?: string
  confirmValue?: string
  confirmForm?: string
  confirmVariant?: ActionVariant
}

export const ConfirmDialog = (props: ConfirmDialogProps): TemplateResult => (
  <Dialog
    {...props}
    body={<p data-ui="confirm-dialog-message">{props.message}</p>}
    actions={
      <ActionGroup
        label={props.title}
        actions={[
          <LinkButton label={props.closeLabel} href={props.closeHref} />,
          <Button
            label={props.confirmLabel}
            variant={props.confirmVariant ?? 'destructive'}
            type="submit"
            name={props.confirmName ?? 'intent'}
            value={props.confirmValue ?? 'confirm'}
            form={props.confirmForm ?? null}
          />,
        ]}
      />
    }
  />
)
