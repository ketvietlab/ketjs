// @ts-nocheck The Flow editor's shell, rendered identically server-side and in
// the browser. Dependency-free on purpose: the browser copy is bundled by
// tools/build-flow-client.mjs with the view runtime left external, so anything
// imported here would be duplicated into every page that shows an editor.
//
// The markup lives in the kit rather than beside the CRDT binding because
// tools/ui-audit.ts holds one rule for the whole suite — markup is written
// under packages/ketsuite/src/ui/ and nowhere else — and an island is not an
// exception to it. The behaviour (the Yjs<->contenteditable binding) stays in
// flow_backend/editor-view.ts, where it is type-checked.

const LABELS = {
  vi: {
    toolbar: 'Định dạng',
    bold: 'Chữ đậm',
    italic: 'Chữ nghiêng',
    editor: 'Mô tả công việc',
  },
  en: {
    toolbar: 'Formatting',
    bold: 'Bold',
    italic: 'Italic',
    editor: 'Issue description',
  },
}

export const labelsOf = (lang) => LABELS[String(lang ?? '').slice(0, 2)] ?? LABELS.vi

/**
 * `containerId` is how the client entry finds the contenteditable element to
 * mount on: `IslandController` has no "mounted" hook, so the binding looks the
 * node up by id once the view has rendered.
 */
export function issueEditorShell(runtime, { containerId, lang }) {
  const { html } = runtime
  const labels = labelsOf(lang)
  return html`<section data-ui="flow-editor">
    <div data-ui="flow-editor-toolbar" role="toolbar" aria-label=${labels.toolbar}>
      <button data-ui="flow-editor-mark" data-flow-editor-bold data-control="action" data-variant="secondary" data-size="compact" type="button" aria-label=${labels.bold} title=${labels.bold}>B</button>
      <button data-ui="flow-editor-mark" data-flow-editor-italic data-control="action" data-variant="secondary" data-size="compact" type="button" aria-label=${labels.italic} title=${labels.italic}>I</button>
    </div>
    <div data-ui="flow-editor-content" id=${containerId} contenteditable="true" role="textbox" aria-multiline="true" aria-label=${labels.editor}></div>
  </section>`
}
