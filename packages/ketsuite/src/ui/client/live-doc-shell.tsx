// A live document's shell, and the serializer that draws its content.
//
// Two halves with different jobs, which is why they look different. The shell
// is ordinary kit markup, written as JSX like every other component here.
// `documentHtml` is not: the binding renders by replacing the container's
// innerHTML, so what it needs is a string, and a JSX tree would only be turned
// back into one.
//
// Both live in the kit rather than beside the CRDT binding for the reason
// tools/ui-audit.ts gives for the whole suite — markup is written under
// packages/ketsuite/src/ui/ and nowhere else, and an island is not an
// exception to it.

import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Delta } from './live-doc-blocks.ts'

/** One block as the serializer needs it: what kind, and the text it holds. */
export type LiveDocBlock = { type: string; checked?: boolean; delta: Delta }

/** Somebody else in the document, and which block their caret is in. */
export type LiveDocViewer = { id: string; name: string; index: number }

type Labels = (typeof LABELS)['vi']

const LABELS = {
  vi: {
    toolbar: 'Định dạng',
    editor: 'Mô tả công việc',
    blockType: 'Kiểu khối',
    p: 'Đoạn văn',
    h1: 'Tiêu đề 1',
    h2: 'Tiêu đề 2',
    h3: 'Tiêu đề 3',
    quote: 'Trích dẫn',
    code: 'Khối mã',
    bullet: 'Danh sách',
    ordered: 'Danh sách đánh số',
    check: 'Danh sách việc cần làm',
    bold: 'Chữ đậm',
    italic: 'Chữ nghiêng',
    strike: 'Gạch ngang',
    inlineCode: 'Mã',
    link: 'Liên kết',
    linkTitle: 'Thêm liên kết',
    linkUrl: 'Địa chỉ',
    linkApply: 'Áp dụng',
    linkRemove: 'Bỏ liên kết',
    linkCancel: 'Huỷ',
    alsoHere: 'Đang xem:',
  },
  en: {
    toolbar: 'Formatting',
    editor: 'Issue description',
    blockType: 'Block type',
    p: 'Paragraph',
    h1: 'Heading 1',
    h2: 'Heading 2',
    h3: 'Heading 3',
    quote: 'Quote',
    code: 'Code block',
    bullet: 'Bullet list',
    ordered: 'Numbered list',
    check: 'Checklist',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    inlineCode: 'Code',
    link: 'Link',
    linkTitle: 'Add a link',
    linkUrl: 'Address',
    linkApply: 'Apply',
    linkRemove: 'Remove link',
    linkCancel: 'Cancel',
    alsoHere: 'Also here:',
  },
}

export const labelsOf = (lang?: string | null): Labels =>
  LABELS[String(lang ?? '').slice(0, 2) as keyof typeof LABELS] ?? LABELS.vi

/** The block vocabulary. The first six are what the type control offers. */

/** Which block types are list items, and so share one wrapper across a run. */
const LIST_WRAPPER: Record<string, string> = { bullet: 'ul', ordered: 'ol', check: 'ul' }

const BLOCK_TAG: Record<string, string> = {
  p: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  quote: 'blockquote',
  code: 'pre',
  bullet: 'li',
  ordered: 'li',
  check: 'li',
}

