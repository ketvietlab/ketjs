# KetJS

KetJS is a module-composable, SSR-first full-stack framework for Node.js. It provides models,
migrations, typed functions, jobs, themes, fragment navigation, and persistent islands without a
required application-server dependency.

> KetJS 0.x is preview software. APIs and deployment contracts may change before 1.0.

## Requirements

- Node.js 24 or newer
- npm

## Create an application

```bash
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

The generated project uses SQLite by default, contains a real module and integration test, and runs
at `http://127.0.0.1:3000`.

Application names use lowercase letters, digits, and underscores and must start with a letter. Use
`--dir ./my-app` when the filesystem directory should have a different name.

Keep `@latest` when scaffolding inside another project so npm does not reuse an older locally
installed KetJS CLI. Use an exact tag such as `@0.1.2` for reproducible generation.

## Install in an existing project

```bash
npm install @ketvietlab/ketjs
```

```ts
import { defineApp, defineModule, defineWorkspace } from '@ketvietlab/ketjs'
```

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)
