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
        // rft.gg's own `max-w-content` token (72rem / 1152px) -- restored to
        // their exact value after a period set to vlr.gg's own `#wrapper`
        // width (1160px) instead. Reverted per direct request to match
        // rft.gg's real width sitewide, not just on the Events page it was
        // first fixed on.
        //
        // NOT a single number on rft.gg's own site, either -- their real
        // wrapper is responsive: this 1152px value only holds below
        // Tailwind's `2xl` breakpoint (1536px); at/above it their own content
        // wrapper measures 1250px, confirmed by binary-searching their live
        // site (1535px viewport -> 616px centre column on a 3-col page,
        // 1536px -> 714px, holds unchanged through 2560px -- no third tier).
        // Tailwind's `maxWidth` theme values can't themselves be responsive,
        // so every place this token is used pairs it with an explicit
        // `2xl:max-w-[1250px]` override rather than encoding the jump here --
        // see <main>/the footer in App.jsx and TopNav's inner row.
        //
        // Single source of truth for the site's BASE width (every page below
        // 2xl): <main>, the footer, and TopNav's inner row all reference it,
        // so this one value widens or narrows the whole site below 2xl; the
        // 2xl override at each of those three sites is the second half of
        // the pair and must move with it if this number ever changes again.
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
        content: '1152px',
      },
    },
  },
  plugins: [],
}
