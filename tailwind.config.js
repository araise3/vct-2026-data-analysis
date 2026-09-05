/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // True neutral charcoals keep the dark UI from developing a colored
        // cast. Valorant red is reserved for interaction and selection.
        base: '#0c0d0f',
        navbar: '#0f1012',
        surface: '#141619',
        surface2: '#1b1e22',
        surface3: '#23272c',
        hairline: '#2d3238',
        ink: '#f0f1f3',
        muted: '#9aa0a8',
        accent: { DEFAULT: '#ff6573', dim: '#c74450', bright: '#ff8b95' },
        selected: { DEFAULT: '#a6404c', dim: '#7d323b', bright: '#c85561' },
        good: '#65c48b',
        warn: '#d9aa5b',
        mid: '#d9aa5b',
        bad: '#e2717f',
        live: '#ff6678',
        score: {
          1: '#4f79df', 2: '#2e9fbd', 3: '#4bd389',
          4: '#d7c74f', 5: '#e79648', 6: '#f06b74',
        },
      },
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: { lg: '0.25rem', xl: '0.25rem', '2xl': '0.25rem' },
      backgroundImage: {
        'grad-accent': 'linear-gradient(#c74450, #c74450)',
        'grad-accent-hover': 'linear-gradient(#d95764, #d95764)',
        'grad-selected': 'linear-gradient(#a6404c, #a6404c)',
        'grad-surface': 'linear-gradient(#141619, #141619)',
        'grad-surface2': 'linear-gradient(#1b1e22, #1b1e22)',
      },
      boxShadow: {
        'depth-xs': 'none',
        'depth-sm': 'none',
        'depth-md': '0 14px 32px rgb(0 0 0 / 0.32)',
        'depth-lg': '0 22px 52px rgb(0 0 0 / 0.42)',
        button: '0 1px 2px rgb(0 0 0 / 0.28)',
        'button-hover': '0 0 0 1px rgb(255 101 115 / 0.25)',
        'button-active': 'inset 0 1px 2px rgb(0 0 0 / 0.42)',
        'focus-ring': '0 0 0 3px rgb(255 101 115 / 0.20)',
      },
      maxWidth: { content: '1400px' },
    },
  },
  plugins: [],
}
