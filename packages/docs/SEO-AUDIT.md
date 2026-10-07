# KetJS on-page SEO audit

Scope: the local `ketjs.dev` static-site deployment in `packages/docs`, reviewed 2026-10-07.
This is an audit of our generated HTML and its rendering/navigation code, not a production crawl,
Search Console assessment or ranking measurement. Baseline and final route-level evidence are
`seo-before.json` and `seo-after.json`. The audit is reproducible with `node site/seo-audit.mjs`.

## Findings and fixes

| Priority | Finding | Result |
| --- | --- | --- |
| High | Open Graph used `name` and omitted type; article social titles differed from document titles | Public View Tools supports `property`; one head model supplies consistent titles, descriptions, URLs and type |
| High | Search was indexable but omitted from sitemap; search/404 shared a generic description | Both routes use noindex/follow with distinct useful metadata; sitemap contains the 43 content routes |
| Medium | The SVG social image was not a suitable raster share card | Generated a local 1200 × 630 PNG with Inter, Preview branding, dimensions and alt metadata |
| Medium | Twitter card metadata was missing | Added large-image card, title, description, image and alt text |
| Medium | Our generated head did not emit structured data | Page-specific WebPage/CollectionPage/TechArticle/BlogPosting, breadcrumbs, plus homepage WebSite and SoftwareSourceCode; no invented reviews, ratings or dates |
| Medium | Collection card headings skipped H2; some Markdown hierarchy skipped levels | Added collection section headings; page owns H1 and Markdown starts at H2 with consecutive levels |
| Medium | Soft doc navigation updated only part of the old metadata | The island now applies the same head model, including social metadata and replacing JSON-LD |
| Content | Home listed features without enough adoption context; Preview status was too easy to miss | Added concrete reasons, independent ketjs-view usage, audience/compatibility tradeoffs, and Preview badge plus evaluation/production guidance |

The original 45 artifacts produced 678 route-level findings, mostly repeated shared-template defects,
not 678 independent causes. The final artifact check covers titles/descriptions, language, canonical,
main H1 and heading levels, social tags and raster availability, JSON-LD parsing/page identity,
image alt text, robots directives and sitemap consistency. Existing build verification also checks
internal links/anchors, one main landmark, singleton island keys and current-version content.
Final local result: 45 generated pages, 43 indexable routes, zero audit findings and 4,631
verified local links/anchors.

## Evidence and limits

JSON-LD detection here is reliable for this scope because we own the pure SSG head renderer and inspect
its complete emitted script elements, rather than a text-only fetch of an unknown CMS. The browser
navigation runtime also replaces those elements explicitly. Producer tests verify script-breakout
escaping and Open Graph attributes. This does not claim validation by Google's Rich Results Test.

Titles/descriptions are unique, concise and page-specific. Length is a review hint rather than a
fixed ranking rule; Google can select a different title/snippet. References:
[Google title-link guidance](https://developers.google.com/search/docs/appearance/title-link),
[Google snippet guidance](https://developers.google.com/search/docs/appearance/snippet), and the
[Open Graph specification](https://ogp.me/).

Not verified: production response/status codes and redirects, TLS/DNS, live robots/sitemap delivery,
Search Console coverage, real-user Core Web Vitals, rich-result eligibility, backlinks or rankings.
These require the deployed origin and relevant access. No production deployment was performed.
