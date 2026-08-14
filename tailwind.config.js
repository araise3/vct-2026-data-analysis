/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Rebuilt as a real elevation ladder (v2 refresh) rather than
        // rft.gg's original near-flat set, where base/surface/surface2 sat
        // within ~4% lightness of each other -- too close for a shadow
        // alone to read as "raised" against. Each step here is a genuine,
        // visible lightness jump so a card is unmistakably above the page
        // and a chip/button is unmistakably above its card, with shadows
        // now reinforcing a real contrast step instead of doing all the
        // work alone.
        base: '#0d0f13',        // page background -- darkened from #131619
        navbar: '#0a0b0e',
        surface: '#1b1f28',     // card -- one clear step up from base
        surface2: '#272d3a',    // nested/active surface -- another clear step up
        surface3: '#333b4c',    // hover state on surface2 (e.g. inactive-chip hover)
        hairline: '#3d4557',    // brightened from #303133 -- now a real visible edge
        ink: '#fafafa',
        muted: '#9ba1b0',
        accent: {
          DEFAULT: '#FF4655',   // Valorant brand red -- reserved for primary CTAs/brand, not selection state
          dim: '#B23440',
          bright: '#FF6E79',
        },
        // Muted slate-blue for "this is selected" (active chips/tabs/
        // toggles) -- direct feedback that red read as too loud once it
        // was on every active facet, and that selection state shouldn't
        // compete with accent's own CTA/brand meaning. Callback to rft.gg's
        // own original (pre-override) periwinkle accent, toned down further.
        selected: {
          DEFAULT: '#5B6EAE',
          dim: '#42517F',
          bright: '#7C8FD1',
        },
        good: '#4ac97e',
        mid: '#ffd47d',
        bad: '#f7665e',
        live: '#ef4444',
      },
      fontFamily: {
        // rft.gg uses one font family throughout — Plus Jakarta Sans —
        // rather than a separate display/body/mono system.
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif', 'system-ui'],
        body: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif', 'system-ui'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Bumped up a full notch from rft.gg's original --radius: .625rem
        // -- direct request to move away from that site's fidelity match
        // toward a rounder, more contemporary feel.
        lg: '0.625rem',
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
      backgroundImage: {
        // Real gradients, not flat fills -- a flat `bg-accent` on a near-
        // black page reads as a colored rectangle with no light source; a
        // top-lit gradient plus the shadow pair below is what actually
        // sells "raised, catching light from above." Used by Button/Chip's
        // active states and Card's own surface.
        'grad-accent': 'linear-gradient(180deg, #FF6E79 0%, #FF4655 55%, #E63A48 100%)',
        'grad-accent-hover': 'linear-gradient(180deg, #FF8890 0%, #FF4655 55%, #E63A48 100%)',
        'grad-selected': 'linear-gradient(180deg, #7C8FD1 0%, #5B6EAE 55%, #42517F 100%)',
        'grad-surface': 'linear-gradient(180deg, #20242f 0%, #1b1f28 100%)',
        'grad-surface2': 'linear-gradient(180deg, #2d3341 0%, #272d3a 100%)',
      },
      boxShadow: {
        // Depth scale v2: noticeably stronger than a first pass that
        // relied on shadow alone against a near-black page -- opacity and
        // blur both raised, and the inset highlight brightened, so a card
        // reads as raised even before the eye gets to the gradient/color
        // step change above.
        'depth-xs': '0 1px 3px 0 rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.05)',
        'depth-sm': '0 4px 10px -2px rgb(0 0 0 / 0.55), 0 2px 4px -2px rgb(0 0 0 / 0.4), inset 0 1px 0 0 rgb(255 255 255 / 0.07)',
        'depth-md': '0 10px 24px -6px rgb(0 0 0 / 0.6), 0 4px 8px -4px rgb(0 0 0 / 0.45), inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
        'depth-lg': '0 22px 44px -10px rgb(0 0 0 / 0.65), 0 8px 16px -6px rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.09)',
        // Button-specific: a real accent-colored glow on hover (not just a
        // darker cast shadow) and a deeper inset press on active.
        button: '0 2px 4px 0 rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.12)',
        'button-hover': '0 8px 20px -4px rgb(255 70 85 / 0.45), 0 3px 8px -2px rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.16)',
        'button-active': 'inset 0 2px 6px 0 rgb(0 0 0 / 0.6)',
        // Muted slate-blue, not accent red -- a focus ring means "you're
        // interacting with this control," the same "selecting" meaning
        // Chip's active state carries, so it uses the same subdued color
        // rather than the loud brand red.
        'focus-ring': '0 0 0 3px rgb(91 110 174 / 0.45)',
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
