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
        // Was rft.gg's own `max-w-content` token (1152px / 72rem). Now set
        // to vlr.gg's own `#wrapper` max-width instead (1160px, read off
        // their live stylesheet at /stats) -- barely different in absolute
        // terms, but this is the actual site the tables' own density
        // (column widths, abbreviations) is modeled on, so its width is the
        // more consistent reference now that content is the thing driving
        // the number rather than rft.gg's chrome. Paired everywhere with
        // `mx-auto px-4 md:px-6`, matching both sites' navbar-inner-row +
        // content-wrapper pattern.
        //
        // Single source of truth for the site width: <main>, the footer, and
        // TopNav's inner row all reference it, so this one value widens or
        // narrows the whole site.
        //
        // This was bumped to 1800px for a while to stop the widest tables
        // (the Agents matrix) needing a horizontal scrollbar, but that grew
        // the whole page past rft.gg's own width just to serve one table.
        // Reverted since -- DataTable's headers wrap instead of forcing
        // `whitespace-nowrap`, which is what was actually blowing columns
        // out past their data's own width (see DataTable's comment), so
        // tables fit this box on their own merits. Whatever still doesn't
        // fit falls back to DataTable's own overflow-auto horizontal
        // scrollbar, same as it always has for a many-column table on a
        // narrow viewport.
        content: '1160px',
      },
    },
  },
  plugins: [],
}
