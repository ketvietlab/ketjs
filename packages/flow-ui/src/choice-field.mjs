import { html, each } from '@ketvietlab/ketjs-view'
import { FlowIcon } from './index.mjs'
/** @typedef {import('@ketvietlab/ketjs-view').Renderable} Child */
/** A single choice with rich selected/option content; consumer owns persistence.
 * @param {{id:string,label:string,size?:'sm'|'md',icon?:Parameters<typeof FlowIcon>[0],value:string,options:{value:string,label:string,content:Child,disabled?:boolean,description?:string}[],disabled?:boolean,onChange:(value:string)=>void}} p */
export function FlowChoiceField(p) {
  const selected = p.options.find((o) => o.value === p.value)
  /** @param {HTMLElement} menu */
  const focusSelected = (menu) =>
    /** @type {HTMLElement|null} */ (
      menu.querySelector('[aria-selected="true"]') ?? menu.querySelector('[role="option"]')
    )?.focus()
  /** @param {HTMLElement} trigger */
  const position = (trigger) => {
    const menu = /** @type {HTMLElement} */ (trigger.parentElement?.querySelector('[popover]'))
    const rect = trigger.getBoundingClientRect(),
      width = Math.min(320, window.innerWidth - 16),
      height = Math.min(280, p.options.length * 44 + 8)
    menu.style.width = `${width}px`
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8))}px`
    return menu
  }
  return html`<div data-flow="field" data-choice-size=${p.size ?? 'md'}><span id=${`${p.id}-label`}>${p.icon ? FlowIcon(p.icon) : null}${p.label}</span>
 <div data-flow="choice-field">
  <button id=${p.id} type="button" data-flow="choice-trigger" disabled=${p.disabled ?? false} aria-labelledby=${`${p.id}-label ${p.id}-value`} aria-haspopup="listbox" popovertarget=${`${p.id}-menu`}
   on:click=${/** @param {MouseEvent} e */ (e) => position(/** @type {HTMLElement} */ (e.currentTarget))}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (['ArrowDown', 'ArrowUp'].includes(e.key) && !p.disabled) {
         e.preventDefault()
         e.stopPropagation()
         const menu = position(/** @type {HTMLElement} */ (e.currentTarget))
         menu.showPopover()
         focusSelected(menu)
       }
     }
}>
   <span id=${`${p.id}-value`}>${selected?.content ?? selected?.label ?? p.value}</span>${FlowIcon('down')}
  </button>
  <div data-flow="choice-menu" id=${`${p.id}-menu`} popover="auto" role="listbox" aria-labelledby=${`${p.id}-label`}
   on:toggle=${
     /** @param {ToggleEvent} e */ (e) => {
       if (e.newState === 'open') focusSelected(/** @type {HTMLElement} */ (e.currentTarget))
     }
}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (e.key !== 'Escape') e.stopPropagation()
       if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
       e.preventDefault()
       const menu = /** @type {HTMLElement} */ (e.currentTarget)
       const choices = Array.from(menu.querySelectorAll(/** @type {'button'} */ ('button:not(:disabled)')))
       const current = choices.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement))
       const next =
         e.key === 'Home'
           ? 0
           : e.key === 'End'
             ? choices.length - 1
             : (current + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
       choices[next]?.focus()
     }
}>
   ${each(
     p.options,
     (o) => o.value,
     (
       o,
     ) => html`<button data-flow="choice-option" type="button" role="option" aria-label=${o.label} aria-selected=${String(o.value === p.value)} tabindex=${o.value === p.value ? 0 : -1} disabled=${p.disabled || o.disabled || false}
    on:click=${
      /** @param {MouseEvent} e */ (e) => {
        if (p.disabled || o.disabled) return
        const menu = /** @type {HTMLElement} */ (
          /** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')
        )
        menu.hidePopover()
        const trigger = menu.parentElement?.querySelector('[data-flow="choice-trigger"]')
        if (trigger instanceof HTMLElement) trigger.focus()
        if (o.value !== p.value) p.onChange(o.value)
      }
    }>${o.description ? html`<span data-flow="choice-copy">${o.content}<small>${o.description}</small></span>` : o.content}${o.value === p.value ? FlowIcon('check') : null}</button>`,
   )}
  </div>
 </div></div>`
}
