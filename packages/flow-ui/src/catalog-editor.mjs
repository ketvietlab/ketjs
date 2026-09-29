import { tr } from './i18n.mjs'
import { html, each } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput, FlowSelect, FlowIcon } from './index.mjs'

/** Fixed palette shared by labels, statuses and their editors. */
export const FLOW_TAG_COLORS = [
  {
    value: 'blue',
    get label() {
      return tr('flow.ui.blue')
    },
  },
  {
    value: 'green',
    get label() {
      return tr('flow.ui.green')
    },
  },
  {
    value: 'yellow',
    get label() {
      return tr('flow.ui.yellow')
    },
  },
  {
    value: 'red',
    get label() {
      return tr('flow.ui.red')
    },
  },
  {
    value: 'neutral',
    get label() {
      return tr('flow.ui.gray')
    },
  },
]
/** Native radios provide keyboard navigation and form values; the palette never accepts arbitrary colors.
 * @param {{id:string,name?:string,label:string,value:string,compact?:boolean,disabled?:boolean,onChange?:(color:string)=>void}} p */
export function FlowColorPicker(p) {
  return html`<fieldset data-flow="color-picker" data-compact=${!!p.compact} disabled=${!!p.disabled}>
  <legend>${p.label}</legend><div data-flow="color-options">
   ${each(
     FLOW_TAG_COLORS,
     (c) => c.value,
     (c) => html`<label data-flow="color-option" title=${c.label}>
    <input type="radio" name=${p.name ?? p.id} value=${c.value} aria-label=${c.label} checked=${p.value === c.value}
     on:change=${
       /** @param {Event} e */ (e) => {
         if (!p.disabled && /** @type {HTMLInputElement} */ (e.target).checked) p.onChange?.(c.value)
       }
} />
    <span data-flow="color-swatch" data-color=${c.value} aria-hidden="true">${FlowIcon('check')}</span>
   </label>`,
   )}
  </div>
 </fieldset>`
}
/** @typedef {{id:string,title:string,color?:string,kind?:string,locked?:boolean,lockedKind?:boolean}} CatalogItem */
/** Compact controlled rows for either a status workflow or a label collection.
 * @param {{id:string,items:CatalogItem[],status?:boolean,disabled?:boolean,kindOptions?:{value:string,label:string}[],onChange:(items:CatalogItem[])=>void}} p */
export function FlowCatalogEditor(p) {
  /** @param {string} id @param {Partial<CatalogItem>} patch */
  const change = (id, patch) =>
    p.onChange(p.items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  return html`<div data-flow="catalog-editor" data-has-kind=${!!p.status}>
  <div data-flow="catalog-columns" aria-hidden="true"><span>${tr('flow.ui.name.d4c6ee', [p.status ? tr('flow.ui.status.751906') : tr('flow.ui.label')])}</span>${p.status ? html`<span>${tr('flow.ui.status.group')}</span>` : null}<span>${tr('flow.ui.color.bf45a5')}</span><span></span></div>
  <div data-flow="catalog-rows">${each(
    p.items,
    (item) => item.id,
    (item) => html`<div data-flow="catalog-row">
   <div data-flow="catalog-name">${FlowInput({ id: `${p.id}-${item.id}-title`, label: p.status ? tr('flow.ui.status.name') : tr('flow.ui.label.name'), placeholder: p.status ? tr('flow.ui.status.name') : tr('flow.ui.label.name'), value: item.title, required: true, disabled: p.disabled, onInput: (e) => change(item.id, { title: /** @type {HTMLInputElement} */ (e.target).value }) })}</div>
   ${p.status ? html`<div data-flow="catalog-kind">${FlowSelect({ label: tr('flow.ui.status.group.e1dcd0', [item.title || tr('flow.ui.new.status')]), value: item.kind ?? 'todo', options: p.kindOptions ?? [], disabled: p.disabled || item.lockedKind, onChange: (e) => change(item.id, { kind: /** @type {HTMLSelectElement} */ (e.target).value }) })}</div>` : null}
   ${FlowColorPicker({ id: `${p.id}-${item.id}-color`, label: tr('flow.ui.color', [item.title || tr('flow.ui.new.entry')]), value: item.color ?? 'blue', compact: true, disabled: p.disabled, onChange: (color) => change(item.id, { color }) })}
   <div data-flow="catalog-remove">${FlowButton({ label: tr('flow.ui.delete') + (item.title || tr('flow.ui.this.entry')), icon: 'close', iconOnly: true, variant: 'ghost', size: 'sm', disabled: p.disabled || item.locked, onClick: () => p.onChange(p.items.filter((x) => x.id !== item.id)) })}</div>
  </div>`,
  )}</div>
  <div data-flow="catalog-add">${FlowButton({ label: p.status ? tr('flow.ui.add.status') : tr('flow.ui.add.label'), icon: 'plus', variant: 'ghost', size: 'sm', disabled: p.disabled, onClick: () => p.onChange([...p.items, { id: 'custom-' + crypto.randomUUID(), title: '', color: 'blue', ...(p.status ? { kind: 'todo' } : {}) }]) })}</div>
 </div>`
}
