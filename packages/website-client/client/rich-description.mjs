// Persist the native LiveDoc block model; legacy plain descriptions remain readable.
export function descriptionBlocks(value, text = '') {
  if (!value) return [{ type: 'p', delta: [{ insert: text }] }]
  const blocks = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(blocks) || blocks.length > 500) throw new Error('Invalid document')
  return blocks
}
export const descriptionText = (blocks) =>
  blocks
    .map((block) =>
      block.type === 'table'
        ? (block.rows ?? []).map((row) => row.join(' | ')).join('\n')
        : (block.delta ?? []).map((part) => part.insert).join(''),
    )
    .join('\n\n')
