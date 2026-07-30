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
        // rft.gg's own `max-w-content` token was 1152px (72rem), paired
        // everywhere with `mx-auto px-4 md:px-6` -- their navbar's inner row
        // and their main content wrapper both used that same trio, which is
        // what made the nav links sit flush with the content beneath them.
        // That's still true here; only the number changed.
        //
        // Single source of truth for the site width: <main>, the footer, and
        // TopNav's inner row all reference it, so this one value widens or
        // narrows the whole site.
        //
        // Widened from 1152px to 1800px: at 1152 the widest tables (the
        // Agents matrix runs ~1650-1700px with every map column; Players and
        // Teams aren't far behind) scrolled inside DataTable's own
        // overflow-auto wrapper even on a typical wide desktop monitor,
        // where hundreds of pixels sat unused on either side of a 1152px
        // column. 1800 was sized against the Agents matrix specifically
        // (the widest table on the site) so it renders with no horizontal
        // scrollbar at a 1920px viewport; DataTable's own comment on why it
        // has no fixed column widths / uses overflow-auto still holds for
        // narrower viewports, where scrolling remains unavoidable.
        content: '1800px',
      },
    },
  },
  plugins: [],
}
