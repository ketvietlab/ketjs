# KetSuite

Composable business modules and UI built on the public KetJS contracts. KetSuite includes backend,
website, commerce, collaboration, accounting, inventory, CRM, and hospitality modules.

> KetSuite 0.x is preview software. Business contracts and migrations may change before 1.0.

```bash
npx -y @ketvietlab/ketsuite@latest new my_suite
cd my_suite
npm install
npm run dev
```

Open `http://127.0.0.1:3000/admin/login` and sign in with `admin` / `admin`. That account is created
only by the generated development script against an empty local database. It is intentionally
insecure; `npm start` does not create it.

To consume selected modules instead of the complete application:

```bash
npm install @ketvietlab/ketsuite @ketvietlab/ketjs
```

```ts
import { product, sale, stock } from '@ketvietlab/ketsuite'
```

KetSuite is intentionally a normal third-party consumer of `@ketvietlab/ketjs`; repository audits prevent it
from importing framework internals.

See the [KetSuite quick start](https://github.com/ketvietlab/ketjs/blob/develop/docs/src/content/docs/ketsuite/quick-start.md)
for configuration and secure administrator provisioning.
