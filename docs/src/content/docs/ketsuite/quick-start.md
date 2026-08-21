---
title: KetSuite quick start
description: Scaffold the complete KetSuite application and provision its first administrator.
---

KetSuite requires Node.js 24 or newer. Generate a standalone application from the public package:

```bash
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

Open `http://127.0.0.1:3000/admin/login` and sign in with `admin` / `admin`.

The generated `dev` script explicitly runs `ketsuite serve --dev-admin`. On an empty SQLite
database, this creates the development company and the `admin` superuser. Repeated starts are
idempotent. The password is intentionally insecure: keep the server on its default loopback host,
do not share the database, and change the password before exposing it to another machine.

## Production-style startup

`npm start` runs `ketsuite serve` and never creates `admin` / `admin`. To initialize a blank database
with a strong credential, pipe the provisioning payload through standard input so the password does
not appear in the process list:

```bash
npm run provision <<'JSON'
{
  "companyName": "Example Company",
  "companyCode": "EXAMPLE",
  "currency": "VND",
  "adminLogin": "admin@example.com",
  "adminName": "Administrator",
  "adminEmail": "admin@example.com",
  "adminPassword": "replace-with-a-strong-password"
}
JSON
```

Provisioning succeeds only while both the company and user tables are empty. The normal password
policy still applies; the short `admin` password is accepted only through the explicit local
development bootstrap path.

## Configuration

KetSuite listens on `127.0.0.1:3000` and stores SQLite data in `.ket/ketsuite.db` by default. Common
overrides are `HOST`, `PORT`, and `KET_SQLITE`. The packaged application uses SQLite; repository
deployments that need PostgreSQL can compose `createKetsuiteApp()` with the PostgreSQL store.

The generated workspace is deliberately small:

```text
my_suite/
├── ket.workspace.mjs
├── package.json
├── README.md
└── .gitignore
```

The workspace re-exports the supported packaged app from `@ketvietlab/ketsuite/app`; it does not
copy KetSuite's module list into the generated project.
