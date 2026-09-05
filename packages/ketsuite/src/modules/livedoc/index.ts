import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { islands } from './islands.ts'

export { documentRoutes } from './routes.ts'
export type { DocumentOwner } from './documents.ts'
export type { DocRef } from './sync.ts'

/**
 * Live Doc — real-time collaborative rich text, over any model.
 *
 * It started inside `flow_backend`, bound to `flow.Issue`. It is its own
 * module because a document is not a Flow idea: an issue description, a
 * project brief, an epic, a wiki page and whatever comes after all want the
 * same editor, the same CRDT, the same presence and the same durable
 * snapshot, and none of that has an opinion about what the text is attached
 * to. What is left in the owner is one function that records a flattened
 * document against its own row, which has to stay there because an effect may
 * only be declared by the module that owns the model.
 *
 * The module ships the machinery and the island; the owner mounts
 * `documentRoutes(owner, base)` in its own route table and places the island
 * where its screen wants it. See documents.ts for the seam.
 */
export default defineModule({
  name: 'livedoc',
  version: '0.1.0',
  // No domain module of its own: it owns no models. `storage` holds the
  // flattened snapshots, `user` names the people in the room.
  depends: ['user', 'storage'],
  title: 'Live Doc',
  summary: 'Real-time collaborative documents attachable to any record.',
  category: 'Productivity',
  // The kit's client directory, where the editor's bundle, shell and
  // stylesheet already live alongside every other island's client code.
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['live-doc.css'],
  functions,
  islands,
})
