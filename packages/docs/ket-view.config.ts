// File: packages/docs/ket-view.config.ts
import { defineConfig } from '@ketvietlab/ketjs-view-tools'

export default defineConfig({
  pages: 'pages',
  styles: ['site/styles.css'],
  islands: { controls: 'site/controls.tsx', documentation: 'site/documentation.tsx' },
  base: '/',
  host: '127.0.0.1',
  port: 3700,
})
