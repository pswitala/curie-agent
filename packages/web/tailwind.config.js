/** @type {import('tailwindcss').Config} */
export default {
  content: ['index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#010101',
        s1: '#080808',
        s2: '#0f0f0f',
        s3: '#1a1a1a',
        s4: '#222222',
        b1: '#1e1e1e',
        b2: '#2a2a2a',
        b3: '#404040',
        fg: '#ffffff',
        text: '#dddddd',
        text2: '#e0e0e0',
        muted: '#808080',
        muted2: '#555555',
        green: '#a3be8c',
        yellow: '#ebcb8b',
        red: '#bf616a',
      },
      fontFamily: {
        sans: ['Instrument Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
};
