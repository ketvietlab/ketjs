import { tr } from './i18n.mjs'
import { html, each } from '@ketvietlab/ketjs-view'
import { FlowAvatar, FlowAvatarGroup, FlowIcon } from './index.mjs'
/** @typedef {{id:string,name:string,email?:string,avatarUrl?:string,disabled?:boolean,description?:string}} FlowUserOption */
/** Controlled multi-user field. Identity, eligibility and persistence belong to the consumer.
 * @param {{id:string,label:string,size?:'sm'|'md',value:string[],options:FlowUserOption[],disabled?:boolean,placeholder?:string,onChange:(ids:string[])=>void}} p */
export function FlowUserPicker(p) {
  const selected = p.value.map(
    (id) => p.options.find((u) => u.id === id) ?? { id, name: tr('flow.ui.user.no.longer.available') },
  )
  /** @param {HTMLElement} trigger */
  const position = (trigger) => {
    const menu = /** @type {HTMLElement} */ (trigger.parentElement?.querySelector('[popover]'))
    const rect = trigger.getBoundingClientRect(),
      width = Math.min(336, window.innerWidth - 16),
      height = Math.min(360, window.innerHeight - 16)
    menu.style.width = `${width}px`
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8))}px`
    return menu
  }
  /** @param {HTMLElement} menu */
  const close = (menu) => {
    menu.hidePopover()
    const trigger = menu.parentElement?.querySelector('[data-flow="user-picker-trigger"]')
    if (trigger instanceof HTMLElement) trigger.focus()
  }
  return html`<div data-flow="field" data-user-picker-size=${p.size ?? 'md'}><span id=${`${p.id}-label`}>${FlowIcon('user')}${p.label}</span>
 <div data-flow="user-picker">
  <button id=${p.id} type="button" data-flow="user-picker-trigger" disabled=${p.disabled ?? false} aria-label=${`${p.label}: ${selected.map((u) => u.name).join(', ') || p.placeholder || tr('flow.ui.unassigned.1f3799')}`} title=${selected.map((u) => u.name).join(', ') || p.placeholder || tr('flow.ui.unassigned.1f3799')} aria-haspopup="dialog" popovertarget=${`${p.id}-menu`}
   on:click=${/** @param {MouseEvent} e */ (e) => position(/** @type {HTMLElement} */ (e.currentTarget))}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (e.key === 'ArrowDown' && !p.disabled) {
         e.preventDefault()
         position(/** @type {HTMLElement} */ (e.currentTarget)).showPopover()
       }
     }
}>
   <span id=${`${p.id}-value`} data-flow="user-selection">${selected.length ? html`${FlowAvatarGroup({ users: selected, limit: 3, showOverflow: p.size === 'sm' })}${p.size === 'sm' ? null : html`<span data-flow="user-selection-name">${selected[0].name}</span>${selected.length > 1 ? html`<span data-flow="user-selection-count">+${selected.length - 1}</span>` : null}`}` : p.size === 'sm' ? FlowIcon('user') : html`<span data-flow="muted">${p.placeholder ?? tr('flow.ui.unassigned.1f3799')}</span>`}</span>${FlowIcon('down')}
  </button>
  <div data-flow="user-picker-menu" id=${`${p.id}-menu`} popover="auto" role="dialog" aria-labelledby=${`${p.id}-label`}
   on:toggle=${
     /** @param {ToggleEvent} e */ (e) => {
       if (e.newState === 'open')
         /** @type {HTMLInputElement|null} */ (
           /** @type {HTMLElement} */ (e.currentTarget).querySelector('input[type="search"]')
         )?.focus()
     }
}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       const menu = /** @type {HTMLElement} */ (e.currentTarget)
       if (e.key !== 'Escape') e.stopPropagation()
       if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).matches('input')) {
         e.preventDefault()
         if (/** @type {HTMLInputElement} */ (e.target).type === 'checkbox')
           /** @type {HTMLElement} */ (e.target).click()
         return
       }
       if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
       e.preventDefault()
       const inputs = Array.from(menu.querySelectorAll('input[type="checkbox"]')).filter(
         (n) => !(/** @type {HTMLInputElement} */ (n).disabled) && !n.parentElement?.hidden,
       )
       const index = inputs.indexOf(/** @type {Element} */ (document.activeElement))
       const next =
         index < 0
           ? e.key === 'ArrowDown'
             ? 0
             : inputs.length - 1
           : (index + (e.key === 'ArrowDown' ? 1 : -1) + inputs.length) % inputs.length
       const input = inputs[next]
       if (input instanceof HTMLElement) input.focus()
     }
}>
   <div data-flow="user-picker-search">${FlowIcon('search')}<input type="search" placeholder=${tr('flow.ui.search.people')} aria-label=${tr('flow.ui.search.people.58e40b')} autocomplete="off"
    on:input=${
      /** @param {Event} e */ (e) => {
        const input = /** @type {HTMLInputElement} */ (e.currentTarget),
          menu = input.closest('[popover]')
        const normalize = /** @param {string} s */ (s) =>
          s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/gi, 'd')
            .toLocaleLowerCase()
        const query = normalize(input.value.trim())
        let count = 0
        menu?.querySelectorAll('[data-flow="user-option"]').forEach((node) => {
          const row = /** @type {HTMLElement} */ (node)
          row.hidden = !normalize(row.textContent ?? '').includes(query)
          if (!row.hidden) count++
        })
        const empty = /** @type {HTMLElement|null} */ (menu?.querySelector('[data-flow="user-picker-empty"]'))
        if (empty) empty.hidden = count > 0
      }
    } /></div>
   <div data-flow="user-options" role="group" aria-label=${tr('flow.ui.you.can.select.multiple.people')}>${each(
     p.options,
     (u) => u.id,
     (u) => html`<label data-flow="user-option">
    <input type="checkbox" checked=${p.value.includes(u.id)} disabled=${p.disabled || (u.disabled && !p.value.includes(u.id))} aria-label=${u.name}
     on:change=${
       /** @param {Event} e */ (e) => {
         if (p.disabled) return
         const checked = /** @type {HTMLInputElement} */ (e.currentTarget).checked
         p.onChange(checked ? [...new Set([...p.value, u.id])] : p.value.filter((id) => id !== u.id))
       }
} />
    ${FlowAvatar({ name: u.name, src: u.avatarUrl })}<span><span>${u.name}</span>${u.description || u.email ? html`<small>${u.description ?? u.email}</small>` : null}</span>
   </label>`,
   )}</div>
   <p data-flow="user-picker-empty" role="status" hidden=${p.options.length > 0}>${tr('flow.ui.no.matching.people')}</p>
   <div data-flow="user-picker-footer"><small>${tr('flow.ui.people.selected', [p.value.length])}</small><button type="button" on:click=${/** @param {MouseEvent} e */ (e) => close(/** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')))}>Xong</button></div>
  </div>
 </div></div>`
}
