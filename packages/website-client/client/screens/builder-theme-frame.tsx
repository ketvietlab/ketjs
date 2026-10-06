import { trustedMarkup } from '@ketvietlab/ketjs-view'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import type { SiteTheme } from '../types.ts'
import { safeImage } from '../renderer.tsx'

/** Only the host-provided stylesheet is loaded; theme JavaScript never runs in the Studio document. */
export function builderThemeFrame(
  theme: SiteTheme | null,
  siteName: string,
  menu: { label: string }[],
  body: JSXChild,
) {
  const stylesheet = /^\/(?!\/)[A-Za-z0-9_./-]+\.css$/.test(theme?.stylesheet ?? '')
    ? theme!.stylesheet
    : null
  return (
    <div
      class="wt-site"
      data-website-theme="default"
      data-site-theme={theme?.theme?.key ?? null}
      data-theme-preset={theme?.preset ?? 'default'}
      data-accent={theme?.theme?.settings?.accent ?? theme?.accent ?? 'green'}
      data-font={theme?.font ?? 'sans'}
      data-spacing={theme?.spacing ?? 'comfortable'}
      data-buttons={theme?.buttons ?? 'rounded'}
    >
      {stylesheet ? <link rel="stylesheet" href={stylesheet} /> : null}
      {theme?.frame?.topbar ? trustedMarkup(theme.frame.topbar) : null}
      {theme?.frame?.header ? (
        trustedMarkup(theme.frame.header)
      ) : (
        <header class="wt-theme-header">
          {theme?.logo ? <img src={safeImage(theme.logo)} alt={siteName} /> : <strong>{siteName}</strong>}
          <nav>
            {menu.map((item) => (
              <span>{item.label}</span>
            ))}
          </nav>
        </header>
      )}
      {theme?.frame?.beforeMain ? trustedMarkup(theme.frame.beforeMain) : null}
      <main>{body}</main>
      {theme?.frame?.afterMain ? trustedMarkup(theme.frame.afterMain) : null}
      {theme?.frame?.footer ? (
        trustedMarkup(theme.frame.footer)
      ) : (
        <footer class="wt-theme-footer">{theme?.footer ?? siteName}</footer>
      )}
    </div>
  )
}
