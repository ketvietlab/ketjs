// The collaborative editor's DOM<->Yjs binding — the hardest, most
// deliberately narrow part of Flow's editor (see the plan: v1 is one flat
// rich-text run with bold/italic, not the full paragraph/heading/list
// vocabulary; that's follow-up work once this foundation is proven).
//
// Runtime-agnostic on purpose: `html`/`signal` come from the caller so the
// same code renders server-side (flow_backend/islands.ts, importing
// @ketvietlab/ketjs-view directly) and client-side (editor-client.ts,
// importing the framework's browser-served /_ket/view/index.js) — the same
// split mail_backend's own chatter view uses.
import * as Y from 'yjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export type EditorRuntime = {
  html: (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult
}

export type IssueEditorProps = { issueId: string }

type Delta = Array<{ insert: string; attributes?: { bold?: boolean; italic?: boolean } }>

const REMOTE = Symbol('remote-origin')
/**
 * Typing's own transact() is tagged so the update listener can skip its
 * render() — the DOM the user is actively typing into already reflects
 * their keystroke, so replacing its innerHTML from Yjs on every single
 * character is churn a re-render doesn't need to do (the actual mark-loss
 * bug this looked like it caused turned out to be `plainTextOf` below;
 * this stays as the right call regardless — it avoids fighting the
 * browser's own cursor/IME state for no reason). Every other local change
 * (toggleMark, initial run creation) still wants the normal render.
 */
const LOCAL_TYPING = Symbol('local-typing-origin')

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * `Y.XmlText.prototype.toString()` is NOT plain text — it renders each
 * attribute key as a wrapping XML tag name (e.g. `bold: true` becomes
 * `<bold>...</bold>`), which is what XmlText is for structurally, but it
 * silently broke every diff in this file: comparing that against
 * `container.textContent` (real plain text) made two unrelated strings,
 * so `diffRange` computed a delete-everything-insert-everything range and
 * every mark on the run was gone the moment anything was typed nearby.
 * This is the actual plain-text projection to diff against instead.
 */
const plainTextOf = (text: Y.XmlText): string => (text.toDelta() as Delta).map((op) => op.insert).join('')

function deltaToHtml(delta: Delta): string {
  return delta
    .map((op) => {
      let html = escapeHtml(op.insert)
      if (op.attributes?.bold) html = `<b>${html}</b>`
      if (op.attributes?.italic) html = `<i>${html}</i>`
      return html
    })
    .join('')
}

/** The plain-text offset of a (node, nodeOffset) point within `container`. */
function offsetOf(container: Node, node: Node, nodeOffset: number): number {
  let offset = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current === node) return offset + nodeOffset
    offset += (current.textContent ?? '').length
    current = walker.nextNode()
  }
  return offset
}

