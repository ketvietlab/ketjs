import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { groups, normalizeLinks, parseContent } from './content.mjs'
import type { ContentPage } from './model.ts'
import type { BenchmarkReport } from './benchmark-charts.tsx'

export function readContent(root = process.cwd()): ContentPage[] {
  const pages: ContentPage[] = []
  for (const kind of ['home', 'docs', 'spec', 'learn', 'examples', 'blog']) {
    const directory = kind === 'home' ? join(root, 'content') : join(root, 'content', kind)
    for (const name of readdirSync(directory)
      .filter((file) => file.endsWith('.md'))
      .sort()) {
      pages.push(
        parseContent(normalizeLinks(readFileSync(join(directory, name), 'utf8')), {
          kind,
          slug: name.slice(0, -3),
        }),
      )
    }
  }
  for (const page of pages.filter((page) => page.kind === 'docs')) {
    if (Array.isArray(page.metadata.benchmarkReports)) {
      const reports = page.metadata.benchmarkReports as BenchmarkReport[]
      for (const report of reports)
        if (!['database', 'server', 'ssr'].includes(report.kind) || !Array.isArray(report.measurements))
          throw new Error(`${page.slug}: invalid benchmark summary`)
      page.toc.unshift(
        ...reports.map((report) => ({
          id: `${report.kind}-comparison`,
          title:
            report.kind === 'database'
              ? 'Database execution'
              : report.kind === 'server'
                ? 'HTTP server and database'
                : 'Server-side rendering',
          depth: 2,
        })),
      )
    }
    if (
      !groups.includes(page.group) ||
      page.metadata.group !== page.group ||
      !Number.isInteger(page.metadata.order)
    )
      throw new Error(`${page.slug}: docs require an explicit navigation group and integer order`)
  }
  pages.sort(
    (a, b) =>
      groups.indexOf(a.group) - groups.indexOf(b.group) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  )
  return pages
}
