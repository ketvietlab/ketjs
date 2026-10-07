// The comparison libraries are installed with `npm ci --prefix bench/ssr-comparison`, which the
// repository build does not run. These declarations cover only what the harnesses call, so the
// repository type check gives the same result with or without that install.

declare module 'react' {
  export function createElement(
    type: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown
}

declare module 'react-dom/server' {
  export function renderToStaticMarkup(element: unknown): string
}

declare module 'preact' {
  export function h(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown
}

declare module 'preact-render-to-string' {
  export function renderToString(vnode: unknown): string
}

declare module 'vue' {
  export function h(type: string, props: Record<string, unknown> | null, children?: unknown): unknown
}

declare module '@vue/server-renderer' {
  export function renderToString(input: unknown): Promise<string>
}

declare module 'express' {
  import type { RequestListener } from 'node:http'

  type Response = { json(body: unknown): unknown }
  type Application = RequestListener & {
    disable(setting: string): unknown
    get(path: string, handler: (req: unknown, res: Response) => unknown): unknown
  }
  export default function express(): Application
}

declare module 'fastify' {
  import type { Server } from 'node:http'

  type Instance = {
    server: Server
    get(path: string, handler: () => Promise<unknown>): unknown
    ready(): Promise<unknown>
    close(): Promise<unknown>
  }
  export default function Fastify(options?: { logger?: boolean }): Instance
}
