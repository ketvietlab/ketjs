import { html } from '@ketvietlab/ketjs-view'
import { createLiveDocView } from '@ketvietlab/ketsuite/livedoc'
import { flowLocale } from './i18n.mjs'

/** @typedef {import('@ketvietlab/ketsuite/livedoc').LiveDocValue} FlowLiveDocValue */
/** Convert legacy Flow blocks once; the Yjs snapshot becomes the rich source of truth.
 * @param {Array<{id?:string,type:string,text?:string,bold?:boolean,italic?:boolean,checked?:boolean,align?:string,rows?:string[][]}>} blocks */
export const FlowLiveDocBlocks = (blocks) =>
  blocks.map((b) => ({
    id: b.id,
    type: { paragraph: 'p', heading: 'h2', subheading: 'h3' }[b.type] ?? b.type,
    checked: b.checked,
    align: b.align,
    rows: b.rows,
    delta: b.text
      ? [
          {
            insert: b.text,
            attributes: { ...(b.bold ? { bold: true } : {}), ...(b.italic ? { italic: true } : {}) },
          },
        ]
      : [],
  }))
/** @param {FlowLiveDocValue} value */
export const FlowLiveDocText = (value) =>
  value.blocks
    .map((b) =>
      b.type === 'table'
        ? (b.rows?.map((r) => r.join(' | ')).join('\n') ?? '')
        : b.delta.map((d) => d.insert).join(''),
    )
    .join('\n\n')
/** @param {FlowLiveDocValue} value */
export const FlowLiveDocLegacyBlocks = (value) =>
  value.blocks.map((b, i) => ({
    id: b.id ?? `live-${i}`,
    type: { p: 'paragraph', h1: 'heading', h2: 'heading', h3: 'subheading' }[b.type] ?? b.type,
    text: b.delta.map((d) => d.insert).join(''),
    checked: b.checked,
    align: b.align,
    rows: b.rows,
  }))

/** Shared LiveDoc embedding; attachFlowUI owns mounting/disposal, never a second island.
 * @param {{id:string,label:string,snapshot?:string,blocks?:Parameters<typeof FlowLiveDocBlocks>[0],text?:string,readOnly?:boolean,onChange:(value:FlowLiveDocValue)=>void,onBlur?:()=>void}} p */
export const FlowLiveDoc = (p) => {
  const lang = flowLocale()
  return html`<section data-flow="live-doc-field"><span data-flow="field-label">${p.label}</span><div data-flow="live-doc" data-live-key=${`${p.id}:${lang}:${!!p.readOnly}`}
    on:flow-live-mount=${
      /** @param {CustomEvent} event */ (event) => {
        const target = /** @type {HTMLElement} */ (event.currentTarget)
        const editor = createLiveDocView({
          docId: p.id,
          lang,
          local: true,
          readOnly: p.readOnly,
          snapshot: p.snapshot,
          blocks: FlowLiveDocBlocks(p.blocks ?? [{ type: 'paragraph', text: p.text ?? '' }]),
          onChange: p.onChange,
        })
        event.detail.mount(editor, target, p.label)
      }
    } on:focusout=${() => p.onBlur?.()}></div></section>`
}
