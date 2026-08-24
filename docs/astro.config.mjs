import { defineConfig } from 'astro/config'
import mermaid from 'astro-mermaid'
import starlight from '@astrojs/starlight'

export default defineConfig({
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        securityLevel: 'strict',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        flowchart: {
          curve: 'linear',
          htmlLabels: false,
        },
        sequence: {
          useMaxWidth: true,
        },
      },
    }),
    starlight({
      title: 'Ket Developer Docs',
      description: 'Developer guides for the KetJS framework and the KetSuite application.',
      favicon: '/favicon.svg',
      logo: {
        light: './src/assets/ketsuite-logo-light.png',
        dark: './src/assets/ketsuite-logo-dark.png',
        alt: 'KetSuite — Extensible Open ERP',
        replacesTitle: true,
      },
      locales: {
        root: {
          label: 'English',
          lang: 'en',
        },
      },
      social: [
        {
          icon: 'github',
          label: 'KetJS on GitHub',
          href: 'https://github.com/ketvietlab/ketjs',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/ketvietlab/ketjs/edit/develop/docs/src/content/docs/',
      },
      customCss: ['./src/styles/ketsuite.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [{ label: 'Choose a development path', slug: '' }],
        },
        {
          label: 'KetJS framework',
          items: [
            { label: 'Framework overview', slug: 'ketjs' },
            { label: 'Quick start', slug: 'ketjs/quick-start' },
            {
              label: 'Compose an application',
              collapsed: false,
              items: [
                { label: 'Workspaces and deployments', slug: 'ketjs/workspaces' },
                { label: 'Modules and manifest', slug: 'ketjs/modules' },
                { label: 'Module discovery', slug: 'ketjs/module-discovery' },
              ],
            },
            {
              label: 'Model data and behavior',
              collapsed: true,
              items: [
                { label: 'Models and scopes', slug: 'ketjs/models' },
                { label: 'Queries and changesets', slug: 'ketjs/data' },
                { label: 'Functions and effects', slug: 'ketjs/functions' },
                { label: 'Migrations and adapters', slug: 'ketjs/migrations' },
              ],
            },
            {
              label: 'Serve and integrate',
              collapsed: true,
              items: [
                { label: 'HTTP routes and responses', slug: 'ketjs/http' },
                { label: 'HTTP contracts and OpenAPI', slug: 'ketjs/openapi' },
                { label: 'Sessions and tenants', slug: 'ketjs/sessions-tenants' },
                { label: 'Durable jobs and workers', slug: 'ketjs/jobs' },
                { label: 'Storage, transport, streams', slug: 'ketjs/integrations' },
              ],
            },
            {
              label: 'Build UI and documents',
              collapsed: true,
              items: [
                { label: 'Form validation', slug: 'ketjs/form-validation' },
                { label: 'Rendering and islands', slug: 'ketjs/rendering' },
                { label: 'Themes and KTL', slug: 'ketjs/themes' },
                { label: 'Menus and localization', slug: 'ketjs/menus-i18n' },
                { label: 'Reports and PDF', slug: 'ketjs/reports' },
              ],
            },
            {
              label: 'Verify and deliver',
              collapsed: true,
              items: [
                { label: 'Testing', slug: 'ketjs/testing' },
                { label: 'CLI and configuration', slug: 'ketjs/cli-config' },
                { label: 'Deployment', slug: 'ketjs/deployment' },
                { label: 'Public API', slug: 'ketjs/api' },
                { label: 'Publishing packages', slug: 'ketjs/releasing' },
              ],
            },
          ],
        },
        {
          label: 'KetSuite application',
          items: [
            { label: 'Developer guide', slug: 'ketsuite' },
            { label: 'Local development', slug: 'ketsuite/quick-start' },
            {
              label: 'Develop KetSuite',
              collapsed: false,
              items: [
                { label: 'Application architecture', slug: 'ketsuite/architecture' },
                { label: 'Module development', slug: 'ketsuite/module-development' },
                { label: 'Security and data scope', slug: 'ketsuite/security-scope' },
                { label: 'Testing KetSuite', slug: 'ketsuite/testing' },
              ],
            },
            {
              label: 'Build interfaces',
              collapsed: true,
              items: [
                { label: 'Backend UI development', slug: 'ketsuite/backend-development' },
                { label: 'Channel API architecture', slug: 'ketsuite/channel-api' },
                { label: 'Customer API reference', slug: 'ketsuite/channel-api-reference' },
              ],
            },
            {
              label: 'Business domains',
              collapsed: true,
              items: [
                { label: 'Product', slug: 'ketsuite/product' },
                { label: 'Manufacturing', slug: 'ketsuite/manufacturing' },
                { label: 'CRM', slug: 'ketsuite/crm' },
                { label: 'Loyalty', slug: 'ketsuite/loyalty' },
                { label: 'Accounting ledger', slug: 'ketsuite/accounting' },
                { label: 'Vietnam accounting defaults', slug: 'ketsuite/accounting-tt99' },
              ],
            },
          ],
        },
        {
          label: 'Engineering reference',
          collapsed: true,
          items: [
            {
              label: 'Operate and measure',
              collapsed: false,
              items: [
                { label: 'Operations reading map', slug: 'operations' },
                { label: 'Performance benchmarks', slug: 'operations/benchmarks' },
                { label: 'Loyalty benchmark evidence', slug: 'ketsuite/benchmarks/loyalty' },
              ],
            },
            {
              label: 'Design records',
              collapsed: true,
              items: [
                { label: 'How to use design records', slug: 'architecture' },
                { label: 'Architecture decisions', slug: 'architecture/decisions' },
                { label: 'Open questions', slug: 'architecture/open-questions' },
              ],
            },
          ],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            { label: 'Develop the docs', slug: 'getting-started' },
            { label: 'Docs application boundary', slug: 'foundation/app-boundary' },
            {
              label: 'Team handoffs',
              collapsed: true,
              items: [
                { label: 'Hospitality to Website', slug: 'handoffs/hospitality-website' },
                { label: 'View system to KetSuite', slug: 'handoffs/view-system-ketsuite' },
              ],
            },
          ],
        },
      ],
      expressiveCode: {
        useStarlightUiThemeColors: true,
      },
    }),
  ],
})
