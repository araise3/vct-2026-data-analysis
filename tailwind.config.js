/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B0D10',
        surface: '#14171C',
        surface2: '#1B1F26',
        hairline: '#23262C',
        ink: '#E8E9EB',
        muted: '#8A8F98',
        accent: {
          DEFAULT: '#C9A227',
          dim: '#8A7220',
          bright: '#E0B93C',
        },
        good: '#30A46C',
        mid: '#F5A623',
        bad: '#E5484D',
      },
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
    },
  },
  plugins: [],
}
