import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// A code editor owns its text, gutter and scrolling geometry. Surface owns the
// surrounding frame; no design-system component's private CSS is overridden.
export function createCodeEditor(parent: HTMLElement, source: string, run: () => void) {
  parent.replaceChildren()
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        javascript({ jsx: true, typescript: true }),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              run()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({
          'aria-label': 'TSX source',
          'aria-describedby': 'playground-code-help',
          spellcheck: 'false',
        }),
        EditorView.theme({
          '&': {
            height: 'var(--playground-editor-height, 500px)',
            color: 'var(--kv-text-main)',
            backgroundColor: 'var(--kv-panel-bg)',
          },
          '&.cm-focused': { outline: '2px solid var(--kv-accent)', outlineOffset: '2px' },
          '.cm-scroller': {
            fontFamily: 'var(--kv-font-mono)',
            fontSize: '13px',
            lineHeight: '1.7',
            overflow: 'auto',
          },
          '.cm-content': { padding: '12px 0', caretColor: 'var(--kv-text-main)' },
          '.cm-line': { padding: '0 12px' },
          '.cm-gutters': {
            backgroundColor: 'var(--kv-panel-bg-subtle)',
            color: 'var(--kv-text-muted)',
            borderRight: '1px solid var(--kv-border-default)',
          },
          '.cm-activeLine': { backgroundColor: 'var(--kv-panel-bg-subtle)' },
          '.cm-cursor': { borderLeftColor: 'var(--kv-text-main)' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
            backgroundColor: 'color-mix(in srgb, var(--kv-accent) 22%, transparent)',
          },
          '@media(max-width: 767px)': { '&': { height: '360px' }, '.cm-scroller': { fontSize: '16px' } },
        }),
        syntaxHighlighting(
          HighlightStyle.define([
            {
              tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
              color: 'var(--syntax-token-keyword)',
            },
            { tag: [tags.string, tags.regexp], color: 'var(--syntax-token-string)' },
            { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-token-constant)' },
            { tag: tags.comment, color: 'var(--syntax-token-comment)', fontStyle: 'italic' },
            {
              tag: [tags.typeName, tags.tagName, tags.function(tags.variableName)],
              color: 'var(--syntax-token-function)',
            },
            {
              tag: [tags.punctuation, tags.operator, tags.attributeName],
              color: 'var(--syntax-token-punctuation)',
            },
          ]),
        ),
      ],
    }),
  })
  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    destroy: () => view.destroy(),
  }
}
