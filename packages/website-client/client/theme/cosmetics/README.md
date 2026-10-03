# Lành — Core cosmetics theme

A bundled MIT preset, separate from the Studio shell. Warm ivory, forest green and brass, serif
display headings over a quiet sans body, a forest call-to-action band and footer, and local vector
product artwork. Public branding stays light when the Studio is dark, so the storefront is consistent
with its published theme. Fonts are named, never fetched: without Cormorant Garamond / Be Vietnam Pro
installed it falls back to the system serif and sans. No external font/image request.

## Files and reuse

- `../cosmetics.ts`: default theme settings and `cosmeticsStarter(tr)`; six normal editable Placement
  pages, menu and media declarations. It takes the product translator; copy lives in messages.ts.
- `../skin.css`: the structure every bundled preset shares; load after `../default.css`.
- `../cosmetics.css`: Lành's colours, type and accent variants; load after `../skin.css`. The other
  trade presets (`retail`, `restaurant`, `hotel`, `services`) follow the same pattern.
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

`test/website-studio-style-http.test.ts` covers the preset through the Studio's draft/CAS/permission
boundary and rejects unknown presets; `website-studio-preview-http`, `website-studio-public-http` and
`website-customer-signin-http` check that preview, public delivery and the sign-in page wear it.
