# The unified manifest

One artifact, four jobs. This is the centre of the design: module contract,
database schema, theme contract and agent descriptor are the same object, so they
cannot drift apart.

```
compose(modules) -> Manifest
```

| Section | Serves | Checked at build |
|---|---|---|
| `modules` | dependency graph | missing deps, cycles |
| `models` | schema + `.d.ts` | duplicate models, bad types |
| `models[].fields[].by` | **provenance** | who contributed each field |
| `joints` | published extension points | — |
| `fills` | who plugs into them | unpublished joint, undeclared dependency |
| `functions` | endpoint + client + agent tool | signature drift |
| `views` | the only data a theme sees | fields that do not exist |
| `regions` | theme ↔ app contract | required region nobody provides |
| `tokens` | CSS custom properties | — |
| `patches` | declared escape hatches | surfaced in every diff |

## Provenance is the load-bearing part

Every field records the module that contributed it. Three features fall out of that
one decision and are impossible without it:

1. **Upgrade diff** — "joint X was removed, still filled by inventory"
2. **Non-destructive migration** — "DROP_COLUMN catalog_product.leadTimeDays (contributed by inventory)"
3. **Generated types** — `/** contributed by module "inventory" */`

## Rules enforced during composition

- A field added to another module's model must be **optional** — existing rows have no value for it
- A module may only extend or fill something belonging to a module it **depends on**
- Two modules may not contribute the same field name
- A view may only expose fields that exist
- Composition order is **deterministic**: the same input always yields the same manifest

## Umbrella

`composeWorkspace(apps)` runs `compose` per app and then unions the schemas of every
app bound to the same datastore. Two apps disagreeing about a column is
`E_DATASTORE_COLUMN_CLASH` at build time, not a production surprise.
