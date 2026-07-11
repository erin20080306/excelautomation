/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: '#102A2A', brand: { 50: '#ECFDF8', 100: '#D1FAEE', 200: '#A7F3D9', 300: '#6EE7BD', 400: '#34D399', 500: '#18A985', 600: '#0F8A6D', 700: '#0B6B56', 800: '#155E4C', 900: '#12463D' } },
      boxShadow: { soft: '0 16px 40px -24px rgba(15, 55, 48, .28)' }
    }
  },
  plugins: []
};
