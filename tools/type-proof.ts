// The lego pillar's riskiest claim, checked by a real type-checker:
// a field module B adds to module A's model must be visible, correctly typed, to
// module C — and everything that is NOT declared must be a compile error.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { compose, generateDts } from 'ketjs'
import { catalog, inventory, checkout, defaultTheme as theme } from 'ketsuite'

const manifest = compose([catalog, inventory, checkout, theme])
const dts = generateDts(manifest)
mkdirSync('.ket', { recursive: true })
writeFileSync('.ket/types.d.ts', dts)

const DIR = '.ket/typeproof'
rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })
writeFileSync(`${DIR}/types.ts`, dts)
writeFileSync(`${DIR}/tsconfig.json`, JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: 'esnext', module: 'preserve', moduleResolution: 'bundler', skipLibCheck: true, allowImportingTsExtensions: true, types: ['node'] },
  include: ['*.ts'],
}, null, 2))

type Case = { name: string; code: string; shouldCompile: boolean; expect?: RegExp }

const cases: Case[] = [
  {
    // The claim the whole respond.ts change rests on. If this ever compiles, the
    // document shell can be built by concatenation again and nothing will say so.
    name: 'a route cannot hand back a string it built itself',
    shouldCompile: false,
    expect: /RESPONSE|not assignable/,
    code: `import type { Route } from 'ketjs'
export const r: Route = async () => ({ body: '<p>' + String(Math.random()) + '</p>' })`,
  },
  {
    name: 'and the way through is a constructor, which escapes',
    shouldCompile: true,
    code: `import type { Route } from 'ketjs'
import { page, document } from 'ketjs'
import { html } from 'ketjs-view'
export const r: Route = async () => page({ body: document({ lang: 'en', body: html\`<p>\${'x'}</p>\` }) })`,
  },
  {
    name: 'module C reads the field module B added to module A model',
    shouldCompile: true,
    code: `import type { CatalogProduct } from './types.ts'
export const leadTime = (p: CatalogProduct): number | null => p.leadTimeDays
export const title = (p: CatalogProduct): string => p.title`,
  },
  {
    name: 'the added field carries its real type (int? -> number | null)',
    shouldCompile: false,
    expect: /not assignable to type 'number'|possibly 'null'/,
    code: `import type { CatalogProduct } from './types.ts'
export const bad = (p: CatalogProduct): number => p.leadTimeDays`,
  },
  {
    name: 'a field nobody declared is a compile error',
    shouldCompile: false,
    expect: /Property 'nope' does not exist/,
    code: `import type { CatalogProduct } from './types.ts'
export const bad = (p: CatalogProduct) => p.nope`,
  },
  {
    name: 'a view model exposes only its declared fields',
    shouldCompile: false,
    expect: /Property 'active' does not exist/,
    code: `import type { CatalogProductDrop } from './types.ts'
export const bad = (d: CatalogProductDrop) => d.active`,
  },
  {
    name: 'the typed client rejects a wrong argument type',
    shouldCompile: false,
    expect: /not assignable to parameter|Type 'string' is not assignable to type 'number'/,
    code: `import type { KetClient } from './types.ts'
declare const client: KetClient
export const bad = () => client['checkout.placeOrder']({ id: 'o1', productId: 'p1', qty: 'hai' })`,
  },
  {
    name: 'the typed client accepts the declared signature',
    shouldCompile: true,
    code: `import type { KetClient } from './types.ts'
declare const client: KetClient
export const ok = () => client['checkout.placeOrder']({ id: 'o1', productId: 'p1', qty: 2 })`,
  },
  {
    name: 'a preloaded relation is optional on the type, because it is optional in fact',
    shouldCompile: false,
    expect: /possibly 'undefined'|possibly 'null'/,
    code: `import type { CheckoutOrder } from './types.ts'
export const bad = (o: CheckoutOrder) => o.product.title`,
  },
  {
    name: 'and reading it after checking is fine',
    shouldCompile: true,
    code: `import type { CheckoutOrder } from './types.ts'
export const ok = (o: CheckoutOrder) => o.product?.title ?? '(chưa preload)'`,
  },
  {
    name: 'joint keys are a closed union - a typo cannot compile',
    shouldCompile: false,
    expect: /not assignable to type 'JointKey'/,
    code: `import type { JointKey } from './types.ts'
export const bad: JointKey = 'catalog:product.detail.foter'`,
  },
]

let pass = 0
let fail = 0
for (const c of cases) {
  rmSync(`${DIR}/case.ts`, { force: true })
  writeFileSync(`${DIR}/case.ts`, c.code)
  let compiled = true
  let output = ''
  try {
    execFileSync('./node_modules/.bin/tsc', ['-p', `${DIR}/tsconfig.json`], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    compiled = false
    output = String((e as { stdout?: string }).stdout ?? '')
  }
  const okCompile = compiled === c.shouldCompile
  const okMessage = c.expect ? c.expect.test(output) : true
  const ok = okCompile && okMessage
  if (ok) pass++; else fail++
  const verdict = ok ? 'PASS' : 'FAIL'
  const what = c.shouldCompile ? 'compiles' : 'rejected'
  console.log(`${verdict}  [${what.padEnd(8)}] ${c.name}`)
  if (!ok) console.log(`      got compiled=${compiled}\n      ${output.split('\n').slice(0, 3).join('\n      ')}`)
}

rmSync(DIR, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} type assertions hold`)
console.log(`generated .ket/types.d.ts (${dts.split('\n').length} lines)`)
process.exit(fail === 0 ? 0 : 1)
