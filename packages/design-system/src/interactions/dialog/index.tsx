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
  /** `small` for a short confirmation, `large` for a review that needs room. */
  size?: 'small' | 'default' | 'large'
  unsavedPrompt?: string
}

const frame = (props: DialogProps, kind: 'confirm' | null): TemplateResult => (
  <div data-ui="dialog" data-kind={kind}>
    <ModalSheet {...props} presentation="dialog" />
  </div>
)

export const Dialog = (props: DialogProps): TemplateResult => frame(props, null)

export type ConfirmDialogProps = Omit<DialogProps, 'body' | 'actions'> & {
  message: string
  confirmLabel: string
  confirmName?: string
  confirmValue?: string
  confirmForm?: string
  confirmVariant?: ActionVariant
  confirmDisabled?: boolean
  /**
   * What the person must see or acknowledge before confirming, under the message: an impact
   * notice, or an acknowledgement checkbox inside the form named by `confirmForm`.
   */
  details?: JSXChild
}

/**
 * Asks before an action that is hard to undo. Always a small centred dialog, on a phone too:
 * a confirmation never becomes a side sheet or a full-screen page.
 */
export const ConfirmDialog = (props: ConfirmDialogProps): TemplateResult =>
  frame(
    {
      ...props,
      size: props.size ?? 'small',
      body: (
        <>
          <p data-ui="confirm-dialog-message">{props.message}</p>
          {props.details}
        </>
      ),
      actions: (
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
              disabled={props.confirmDisabled ?? false}
            />,
          ]}
        />
      ),
    },
    'confirm',
  )
