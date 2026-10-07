type MermaidConfig = Record<string, unknown>

// Mermaid derives colors internally, so resolve DS tokens to opaque hex first.
export function diagramTheme(read: (token: string) => string): MermaidConfig {
  const panel = read('--kv-panel-bg'),
    subtle = read('--kv-panel-bg-subtle')
  const text = read('--kv-text-main'),
    muted = read('--kv-text-secondary')
  const accent = read('--kv-accent'),
    border = read('--kv-border-default')
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    look: 'classic',
    htmlLabels: false,
    fontFamily: 'Inter, sans-serif',
    flowchart: { curve: 'linear', nodeSpacing: 32, rankSpacing: 48, padding: 16 },
    sequence: {
      diagramMarginX: 16,
      diagramMarginY: 16,
      actorMargin: 40,
      messageMargin: 32,
      noteMargin: 12,
      actorFontSize: 13,
      messageFontSize: 13,
      noteFontSize: 13,
      actorFontFamily: 'Inter, sans-serif',
      messageFontFamily: 'Inter, sans-serif',
      noteFontFamily: 'Inter, sans-serif',
    },
    themeCSS: `
      .node rect, .cluster rect, rect.actor, .note, .labelBox {
        rx: var(--kv-radius-md); ry: var(--kv-radius-md);
      }
      .node rect, .node circle, .node ellipse, .node polygon, .node path,
      .cluster rect, rect.actor, .note, .labelBox {
        filter: none !important; stroke-width: 1px;
      }
      text, .messageText, .noteText, .labelText {
        font-family: Inter, sans-serif !important; font-weight: 400;
      }
      .edgeLabel rect { fill: ${panel}; opacity: 1; }
    `,
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'theme',
      'look',
      'themeVariables',
      'themeCSS',
      'htmlLabels',
    ],
    themeVariables: {
      fontFamily: 'Inter, sans-serif',
      fontSize: '13px',
      background: panel,
      darkMode:
        [1, 3, 5].reduce((sum, start) => sum + Number.parseInt(panel.slice(start, start + 2), 16), 0) < 384,
      primaryColor: panel,
      primaryTextColor: text,
      primaryBorderColor: accent,
      secondaryColor: panel,
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: subtle,
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      textColor: text,
      lineColor: muted,
      nodeBorder: accent,
      mainBkg: panel,
      nodeTextColor: text,
      edgeLabelBackground: panel,
      clusterBkg: panel,
      clusterBorder: border,
      titleColor: text,
      actorBkg: panel,
      actorBorder: accent,
      actorTextColor: text,
      actorLineColor: border,
      signalColor: muted,
      signalTextColor: text,
      labelBoxBkgColor: panel,
      labelBoxBorderColor: border,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: subtle,
      noteBorderColor: border,
      noteTextColor: text,
      sequenceNumberColor: panel,
      activationBkgColor: subtle,
      activationBorderColor: accent,
    },
  }
}
