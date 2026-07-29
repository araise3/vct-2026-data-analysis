/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Exact tokens pulled from rft.gg's own stylesheet, with "primary"
        // (their accent) overridden to Valorant's official brand red
        // instead of their periwinkle (#a6b0f2).
        base: '#131619',        // --background
        navbar: '#0d0f10',      // --navbar-background
        surface: '#191c22',     // --card
        surface2: '#242832',    // --muted
        hairline: '#303133',    // --border
        ink: '#fafafa',         // --foreground
        muted: '#9b9c9e',       // --muted-foreground
        accent: {
          DEFAULT: '#FF4655',   // Valorant brand red (overridden from rft's #a6b0f2)
          dim: '#B23440',
          bright: '#FF6E79',
        },
        good: '#4ac97e',        // --success
        mid: '#ffd47d',         // --legendary
        bad: '#f7665e',         // --destructive
        live: '#ef4444',        // --live
      },
      fontFamily: {
        // rft.gg uses one font family throughout — Plus Jakarta Sans —
        // rather than a separate display/body/mono system.
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif', 'system-ui'],
        body: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif', 'system-ui'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // rft.gg's --radius: .625rem — noticeably more subtle than the
        // 14-20px this site used before.
        xl: '0.625rem',
        '2xl': '0.875rem',
      },
      maxWidth: {
        // rft.gg's own `max-w-content` token, read off their live stylesheet:
        // 1152px (72rem). Paired everywhere with `mx-auto px-4 md:px-6`,
        // exactly as they do it -- their navbar's inner row and their main
        // content wrapper both use that same trio, which is what makes the
        // nav links sit flush with the content beneath them.
        //
        // Single source of truth for the site width: <main>, the footer, and
        // TopNav's inner row all reference it, so this one value widens or
        // narrows the whole site.
        //
        // The site used to be full-bleed (max-w-[2400px], effectively the
        // viewport), which is why it read as sprawling next to rft.gg.
        // Constraining it means the widest tables (the Agents matrix runs
        // ~1700px with every map column) now scroll inside their own
        // DataTable overflow-auto wrapper rather than stretching the page --
        // the intended behaviour, see DataTable's comment on why it has no
        // fixed column widths.
        content: '1152px',
      },
    },
  },
  plugins: [],
}
