import * as Y from 'yjs'

/** Local editors retain a real empty paragraph as the final typing target. */
export function ensureTrailingParagraph(doc: Y.Doc): void {
  const content = doc.getXmlFragment('content')
  const last = content.length ? content.get(content.length - 1) : null
  if (last instanceof Y.XmlText && last.length === 0) return
  if (last instanceof Y.XmlElement && last.getAttribute('type') === 'p') {
    const text = last.length ? last.get(0) : null
    if (text instanceof Y.XmlText && text.length === 0) return
  }
  doc.transact(() => {
    const paragraph = new Y.XmlElement('block')
    paragraph.setAttribute('type', 'p')
    paragraph.setAttribute('id', crypto.randomUUID())
    paragraph.insert(0, [new Y.XmlText()])
    content.insert(content.length, [paragraph])
  })
}
