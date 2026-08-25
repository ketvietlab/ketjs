// The editor's block vocabulary, shared by the binding and the Markdown
// reader.
//
// Its own file because both of them need the same list and neither owns it:
// `markdown.ts` produces blocks and `editor-view.ts` consumes them, so putting
// the union in either one makes the other import from a module it has no
// business depending on.

export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'code' | 'bullet' | 'ordered' | 'check'

export const BLOCK_TYPES: readonly BlockType[] = [
  'p',
  'h1',
  'h2',
  'h3',
  'quote',
  'code',
  'bullet',
  'ordered',
  'check',
]

/** The list kinds, which share a wrapper when rendered and continue on Enter. */
export const LIST_TYPES: readonly BlockType[] = ['bullet', 'ordered', 'check']

/** Pressing Enter at the end of one of these starts another of the same kind. */
export const CONTINUES = new Set<BlockType>(['p', 'bullet', 'ordered', 'check'])

export type MarkName = 'bold' | 'italic' | 'strike' | 'code'

export type Attributes = {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  link?: string | null
}

export type Delta = Array<{ insert: string; attributes?: Attributes }>
