// @ts-nocheck The Flow editor's shell and its document serializer, rendered
// identically server-side and in the browser. Dependency-free on purpose: the
// browser copy is bundled by tools/build-flow-client.mjs with the view runtime
// left external, so anything imported here would be duplicated into every page
// that shows an editor.
//
// The markup lives in the kit rather than beside the CRDT binding because
// tools/ui-audit.ts holds one rule for the whole suite — markup is written
// under packages/ketsuite/src/ui/ and nowhere else — and an island is not an
// exception to it. The behaviour (the Yjs<->contenteditable binding) stays in
// flow_backend/editor-view.ts, where it is type-checked.
//
// That rule is why `documentHtml` below lives here too. The binding renders by
// replacing the container's innerHTML, so the tag chosen for a heading, a list
// item or a checkbox is markup by any reading of the word. It was written in
// the module while the vocabulary was two tags wide; moving it here is what
// growing to nine costs.

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
  },
}

export const labelsOf = (lang) => LABELS[String(lang ?? '').slice(0, 2)] ?? LABELS.vi

/** The block vocabulary. The first six are what the type control offers. */
export const BLOCK_TYPES = ['p', 'h1', 'h2', 'h3', 'quote', 'code', 'bullet', 'ordered', 'check']

/** Which block types are list items, and so share one wrapper across a run. */
const LIST_WRAPPER = { bullet: 'ul', ordered: 'ol', check: 'ul' }

const BLOCK_TAG = {
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

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (text) => escapeHtml(text).replace(/"/g, '&quot;')

/**
 * Only http/https/mailto survive.
 *
 * A link's address comes from whoever typed it, and the editor writes it
 * straight into an `href` — `javascript:` there is a script the *next* reader
 * runs, on a page that already holds their session. Anything else renders as
 * an inert `#`, which is still visibly a link, rather than silently dropping
 * text somebody typed.
 */
const safeHref = (href) => {
  const value = String(href ?? '').trim()
  return /^(https?:|mailto:)/i.test(value) ? value : '#'
}

/** A line break is a newline in the model and a <br> on screen. */
const withBreaks = (text) => escapeHtml(text).replace(/\n/g, '<br>')

const plainOf = (delta) => (delta ?? []).map((op) => op.insert).join('')

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
const trailingBreak = (text) => (text.endsWith('\n') ? '<br>' : '')

/**
 * One delta run's marks, wrapped innermost-first so the nesting is stable
 * across renders: selection restore walks text nodes, and a run whose wrappers
 * reorder between two renders moves the caret for no reason.
 */
const inlineHtml = (delta) =>
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
const blockBody = (block) => {
  const inner = inlineHtml(block.delta)
  return inner ? `${inner}${trailingBreak(plainOf(block.delta))}` : '<br>'
}

const checkMark = (block, labels) =>
  `<span data-ui="flow-editor-check" contenteditable="false" role="checkbox" aria-checked="${block.checked ? 'true' : 'false'}" aria-label="${escapeAttr(labels.check)}" tabindex="-1"></span>`

const blockHtml = (block, index, labels) => {
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
  return `<${tag} data-block="${type}" data-index="${index}"${checked}>${body}</${tag}>`
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
export function documentHtml(blocks, lang) {
  const labels = labelsOf(lang)
  const parts = []
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
    parts.push(blockHtml(block, index, labels))
  }
  closeList()
  return parts.join('')
}

/**
 * `containerId` is how the client entry finds the contenteditable element to
 * mount on: `IslandController` has no "mounted" hook, so the binding looks the
 * node up by id once the view has rendered.
 */
export function issueEditorShell(runtime, { containerId, lang }) {
  const { html } = runtime
  const labels = labelsOf(lang)
  const mark = (key, glyph, label) =>
    html`<button data-ui="flow-editor-mark" data-flow-editor-mark=${key} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-label=${label} title=${label}>${glyph}</button>`
  const blockOption = (value) => html`<option value=${value}>${labels[value]}</option>`
  return html`<section data-ui="flow-editor">
    <div data-ui="flow-editor-toolbar" role="toolbar" aria-label=${labels.toolbar}>
      <select data-ui="form-control" data-flow-editor-block data-size="compact" aria-label=${labels.blockType} title=${labels.blockType}>
        ${blockOption('p')}
        ${blockOption('h1')}
        ${blockOption('h2')}
        ${blockOption('h3')}
        ${blockOption('quote')}
        ${blockOption('code')}
      </select>
      ${mark('bullet', '•', labels.bullet)}
      ${mark('ordered', '1.', labels.ordered)}
      ${mark('check', '☑', labels.check)}
      <span data-ui="flow-editor-divider" aria-hidden="true"></span>
      ${mark('bold', 'B', labels.bold)}
      ${mark('italic', 'I', labels.italic)}
      ${mark('strike', 'S', labels.strike)}
      ${mark('code', '</>', labels.inlineCode)}
      ${mark('link', '🔗', labels.link)}
    </div>
    <div data-ui="flow-editor-content" id=${containerId} contenteditable="true" role="textbox" aria-multiline="true" aria-label=${labels.editor}></div>
    <dialog data-ui="flow-editor-link-dialog" data-flow-editor-link-dialog aria-label=${labels.linkTitle}>
      <div data-ui="flow-editor-link-body">
        <label data-ui="flow-editor-link-label">
          <span>${labels.linkUrl}</span>
          <input data-ui="form-control" data-flow-editor-link-input type="url" name="href" placeholder="https://" autocomplete="off">
        </label>
        <div data-ui="flow-editor-link-actions">
          <button data-control="action" data-variant="secondary" data-size="compact" type="button" data-flow-editor-link-cancel>${labels.linkCancel}</button>
          <button data-control="action" data-variant="destructive" data-size="compact" type="button" data-flow-editor-link-remove>${labels.linkRemove}</button>
          <button data-control="action" data-variant="primary" data-size="compact" type="button" data-flow-editor-link-apply>${labels.linkApply}</button>
        </div>
      </div>
    </dialog>
  </section>`
}
