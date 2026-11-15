/** @type {import('tailwindcss').Config} */
// Tripzy design tokens (restored from the original app): semantic colours resolve to the
// CSS variables in src/index.css (:root light / .dark dark).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--bg-primary)', secondary: 'var(--bg-secondary)', tertiary: 'var(--bg-tertiary)',
          elevated: 'var(--bg-elevated)', card: 'var(--bg-card)', input: 'var(--bg-input)', hover: 'var(--bg-hover)', selected: 'var(--bg-selected)',
        },
        content: { DEFAULT: 'var(--text-primary)', secondary: 'var(--text-secondary)', muted: 'var(--text-muted)', faint: 'var(--text-faint)' },
        edge: { DEFAULT: 'var(--border-primary)', secondary: 'var(--border-secondary)', faint: 'var(--border-faint)' },
        accent: { DEFAULT: 'var(--accent)', text: 'var(--accent-text)', on: 'var(--accent-on)', hover: 'var(--accent-hover)', subtle: 'var(--accent-subtle)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
        inverse: { DEFAULT: 'var(--bg-inverse)', text: 'var(--text-inverse)' },
      },
      fontFamily: {
        geist: ['Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)', elevated: 'var(--shadow-elevated)', modal: 'var(--shadow-modal)',
        dropdown: 'var(--shadow-dropdown)', popover: 'var(--shadow-popover)',
      },
      fontSize: {
        title: ['calc(24px * var(--fs-scale-title, 1))', '1.2'],
        subtitle: ['calc(18px * var(--fs-scale-subtitle, 1))', '1.35'],
        body: ['calc(14px * var(--fs-scale-body, 1))', '1.5'],
        caption: ['calc(12px * var(--fs-scale-caption, 1))', '1.4'],
      },
    },
  },
  plugins: [],
}
