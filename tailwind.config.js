/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      // Escala tipográfica pensada para leitura a ~3 metros (base 1920x1080).
      fontSize: {
        'tv-sm': ['1.25rem', { lineHeight: '1.75rem' }],
        'tv-base': ['1.5rem', { lineHeight: '2.25rem' }],
        'tv-lg': ['2rem', { lineHeight: '2.75rem' }],
        'tv-xl': ['2.75rem', { lineHeight: '3.5rem' }],
        'tv-2xl': ['3.75rem', { lineHeight: '4.25rem' }],
      },
      colors: {
        tv: {
          bg: '#0a0a0a',
          surface: '#111114',
          card: '#141418',
          border: 'rgba(255, 255, 255, 0.10)',
          text: '#f1f5f9',
          muted: '#8e8e93',
          accent: '#e50914',
          'accent-soft': '#ff1f2d',
        },
      },
      boxShadow: {
        focus: '0 0 25px rgba(255, 255, 255, 0.25)',
      },
    },
  },
  plugins: [],
}
