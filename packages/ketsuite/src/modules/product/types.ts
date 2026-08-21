/**
 * What a template is, before any other module has an opinion about it.
 *
 * the domain contract puts three values here — consu, service, product — where "product" means
 * storable. But storable is a *stock* concept living in a module that must not know
 * stock exists, so uninstalling stock leaves a value behind that means nothing.
 *
 * Here the split is honest: `product` says physical or not, and `stock` extends the
 * template with whether it is tracked. the domain contract's three states still map one to one —
 * service · goods+untracked · goods+tracked — so a migration is mechanical.
 */
export type ProductType = 'goods' | 'service'
export const PRODUCT_TYPES: readonly ProductType[] = ['goods', 'service']
