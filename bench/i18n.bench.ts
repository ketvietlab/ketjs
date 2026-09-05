import { compose, dateBucket, dateTimeFormatter, defineModule, translator } from '@ketvietlab/ketjs'

const messages = defineModule({
  name: 'benchmark',
  messages: {
    vi: {
      plain: 'Xin chào',
      greeting: 'Xin chào {name}',
      items: { other: '{count} mục' },
    },
  },
})
const manifest = compose([messages], { headless: true })
const translate = translator(manifest, 'vi')
const instant = new Date('2026-09-02T09:23:45.000Z')
const dateOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
} as const

const measure = (label: string, iterations: number, operation: (index: number) => unknown): void => {
  for (let index = 0; index < Math.min(iterations, 10_000); index++) operation(index)
  const started = process.hrtime.bigint()
  let result: unknown
  for (let index = 0; index < iterations; index++) result = operation(index)
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  if (result === undefined) throw new Error(`${label} produced no result`)
  console.log(
    label.padEnd(34),
    `${elapsedMs.toFixed(2).padStart(9)} ms`,
    `${Math.round(iterations / (elapsedMs / 1000))
      .toLocaleString('en-US')
      .padStart(12)} ops/s`,
  )
}

console.log(`i18n hot paths — ${process.version}`)
measure('plain translation', 1_000_000, () => translate('benchmark.plain'))
measure('placeholder translation', 500_000, (index) => translate('benchmark.greeting', { name: index }))
measure('plural translation', 500_000, (index) => translate('benchmark.items', { count: index }))
measure('cached date/time format', 250_000, () => dateTimeFormatter('vi', dateOptions).format(instant))
measure('timezone date bucket', 100_000, (index) =>
  dateBucket(`2026-09-${String((index % 28) + 1).padStart(2, '0')}T18:30:00.000Z`, 'day', 'Asia/Ho_Chi_Minh'),
)