/** The inverse of offsetOf: the (node, nodeOffset) point at a plain-text offset. */
function pointAt(container: Node, offset: number): { node: Node; offset: number } | null {
  let remaining = offset
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  let last: Text | null = null
  while (current) {
    const length = (current.textContent ?? '').length
    if (remaining <= length) return { node: current, offset: remaining }
    remaining -= length
    last = current as Text
    current = walker.nextNode()
  }
  return last ? { node: last, offset: (last.textContent ?? '').length } : null
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number)
  return btoa(binary)
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Common-prefix/suffix text diff — small enough edits to keep formatting on either side intact. */
function diffRange(
  before: string,
  after: string,
): { start: number; deletedLength: number; inserted: string } {
  let start = 0
  const maxStart = Math.min(before.length, after.length)
  while (start < maxStart && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  return { start, deletedLength: endBefore - start, inserted: after.slice(start, endAfter) }
}

export function createIssueEditorView(runtime: EditorRuntime, props: IssueEditorProps) {
  const { html } = runtime
  const issueId = props.issueId
  const base = `/admin/flow/issues/${encodeURIComponent(issueId)}`
  const containerId = `flow-editor-${issueId}`
  const doc = new Y.Doc()
  let run: Y.XmlText | null = null
  let container: HTMLElement | null = null
  let composing = false
  let source: EventSource | null = null

  const fragment = doc.getXmlFragment('content')
  const ensureRun = (): Y.XmlText => {
    let first = fragment.get(0) as Y.XmlText | undefined
    if (!first) {
      first = new Y.XmlText()
      fragment.insert(0, [first])
    }
    return first
  }

  function render() {
    if (!container || !run) return
    const selection = document.getSelection()
    const anchored =
      selection?.rangeCount && container.contains(selection.anchorNode)
        ? offsetOf(container, selection.anchorNode as Node, selection.anchorOffset)
        : null
    container.innerHTML = deltaToHtml(run.toDelta() as Delta) || '<br>'
    if (anchored != null) {
      const point = pointAt(container, anchored)
      if (point) {
        const range = document.createRange()
        range.setStart(point.node, point.offset)
        range.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }

  async function pushLocalUpdate(update: Uint8Array) {
    await fetch(`${base}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: bytesToBase64(update) }),
    }).catch(() => {})
  }

  /**
   * A topic is scoped to one flatten generation (see sync.ts's rollGeneration) —
   * once it rolls over, the old topic 404s forever, and EventSource's native
   * reconnect just retries the same dead URL. Re-fetching /content gets both
   * the current topic and a snapshot to catch up on anything missed while
   * disconnected; re-applying already-known updates through it is a no-op,
   * Yjs merges are idempotent.
   */
  async function resync() {
    const response = await fetch(`${base}/content`).catch(() => null)
    if (!response?.ok) return
    const { snapshot, topic } = (await response.json()) as { snapshot: string; topic: string }
    Y.applyUpdate(doc, base64ToBytes(snapshot), REMOTE)
    connectLive(topic)
  }

  function connectLive(topic: string) {
    source?.close()
    const es = new EventSource(`${base}/live?topic=${encodeURIComponent(topic)}`)
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { update: string }
        Y.applyUpdate(doc, base64ToBytes(payload.update), REMOTE)
      } catch {
        // A malformed frame is skipped rather than tearing down the
        // connection — the CRDT stays correct either way.
      }
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setTimeout(() => void resync(), 500)
    }
    source = es
  }

  function applyLocalTextChange() {
    if (!container || !run || composing) return
    const before = plainTextOf(run)
    const after = container.textContent ?? ''
    if (before === after) return
    const { start, deletedLength, inserted } = diffRange(before, after)
    doc.transact(() => {
      if (deletedLength) run!.delete(start, deletedLength)
      if (inserted) run!.insert(start, inserted)
    }, LOCAL_TYPING)
  }

  function toggleMark(attribute: 'bold' | 'italic') {
    if (!container || !run) return
    const selection = document.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    const start = offsetOf(container, range.startContainer, range.startOffset)
    const end = offsetOf(container, range.endContainer, range.endOffset)
    if (end <= start) return
    const delta = run.toDelta() as Delta
    let cursor = 0
    let currentlyOn = true
    for (const op of delta) {
      const opEnd = cursor + op.insert.length
      if (opEnd > start && cursor < end && !op.attributes?.[attribute]) currentlyOn = false
      cursor = opEnd
    }
    run.format(start, end - start, { [attribute]: !currentlyOn })
  }

  async function mount(el: HTMLElement) {
    container = el
    el.addEventListener('compositionstart', () => {
      composing = true
    })
    el.addEventListener('compositionend', () => {
      composing = false
      applyLocalTextChange()
    })
    el.addEventListener('input', () => {
      if (!composing) applyLocalTextChange()
    })
    el.parentElement
      ?.querySelector('[data-flow-editor-bold]')
      ?.addEventListener('click', () => toggleMark('bold'))
    el.parentElement
      ?.querySelector('[data-flow-editor-italic]')
      ?.addEventListener('click', () => toggleMark('italic'))

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // The incremental update Yjs already computed for this change, not a
      // fresh Y.encodeStateAsUpdate(doc) full re-encode — sending the whole
      // document's state on every keystroke was the actual source of the
      // formatting loss bug: applying a full-state update on top of the
      // server's own incrementally-built state doesn't round-trip marks the
      // same way normal incremental merges do.
      if (origin !== REMOTE) void pushLocalUpdate(update)
      if (origin !== LOCAL_TYPING) render()
    })

    const response = await fetch(`${base}/content`)
    const { snapshot, topic } = (await response.json()) as { snapshot: string; topic: string }
    Y.applyUpdate(doc, base64ToBytes(snapshot), REMOTE)
    run = ensureRun()
    render()
    connectLive(topic)

    window.addEventListener('pagehide', () => {
      navigator.sendBeacon?.(`${base}/leave`)
    })
  }

  return {
    view: () =>
      html`<div class="flow-editor">
        <div class="flow-editor__toolbar">
          <button type="button" data-flow-editor-bold>B</button>
          <button type="button" data-flow-editor-italic>I</button>
        </div>
        <div id=${containerId} class="flow-editor__content" contenteditable="true"></div>
      </div>`,
    dispose() {
      source?.close()
    },
    mount,
    containerId,
  }
}
