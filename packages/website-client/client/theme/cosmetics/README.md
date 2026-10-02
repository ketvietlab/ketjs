# Lành — Core cosmetics theme

A bundled MIT preset, separate from the Studio shell. Warm ivory, forest green, clay accents,
serif display headings and local vector product artwork. Public branding stays light when the Studio
is dark, so the storefront is consistent with its published theme. No external font/image request.

## Files and reuse

- `../cosmetics.ts`: default theme settings and `cosmeticsStarter(tr)`; six normal editable Placement
  pages, menu and media declarations. It takes the product translator; copy lives in messages.ts.
- `../cosmetics.css`: scoped visitor/canvas presentation; load after `../default.css`.
- `collection.svg`, `serum.svg`, `cream.svg`: original vector illustrations, not product photography.
- `../../../atlas/cosmetics-fixture.mjs`: demo-only host seeding. Core never imports it.

Select **Giao diện → Mẫu giao diện → Mỹ phẩm · Lành** on an existing site. This changes presentation
only. Save a draft, review and publish through the existing workflow. The builder's styles panel can
preview/reset before saving, including accent, font, spacing and button choices.

The starter includes home, collection, serum, cream, brand story and skincare guide. Pages link through
native site-scoped URLs and reuse the same renderer in public delivery, preview and builder.
The six-page starter is available to hosts; the demo initializes it through `state=cosmetics`.
There is no automatic destructive content installation on an existing site.

## Demo

Run the Core Atlas according to the root README. On its renderer port open:

- `/website/visit?site=site-cosmetics&state=cosmetics`
- `/website/themes/theme-cosmetics?site=site-cosmetics&state=cosmetics`
- `/website/pages/cosmetics-home/builder?site=site-cosmetics&state=cosmetics&panel=styles`

Keep navigation in the same document; this is an in-memory mock. A fresh document needs the scenario
parameter again. Six public pages plus configuration/builder are registered in the Core Atlas.

Brand, packaging, product descriptions and prices are illustrative. This theme does not introduce
checkout, claims verification, clinical advice or a production catalogue integration. KTL/third-party
JavaScript remains an open contract decision; this preset does not change it.

## Verification

Three tests added in `test/cosmetics-theme.test.mjs` were red before implementation and pass after:
seeded page/publication coherence and scope; draft/CAS/permissions/publish; shared renderer skin.
Their three mutations are included in `test/mutations.mjs`. Browser evidence is in
`review/evidence/THEME-COSMETICS/` at desktop/mobile, with Studio dark-mode checks.
