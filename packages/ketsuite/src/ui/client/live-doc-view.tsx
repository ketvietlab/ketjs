// The collaborative editor's DOM<->Yjs binding.
//
// The first version of this file was one flat rich-text run with bold and
// italic — deliberately narrow, to prove the CRDT binding and IME handling
// before spending anything on vocabulary. This is that vocabulary: paragraphs,
// three heading levels, quote, code block, bullet/numbered/checklist items,
// and the marks bold/italic/strikethrough/code/link.
//
// The document is a flat list of blocks, not a tree. Each block is a
// `Y.XmlElement('block')` carrying a `type` attribute and one `Y.XmlText`
// child; nesting exists only in the rendered HTML, where consecutive list
// items share a `<ul>`. A tree would buy indented sub-lists and cost a
// position model that no longer maps to `(blockIndex, offset)` — the pair
// every operation below is written in terms of. Sub-lists are the thing given
// up for that, stated rather than pretended away.
//
// Runtime-agnostic on purpose: `html` comes from the caller so the same code
// renders server-side (flow_backend/islands.ts, importing @ketvietlab/ketjs-view
// directly) and client-side (editor-client.mjs, importing the framework's
// browser-served /_ket/view/index.js) — the same split mail_backend's own
// chatter view uses.
import * as Y from 'yjs'
import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'
// The shell's markup and the document serializer, which belong to the kit and
// not to a module — see the header of that file, and tools/ui-audit.ts for the
// rule it answers.
import { documentHtml, liveDocShell, presenceHtml } from './live-doc-shell.tsx'
import { BLOCK_TYPES, CONTINUES, LIST_TYPES } from './live-doc-blocks.ts'
import type { BlockType, Delta, MarkName } from './live-doc-blocks.ts'
import { parseMarkdown } from './live-doc-markdown.ts'
import type { MarkdownBlock } from './live-doc-markdown.ts'

export type LiveDocProps = {
  /** The record this document belongs to. */
  docId: string
  /**
   * The collection its endpoints hang off — `/admin/flow/issues`, matching the
   * base the owner passed `documentRoutes`. Handed in rather than built here so
   * one editor serves an issue, a project description and a page alike.
   */
  base: string
  lang?: string
}

type Block = { node: Y.XmlElement | Y.XmlText; text: Y.XmlText; type: BlockType; checked: boolean }
type Point = { index: number; offset: number }
type Span = { start: Point; end: Point }
type Viewer = { id: string; name: string; index: number; seenAt: number }

/**
 * Typing a prefix turns the block into what the prefix means, the way every
 * editor people already use behaves. Each pattern matches the block's *whole*
 * text, so a rule only fires on a line that is still nothing but its prefix —
 * `1. ` mid-sentence is a numbered reference, not a list.
 */
