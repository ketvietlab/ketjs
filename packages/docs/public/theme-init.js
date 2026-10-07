// Apply the saved preference before CSS/body paint; the controls island owns user interaction.
try {
  const theme = localStorage.getItem('ketjs-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch {
  // Storage can be blocked. CSS follows the system preference in that case.
}
