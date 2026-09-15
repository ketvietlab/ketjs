import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'modal-layer',
  'modal-backdrop',
  'modal-sheet',
  'modal-head',
  'modal-heading',
  'modal-title',
  'modal-description',
  'modal-close',
  'modal-body',
  'modal-actions',
] as const

export const ModalSheet = (props: {
  id: string
  title: string
  body: JSXChild
  /** Required for `overlay`: a route modal closes by navigating. Ignored in `client` mode. */
  closeHref?: string
  closeLabel: string
  description?: string | null
  actions?: JSXChild
  presentation?: 'sheet' | 'dialog'
  size?: 'default' | 'large'
  /**
   * `content` (default) lets a dialog grow with its body up to the viewport cap. `fixed`
   * holds the dialog at that cap so switching between tabs of different heights does not
   * resize it; the body scrolls inside while the head stays put.
   */
  height?: 'content' | 'fixed'
  /**
   * `overlay` is URL-owned: its close controls are links the route runtime
   * follows. `client` belongs to a modal island that opens and closes it in the
   * browser: close controls are buttons, and it carries no route-modal marker, so
   * no navigation layer ever treats closing it as a page change.
   */
  mode?: 'overlay' | 'embedded' | 'client'
  unsavedPrompt?: string | null
}): TemplateResult => {
  const client = props.mode === 'client'
  const embedded = props.mode === 'embedded'
  return (
    <div
      data-ui="modal-layer"
      data-mode={props.mode ?? 'overlay'}
      data-route-modal={embedded || client ? null : 'true'}
      data-client-modal={client ? 'true' : null}
      data-presentation={props.presentation ?? 'sheet'}
      data-unsaved-prompt={props.unsavedPrompt ?? null}
    >
      {client ? (
        <button data-ui="modal-backdrop" type="button" aria-label={props.closeLabel} tabindex="-1">
          <span>{props.closeLabel}</span>
        </button>
      ) : (
        <a data-ui="modal-backdrop" href={props.closeHref ?? '#'} aria-label={props.closeLabel}>
          <span>{props.closeLabel}</span>
        </a>
      )}
      <section
        id={props.id}
        data-ui="modal-sheet"
        data-size={props.size ?? 'default'}
        data-height={props.height === 'fixed' ? 'fixed' : null}
        role="dialog"
        aria-modal={embedded ? 'false' : 'true'}
        aria-labelledby={`${props.id}-title`}
        aria-describedby={props.description ? `${props.id}-description` : null}
        tabindex={embedded ? null : '-1'}
      >
        <header data-ui="modal-head">
          <div data-ui="modal-heading">
            <h2 data-ui="modal-title" id={`${props.id}-title`}>
              {props.title}
            </h2>
            {!!props.description && (
              <p data-ui="modal-description" id={`${props.id}-description`}>
                {props.description}
              </p>
            )}
          </div>
          {client ? (
            <button
              data-ui="modal-close"
              type="button"
              aria-label={props.closeLabel}
              title={props.closeLabel}
            >
              ×
            </button>
          ) : (
            <a
              data-ui="modal-close"
              href={props.closeHref ?? '#'}
              aria-label={props.closeLabel}
              title={props.closeLabel}
            >
              ×
            </a>
          )}
        </header>
        <div data-ui="modal-body">{props.body}</div>
        {props.actions !== undefined && <footer data-ui="modal-actions">{props.actions}</footer>}
      </section>
    </div>
  )
}
