/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface:      '#FFFFFF',
        card:         '#F8F9FA',
        accent:       '#C4222E',
        'accent-dark':'#96181F',
        graphite:     '#15171B',
        // Override Tailwind's default `red` scale so every existing
        // bg-red-*/text-red-*/border-red-* utility picks up the new
        // brand hue automatically.
        red: {
          300: '#EB9FA5',
          400: '#E2626C',
          500: '#D63A44',
          600: '#C4222E',
          700: '#AC2129',
          800: '#96181F',
          900: '#6B0F16',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
