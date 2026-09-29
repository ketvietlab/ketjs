import { tr } from './i18n.mjs'
import { html, each } from '@ketvietlab/ketjs-view'
import { FlowIcon, FlowCheckbox, FlowFrame, FlowButton, FlowShellHeader } from './index.mjs'
/** @typedef {import('@ketvietlab/ketjs-view').Renderable} Child */
/** @typedef {{id:string,type:string,text?:string,checked?:boolean,bold?:boolean,italic?:boolean,align?:string,rows?:string[][]}} FlowDocBlock */
/** Product-owned tree splitter: pointer capture and keyboard arrows share bounds. */
const FlowDocTreeResize = () => {
  /** @param {HTMLElement} handle @param {number} width */
  const resize = (handle, width) => {
    const layout = /** @type {HTMLElement} */ (handle.closest('[data-flow-layout="documents"]'))
    const inspector = layout.querySelector('[data-flow="docs-inspector"]')
    const max = Math.max(
      220,
      Math.min(420, layout.clientWidth - 360 - (inspector?.getBoundingClientRect().width ?? 0)),
    )
    const next = Math.round(Math.max(220, Math.min(max, width)))
    layout.style.setProperty('--flow-doc-tree', `${next}px`)
    handle.setAttribute('aria-valuenow', String(next))
    handle.setAttribute('aria-valuemax', String(max))
  }
  return html`<div data-flow="doc-tree-resize" role="separator" tabindex="0"
    aria-label=${tr('flow.ui.resize.document.tree')} aria-orientation="vertical"
    aria-valuemin="220" aria-valuemax="420" aria-valuenow="300"
    title=${tr('flow.ui.drag.to.resize.use.or.when.focused')}
    on:pointerdown=${
      /** @param {PointerEvent} e */ (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const handle = /** @type {HTMLElement} */ (e.currentTarget)
        handle.focus()
        handle.setPointerCapture(e.pointerId)
      }
    }
    on:pointermove=${
      /** @param {PointerEvent} e */ (e) => {
        const handle = /** @type {HTMLElement} */ (e.currentTarget)
        if (!handle.hasPointerCapture(e.pointerId)) return
        const layout = /** @type {HTMLElement} */ (handle.closest('[data-flow-layout="documents"]'))
        resize(handle, e.clientX - layout.getBoundingClientRect().left)
      }
    }
    on:pointerup=${
      /** @param {PointerEvent} e */ (e) => {
        const handle = /** @type {HTMLElement} */ (e.currentTarget)
        if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      }
    }
    on:keydown=${
      /** @param {KeyboardEvent} e */ (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const handle = /** @type {HTMLElement} */ (e.currentTarget)
        const current = handle.parentElement?.getBoundingClientRect().width ?? 300
        resize(
          handle,
          e.key === 'Home' ? 220 : e.key === 'End' ? 420 : current + (e.key === 'ArrowLeft' ? -16 : 16),
        )
      }
    }></div>`
}
/** @param {{sidebar:Child,top?:Child,title?:string,search?:Child,actions?:Child,navigation?:Child,tree:Child,toolbar:Child,inspector:Child,hideInspector?:boolean,children:Child,notice?:Child}} p */
export const FlowDocsShell = (p) =>
  FlowFrame({
    sidebar: p.sidebar,
    children: html`<div data-flow-layout="documents" data-hide-inspector=${!!p.hideInspector} data-project-context=${!!p.navigation}>
      ${p.title !== undefined ? FlowShellHeader({ title: p.title, search: p.search, actions: p.actions, documentTitle: true }) : html`<header data-flow="docs-top">${p.top}</header>`}
      ${p.navigation ? html`<div data-flow="docs-context">${p.navigation}</div>` : null}
      <aside data-flow="docs-tree" aria-label=${tr('flow.ui.document.library')}>
        <details data-flow="docs-tree-disclosure" open>
          <summary>${tr('flow.ui.document.library')}</summary>
          ${p.tree}
        </details>
        ${FlowDocTreeResize()}
      </aside>
      <main data-flow="docs-main">
        <div data-flow="docs-toolbar" hidden=${!p.toolbar} role="toolbar" aria-label=${tr('flow.ui.document.formatting')}>
          ${p.toolbar}
        </div>
        ${p.notice ?? null}
        <div data-flow="docs-scroll">${p.children}</div>
      </main>
      <aside data-flow="docs-inspector" aria-label=${tr('flow.ui.document.details')}>${p.inspector}</aside>
    </div>`,
  })
