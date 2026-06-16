/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0E1B45',
          800: '#14245C',
          700: '#1C326E',
          600: '#274585',
          500: '#3A5BA8',
          400: '#5B7AC4',
        },
        paper: {
          DEFAULT: '#F1ECDD',
          soft: '#F7F3E6',
          bright: '#FBF8EE',
          edge: '#E4DDC6',
        },
        blue: {
          700: '#1F3FB8',
          600: '#2E5BE0',
          500: '#4773F0',
          100: '#DCE6FF',
        },
        teal: { DEFAULT: '#1F8F7C' },
        amber: { DEFAULT: '#B8841C' },
        crimson: { DEFAULT: '#B43A3A' },
        orange: { DEFAULT: '#C26A1D' },
        graphite: '#1A1C20',
        char: '#4A4E57',
        slate: {
          DEFAULT: '#7A7E88',
          2: '#A8ACB5',
        },
      },
      fontFamily: {
        sans: ['Geist', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '3px',
      },
    },
  },
  plugins: [],
}
