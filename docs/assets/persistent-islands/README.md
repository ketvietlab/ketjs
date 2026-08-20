# Persistent island browser evidence

Captured from the local collaboration fixture on 2026-08-20 after the full repository verification.

- `backend-product-state.jpg`: the Product page navigated from General to Media with a fragment response.
  The Chatter note draft, open Activity composer, record title, sidebar, and hydrated collaboration state
  remain visible after the content changed.
- `website-search-state.jpg`: the built-in website navigated Home → About → Back → About. The global
  search island remains open and keeps the text `áo khoác vận hành` while the page region and document
  title change.

The matching browser assertions checked the final URL and title, the destination page content, and the
continued visibility of each open island state.
