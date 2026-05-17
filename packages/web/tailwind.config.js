/** @type {import('tailwindcss').Config} */
export default {
  content: ['index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        s1: 'var(--s1)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',
        s4: 'var(--s4)',
        b1: 'var(--b1)',
        b2: 'var(--b2)',
        b3: 'var(--b3)',
        fg: 'var(--fg)',
        text: 'var(--text)',
        text2: 'var(--text2)',
        muted: 'var(--muted)',
        muted2: 'var(--muted2)',
        green: 'var(--green)',
        yellow: 'var(--yellow)',
        red: 'var(--red)',
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