/** @param {{items:{id:string,title:string,parentId?:string|null,projectId?:string|null,visibility?:string}[],active:string,collapsed:string[],onOpen:(id:string)=>void,onToggle:(id:string)=>void,onCreate?:()=>void,onAddChild?:(id:string)=>void,onReorder?:(id:string,targetId:string,position:"before"|"after")=>void}} p */
export const FlowDocTree = (p) => {
  const ids = new Set(p.items.map((x) => x.id))
  let dragged = ''
  /** @type {HTMLElement|null} */
  let indicator = null
  const clearDrop = () => {
    indicator?.removeAttribute('data-drop')
    indicator = null
  }
  /** @param {typeof p.items[number]} a @param {typeof p.items[number]} b */
  const peers = (a, b) =>
    (a.parentId ?? null) === (b.parentId ?? null) &&
    a.projectId === b.projectId &&
    (a.visibility ?? 'shared') === (b.visibility ?? 'shared')
  /** @param {string} targetId */
  const accepts = (targetId) => {
    const source = p.items.find((x) => x.id === dragged),
      target = p.items.find((x) => x.id === targetId)
    return !!p.onReorder && !!source && !!target && source.id !== target.id && peers(source, target)
  }
  /** @param {DragEvent} e */
  const position = (e) => {
    const row = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect()
    return e.clientY < row.top + row.height / 2 ? 'before' : 'after'
  }

  /** @param {string|null} parent @param {Set<string>} seen @returns {Child} */
  const branch = (parent, seen) =>
    html`<ul data-flow="doc-tree-list">
      ${each(
        p.items.filter((x) => (ids.has(x.parentId ?? '') ? x.parentId : null) === parent && !seen.has(x.id)),
        (x) => x.id,
        (x) => {
          const children = p.items.some((y) => y.parentId === x.id),
            open = !p.collapsed.includes(x.id)
          return html`<li>
            <div data-flow="doc-tree-row" data-active=${x.id === p.active}
              draggable=${!!p.onReorder}
              on:dragstart=${
                /** @param {DragEvent} e */ (e) => {
                  if (!p.onReorder) return
                  dragged = x.id
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', x.id)
                  }
                }
              }
              on:dragover=${
                /** @param {DragEvent} e */ (e) => {
                  clearDrop()
                  if (!accepts(x.id)) {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
                    return
                  }
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  indicator = /** @type {HTMLElement} */ (e.currentTarget)
                  indicator.setAttribute('data-drop', position(e))
                }
              }
              on:dragleave=${clearDrop}
              on:dragend=${() => {
                clearDrop()
                dragged = ''
              }}
              on:drop=${
                /** @param {DragEvent} e */ (e) => {
                  e.preventDefault()
                  clearDrop()
                  if (accepts(x.id)) p.onReorder?.(dragged, x.id, position(e))
                  dragged = ''
                }
              }>

              <button
                type="button"
                data-flow="doc-tree-toggle"
                disabled=${!children}
                aria-label=${`${open ? tr('flow.ui.collapse') : tr('flow.ui.expand')} ${x.title}`}
                aria-expanded=${children ? String(open) : null}
                on:click=${() => p.onToggle(x.id)}
              >
                ${children ? FlowIcon(open ? 'down' : 'chevron') : null}</button
              ><button
                type="button"
                data-flow="doc-tree-page"
                aria-current=${x.id === p.active ? 'page' : null}
                on:click=${() => p.onOpen(x.id)}
                title=${p.onReorder ? tr('flow.ui.drag.to.reorder.siblings.alt.or.for.keyboard.control') : null}
                on:keydown=${
                  /** @param {KeyboardEvent} e */ (e) => {
                    if (!p.onReorder || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
                    e.preventDefault()
                    const siblings = p.items.filter((y) => peers(x, y))
                    const target =
                      siblings[siblings.findIndex((y) => y.id === x.id) + (e.key === 'ArrowUp' ? -1 : 1)]
                    if (target) p.onReorder(x.id, target.id, e.key === 'ArrowUp' ? 'before' : 'after')
                  }
                }
              >
                ${FlowIcon('book')}<span>${x.title}</span>
              </button>
              ${
                p.onAddChild
                  ? html`<button type="button" data-flow="doc-tree-add"
                aria-label=${tr('flow.ui.create.child.document.in', [x.title])} title=${tr('flow.ui.create.child.document')}
                on:click=${() => p.onAddChild?.(x.id)}>${FlowIcon('plus')}</button>`
                  : null
              }
            </div>
            ${children && open ? branch(x.id, new Set([...seen, x.id])) : null}
          </li>`
        },
      )}
    </ul>`
  return html`<nav aria-label=${tr('flow.ui.document.tree')}>${branch(null, new Set())}${p.onCreate ? html`<div data-flow="doc-tree-create">${FlowButton({ label: tr('flow.ui.create.document'), icon: 'plus', size: 'sm', variant: 'ghost', onClick: p.onCreate })}</div>` : null}</nav>`
}
/** @param {{title:string,subtitle:Child,children?:Child,blocks:FlowDocBlock[],readOnly?:boolean,onTitle:(text:string)=>void,onText:(id:string,text:string,row?:number,col?:number)=>void,onFocus:(id:string)=>void,onBlur:()=>void,onCheck:(id:string,checked:boolean)=>void}} p */
export const FlowDocEditor = (p) => {
  /** @param {FlowDocBlock} b @param {string} text @param {number} [row] @param {number} [col] */
  const text = (b, text, row, col) =>
    html`<span
      data-flow="doc-editable"
      role="textbox"
      aria-label=${row == null ? tr('flow.ui.content.20a9ac', [b.id]) : tr('flow.ui.cell', [row + 1, (col ?? 0) + 1])}
      contenteditable=${p.readOnly ? 'false' : 'plaintext-only'}
      aria-readonly=${String(!!p.readOnly)}
      tabindex=${p.readOnly ? -1 : 0}
      on:focus=${() => p.onFocus(b.id)}
      on:input=${/** @param {Event} e */ (e) => p.onText(b.id, /** @type {HTMLElement} */ (e.currentTarget).innerText, row, col)}
      on:blur=${p.onBlur}
      >${text}</span
    >`
  // Keep whitespace out of the plaintext-only title; browsers preserve it.
  // prettier-ignore
  return html`<article data-flow="doc-paper">
    <h1
      data-flow="doc-title"
      role="textbox"
      aria-label=${tr('flow.ui.document.title')}
      contenteditable=${p.readOnly ? 'false' : 'plaintext-only'}
      aria-readonly=${String(!!p.readOnly)}
      on:input=${/** @param {Event} e */ (e) => p.onTitle(/** @type {HTMLElement} */ (e.currentTarget).innerText)}
      on:blur=${p.onBlur}
    >${p.title}</h1>
    <div data-flow="doc-byline">${p.subtitle}</div>
    ${
      p.children ??
      each(
        p.blocks,
        (b) => b.id,
        (b) =>
          html`<section
          id=${`doc-${b.id}`}
          data-flow="doc-block"
          data-kind=${b.type}
          data-bold=${b.bold ?? false}
          data-italic=${b.italic ?? false}
          data-align=${b.align ?? 'left'}
        >
          ${
            b.type === 'heading'
              ? html`<h2>${text(b, b.text ?? '')}</h2>`
              : b.type === 'subheading'
                ? html`<h3>${text(b, b.text ?? '')}</h3>`
                : b.type === 'table'
                  ? html`<div data-flow="doc-table-scroll">
                      <table aria-label=${tr('flow.ui.document.content.table')}>
                        <tbody>
                          ${each(
                            b.rows ?? [],
                            (_, i) => i,
                            (row, r) =>
                              html`<tr>
                                ${each(
                                  row,
                                  (_, i) => i,
                                  (cell, c) => html`<td>${text(b, cell, r, c)}</td>`,
                                )}
                              </tr>`,
                          )}
                        </tbody>
                      </table>
                    </div>`
                  : b.type === 'check'
                    ? html`<div data-flow="doc-check">
                        ${FlowCheckbox({ label: b.text ?? 'Checklist', checked: b.checked ?? false, disabled: p.readOnly, onChange: p.readOnly ? undefined : (e) => p.onCheck(b.id, /** @type {HTMLInputElement} */ (e.currentTarget).checked) })}${text(b, b.text ?? '')}
                      </div>`
                    : b.type === 'divider'
                      ? html`<hr />`
                      : b.type === 'bullet'
                        ? html`<div data-flow="doc-bullet">
                            <span aria-hidden="true">•</span>${text(b, b.text ?? '')}
                          </div>`
                        : html`<p>${text(b, b.text ?? '')}</p>`
          }
        </section>`,
      )
    }
  </article>`
}
/** @param {{items:{id:string,text:string,level:number}[],active?:string,onOpen:(id:string)=>void}} p */
export const FlowDocOutline = (p) =>
  html`<nav data-flow="doc-outline" aria-label=${tr('flow.ui.document.outline')}>
    ${each(
      p.items,
      (x) => x.id,
      (x) =>
        html`<button
          type="button"
          data-level=${x.level}
          aria-current=${p.active === x.id ? 'location' : null}
          on:click=${() => p.onOpen(x.id)}
        >
          ${x.text || tr('flow.ui.untitled.heading')}
        </button>`,
    )}
  </nav>`
/** @param {{label:string,glyph:string,pressed?:boolean,disabled?:boolean,onClick:()=>void}} p */
export const FlowDocTool = (p) =>
  html`<button
    type="button"
    data-flow="doc-tool"
    title=${p.label}
    aria-label=${p.label}
    aria-pressed=${p.pressed == null ? null : String(p.pressed)}
    disabled=${p.disabled ?? false}
    on:click=${p.onClick}
  >
    ${p.glyph}
  </button>`
/** @param {{children:Child}} p */
export const FlowDocToolGroup = (p) => html`<div data-flow="doc-tool-group">${p.children}</div>`
/** @param {{title:string,children:Child}} p */
export const FlowDocPanel = (p) =>
  html`<section data-flow="doc-panel">
    <h2>${p.title}</h2>
    ${p.children}
  </section>`

/** @param {{title:string,children:Child}} p */
export const FlowDocBlank = (p) =>
  html`<article data-flow="doc-paper">
    <h1 data-flow="doc-title">${p.title}</h1>
    ${p.children}
  </article>`
