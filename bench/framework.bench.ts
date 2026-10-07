import assert from 'node:assert/strict'
import { compileKtl, compose, defineModule, desc, eq, from, gte, table } from '@ketvietlab/ketjs'

function measure(name: string, iterations: number, operation: () => unknown) {
  for (let index = 0; index < 2000; index++) operation()
  const start = performance.now()
  let result: unknown
  for (let index = 0; index < iterations; index++) result = operation()
  const ms = performance.now() - start
  assert.ok(result)
  console.log(JSON.stringify({ name, iterations, ms, perSecond: (iterations * 1000) / ms }))
}

const products = Array.from({ length: 50 }, (_, index) => ({
  name: `Product ${index}`,
  price: 10000 + index,
}))
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const source =
  '<ul>{% for product in products %}<li>{{ product.name }}: {{ product.price | money }}</li>{% endfor %}</ul>'
const template = compileKtl(source, { filters: { money: (value) => money.format(Number(value) / 100) } })
const expected = `<ul>${products.map((product) => `<li>${product.name}: ${money.format(product.price / 100)}</li>`).join('')}</ul>`
assert.equal(template.render({ products }), expected)
measure('KTL: 50 products with cached money filter', 20000, () => template.render({ products }))

const module = defineModule({
  name: 'benchmark',
  models: { Product: { scope: 'shared', fields: { id: 'id', active: 'bool', stock: 'int' } } },
})
const manifest = compose([module], { headless: true })
const Product = table(manifest, 'benchmark.Product')
const build = () =>
  from(Product)
    .where(eq(Product.active, true), gte(Product.stock, 10))
    .orderBy(desc(Product.stock))
    .limit(50)
    .toSQL('sqlite')
const expectedQuery = build()
assert.equal(expectedQuery.params.length, 3)
assert.ok(expectedQuery.text.includes('ORDER BY') && expectedQuery.text.includes('LIMIT'))
measure('Query: two predicates, order, limit and SQLite SQL', 200000, build)
