# App lifecycle: every edge, and what actually happens

"Install at build, switch on at run" (D21) is easy to state and full of corners. Each
row below was **run**, not reasoned about. Five of them were bugs when first probed;
all five are now tests in `test/apps.test.ts`.

## Installing

| Case | What happens | Why |
|---|---|---|
| Install an app with uninstalled dependencies | dependencies come along | an app whose dependency is off is broken, not "partly installed" |
| Install something already installed | no-op, returns nothing changed | idempotent, so a retry is safe |
| Install something the deployment does not ship | `E_UNKNOWN_APP` naming what *is* shipped | the code has to be built in first — this is the whole point of the model |
| An `install: 'auto'` app whose dependencies just arrived | installs itself, and the sweep repeats until nothing more qualifies | matches the domain contract's `auto_install`; the loop terminates because each pass strictly grows the installed set |
| Two `install: 'auto'` apps depending on each other | both install, sweep settles | **probed** — it does not loop |
| Two requests install at once | the primary key settles it | `ON CONFLICT DO NOTHING`, same as idempotency |
| Install an `install: 'never'` app by name | `E_APP_NOT_INSTALLABLE`, pointing at the modules that depend on it | the module drew the boundary: it is machinery, and the honest way in is for something that needs it to ask |
| An `install: 'never'` app that something installed depends on | comes along as a dependency | 'never' restricts *direct* install, not existence |
| An `install: 'auto'` app when the deployment set `KET_AUTO_INSTALL=0` | does not arrive; the banner says why | the module says what it permits, the deployment decides whether to honour it — held back is not forbidden, installing by name still works |

## Removing

| Case | What happens | Why |
|---|---|---|
| Remove an app something installed depends on | refused, **naming the dependents** | removing it would break them silently |
| Remove something not installed | no-op | idempotent |
| Remove an `install: 'auto'` app | **stays removed** | ← was a bug. The row records a *decision*, not a fact: `state='removed'` survives the next sweep. Deleting the row let the app walk straight back in the moment anything else was installed. |
| Routes of a removed app | **404**, naming the module | ← was a bug. They stayed mounted, because the app declared them instead of the module. Dispatch now checks the live manifest per request. |
| Assets and stylesheets of a removed app | **stop being served and stop being linked** | same cause, same fix: the module declares them, `restrictManifest` drops them |
| Remove a module declaring `removable: false` | `E_APP_NOT_REMOVABLE` | the backend is the screen you would use to put something back |
| Rows belonging to a removed app | **kept, untouched** | turning an app off must never be a way to lose data (D7 one level up) |
| Re-install after removing | data is where it was | the columns never went anywhere |

## Schema

| Case | What happens | Why |
|---|---|---|
| Install / remove anything | **table list is byte-identical** | installing changes behaviour, never shape — this is what keeps a fleet upgrade one known migration instead of N unknown ones (D16) |
| A database with apps off | carries their columns anyway | the stated cost of the model; nullable columns are nearly free and this is what buys the single upgrade diff |
| `migrateFleet` while apps differ per database | one target schema for all | schema belongs to the deployment, install state to the database |

## Rendering

| Case | What happens | Why |
|---|---|---|
| A page names a section from a **switched-off** app | skipped silently | the page was saved when the app was on; re-installing brings the section back with its settings |
| A page names a section **no deployment ever shipped** | `<!-- ket: unknown section "..." -->` | ← was a bug. Silently swallowing it made data rot indistinguishable from an app being off. |
| An island from a switched-off app | renders empty | same reasoning |
| The **theme** is removed | `E_REGION_NOT_RENDERABLE` on the next render | ← was a bug: `createTheme` read templates off the module list and never consulted install state, so a removed theme kept working |
| A template names an island nobody provides | build error against the full manifest, nothing at runtime | a theme is written against what the *deployment* ships; whether an app is on is a runtime fact |

## Deployment changes

| Case | What happens | Why |
|---|---|---|
| A new deployment adds an app | appears as available, installs nothing | nobody wants a release to switch features on by itself |
| A new deployment drops an app a database had on | `apps.orphans()` reports it | ← was a bug: it vanished from the list and nobody was told. The data is still there and still unreachable, which is worth knowing. |
| A module is renamed | old name becomes an orphan, new one appears available | there is no automatic migration for this and there should not be a silent one |

## Multi-tenant

| Case | What happens | Why |
|---|---|---|
| Two databases, one deployment | independent install state | `ket_app` lives in the database |
| The restricted manifest | **must be computed per request**, from that database's state | caching one globally would serve every tenant the first tenant's app set. This is a usage rule the framework cannot enforce for you — the pool hands you the adapter, and the restriction belongs beside it. |

## Still open

- **Exactly one storefront theme.** Nothing stops two themes being installed at once,
  and the last one composed wins the template. the domain contract makes installing a theme uninstall
  the previous one. That rule is not written here yet.
- **Backend UI.** There is none. See the note in `00-decisions.md` on why a backend
  screen should not be a KTL theme.