const INPUT_RULES: Array<[RegExp, BlockType]> = [
  [/^# $/, 'h1'],
  [/^## $/, 'h2'],
  [/^### $/, 'h3'],
  [/^> $/, 'quote'],
  [/^[-*] $/, 'bullet'],
  [/^\d+\. $/, 'ordered'],
  [/^\[[ xX]?\] $/, 'check'],
  [/^```$/, 'code'],
]

/**
 * Markdown that completes as you type it.
 *
 * Each pattern is anchored to the caret, so a rule fires on the keystroke that
 * closes it and never reaches back through text somebody finished with — the
 * closing delimiter is the gesture.
 *
 * No inner text may contain its own delimiter, and it may not begin or end
 * with a space. The second half keeps `2 * 3 * 4` a sum. The first half is
 * what makes `**now**` bold: while the inner text was merely "not a space",
 * the italic rule could open on the first `*` of a bold pair and swallow the
 * second one as content, so finishing `**now**` produced italic `now`.
 */
const INLINE_RULES: Array<{ pattern: RegExp; open: number; mark: MarkName }> = [
  { pattern: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, open: 2, mark: 'bold' },
  { pattern: /__([^_\s](?:[^_]*[^_\s])?)__$/, open: 2, mark: 'bold' },
  { pattern: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, open: 2, mark: 'strike' },
  { pattern: /(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, open: 1, mark: 'italic' },
  { pattern: /(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, open: 1, mark: 'italic' },
  { pattern: /`([^`]+)`$/, open: 1, mark: 'code' },
]

const LINK_RULE = /\[([^\]]+)\]\(([^)\s]+)\)$/

/**
 * How long a viewer stays listed without saying anything.
 *
 * Three heartbeats' worth, so one dropped frame does not make somebody blink
 * out of the room and back.
 */
const VIEWER_TTL = 90_000
const HEARTBEAT_MS = 30_000
/** A caret moving between blocks is worth announcing; a caret moving is not. */
const ANNOUNCE_EVERY_MS = 1_000

const REMOTE = Symbol('remote-origin')
/**
 * Typing's own transact() is tagged so the update listener can skip its
 * render() — the DOM the user is actively typing into already reflects
 * their keystroke, so replacing its innerHTML from Yjs on every single
 * character is churn a re-render doesn't need to do (it avoids fighting the
 * browser's own cursor and IME state for no reason). Every structural change
 * still wants the normal render, and says where the caret lands.
 */
const LOCAL_TYPING = Symbol('local-typing-origin')

/**
 * `Y.XmlText.prototype.toString()` is NOT plain text — it renders each
 * attribute key as a wrapping XML tag name (e.g. `bold: true` becomes
 * `<bold>...</bold>`), which is what XmlText is for structurally, but it
 * silently broke every diff in this file: comparing that against the DOM's
 * real plain text made two unrelated strings, so `diffRange` computed a
 * delete-everything-insert-everything range and every mark on the run was
 * gone the moment anything was typed nearby. This is the actual plain-text
 * projection to diff against instead.
 */
const plainTextOf = (text: Y.XmlText): string => (text.toDelta() as Delta).map((op) => op.insert).join('')

const plainLength = (delta: Delta): number => delta.reduce((total, op) => total + op.insert.length, 0)

const sliceDelta = (delta: Delta, from: number, to = Number.POSITIVE_INFINITY): Delta => {
  const out: Delta = []
  let cursor = 0
  for (const op of delta) {
    const end = cursor + op.insert.length
    const start = Math.max(from, cursor)
    const stop = Math.min(to, end)
    if (stop > start)
      out.push({
        insert: op.insert.slice(start - cursor, stop - cursor),
        ...(op.attributes ? { attributes: op.attributes } : {}),
      })
    cursor = end
  }
  return out
}

/** Everything a run can carry, so every one of them can be turned off by name. */
const MARK_KEYS = ['bold', 'italic', 'strike', 'code', 'link'] as const

/**
 * The marks new text inherits: the ones it is landing *inside* of.
 *
 * A mark does not reach past its own end. Typing in the middle of a bold word
 * keeps it bold, which is what anyone expects; typing immediately after one
 * does not, which is the half that has to be said out loud, because word
 * processors do the opposite.
 *
 * Here the closing delimiter is usually the gesture that made the mark —
 * somebody types `**now**`, and the two asterisks they finished with mean
 * exactly "stop". Extending anyway turned the rest of the sentence bold, then
 * the rest of that into code, then dropped all of it inside a link. The
 * failure is silent in the direction that matters, too: unwanted formatting is
 * invisible until you look at it, while missing formatting is visible at once
 * and one click away.
 *
 * Every mark is named on every insert, `null` for the ones that do not apply,
 * because leaving them out is not the same statement. `Y.Text.insert` with no
 * attributes means *inherit whatever is at this position* — so the answer to
 * "no marks here" is an explicit no, not silence. That distinction is why the
 * paragraph above was true of the code and false of the running editor.
 */
function attributesAt(text: Y.XmlText, offset: number): Record<string, unknown> {
  const clear: Record<string, unknown> = {}
  for (const key of MARK_KEYS) clear[key] = null
  if (offset === 0) return clear
  const delta = text.toDelta() as Delta
  let cursor = 0
  for (const op of delta) {
    const end = cursor + op.insert.length
    // `toDelta` merges neighbouring runs carrying the same marks, so the end of
    // an op is always the end of the run it belongs to.
    if (offset <= end) {
      if (offset === end || !op.attributes) return clear
      const carried: Record<string, unknown> = { ...clear }
      for (const key of MARK_KEYS) {
        const value = (op.attributes as Record<string, unknown>)[key]
        if (value != null) carried[key] = value
      }
      return carried
    }
    cursor = end
  }
  return clear
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

/** A selection point given as an element must be resolved down to a text node first. */
function descend(node: Node, offset: number): { node: Node; offset: number } {
  let current = node
  let at = offset
  while (current.nodeType === Node.ELEMENT_NODE) {
    const children = current.childNodes
    if (!children.length) return { node: current, offset: 0 }
    if (at >= children.length) {
      const last = children[children.length - 1] as Node
      current = last
      at = last.nodeType === Node.TEXT_NODE ? (last.textContent ?? '').length : last.childNodes.length
    } else {
      current = children[at] as Node
      at = 0
    }
  }
  return { node: current, offset: at }
}

export function createLiveDocView(props: LiveDocProps) {
  const docId = props.docId
  const base = `${props.base}/${encodeURIComponent(docId)}`
  const containerId = `flow-editor-${docId}`
  const doc = new Y.Doc()
  let container: HTMLElement | null = null
  let shell: HTMLElement | null = null
  let composing = false
  /**
   * Where a composition began, and whether a re-render is owed to it.
   *
   * Replacing the container's innerHTML while an IME is mid-word detaches the
   * text node it is composing into, and the half-typed word goes with it —
   * reproduced with two tabs: one composing `tiê`, the other typing anything,
   * and the first reader's word was gone. Telex and VNI make this ordinary
   * rather than rare: a Vietnamese word is several keystrokes long and the
   * accents rewrite letters already on screen, so the window in which a
   * collaborator can destroy one is most of the time spent typing.
   */
  let composedAt: Point | null = null
  let renderOwed: Span | null | undefined
  let source: EventSource | null = null
  /**
   * Where the caret goes after the next render, set by whichever structural
   * edit is about to run.
   *
   * A structural edit changes how many blocks there are, so reading the
   * selection out of the DOM at render time — which is the old DOM, still
   * showing the old block count — yields indices that no longer exist and a
   * caret that silently vanishes. The operation knows where the caret lands
   * before it runs; this is where it says so.
   */
  let pending: Span | null = null
  /** The selection the link dialog was opened over, since focusing its input destroys it. */
  let linkSpan: Span | null = null
  /**
   * Everyone else with this description open, by user id.
   *
   * Kept only here. Presence is who is here *now*, so the moment it were
   * stored anywhere it would outlive the person — a viewer is remembered
   * until they stop saying otherwise, and no longer.
   */
  const viewers = new Map<string, Viewer>()
  let selfId = ''
  let announcedAt = 0
  let announcedIndex = -1
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const fragment = doc.getXmlFragment('content')

  // ---- document model -----------------------------------------------------

  const typeOf = (element: Y.XmlElement): BlockType => {
    const value = element.getAttribute('type') as BlockType | undefined
    return value && BLOCK_TYPES.includes(value) ? value : 'p'
  }

  /**
   * The blocks, in order.
   *
   * A bare `Y.XmlText` at the top level is what the first version of this
   * editor wrote, and documents written by it are still stored. It is read as
   * a paragraph rather than migrated on load: a migration is a write, two tabs
   * opening the same old issue would each perform it, and the result is the
   * paragraph twice. It converts to a real block the first time somebody
   * changes its type, which is a deliberate act by one client.
   */
  const blocksOf = (): Block[] =>
    fragment.toArray().flatMap((node): Block[] => {
      if (node instanceof Y.XmlText) return [{ node, text: node, type: 'p', checked: false }]
      if (!(node instanceof Y.XmlElement)) return []
      const first = node.get(0)
      if (!(first instanceof Y.XmlText)) return []
      return [{ node, text: first, type: typeOf(node), checked: node.getAttribute('checked') === 'true' }]
    })

  /** Inserts a new empty block and answers its text run. Call inside a transaction. */
  function insertBlock(index: number, type: BlockType, checked = false): Y.XmlText {
    const element = new Y.XmlElement('block')
    element.setAttribute('type', type)
    if (checked) element.setAttribute('checked', 'true')
    fragment.insert(index, [element])
    const text = new Y.XmlText()
    element.insert(0, [text])
    return text
  }

  const ensureBlocks = () => {
    if (fragment.length === 0) doc.transact(() => void insertBlock(0, 'p'))
  }

  const modelOf = () =>
    blocksOf().map((block) => ({
      type: block.type,
      checked: block.checked,
      delta: block.text.toDelta() as Delta,
    }))

  // ---- DOM <-> model positions --------------------------------------------

  const elementAt = (index: number): HTMLElement | null =>
    container?.querySelector(`[data-index="${index}"]`) ?? null

  /**
   * The element a block's characters actually live in.
   *
   * For most blocks that is the block itself. A checklist item also holds a
   * tick box, so its text sits in its own span — and the difference matters at
   * exactly one moment: an empty item has no text node to put the caret in, so
   * `pointIn`'s fallback has to name an element instead. Naming the `<li>` put
   * the caret *before* the tick box, and the first character typed into a
   * fresh checklist item landed outside the line, ahead of its own checkbox.
   *
   * Only that fallback uses this. Reading a block's text still walks the whole
   * block, so a character that does end up outside the line — a click landing
   * in the item's padding, say — is still read into the model and moved back
   * where it belongs by the next render, rather than quietly discarded.
   */
  const lineOf = (block: HTMLElement): HTMLElement =>
    (block.querySelector('[data-ui="flow-editor-line"]') as HTMLElement | null) ?? block

  /**
   * The editable nodes of one block, in order.
   *
   * `contenteditable="false"` subtrees are rejected outright — a checklist's
   * own tick box is chrome, not a character, and counting it shifted every
   * offset in the line by one. A trailing `<br>` is dropped for the same kind
   * of reason: it is the placeholder that gives an empty block a line box, not
   * something anybody typed.
   */
  function blockNodes(block: HTMLElement): Node[] {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node: Node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT
        const element = node as HTMLElement
        if (element.getAttribute('contenteditable') === 'false') return NodeFilter.FILTER_REJECT
        return element.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    const nodes: Node[] = []
    let current = walker.nextNode()
    while (current) {
      nodes.push(current)
      current = walker.nextNode()
    }
    // Exactly one, never more: the last `<br>` is the placeholder the renderer
    // adds so an empty line has somewhere to put the caret, and every one
    // before it is a newline somebody typed. Dropping them all read
    // `"cd build\n"` back as `"cd build"`, so the next character typed landed
    // on the end of the previous line.
    if (nodes.length && (nodes[nodes.length - 1] as HTMLElement).tagName === 'BR') nodes.pop()
    return nodes
  }

  const lengthOfNode = (node: Node): number =>
    node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : 1

  /**
   * A block's text as the model would spell it.
   *
   * The U+00A0 replacement is not cosmetic. contenteditable writes a
   * non-breaking space wherever a normal one would collapse -- a trailing
   * space above all -- so what the model read back after typing "# " was "#"
   * followed by U+00A0, which matches no input rule and is not the character
   * anybody typed. It reached the stored description and the search index
   * that way too. `white-space: pre-wrap` on the container (flow-editor.css)
   * is the other half: it lets a real space survive the round trip, so the
   * browser has no reason to reach for the substitute in the first place.
   */
  const domTextOf = (block: HTMLElement): string =>
    blockNodes(block)
      .map((node) => (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '') : '\n'))
      .join('')
      .replace(/\u00a0/g, ' ')

  function offsetIn(block: HTMLElement, node: Node, nodeOffset: number): number {
    let offset = 0
    for (const current of blockNodes(block)) {
      if (current === node) return offset + nodeOffset
      offset += lengthOfNode(current)
    }
    return offset
  }

  /** Where in the DOM a `<br>` sits, as a (parent, childIndex) point. */
  const beside = (node: Node, after: boolean): { node: Node; offset: number } => {
    const parent = node.parentNode as Node
    const at = Array.prototype.indexOf.call(parent.childNodes, node) as number
    return { node: parent, offset: at + (after ? 1 : 0) }
  }

  function pointIn(block: HTMLElement, offset: number): { node: Node; offset: number } {
    let remaining = offset
    let last: Node | null = null
    for (const current of blockNodes(block)) {
      const length = lengthOfNode(current)
      if (current.nodeType === Node.TEXT_NODE) {
        if (remaining <= length) return { node: current, offset: remaining }
      } else if (remaining === 0) return beside(current, false)
      remaining -= length
      last = current
    }
    if (last?.nodeType === Node.TEXT_NODE) return { node: last, offset: (last.textContent ?? '').length }
    // Past the last newline is the empty line after it, which is a position
    // between two `<br>`s rather than anywhere inside a text node.
    if (last) return beside(last, true)
    return { node: lineOf(block), offset: 0 }
  }

  function pointFrom(node: Node | null, offset: number): Point | null {
    if (!container || !node || !container.contains(node)) return null
    const resolved = descend(node, offset)
    const host =
      resolved.node.nodeType === Node.ELEMENT_NODE
        ? (resolved.node as HTMLElement)
        : resolved.node.parentElement
    const block = host?.closest('[data-index]') as HTMLElement | null
    if (!block) return null
    return {
      index: Number(block.getAttribute('data-index')),
      offset: offsetIn(block, resolved.node, resolved.offset),
    }
  }

  /** The current selection as model positions, always in document order. */
  function selectionSpan(): Span | null {
    const selection = document.getSelection()
    if (!selection?.rangeCount) return null
    const range = selection.getRangeAt(0)
    const start = pointFrom(range.startContainer, range.startOffset)
    const end = pointFrom(range.endContainer, range.endOffset)
    return start && end ? { start, end } : null
  }

  const isCollapsed = (span: Span) =>
    span.start.index === span.end.index && span.start.offset === span.end.offset

  const caretAt = (point: Point): Span => ({ start: point, end: point })

  function restoreSelection(span: Span) {
    const startBlock = elementAt(span.start.index)
    const endBlock = elementAt(span.end.index)
    if (!startBlock || !endBlock) return
    const from = pointIn(startBlock, span.start.offset)
    const to = pointIn(endBlock, span.end.offset)
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  // ---- rendering ----------------------------------------------------------

  function render(keep?: Span | null) {
    if (!container) return
    const span = keep === undefined ? selectionSpan() : keep
    container.innerHTML = documentHtml(modelOf(), props.lang, others())
    if (span) restoreSelection(span)
    syncToolbar()
    renderPresence()
  }

  /**
   * The toolbar reports the block under the caret and which marks it carries.
   *
   * Without it the type control keeps showing whatever was last chosen and the
   * mark buttons never look pressed, so the toolbar describes the past rather
   * than the selection — which is worse than having no toolbar state at all,
   * because it reads as authoritative.
   */
  function syncToolbar() {
    if (!shell) return
    const span = selectionSpan()
    const block = span ? blocksOf()[span.start.index] : undefined
    const select = shell.querySelector('[data-flow-editor-block]') as HTMLSelectElement | null
    if (select && block) select.value = LIST_TYPES.includes(block.type) ? 'p' : block.type
    for (const button of Array.from(shell.querySelectorAll('[data-flow-editor-mark]')) as HTMLElement[]) {
      const name = button.getAttribute('data-flow-editor-mark') ?? ''
      const active = LIST_TYPES.includes(name as BlockType)
        ? block?.type === name
        : span && !isCollapsed(span) && spanHasMark(span, name as MarkName)
      button.setAttribute('aria-pressed', String(active === true))
    }
  }

  // ---- presence -----------------------------------------------------------

  /** Everyone but you, and only while they are still saying they are here. */
  function others(): Array<{ id: string; name: string; index: number }> {
    const now = Date.now()
    for (const [id, viewer] of viewers) if (now - viewer.seenAt > VIEWER_TTL) viewers.delete(id)
    return [...viewers.values()]
      .filter((viewer) => viewer.id !== selfId)
      .map(({ id, name, index }) => ({ id, name, index }))
  }

  /** What the room looks like, so a frame that changes nothing costs nothing. */
  const roomSignature = (): string =>
    others()
      .map((viewer) => `${viewer.id}@${viewer.index}`)
      .sort()
      .join(',')

  function renderPresence() {
    const slot = shell?.querySelector('[data-flow-editor-presence]')
    if (slot) slot.innerHTML = presenceHtml(others(), props.lang)
  }

  /**
   * Says where this client's caret is — or, with `gone`, that it is leaving.
   *
   * The name is not sent. The route stamps it from the session, because a
   * frame goes to everyone else in the document and a client that could name
   * itself could sit in the room under somebody else's name.
   */
  async function announce(index: number, gone = false) {
    announcedAt = Date.now()
    announcedIndex = gone ? -1 : index
    const answer = await fetch(`${base}/presence`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ index, gone }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ id?: string }>) : null))
      .catch(() => null)
    if (answer?.id) selfId = answer.id
  }

  /**
   * Announce when the caret changes block, and no more often than that.
   *
   * A caret moving inside a paragraph tells nobody anything the marker on that
   * paragraph did not already say, and these frames ride the same topic as the
   * edits — which is bounded by how often the document flattens, not by how
   * often anybody types.
   */
  function announceCaret() {
    const span = selectionSpan()
    if (!span) return
    const index = span.start.index
    if (index === announcedIndex && Date.now() - announcedAt < HEARTBEAT_MS) return
    if (Date.now() - announcedAt < ANNOUNCE_EVERY_MS) return
    void announce(index)
  }

  function receivePresence(frame: { id?: string; name?: string; index?: number; gone?: boolean }) {
    if (!frame.id) return
    const before = roomSignature()
    const known = viewers.has(frame.id)
    if (frame.gone) viewers.delete(frame.id)
    else
      viewers.set(frame.id, {
        id: frame.id,
        name: String(frame.name ?? frame.id),
        index: Number(frame.index) || 0,
        // Stamped on arrival rather than taken from the frame: freshness is
        // measured against this clock, and the sender's is a different one.
        seenAt: Date.now(),
      })
    // Somebody new only learns who is already here when they next speak, and
    // an idle room is silent. Answering a stranger is what makes the room
    // visible to a joiner within a beat instead of within a heartbeat.
    if (!known && !frame.gone && frame.id !== selfId && Date.now() - announcedAt > ANNOUNCE_EVERY_MS)
      void announce(selectionSpan()?.start.index ?? 0)
    if (roomSignature() !== before) render()
  }

  // ---- structural edits ---------------------------------------------------

  /** Every structural edit runs through here, so none of them can forget the caret. */
  function structural(caret: Span, run: () => void) {
    pending = caret
    doc.transact(run)
  }

  function setBlockType(index: number, type: BlockType) {
    const block = blocksOf()[index]
    if (!block || block.type === type) return
    if (block.node instanceof Y.XmlText) {
      // A legacy top-level run has nowhere to put an attribute, so it is
      // replaced by a real block carrying the same content.
      const delta = block.text.toDelta() as Delta
      fragment.delete(index, 1)
      const text = insertBlock(index, type)
      if (delta.length) text.applyDelta(delta as unknown[])
      return
    }
    block.node.setAttribute('type', type)
    if (type !== 'check') block.node.removeAttribute('checked')
  }

  function applyBlockType(type: BlockType) {
    const span = selectionSpan()
    if (!span) return
    const blocks = blocksOf()
    // Asking for the type a block already has means asking to leave it — the
    // way the same button both makes a list and unmakes one.
    const all = blocks.slice(span.start.index, span.end.index + 1).every((block) => block.type === type)
    const target = all ? 'p' : type
    structural(span, () => {
      for (let index = span.end.index; index >= span.start.index; index--) setBlockType(index, target)
    })
  }

  function splitBlock(at: Point) {
    const blocks = blocksOf()
    const block = blocks[at.index]
    if (!block) return
    const delta = block.text.toDelta() as Delta
    const length = plainLength(delta)
    // Enter on an empty list item leaves the list rather than extending it —
    // otherwise there is no way out of one except deleting it.
    if (LIST_TYPES.includes(block.type) && length === 0) {
      structural(caretAt({ index: at.index, offset: 0 }), () => setBlockType(at.index, 'p'))
      return
    }
    const tail = sliceDelta(delta, at.offset)
    const nextType = CONTINUES.has(block.type) ? block.type : 'p'
    structural(caretAt({ index: at.index + 1, offset: 0 }), () => {
      if (at.offset < length) block.text.delete(at.offset, length - at.offset)
      const text = insertBlock(at.index + 1, nextType)
      if (tail.length) text.applyDelta(tail as unknown[])
    })
  }

  function mergeBackward(index: number) {
    if (index <= 0) return
    const blocks = blocksOf()
    const previous = blocks[index - 1]
    const current = blocks[index]
    if (!previous || !current) return
    const at = plainLength(previous.text.toDelta() as Delta)
    const tail = current.text.toDelta() as Delta
    structural(caretAt({ index: index - 1, offset: at }), () => {
      if (tail.length) previous.text.applyDelta([{ retain: at }, ...tail] as unknown[])
      fragment.delete(index, 1)
    })
  }

  function mergeForward(index: number) {
    const blocks = blocksOf()
    if (index + 1 >= blocks.length) return
    mergeBackward(index + 1)
  }

  /** Removes everything between the two ends and answers where the caret lands. */
  function deleteSpan(span: Span): Point {
    const blocks = blocksOf()
    const first = blocks[span.start.index]
    if (!first) return span.start
    const caret = { index: span.start.index, offset: span.start.offset }
    if (span.start.index === span.end.index) {
      structural(caretAt(caret), () =>
        first.text.delete(span.start.offset, span.end.offset - span.start.offset),
      )
      return caret
    }
    const last = blocks[span.end.index]
    const tail = last ? sliceDelta(last.text.toDelta() as Delta, span.end.offset) : []
    const length = plainLength(first.text.toDelta() as Delta)
    structural(caretAt(caret), () => {
      if (span.start.offset < length) first.text.delete(span.start.offset, length - span.start.offset)
      if (tail.length) first.text.applyDelta([{ retain: span.start.offset }, ...tail] as unknown[])
      fragment.delete(span.start.index + 1, span.end.index - span.start.index)
    })
    return caret
  }

  function insertTextAt(at: Point, value: string) {
    const block = blocksOf()[at.index]
    if (!block || !value) return
    const caret = { index: at.index, offset: at.offset + value.length }
    structural(caretAt(caret), () => block.text.insert(at.offset, value, attributesAt(block.text, at.offset)))
  }

  /** Sets a checklist item's tick without regard to what it was. Call inside a transaction. */
  function checkedOn(index: number, checked: boolean) {
    const block = blocksOf()[index]
    if (!block || block.node instanceof Y.XmlText) return
    if (checked) block.node.setAttribute('checked', 'true')
    else block.node.removeAttribute('checked')
  }

  function toggleChecked(index: number) {
    const block = blocksOf()[index]
    if (!block || block.node instanceof Y.XmlText || block.type !== 'check') return
    const next = block.checked ? null : 'true'
    structural(selectionSpan() ?? caretAt({ index, offset: 0 }), () => {
      if (next) (block.node as Y.XmlElement).setAttribute('checked', next)
      else (block.node as Y.XmlElement).removeAttribute('checked')
    })
  }

  // ---- marks --------------------------------------------------------------

  /** Runs `visit` over each block's slice of the selection. */
  function overSpan(span: Span, visit: (text: Y.XmlText, from: number, to: number) => void) {
    const blocks = blocksOf()
    for (let index = span.start.index; index <= span.end.index; index++) {
      const block = blocks[index]
      if (!block) continue
      const length = plainLength(block.text.toDelta() as Delta)
      const from = index === span.start.index ? span.start.offset : 0
      const to = index === span.end.index ? Math.min(span.end.offset, length) : length
      if (to > from) visit(block.text, from, to)
    }
  }

  function spanHasMark(span: Span, name: MarkName): boolean {
    let seen = false
    let all = true
    overSpan(span, (text, from, to) => {
      let cursor = 0
      for (const op of text.toDelta() as Delta) {
        const end = cursor + op.insert.length
        if (end > from && cursor < to) {
          seen = true
          if (!op.attributes?.[name]) all = false
        }
        cursor = end
      }
    })
    return seen && all
  }

  function toggleMark(name: MarkName) {
    const span = selectionSpan()
    if (!span || isCollapsed(span)) return
    const on = spanHasMark(span, name)
    pending = span
    doc.transact(() => {
      overSpan(span, (text, from, to) => text.format(from, to - from, { [name]: on ? null : true }))
    })
  }

  function applyLink(href: string | null) {
    const span = linkSpan
    if (!span || isCollapsed(span)) return
    pending = span
    doc.transact(() => {
      overSpan(span, (text, from, to) => text.format(from, to - from, { link: href }))
    })
  }

  // ---- input --------------------------------------------------------------

  function applyInputRule(index: number): boolean {
    const block = blocksOf()[index]
    if (!block || block.type === 'code') return false
    const text = plainTextOf(block.text)
    const rule = INPUT_RULES.find(([pattern]) => pattern.test(text))
    if (!rule) return false
    structural(caretAt({ index, offset: 0 }), () => {
      block.text.delete(0, text.length)
      setBlockType(index, rule[1])
    })
    return true
  }

  /**
   * Turns a completed Markdown span into the mark it spells.
   *
   * The delimiters are removed from the end first, so the offsets computed
   * against the original text still hold when the opening one goes. What is
   * left keeps whatever marks it already carried — writing `**` around a word
   * that is already a link should bold the link, not replace it.
   */
  function applyInlineRule(index: number, caret: number): boolean {
    const block = blocksOf()[index]
    // Not in a code block: the delimiters there are characters.
    if (!block || block.type === 'code') return false
    const upToCaret = plainTextOf(block.text).slice(0, caret)

    const link = LINK_RULE.exec(upToCaret)
    if (link) {
      const whole = link[0] as string
      const label = link[1] as string
      const href = link[2] as string
      const start = caret - whole.length
      structural(caretAt({ index, offset: start + label.length }), () => {
        block.text.delete(start + 1 + label.length, whole.length - 1 - label.length)
        block.text.delete(start, 1)
        block.text.format(start, label.length, { link: href })
      })
      return true
    }

    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(upToCaret)
      if (!match) continue
      const whole = match[0] as string
      const inner = match[1] as string
      const start = caret - whole.length
      structural(caretAt({ index, offset: start + inner.length }), () => {
        block.text.delete(start + rule.open + inner.length, rule.open)
        block.text.delete(start, rule.open)
        block.text.format(start, inner.length, { [rule.mark]: true })
      })
      return true
    }
    return false
  }

  /**
   * Within-block typing, diffed rather than intercepted.
   *
   * Everything structural is handled in `onBeforeInput` before the browser
   * touches the DOM; what reaches here is a character landing inside one
   * block, which is exactly the case where letting contenteditable do its own
   * work is what keeps an IME's composition intact. If the DOM has more or
   * fewer blocks than the model, the browser did something structural anyway
   * and the model wins — re-rendering discards it rather than trying to
   * reverse-engineer it.
   */
  function applyLocalTextChange() {
    if (!container || composing) return
    const blocks = blocksOf()
    if (container.querySelectorAll('[data-index]').length !== blocks.length) {
      render(null)
      return
    }
    const span = selectionSpan()
    if (!span) return
    const element = elementAt(span.start.index)
    const block = blocks[span.start.index]
    if (!element || !block) {
      render(null)
      return
    }
    const before = plainTextOf(block.text)
    const after = domTextOf(element)
    if (before === after) return
    const { start, deletedLength, inserted } = diffRange(before, after)
    doc.transact(() => {
      if (deletedLength) block.text.delete(start, deletedLength)
      if (inserted) block.text.insert(start, inserted, attributesAt(block.text, start))
    }, LOCAL_TYPING)
    // Block rules win: they only fire on a line that is still nothing but its
    // prefix, so the two can never both be right about the same keystroke.
    if (!applyInputRule(span.start.index)) applyInlineRule(span.start.index, start + inserted.length)
  }

  function onBeforeInput(event: InputEvent) {
    if (composing || !container) return
    const span = selectionSpan()
    if (!span) return
    const type = event.inputType
    const collapsed = isCollapsed(span)
    const multi = span.start.index !== span.end.index

    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
      const at = collapsed ? span.start : deleteSpan(span)
      const block = blocksOf()[at.index]
      // A code block is where a newline is a character rather than a new
      // block — that is most of what makes it a code block. Which leaves the
      // question of how anyone gets out of one, since Enter no longer means
      // "next block" and a code block at the end of the document has nothing
      // after it to click into. Enter on an already-blank last line is the
      // way out, the same gesture every editor uses for the same problem.
      if (block?.type === 'code') {
        const length = plainLength(block.text.toDelta() as Delta)
        if (at.offset === length && plainTextOf(block.text).endsWith('\n'))
          structural(caretAt({ index: at.index + 1, offset: 0 }), () => {
            block.text.delete(length - 1, 1)
            insertBlock(at.index + 1, 'p')
          })
        else insertTextAt(at, '\n')
      } else splitBlock(at)
      return
    }

    if (type.startsWith('delete')) {
      if (!collapsed) {
        event.preventDefault()
        deleteSpan(span)
        return
      }
      const block = blocksOf()[span.start.index]
      if (!block) return
      const length = plainLength(block.text.toDelta() as Delta)
      if (type.includes('Backward') && span.start.offset === 0) {
        event.preventDefault()
        // Backspace at the head of a heading or a list item removes the *kind*
        // first and joins the line above only on a second press. Joining
        // straight away is how a heading silently disappears into the
        // paragraph before it.
        if (block.type !== 'p')
          structural(caretAt({ index: span.start.index, offset: 0 }), () =>
            setBlockType(span.start.index, 'p'),
          )
        else mergeBackward(span.start.index)
        return
      }
      if (type.includes('Forward') && span.start.offset === length) {
        event.preventDefault()
        mergeForward(span.start.index)
      }
      return
    }

    if (!multi) return
    // Anything else spanning two blocks would leave contenteditable to do its
    // own structural surgery, which the model cannot read back. The selection
    // is removed here and the typed character, if there is one, re-inserted.
    event.preventDefault()
    const at = deleteSpan(span)
    if (type === 'insertText' && typeof event.data === 'string') insertTextAt(at, event.data)
  }

  /**
   * Paste arrives as plain text and lands as blocks.
   *
   * Keeping the source's own HTML would mean trusting markup from wherever the
   * clipboard came from, which is a different and much larger problem than
   * this editor has; every line becomes a block of the current kind instead,
   * so pasting a list into a list stays a list.
   */
  function onPaste(event: ClipboardEvent) {
    event.preventDefault()
    const value = event.clipboardData?.getData('text/plain') ?? ''
    const span = selectionSpan()
    if (!value || !span) return
    const at = isCollapsed(span) ? span.start : deleteSpan(span)
    const block = blocksOf()[at.index]
    if (!block) return
    // Into a code block the clipboard is characters, delimiters and all —
    // pasting a snippet is the one time nobody wants it read as Markdown.
    if (block.type === 'code') {
      insertTextAt(at, value)
      return
    }
    const parsed = parseMarkdown(value)
    if (!parsed.length) return

    const delta = block.text.toDelta() as Delta
    const length = plainLength(delta)
    const tail = sliceDelta(delta, at.offset)
    const first = parsed[0] as MarkdownBlock
    // An empty block takes the shape of what lands in it — pasting a heading
    // into a blank line should give a heading, not a heading's words. A block
    // with something in it keeps its own kind and takes only the words.
    const adopt = length === 0 && first.type !== 'p'
    const lastBlock = parsed[parsed.length - 1] as MarkdownBlock
    const caret = {
      index: at.index + parsed.length - 1,
      offset: parsed.length === 1 ? at.offset + plainLength(first.delta) : plainLength(lastBlock.delta),
    }

    structural(caretAt(caret), () => {
      if (at.offset < length) block.text.delete(at.offset, length - at.offset)
      if (first.delta.length) block.text.applyDelta([{ retain: at.offset }, ...first.delta] as unknown[])
      if (adopt) {
        setBlockType(at.index, first.type)
        if (first.checked) checkedOn(at.index, true)
      }
      for (let index = 1; index < parsed.length; index++) {
        const source = parsed[index] as MarkdownBlock
        const text = insertBlock(at.index + index, source.type, source.checked)
        if (source.delta.length) text.applyDelta(source.delta as unknown[])
        if (index === parsed.length - 1 && tail.length)
          text.applyDelta([{ retain: plainLength(source.delta) }, ...tail] as unknown[])
      }
      // One block in, so the text after the caret never left its own block.
      if (parsed.length === 1 && tail.length)
        block.text.applyDelta([{ retain: at.offset + plainLength(first.delta) }, ...tail] as unknown[])
    })
  }

  // ---- transport ----------------------------------------------------------

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
    const { snapshot, topic, viewerId } = (await response.json()) as {
      snapshot: string
      topic: string
      viewerId?: string | null
    }
    if (viewerId) selfId = viewerId
    Y.applyUpdate(doc, base64ToBytes(snapshot), REMOTE)
    connectLive(topic)
  }

  function connectLive(topic: string) {
    source?.close()
    const es = new EventSource(`${base}/live?topic=${encodeURIComponent(topic)}`)
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          update?: string
          presence?: Record<string, unknown>
        }
        if (payload.presence) receivePresence(payload.presence)
        else if (payload.update) Y.applyUpdate(doc, base64ToBytes(payload.update), REMOTE)
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

  // ---- mount --------------------------------------------------------------

  const onSelectionChange = () => {
    syncToolbar()
    announceCaret()
  }

  function wireToolbar(root: HTMLElement) {
    for (const button of Array.from(root.querySelectorAll('[data-flow-editor-mark]')) as HTMLElement[]) {
      const name = button.getAttribute('data-flow-editor-mark') ?? ''
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => {
        if (LIST_TYPES.includes(name as BlockType)) applyBlockType(name as BlockType)
        else if (name === 'link') openLinkDialog()
        else toggleMark(name as MarkName)
      })
    }
    const select = root.querySelector('[data-flow-editor-block]') as HTMLSelectElement | null
    select?.addEventListener('change', () => {
      const value = select.value as BlockType
      const span = selectionSpan()
      if (!span) return
      structural(span, () => {
        for (let index = span.end.index; index >= span.start.index; index--) setBlockType(index, value)
      })
    })
  }

  const linkDialog = () => shell?.querySelector('[data-flow-editor-link-dialog]') as HTMLDialogElement | null

  function openLinkDialog() {
    const span = selectionSpan()
    if (!span || isCollapsed(span)) return
    linkSpan = span
    const dialog = linkDialog()
    const input = shell?.querySelector('[data-flow-editor-link-input]') as HTMLInputElement | null
    const block = blocksOf()[span.start.index]
    const existing = block
      ? (sliceDelta(block.text.toDelta() as Delta, span.start.offset)[0]?.attributes?.link ?? '')
      : ''
    if (input) input.value = existing
    dialog?.showModal()
    input?.focus()
  }

  function wireLinkDialog(root: HTMLElement) {
    const dialog = root.querySelector('[data-flow-editor-link-dialog]') as HTMLDialogElement | null
    const input = root.querySelector('[data-flow-editor-link-input]') as HTMLInputElement | null
    root.querySelector('[data-flow-editor-link-cancel]')?.addEventListener('click', () => {
      dialog?.close()
    })
    root.querySelector('[data-flow-editor-link-remove]')?.addEventListener('click', () => {
      applyLink(null)
      dialog?.close()
    })
    root.querySelector('[data-flow-editor-link-apply]')?.addEventListener('click', () => {
      applyLink(input?.value?.trim() || null)
      dialog?.close()
    })
  }

  async function mount(el: HTMLElement) {
    container = el
    shell = (el.closest('[data-ui="flow-editor"]') as HTMLElement | null) ?? el.parentElement
    el.addEventListener('compositionstart', () => {
      composing = true
      composedAt = selectionSpan()?.start ?? null
    })
    el.addEventListener('compositionend', (event) => {
      composing = false
      const owed = renderOwed
      renderOwed = undefined
      const composed = (event as CompositionEvent).data ?? ''
      if (owed === undefined) {
        // Nothing arrived while they typed, so the DOM is still the truth and
        // the ordinary diff reads it.
        applyLocalTextChange()
        composedAt = null
        return
      }
      // Something did arrive, and the DOM has been holding a stale copy of the
      // document ever since. Diffing it now would read the remote edit as a
      // deletion, so the word is taken from the event that carries it and put
      // back where the composition began, and the document is redrawn from the
      // model rather than the other way round.
      const block = composedAt ? blocksOf()[composedAt.index] : undefined
      if (block && composed) {
        const offset = Math.min(composedAt!.offset, plainLength(block.text.toDelta() as Delta))
        const caret = { index: composedAt!.index, offset: offset + composed.length }
        structural(caretAt(caret), () =>
          block.text.insert(offset, composed, attributesAt(block.text, offset)),
        )
      } else render(owed ?? undefined)
      composedAt = null
    })
    el.addEventListener('beforeinput', (event) => onBeforeInput(event as InputEvent))
    el.addEventListener('input', () => {
      if (!composing) applyLocalTextChange()
    })
    el.addEventListener('paste', (event) => onPaste(event as ClipboardEvent))
    el.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const box = target?.closest('[data-ui="flow-editor-check"]')
      const block = box?.closest('[data-index]')
      if (block) toggleChecked(Number(block.getAttribute('data-index')))
    })
    document.addEventListener('selectionchange', onSelectionChange)
    if (shell) {
      wireToolbar(shell)
      wireLinkDialog(shell)
    }

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      // The incremental update Yjs already computed for this change, not a
      // fresh Y.encodeStateAsUpdate(doc) full re-encode — sending the whole
      // document's state on every keystroke was the actual source of an early
      // formatting-loss bug: applying a full-state update on top of the
      // server's own incrementally-built state doesn't round-trip marks the
      // same way normal incremental merges do.
      if (origin !== REMOTE) void pushLocalUpdate(update)
      if (origin !== LOCAL_TYPING) {
        const keep = pending
        pending = null
        // Not while somebody is mid-word. The change is already in the
        // document; drawing it can wait the second it takes them to finish.
        if (composing) renderOwed = keep
        else render(keep ?? undefined)
      }
    })

    const response = await fetch(`${base}/content`)
    const { snapshot, topic, viewerId } = (await response.json()) as {
      snapshot: string
      topic: string
      viewerId?: string | null
    }
    if (viewerId) selfId = viewerId
    Y.applyUpdate(doc, base64ToBytes(snapshot), REMOTE)
    ensureBlocks()
    render(null)
    connectLive(topic)

    void announce(0)
    // Only while the tab is actually being looked at: a background tab that
    // kept announcing would hold its author in the room for as long as the
    // browser stayed open, and would keep writing frames onto a topic that
    // only a flatten ever ends.
    heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') void announce(selectionSpan()?.start.index ?? 0)
    }, HEARTBEAT_MS)

    window.addEventListener('pagehide', () => {
      navigator.sendBeacon?.(`${base}/leave`)
      // A Blob, because sendBeacon posts text/plain otherwise and the route
      // reads JSON. Beacons survive the page going away; a fetch does not.
      navigator.sendBeacon?.(
        `${base}/presence`,
        new Blob([JSON.stringify({ index: 0, gone: true })], { type: 'application/json' }),
      )
    })
  }

  return {
    view: () => liveDocShell({ containerId, lang: props.lang }) as TemplateResult,
    dispose() {
      source?.close()
      if (heartbeat) clearInterval(heartbeat)
      if (typeof document !== 'undefined') document.removeEventListener('selectionchange', onSelectionChange)
    },
    mount,
    containerId,
  }
}

/**
 * The island the shell is mounted as.
 *
 * A separate browser-only entry file used to hold these six lines, because the
 * view runtime resolves to a URL rather than a package and a `.ts` file could
 * not say so without failing the zero-dep audit. It is imported as a type-only
 * runtime here instead, which is what `relation-select-view.tsx` next door
 * already does — so the entry, and the `client-src` directory it lived in, are
 * gone.
 *
 * `IslandController` has no "mounted" hook, so the DOM mount is queued for
 * after the view has rendered and finds its container by id.
 */
export const liveDoc = (props: IslandProps): IslandController => {
  const controller = createLiveDocView(props as unknown as LiveDocProps)
  queueMicrotask(() => {
    const el = document.getElementById(controller.containerId)
    if (el) void controller.mount(el)
  })
  return { view: controller.view, dispose: controller.dispose }
}
