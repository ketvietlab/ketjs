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
      title: 'KetSuite Docs',
      description: 'Architecture, operations, and development documentation for the KetJS framework.',
      favicon: '/favicon.svg',
      logo: {
        src: './src/assets/logo-placeholder.svg',
        replacesTitle: false,
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
        baseUrl: 'https://github.com/ketvietlab/ketjs/edit/develop/docs/',
      },
      customCss: ['./src/styles/ketsuite.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [{ label: 'Documentation overview', slug: '' }],
        },
        {
          label: 'KetJS framework',
          items: [
            { label: 'Framework overview', slug: 'ketjs' },
            { label: 'Quick start', slug: 'ketjs/quick-start' },
            {
              label: 'Application model',
              collapsed: true,
              items: [
                { label: 'Workspaces and apps', slug: 'ketjs/workspaces' },
                { label: 'Modules and manifest', slug: 'ketjs/modules' },
                { label: 'Module discovery', slug: 'ketjs/module-discovery' },
              ],
            },
            {
              label: 'Data and operations',
              collapsed: true,
              items: [
                { label: 'Models and scopes', slug: 'ketjs/models' },
                { label: 'Queries and changesets', slug: 'ketjs/data' },
                { label: 'Functions and effects', slug: 'ketjs/functions' },
                { label: 'Migrations and adapters', slug: 'ketjs/migrations' },
              ],
            },
            {
              label: 'Server runtime',
              collapsed: true,
              items: [
                { label: 'HTTP routes and responses', slug: 'ketjs/http' },
                { label: 'Channel API architecture', slug: 'ketjs/channel-api' },
                { label: 'Customer API reference', slug: 'ketjs/channel-api-reference' },
                { label: 'Sessions and tenants', slug: 'ketjs/sessions-tenants' },
                { label: 'Durable jobs and workers', slug: 'ketjs/jobs' },
                { label: 'Storage, transport, streams', slug: 'ketjs/integrations' },
              ],
            },
            {
              label: 'UI and presentation',
              collapsed: true,
              items: [
                { label: 'Rendering and islands', slug: 'ketjs/rendering' },
                { label: 'Themes and KTL', slug: 'ketjs/themes' },
                { label: 'Menus and localization', slug: 'ketjs/menus-i18n' },
              ],
            },
            {
              label: 'Tooling and delivery',
              collapsed: true,
              items: [
                { label: 'Testing', slug: 'ketjs/testing' },
                { label: 'CLI and configuration', slug: 'ketjs/cli-config' },
                { label: 'Deployment', slug: 'ketjs/deployment' },
                { label: 'Publishing packages', slug: 'ketjs/releasing' },
                { label: 'Public API', slug: 'ketjs/api' },
              ],
            },
          ],
        },
        {
          label: 'KetSuite application',
          items: [{ label: 'Quick start', slug: 'ketsuite/quick-start' }],
        },
        {
          label: 'Architecture & internals',
          collapsed: true,
          items: [{ label: 'Architecture overview', slug: 'architecture' }],
        },
        {
          label: 'Operations & migration',
          collapsed: true,
          items: [{ label: 'Operations overview', slug: 'operations' }],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [
            { label: 'Develop the docs', slug: 'getting-started' },
            { label: 'Docs application boundary', slug: 'foundation/app-boundary' },
          ],
        },
      ],
      expressiveCode: {
        useStarlightUiThemeColors: true,
      },
    }),
  ],
})
