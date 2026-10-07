# ketjs-view learning project

A standalone website with a counter and keyed todo island for the
[KetJS learning path](https://ketjs.dev/learn/). Uses **0.2.0 preview** packages from npm;
no KetJS server package or database is needed.

```bash
# Run from: learn-view
npm ci
npm run dev
```

Open the URL printed by the development server. The homepage has a counter; `/todo/` has
an in-memory task list; `/about/` is static; `/data/` demonstrates cancellable fetching from a same-origin JSON fixture. Reloading resets the in-memory examples.

```bash
# Run from: learn-view
npm run check
npm run build
npm run preview
```

`dist` is the static hosting artifact. The project is configured for the domain root.
The `validation` island source is an additional exercise example; place it on a page to use it.
For small edits without installing anything, use [the online playground](https://ketjs.dev/playground/).

All interactive examples use TSX. The shared views remain render-pure; browser effects belong
to handlers or disposable island lifecycle hooks. APIs may change before 1.0.