const escapeHtml = (text: unknown): string =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (text: unknown): string => escapeHtml(text).replace(/"/g, '&quot;')

/**
 * Only http/https/mailto survive.
 *
 * A link's address comes from whoever typed it, and the editor writes it
 * straight into an `href` — `javascript:` there is a script the *next* reader
 * runs, on a page that already holds their session. Anything else renders as
 * an inert `#`, which is still visibly a link, rather than silently dropping
 * text somebody typed.
 */
const safeHref = (href: unknown): string => {
  const value = String(href ?? '').trim()
  return /^(https?:|mailto:)/i.test(value) ? value : '#'
}

/** A line break is a newline in the model and a <br> on screen. */
const withBreaks = (text: string): string => escapeHtml(text).replace(/\n/g, '<br>')

const plainOf = (delta?: Delta): string => (delta ?? []).map((op) => op.insert).join('')

/**
 * A block whose text ends in a newline needs one more `<br>` than it has
 * newlines.
 *
 * The last one is a placeholder, not a character: without it the browser gives
 * the empty final line no line box, the caret has nowhere to sit, and the
 * binding — which drops one trailing `<br>` when it reads a block back —
 * concluded the newline was never there. Pressing Enter at the end of a code
 * block and typing put the next line straight onto the end of the previous
 * one.
 */
const trailingBreak = (text: string): string => (text.endsWith('\n') ? '<br>' : '')

/**
 * One delta run's marks, wrapped innermost-first so the nesting is stable
 * across renders: selection restore walks text nodes, and a run whose wrappers
 * reorder between two renders moves the caret for no reason.
 */
const inlineHtml = (delta?: Delta): string =>
  (delta ?? [])
    .map((op) => {
      const attributes = op.attributes ?? {}
      let out = withBreaks(op.insert)
      if (attributes.code) out = `<code data-ui="flow-editor-code">${out}</code>`
      if (attributes.bold) out = `<b>${out}</b>`
      if (attributes.italic) out = `<i>${out}</i>`
      if (attributes.strike) out = `<s>${out}</s>`
      if (attributes.link)
        out = `<a data-ui="flow-editor-link" href="${escapeAttr(safeHref(attributes.link))}" rel="noreferrer noopener">${out}</a>`
      return out
    })
    .join('')

/**
 * An empty block still needs a line box, or contenteditable gives it zero
 * height and there is nowhere left to put the caret.
 */
const blockBody = (block: LiveDocBlock): string => {
  const inner = inlineHtml(block.delta)
  return inner ? `${inner}${trailingBreak(plainOf(block.delta))}` : '<br>'
}

/**
 * A stable colour per person, from their name.
 *
 * Assigning colours in arrival order would give the same person a different
 * colour in every tab, and the colour is the whole point of the marker — it is
 * what lets you match the initials by the paragraph to the chip in the row
 * without reading either.
 */
const hueOf = (key: unknown): number => {
  let hash = 0
  for (let i = 0; i < String(key).length; i++) hash = (hash * 31 + String(key).charCodeAt(i)) % 360
  return hash
}

/** Two letters, because that is what fits and what people recognise. */
const initialsOf = (name: unknown): string => {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** The people in a block, marked inside it so you can see whose paragraph it is. */
const viewerMarks = (people: LiveDocViewer[]): string =>
  people
    .map(
      (person) =>
        `<span data-ui="flow-editor-viewer" contenteditable="false" style="--flow-viewer-hue:${hueOf(person.name)}" title="${escapeAttr(person.name)}" aria-hidden="true">${escapeHtml(initialsOf(person.name))}</span>`,
    )
    .join('')

/**
 * Who else has this description open.
 *
 * Rendered into its own container rather than into the document, so a
 * heartbeat never touches the element somebody is typing into.
 */
export function presenceHtml(people: LiveDocViewer[] | undefined, lang?: string | null): string {
  const labels = labelsOf(lang)
  if (!people?.length) return ''
  return `<span data-ui="flow-editor-presence-label">${escapeHtml(labels.alsoHere)}</span>${people
    .map(
      (person) =>
        `<span data-ui="flow-editor-viewer" data-size="chip" style="--flow-viewer-hue:${hueOf(person.name)}" title="${escapeAttr(person.name)}">${escapeHtml(initialsOf(person.name))}</span>`,
    )
    .join('')}`
}

const checkMark = (block: LiveDocBlock, labels: Labels): string =>
  `<span data-ui="flow-editor-check" contenteditable="false" role="checkbox" aria-checked="${block.checked ? 'true' : 'false'}" aria-label="${escapeAttr(labels.check)}" tabindex="-1"></span>`

const blockHtml = (block: LiveDocBlock, index: number, labels: Labels, people: LiveDocViewer[]): string => {
  const type = BLOCK_TAG[block.type] ? block.type : 'p'
  const tag = BLOCK_TAG[type]
  const checked = type === 'check' ? ` data-checked="${block.checked ? 'true' : 'false'}"` : ''
  // A code block carries no inline marks: the whole point of it is that what
  // sits inside is characters rather than formatting.
  const code = type === 'code' ? plainOf(block.delta) : ''
  const body =
    type === 'code'
      ? code
        ? `${withBreaks(code)}${trailingBreak(code)}`
        : '<br>'
      : type === 'check'
        ? `${checkMark(block, labels)}<span data-ui="flow-editor-line">${blockBody(block)}</span>`
        : blockBody(block)
  return `<${tag} data-block="${type}" data-index="${index}"${checked}>${body}${viewerMarks(people)}</${tag}>`
}

/**
 * The whole document as one HTML string, runs of list items wrapped.
 *
 * Consecutive items share one `<ul>`/`<ol>` rather than each getting its own:
 * a screen reader announces "list, three items" from the wrapper, and an
 * ordered list numbers from it. `data-index` rather than child position is how
 * the binding finds a block again afterwards, precisely because these wrappers
 * mean a block is not always a direct child of the container.
 */
export function documentHtml(
  blocks: LiveDocBlock[] | undefined,
  lang?: string | null,
  presence?: LiveDocViewer[],
): string {
  const labels = labelsOf(lang)
  const here = new Map<number, LiveDocViewer[]>()
  for (const person of presence ?? []) {
    const at = here.get(person.index)
    if (at) at.push(person)
    else here.set(person.index, [person])
  }
  const parts: string[] = []
  let openList = ''
  let openKind = ''
  const closeList = () => {
    if (openList) parts.push(`</${openList}>`)
    openList = ''
    openKind = ''
  }
  const list = blocks ?? []
  for (let index = 0; index < list.length; index++) {
    const block = list[index]
    const wrapper = LIST_WRAPPER[block.type]
    if (!wrapper) closeList()
    else if (openKind !== block.type) {
      closeList()
      openList = wrapper
      openKind = block.type
      parts.push(`<${wrapper} data-ui="flow-editor-list" data-kind="${block.type}">`)
    }
    parts.push(blockHtml(block, index, labels, here.get(index) ?? []))
  }
  closeList()
  return parts.join('')
}

/**
 * `containerId` is how the client entry finds the contenteditable element to
 * mount on: `IslandController` has no "mounted" hook, so the binding looks the
 * node up by id once the view has rendered.
 */

/**
 * `containerId` is how the client entry finds the contenteditable element to
 * mount on: `IslandController` has no "mounted" hook, so the binding looks the
 * node up by id once the view has rendered.
 */
export function liveDocShell(o: { containerId: string; lang?: string | null }): TemplateResult {
  const labels = labelsOf(o.lang)
  const mark = (key: string, glyph: string, label: string) => (
    <button
      data-ui="flow-editor-mark"
      data-flow-editor-mark={key}
      data-control="action"
      data-variant="secondary"
      data-size="compact"
      type="button"
      aria-label={label}
      title={label}
    >
      {glyph}
    </button>
  )
  const blockOption = (value: 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'code') => (
    <option value={value}>{labels[value]}</option>
  )
  return (
    <section data-ui="flow-editor">
      <div data-ui="flow-editor-toolbar" role="toolbar" aria-label={labels.toolbar}>
        <select
          data-ui="form-control"
          data-flow-editor-block
          data-size="compact"
          aria-label={labels.blockType}
          title={labels.blockType}
        >
          {blockOption('p')}
          {blockOption('h1')}
          {blockOption('h2')}
          {blockOption('h3')}
          {blockOption('quote')}
          {blockOption('code')}
        </select>
        {mark('bullet', '\u2022', labels.bullet)}
        {mark('ordered', '1.', labels.ordered)}
        {mark('check', '\u2611', labels.check)}
        <span data-ui="flow-editor-divider" aria-hidden="true" />
        {mark('bold', 'B', labels.bold)}
        {mark('italic', 'I', labels.italic)}
        {mark('strike', 'S', labels.strike)}
        {mark('code', '</>', labels.inlineCode)}
        {mark('link', '\u{1F517}', labels.link)}
      </div>
      <div data-ui="flow-editor-presence" data-flow-editor-presence role="status" aria-live="polite" />
      {/* biome-ignore lint/a11y/useFocusableInteractive: `contenteditable` makes this natively focusable and tab-reachable, which the rule does not model; the explicit tabindex is there so it reads that way too. */}
      <div
        data-ui="flow-editor-content"
        id={o.containerId}
        contenteditable="true"
        role="textbox"
        tabindex="0"
        aria-multiline="true"
        aria-label={labels.editor}
      />
      <dialog data-ui="flow-editor-link-dialog" data-flow-editor-link-dialog aria-label={labels.linkTitle}>
        <div data-ui="flow-editor-link-body">
          <label data-ui="flow-editor-link-label">
            <span>{labels.linkUrl}</span>
            <input
              data-ui="form-control"
              data-flow-editor-link-input
              type="url"
              name="href"
              placeholder="https://"
              autocomplete="off"
            />
          </label>
          <div data-ui="flow-editor-link-actions">
            <button
              data-control="action"
              data-variant="secondary"
              data-size="compact"
              type="button"
              data-flow-editor-link-cancel
            >
              {labels.linkCancel}
            </button>
            <button
              data-control="action"
              data-variant="destructive"
              data-size="compact"
              type="button"
              data-flow-editor-link-remove
            >
              {labels.linkRemove}
            </button>
            <button
              data-control="action"
              data-variant="primary"
              data-size="compact"
              type="button"
              data-flow-editor-link-apply
            >
              {labels.linkApply}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  )
}
