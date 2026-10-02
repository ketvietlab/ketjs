import { walkLayout, safeHref } from './renderer.mjs'
const luminance = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return null
  const rgb = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
export function checkBuilderAccessibility(layout) {
  const issues = []
  let headings = 0
  walkLayout(layout, (p) => {
    const s = p.settings ?? {}
    const add = (code, severity = 'block') =>
      issues.push({ id: `${p.id}:${code}`, nodeId: p.id, code, severity })
    if (p.type === 'website.hero') {
      if (!String(s.heading ?? '').trim()) add('heading')
      headings++
    }
    if (
      (p.type === 'website.image' || p.type === 'website.gallery') &&
      s.image &&
      !String(s.alt ?? s.caption ?? '').trim()
    )
      add('alt')
    if (s.ctaHref && !String(s.ctaLabel ?? '').trim()) add('linkLabel')
    if (s.ctaLabel && safeHref(s.ctaHref) === '#') add('link')
    const fg = luminance(s.textColor),
      bg = luminance(s.backgroundColor)
    if (fg !== null && bg !== null && (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) < 4.5)
      add('contrast')
  })
  if (headings > 1)
    issues.push({
      id: 'document:headings',
      nodeId: layout.find((p) => p.type === 'website.hero')?.id,
      code: 'headings',
      severity: 'block',
    })
  if (headings === 0)
    issues.push({
      id: 'document:headingMissing',
      nodeId: layout[0]?.id,
      code: 'headingMissing',
      severity: 'warn',
    })
  return issues
}
