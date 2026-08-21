# KetSuite

Composable business modules and UI built on the public KetJS contracts. KetSuite includes backend,
website, commerce, collaboration, accounting, inventory, CRM, and hospitality modules.

> KetSuite 0.x is preview software. Business contracts and migrations may change before 1.0.

```bash
npm install @ketvietlab/ketsuite @ketvietlab/ketjs
```

```ts
import { product, sale, stock } from '@ketvietlab/ketsuite'
```

KetSuite is intentionally a normal third-party consumer of `@ketvietlab/ketjs`; repository audits prevent it
from importing framework internals.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)
