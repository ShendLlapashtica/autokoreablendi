/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#FFFFFF',
        card:    '#F8F9FA',
        accent:  '#DC2626',
        // Tailwind's default `red` scale is already a true red (no orange
        // bias), so it's left untouched here and used directly everywhere.
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
