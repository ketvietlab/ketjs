import { readFile } from 'node:fs/promises'
import { bytes, sha256, text, withHeaders } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { compileReportTemplate, interFontUrl, renderPdf } from 'ketjs/pdf'

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
const collect = async (body: AsyncIterable<Uint8Array>) => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    chunks.push(chunk)
    size += chunk.length
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
async function* one(value: Uint8Array) {
  yield value
}
const safeName = (value: unknown) =>
  String(value ?? 'document')
    .replaceAll('Đ', 'D')
    .replaceAll('đ', 'd')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document'

export const reportRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const live = await ctx.live(req)
    const reportId = params.report ?? ''
    const recordId = params.id ?? ''
    const report = live.reports[reportId]
    if (!report) return text('Report not found', { status: 404 })
    const data = await ctx.call(report.source, { id: recordId }, url, req)
    if (!data) return text('Document not found', { status: 404 })
    const locale = ctx.localeOf(url, req)
    const template = (await ctx.callUnchecked('report.getTemplate', { reportId }, url, req)) as {
      published: string
      publishedVersion: number
      layout: unknown
    }
    const fingerprint = sha256(
      stable({
        reportId,
        recordId,
        locale,
        data,
        template: template.published,
        layout: template.layout,
        engine: 1,
        font: 'Inter-4.1',
      }),
    )
    const storage = await ctx.storageOf(url, req)
    const cached = (await ctx.callUnchecked('report.getCache', { reportId, recordId, locale }, url, req)) as {
      fingerprint: string
      storageKey: string
      expiresAt: string
    } | null
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > new Date().toISOString()) {
      const found = await storage.get(cached.storageKey)
      if (found) {
        const result = bytes(await collect(found.body), { type: 'application/pdf' })
        return withHeaders(result, {
          'Content-Disposition': `inline; filename="${safeName((data as Record<string, unknown>).name ?? report.filename ?? reportId)}.pdf"`,
        })
      }
    }
    if (cached) {
      try {
        await storage.remove(cached.storageKey)
      } catch (error) {
        console.warn(`stale report cache removal failed for ${reportId}/${recordId}:`, error)
      }
    }
    const translate = ctx.translate(locale)
    const document = compileReportTemplate(template.published, { name: reportId, translate }).render(
      data as Record<string, unknown>,
    )
    const layout = (template.layout && typeof template.layout === 'object' ? template.layout : {}) as Record<
      string,
      unknown
    >
    document.attrs.paper ??= String(layout.paper ?? report.paper ?? 'A4')
    document.attrs.orientation ??= String(layout.orientation ?? report.orientation ?? 'portrait')
    const margins = (
      layout.margins && typeof layout.margins === 'object' ? layout.margins : report.margins
    ) as Record<string, unknown> | undefined
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = margins?.[side]
      if (value !== undefined) document.attrs[`margin-${side}`] ??= String(value)
    }
    const font = await readFile(interFontUrl())
    const images: Record<string, Uint8Array> = {}
    if (layout.images && typeof layout.images === 'object') {
      for (const [key, storageKey] of Object.entries(layout.images as Record<string, unknown>)) {
        const found = await storage.get(String(storageKey))
        if (found) images[key] = await collect(found.body)
      }
    }
    const pdf = renderPdf(document, { font, images })
    const storageKey = `reports/${reportId}/${recordId}/${locale}/${fingerprint}.pdf`
    try {
      await storage.put(storageKey, one(pdf), { type: 'application/pdf', size: pdf.length })
      await ctx.callUnchecked(
        'report.storeCache',
        { reportId, recordId, locale, fingerprint, storageKey },
        url,
        req,
      )
    } catch (error) {
      console.warn(`report cache write failed for ${reportId}/${recordId}:`, error)
    }
    return withHeaders(bytes(pdf, { type: 'application/pdf' }), {
      'Content-Disposition': `inline; filename="${safeName((data as Record<string, unknown>).name ?? report.filename ?? reportId)}.pdf"`,
      'Cache-Control': 'private, no-store',
    })
  }
