/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef2ff", 100: "#dfe6ff", 200: "#bccbff", 500: "#3b5bfd", 600: "#2447d4", 700: "#1c37a6", 900: "#121f5c" },
        accent: { 50: "#fdf0f6", 100: "#fbe0ee", 500: "#e0287d", 600: "#c01e69" },
        ink: { 900: "#121527", 700: "#363b55", 500: "#6b7089", 300: "#b9bccb", 100: "#e9eaf1", 50: "#f6f7fb" },
      },
      fontFamily: { sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(18,21,39,.06), 0 4px 16px rgba(18,21,39,.06)" },
    },
  },
  plugins: [],
};
