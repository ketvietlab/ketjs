---
title: Notes application
description: A SQLite-backed application with a module, model, function, migration, and HTTP route.
order: 1
---
## Create the application

```bash
# Run from: /path/to/projects
npx -y @ketvietlab/ketjs@latest new notes
cd notes
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The first boot composes the declared modules and applies their schema.

## Explore the generated code

The scaffold includes `ket.workspace.ts`, `modules/notes.ts`, and a deployment test. Follow the [quick start](/docs/quick-start/) for the full walkthrough, then inspect the [testing guide](/docs/testing/) to extend its coverage.
