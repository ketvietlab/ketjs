import { tr } from './i18n.mjs'
import { html } from '@ketvietlab/ketjs-view'
import { FlowIcon, FlowInput, FlowButton } from './index.mjs'
/** Compact date value opens the same native date input used by record forms.
 * @param {{id:string,label:string,value:string,min?:string,max?:string,disabled?:boolean,overdue?:boolean,onChange:(value:string)=>void}} p */
export function FlowDateField(p) {
  const formatted = p.value ? p.value.split('-').reverse().join('/') : tr('flow.ui.set.due.date')
  /** @param {HTMLElement} menu */
  const close = (menu) => {
    menu.hidePopover()
    const trigger = menu.parentElement?.querySelector('[data-flow="date-trigger"]')
    if (trigger instanceof HTMLElement) trigger.focus()
  }
  return html`<div data-flow="date-field">
  <button id=${p.id} type="button" data-flow="date-trigger" data-overdue=${p.overdue ? 'true' : null} disabled=${p.disabled ?? false} aria-label=${`${p.label}: ${p.value ? formatted : tr('flow.ui.not.set.ba42e8')}${p.overdue ? ' · ' + tr('flow.ui.overdue') : ''}`} title=${`${p.label}: ${p.value ? formatted : tr('flow.ui.not.set.ba42e8')}${p.overdue ? ' · ' + tr('flow.ui.overdue') : ''}`} aria-haspopup="dialog" popovertarget=${`${p.id}-menu`}
   on:click=${
     /** @param {MouseEvent} e */ (e) => {
       const trigger = /** @type {HTMLElement} */ (e.currentTarget),
         menu = /** @type {HTMLElement} */ (trigger.parentElement?.querySelector('[popover]')),
         rect = trigger.getBoundingClientRect(),
         width = Math.min(288, window.innerWidth - 16)
       menu.style.width = `${width}px`
       menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
       menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 184))}px`
     }
}>
   ${p.value ? html`<span>${p.value.slice(8, 10)}/${p.value.slice(5, 7)}</span>` : html`${FlowIcon('calendar')}<span>${tr('flow.ui.set.due.date')}</span>`}
  </button>
  <div id=${`${p.id}-menu`} data-flow="date-menu" popover="auto" role="dialog" aria-label=${p.label}
   on:toggle=${
     /** @param {ToggleEvent} e */ (e) => {
       if (e.newState === 'open')
         /** @type {HTMLInputElement|null} */ (
           /** @type {HTMLElement} */ (e.currentTarget).querySelector('input')
         )?.focus()
     }
}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (e.key !== 'Escape') e.stopPropagation()
       if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).tagName === 'INPUT') e.preventDefault()
     }
}>
   ${FlowInput({
     id: `${p.id}-input`,
     label: p.label,
     type: 'date',
     value: p.value,
     min: p.min,
     max: p.max,
     disabled: p.disabled,
     onChange: /** @param {Event} e */ (e) => {
       const input = /** @type {HTMLInputElement} */ (e.currentTarget)
       if (p.disabled) return
       if (input.validity.valid) p.onChange(input.value)
       else input.reportValidity()
     },
   })}
   <div data-flow="date-actions">${FlowButton({
     label: tr('flow.ui.clear.due.date'),
     size: 'sm',
     variant: 'ghost',
     disabled: p.disabled || !p.value,
     onClick: () => {
       if (!p.disabled) p.onChange('')
     },
   })}${FlowButton({ label: 'Xong', size: 'sm', onClick: /** @param {Event} e */ (e) => close(/** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).closest('[popover]'))) })}</div>
  </div>
 </div>`
}
