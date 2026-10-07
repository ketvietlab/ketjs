import { BarChart, Text } from '@ketvietlab/design-system'

type Measurement = {
  framework: string
  version: string
  medianPerSecond: number
  engine?: string
  databaseVersion?: string
  operation?: string
  title?: string
  rows?: number
  path?: string
  minPerSecond?: number
  maxPerSecond?: number
}
export type BenchmarkReport = {
  kind: 'database' | 'server' | 'ssr'
  source: string
  date: string
  processes: number
  measurements: Measurement[]
}
const descriptions = {
  database:
    'Actual DB operations on 50,000 indexed rows. KetJS adapters and their raw drivers use the same engine, SQL and durability settings. Higher is better.',
  server:
    'HTTP/1.1 over loopback, 16 keep-alive clients. Each server uses the same KetJS adapter and SQL. Higher is better; this is not a production capacity test.',
  ssr: 'Production-mode public render APIs, including element creation and HTML escaping. Equivalent product markup is verified. Higher is better.',
}
const names = {
  database: 'Database execution',
  server: 'HTTP server and database',
  ssr: 'Server-side rendering',
}
const number = (value: number) => Math.round(value).toLocaleString('en-US')

export function BenchmarkCharts({ reports }: { reports: BenchmarkReport[] }) {
  return (
    <div class="benchmark-charts">
      {reports.map((report) => {
        const groups = new Map<string, Measurement[]>()
        for (const sample of report.measurements) {
          const key = `${sample.engine ?? ''}:${sample.operation ?? sample.path ?? sample.rows}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(sample)
        }
        const groupsInOrder = [...groups.values()]
        const featured = (samples: Measurement[]) =>
          report.kind === 'database'
            ? ['range', 'transfer'].includes(samples[0].operation!)
            : report.kind === 'server'
              ? samples[0].path === '/db/range'
              : true
        const chart = (samples: Measurement[]) => {
          const sample = samples[0]
          const title =
            report.kind === 'ssr'
              ? `SSR: ${sample.rows} products`
              : `${sample.engine} — ${sample.title ?? (sample.path === '/db/range' ? 'HTTP + 20-row indexed read' : sample.path === '/db/point' ? 'HTTP + primary-key lookup' : 'HTTP JSON response')}`
          const unit =
            report.kind === 'ssr'
              ? 'renders/s'
              : report.kind === 'server'
                ? 'requests/s'
                : sample.operation === 'batch' || sample.operation === 'transfer'
                  ? 'transactions/s'
                  : 'operations/s'
          return (
            <section class="benchmark-plot">
              <Text as="h3" variant="headingLg">
                {title}
              </Text>
              <BarChart
                label={`${title}: median throughput`}
                bars={samples.map((item) => ({
                  id: item.framework,
                  label: item.framework,
                  value: item.medianPerSecond,
                  caption: `${item.version}${item.minPerSecond === undefined ? '' : ` · range ${number(item.minPerSecond)}–${number(item.maxPerSecond!)} /s`}`,
                }))}
                value={(bar) => `${number(bar.value)} ${unit}`}
              />
            </section>
          )
        }
        const rest = groupsInOrder.filter((samples) => !featured(samples))
        return (
          <section class="benchmark-chart-group">
            <Text as="h2" id={`${report.kind}-comparison`} variant="headingLg">
              {names[report.kind]}
            </Text>
            <p>{descriptions[report.kind]}</p>
            {groupsInOrder.filter(featured).map(chart)}
            {rest.length > 0 && (
              <details class="benchmark-more">
                <summary>
                  More {report.kind === 'database' ? 'database workloads' : 'server workloads'}
                </summary>
                <div class="benchmark-chart-group">{rest.map(chart)}</div>
              </details>
            )}
            <p class="metadata">
              Measured {report.date.slice(0, 10)} · Median of {report.processes} processes ·{' '}
              <a href={`/measurements/${report.source}`}>Versions, environment and raw measurements</a>
            </p>
          </section>
        )
      })}
    </div>
  )
}
