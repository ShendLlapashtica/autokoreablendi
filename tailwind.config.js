/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface:      '#FFFFFF',
        card:         '#F8F9FA',
        accent:       '#B50909',
        'accent-dark':'#7A0606',
        graphite:     '#15171B',
        // Override Tailwind's default `red` scale so every existing
        // bg-red-*/text-red-*/border-red-* utility picks up the new
        // brand hue automatically.
        red: {
          300: '#E38585',
          400: '#D34F4F',
          500: '#C22020',
          600: '#B50909',
          700: '#970808',
          800: '#7A0606',
          900: '#5C0505',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Montserrat', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
