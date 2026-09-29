import { createRoot, domHost } from '@ketvietlab/ketjs-view'
import { tr } from './i18n.mjs'
import { attachTimelineDrag } from './timeline-drag.mjs'
/** Explicit and disposable; never scans unrelated Suite roots. @param {HTMLElement} root */
export function attachFlowUI(root) {
  const controller = new AbortController()
  const clearTimelineDrag = attachTimelineDrag(root, controller.signal)
  // Context disclosure is local to the Flow root, including mobile navigation.
  root.ownerDocument.addEventListener(
    'pointerdown',
    (event) => {
      root
        .querySelectorAll('[data-flow="context-picker"][open], [data-flow="scope-menu"][open]')
        .forEach((menu) => {
          if (
            menu instanceof HTMLDetailsElement &&
            event.target instanceof Node &&
            !menu.contains(event.target)
          )
            menu.open = false
        })
    },
    { signal: controller.signal },
  )
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      const menu =
        event.target instanceof Element
          ? event.target.closest('[data-flow="context-picker"][open], [data-flow="scope-menu"][open]')
          : null
      if (menu instanceof HTMLDetailsElement) {
        menu.open = false
        menu.querySelector('summary')?.focus()
        event.preventDefault()
        event.stopPropagation()
      }
    },
    { signal: controller.signal },
  )

  const compactNavigation = window.matchMedia?.('(max-width:760px)')
  const navInitialized = new WeakSet()
  const syncNavigation = () =>
    root.querySelectorAll('[data-flow="mobile-nav"]').forEach((el) => {
      if (el instanceof HTMLDetailsElement && !navInitialized.has(el)) {
        el.open = !compactNavigation?.matches
        navInitialized.add(el)
      }
    })
  compactNavigation?.addEventListener(
    'change',
    () => {
      root.querySelectorAll('[data-flow="mobile-nav"]').forEach((el) => {
        if (el instanceof HTMLDetailsElement) el.open = !compactNavigation.matches
      })
    },
    { signal: controller.signal },
  )
  const compactRecord = window.matchMedia?.('(max-width:1199px)')
  /** @param {HTMLElement} panel */
  const positionRecordPanel = (panel) => {
    const dialog = panel.closest('dialog')
    const header = dialog?.querySelector(':scope > header')
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open || !header) return
    const bounds = dialog.getBoundingClientRect(),
      heading = header.getBoundingClientRect()
    const width = Math.min(440, bounds.width - 24)
    const top = heading.bottom + 8
    panel.style.setProperty('--flow-record-panel-width', `${width}px`)
    panel.style.setProperty('--flow-record-panel-left', `${bounds.right - width - 12}px`)
    panel.style.setProperty('--flow-record-panel-top', `${top}px`)
    panel.style.setProperty('--flow-record-panel-height', `${Math.max(120, bounds.bottom - top - 12)}px`)
  }
  const syncRecordPanels = () => {
    root.querySelectorAll('[data-flow-record-panel]').forEach((panel) => {
      if (!(panel instanceof HTMLElement) || !panel.closest('[data-flow="dialog"][data-size="task"]')) return
      if (compactRecord?.matches) {
        if (panel.getAttribute('popover') !== 'auto') panel.setAttribute('popover', 'auto')
        panel.setAttribute('role', 'dialog')
        if (panel.matches(':popover-open')) positionRecordPanel(panel)
      } else {
        if (panel.matches(':popover-open')) panel.hidePopover()
        panel.removeAttribute('popover')
        panel.removeAttribute('role')
      }
    })
  }
  root.addEventListener(
    'beforetoggle',
    (event) => {
      const panel = event.target
      if (
        panel instanceof HTMLElement &&
        panel.hasAttribute('data-flow-record-panel') &&
        /** @type {ToggleEvent} */ (event).newState === 'open'
      )
        positionRecordPanel(panel)
    },
    { capture: true, signal: controller.signal },
  )
  root.addEventListener(
    'toggle',
    (event) => {
      const panel = event.target
      if (
        !(panel instanceof HTMLElement) ||
        !panel.hasAttribute('data-flow-record-panel') ||
        /** @type {ToggleEvent} */ (event).newState !== 'closed' ||
        !compactRecord?.matches ||
        !panel.isConnected
      )
        return
      const active = root.ownerDocument.activeElement
      if (active === root.ownerDocument.body || (active && panel.contains(active))) {
        const trigger = root.querySelector(
          `[data-flow="record-panel-trigger"][aria-controls="${CSS.escape(panel.id)}"]`,
        )
        if (trigger instanceof HTMLElement && trigger.getClientRects().length) trigger.focus()
      }
    },
    { capture: true, signal: controller.signal },
  )
  root.addEventListener(
    'invalid',
    (event) => {
      const field = event.target
      if (field instanceof Element) {
        let parent = field.parentElement
        while (parent && parent !== root) {
          if (parent instanceof HTMLDetailsElement) parent.open = true
          parent = parent.parentElement
        }
      }
      const panel = field instanceof HTMLElement ? field.closest('[data-flow-record-panel]') : null
      if (compactRecord?.matches && panel instanceof HTMLElement && !panel.matches(':popover-open'))
        panel.showPopover()
    },
    { capture: true, signal: controller.signal },
  )
  compactRecord?.addEventListener('change', syncRecordPanels, { signal: controller.signal })
  window.addEventListener('resize', syncRecordPanels, { signal: controller.signal })

  /** @type {{source:HTMLElement,id:string,pointerId:number,x:number,y:number,active:boolean}|null} */
  let dragging = null
  /** @type {HTMLElement|null} */
  let dropTarget = null
  /** @type {HTMLElement|null} */
  let preview = null
  /** @type {'before'|'after'} */
  let dropPosition = 'after'
  let suppressClick = false
  const clearDrag = () => {
    root.querySelectorAll('[data-task-drop]').forEach((el) => {
      el.removeAttribute('data-task-drop')
    })
    root.querySelectorAll('[data-dragging]').forEach((el) => {
      el.removeAttribute('data-dragging')
    })
    preview?.remove()
    preview = null
    if (dragging?.source.hasPointerCapture(dragging.pointerId))
      dragging.source.releasePointerCapture(dragging.pointerId)
    dragging = null
    dropTarget = null
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      const source = event.target.closest('[data-task-id][data-flow-task-drop="item"]')
      if (
        !(source instanceof HTMLElement) ||
        event.target.closest('input,select,textarea,a,[contenteditable]')
      )
        return
      suppressClick = false
      dragging = {
        source,
        id: source.dataset.taskId ?? '',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
      }
    },
    { signal: controller.signal },
  )
  root.addEventListener(
    'dragstart',
    (event) => {
      // Keep a single pointer gesture alive instead of handing it to native button/text dragging.
      if (dragging) event.preventDefault()
    },
    { capture: true, signal: controller.signal },
  )
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressClick = false
    },
    { capture: true, signal: controller.signal },
  )
  root.ownerDocument.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return
      if (!dragging.active && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 6) return
      event.preventDefault()
      if (!dragging.active) {
        dragging.active = true
        dragging.source.setPointerCapture(event.pointerId)
        dragging.source.setAttribute('data-dragging', 'true')
        preview = root.ownerDocument.createElement('div')
        preview.dataset.flow = 'task-drag-preview'
        preview.setAttribute('aria-hidden', 'true')
        const count = Number(dragging.source.dataset.flowDragCount) || 1
        if (count > 1)
          root.querySelectorAll('[data-flow="task-row"][data-selected="true"]').forEach((el) => {
            el.setAttribute('data-dragging', 'true')
          })
        const sources =
          count > 1
            ? [...root.querySelectorAll('[data-flow="task-row"][data-selected="true"]')]
            : [dragging.source]
        const sourceRect = dragging.source.getBoundingClientRect()
        preview.style.width = `${sourceRect.width}px`
        preview.style.setProperty('--flow-drag-offset-x', `${dragging.x - sourceRect.left}px`)
        preview.style.setProperty('--flow-drag-offset-y', `${dragging.y - sourceRect.top}px`)
        for (const source of sources.slice(0, 3)) {
          const clone = /** @type {HTMLElement} */ (source.cloneNode(true))
          // Visual-only copies must not join hit testing, selection, or runtime lookup.
          for (const element of [clone, ...clone.querySelectorAll('*')]) {
            for (const name of [
              'id',
              'data-task-id',
              'data-flow-task-drop',
              'data-dragging',
              'data-task-drop',
              'data-selected',
              'tabindex',
            ])
              element.removeAttribute(name)
          }
          clone.inert = true
          if (source instanceof HTMLTableRowElement) {
            const table = root.ownerDocument.createElement('table')
            table.dataset.flow = 'task-drag-table'
            const body = root.ownerDocument.createElement('tbody')
            const sourceCells = [...source.cells]
            ;[...clone.children].forEach((cell, index) => {
              if (cell instanceof HTMLElement)
                cell.style.width = `${sourceCells[index].getBoundingClientRect().width}px`
            })
            body.append(clone)
            table.append(body)
            preview.append(table)
          } else preview.append(clone)
        }
        if (count > 1) {
          const countLabel = root.ownerDocument.createElement('strong')
          countLabel.textContent = tr('flow.ui.move.tasks', [count])
          preview.append(countLabel)
        }
        const reason = root.ownerDocument.createElement('small')
        reason.dataset.flow = 'task-drag-reason'
        preview.append(reason)
        root.append(preview)
      }
      if (preview) {
        preview.style.left = `${event.clientX}px`
        preview.style.top = `${event.clientY}px`
      }
      root.querySelectorAll('[data-task-drop]').forEach((el) => {
        el.removeAttribute('data-task-drop')
      })
      const hit = root.ownerDocument
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-flow-task-drop]')
      dropTarget = hit instanceof HTMLElement && root.contains(hit) ? hit : null
      if (dropTarget?.dataset.taskId === dragging.id || dropTarget?.hasAttribute('data-dragging')) {
        dropTarget = null
        return
      }
      const check = { id: dragging.id, reason: '' }
      dropTarget?.dispatchEvent(new CustomEvent('flowtaskdragcheck', { bubbles: true, detail: check }))
      const reason = preview?.querySelector('[data-flow="task-drag-reason"]')
      if (reason) reason.textContent = check.reason
      if (check.reason) {
        dropTarget?.setAttribute('data-task-drop', 'blocked')
        dropTarget = null
        return
      }
      if (dropTarget) {
        const rect = dropTarget.getBoundingClientRect()
        dropPosition =
          dropTarget.dataset.flowTaskDrop === 'item' && event.clientY < rect.top + rect.height / 2
            ? 'before'
            : 'after'
        dropTarget.setAttribute(
          'data-task-drop',
          dropTarget.dataset.flowTaskDrop === 'item' ? dropPosition : 'group',
        )
      }
      const board = root.querySelector('[data-flow="board"]')
      if (board instanceof HTMLElement) {
        const rect = board.getBoundingClientRect()
        if (event.clientX > rect.right - 36) board.scrollLeft += 16
        else if (event.clientX < rect.left + 36) board.scrollLeft -= 16
      }
      const area = root.querySelector('[data-flow="shell-content"]')
      if (area instanceof HTMLElement) {
        const rect = area.getBoundingClientRect()
        if (event.clientY > rect.bottom - 36) area.scrollTop += 16
        else if (event.clientY < rect.top + 36) area.scrollTop -= 16
      }
    },
    { signal: controller.signal, passive: false },
  )
  root.ownerDocument.addEventListener(
    'pointerup',
    (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return
      const id = dragging.id,
        active = dragging.active,
        target = dropTarget,
        position = dropPosition
      suppressClick = active
      clearDrag()
      if (active && target)
        target.dispatchEvent(new CustomEvent('flowtaskdrop', { bubbles: true, detail: { id, position } }))
    },
    { signal: controller.signal },
  )
  root.ownerDocument.addEventListener('pointercancel', clearDrag, { signal: controller.signal })
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        suppressClick = !!dragging?.active
        clearDrag()
      }
    },
    { signal: controller.signal },
  )
  /** @type {WeakMap<HTMLDialogElement, HTMLElement>} */
  const openers = new WeakMap()
  /** @type {WeakMap<Element, string>} */
  const values = new WeakMap()
  // KetJS updates attributes. Dirty native form controls also need their live
  // properties synchronized. Uncontrolled draft fields only reset when their
  // supplied value changes, so unrelated renders never erase entered text.
  /** @type {WeakMap<HTMLElement,string>} */
  const timelinePositions = new WeakMap()
  /** @type {WeakMap<HTMLElement,string>} */
  const scopeTabPositions = new WeakMap()
  /** @type {WeakMap<Element,string>} */
  const spotlightPositions = new WeakMap()
  const sync = () => {
    root.querySelectorAll('[data-flow="scope-tabs"]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return
      const active = element.querySelector('[aria-current="page"]')
      if (!(active instanceof HTMLElement)) return
      const key = active.getAttribute('href') ?? ''
      if (scopeTabPositions.get(element) === key) return
      const rect = element.getBoundingClientRect(),
        target = active.getBoundingClientRect()
      if (target.left < rect.left) element.scrollLeft += target.left - rect.left
      else if (target.right > rect.right) element.scrollLeft += target.right - rect.right
      scopeTabPositions.set(element, key)
    })
    root.querySelectorAll('[data-flow="timeline"]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return
      const key = element.dataset.focusKey ?? ''
      if (timelinePositions.get(element) === key) return
      const day = element.querySelectorAll('[data-flow="timeline-days"] > span')[
        Number(element.dataset.focusIndex)
      ]
      const label = element.querySelector('[data-flow="timeline-label"]')
      if (!(day instanceof HTMLElement) || !(label instanceof HTMLElement)) return
      const rect = element.getBoundingClientRect()
      const offset =
        day.getBoundingClientRect().left -
        rect.left +
        element.scrollLeft -
        label.getBoundingClientRect().width
      element.scrollLeft = Math.max(0, offset - 32)
      timelinePositions.set(element, key)
    })
    root.querySelectorAll('dialog[data-flow-route-modal]').forEach((element) => {
      if (element instanceof HTMLDialogElement && !element.open) {
        if (document.activeElement instanceof HTMLElement) openers.set(element, document.activeElement)
        element.showModal()
      }
    })
    root.querySelectorAll('[data-flow="spotlight-results"]').forEach((list) => {
      const active = list.querySelector('[aria-selected="true"]')
      if (active && spotlightPositions.get(list) !== active.id) {
        active.scrollIntoView({ block: 'nearest' })
        spotlightPositions.set(list, active.id)
      }
    })
    syncNavigation()
    syncRecordPanels()
    root.querySelectorAll('[data-flow="toast"][popover]').forEach((element) => {
      if (element instanceof HTMLElement && !element.matches(':popover-open')) element.showPopover()
    })
    root.querySelectorAll('[data-flow-value]').forEach((element) => {
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        )
      )
        return
      const value = element.getAttribute('data-flow-value') ?? ''
      if (element.hasAttribute('data-flow-controlled') || values.get(element) !== value) {
        if (element.value !== value) element.value = value
      }
      values.set(element, value)
    })
    root.querySelectorAll('input[data-flow="checkbox"]').forEach((element) => {
      if (element instanceof HTMLInputElement) {
        element.checked = element.hasAttribute('checked')
        element.indeterminate = element.hasAttribute('data-flow-indeterminate')
      }
    })
  }
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (compactNavigation?.matches && target?.closest('[data-flow="navigation"] a')) {
        const menu = root.querySelector('[data-flow="mobile-nav"]')
        if (menu instanceof HTMLDetailsElement) menu.open = false
      }
      if (!target?.closest('[data-flow-close]')) return
      const dialog = target.closest('dialog')
      if (dialog instanceof HTMLDialogElement) dialog.close()
    },
    { signal: controller.signal },
  )
  root.addEventListener(
    'close',
    (event) => {
      if (event.target instanceof HTMLDialogElement) openers.get(event.target)?.focus()
    },
    { capture: true, signal: controller.signal },
  )
  /** @type {Map<HTMLElement,{key:string|undefined,dispose:()=>void}>} */
  const liveEditors = new Map()
  const syncLiveDocs = () => {
    for (const [el, entry] of liveEditors)
      if (!root.contains(el) || el.dataset.liveKey !== entry.key) {
        entry.dispose()
        el.replaceChildren()
        liveEditors.delete(el)
      }
    root.querySelectorAll('[data-flow="live-doc"]').forEach((el) => {
      if (!(el instanceof HTMLElement) || liveEditors.has(el)) return
      el.dispatchEvent(
        new CustomEvent('flow-live-mount', {
          detail: {
            /** @param {ReturnType<typeof import('@ketvietlab/ketsuite/livedoc').createLiveDocView>} editor @param {HTMLElement} target @param {string} label */
            mount(editor, target, label) {
              const viewRoot = createRoot(
                domHost(),
                /** @type {import("@ketvietlab/ketjs-view").HostNode} */ (/** @type {unknown} */ (target)),
              )
              liveEditors.set(target, {
                key: target.dataset.liveKey,
                dispose: () => {
                  editor.dispose()
                  viewRoot.dispose()
                },
              })
              viewRoot.render(editor.view())
              const content = /** @type {HTMLElement} */ (
                target.querySelector('[data-ui="flow-editor-content"]')
              )
              content.setAttribute('aria-label', label)
              void editor.mountEditor(content)
            },
          },
        }),
      )
    })
  }
  return {
    sync() {
      sync()
      syncLiveDocs()
    },
    /** @param {string} id */
    open(id) {
      const dialog = root.querySelector(`#${CSS.escape(id)}`)
      if (!(dialog instanceof HTMLDialogElement)) throw new Error(`Flow dialog missing: ${id}`)
      if (document.activeElement instanceof HTMLElement) openers.set(dialog, document.activeElement)
      dialog.showModal()
    },
    dispose() {
      for (const entry of liveEditors.values()) entry.dispose()
      liveEditors.clear()
      clearTimelineDrag()
      clearDrag()
      root.querySelectorAll('[data-flow="toast"]:popover-open').forEach((element) => {
        if (element instanceof HTMLElement) element.hidePopover()
      })
      root.querySelectorAll('dialog[open]').forEach((dialog) => {
        if (dialog instanceof HTMLDialogElement) dialog.close()
      })
      controller.abort()
    },
  }
}
