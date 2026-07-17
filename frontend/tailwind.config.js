/** @type {import('tailwindcss').Config} */
// Token 唯一来源：frontend/DESIGN.md §1.1（色彩）§2.1（字号阶梯）。改这里先改 DESIGN.md。
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class', // 保留不启用（DESIGN.md §1.5：浅色是正典）
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // 字号阶梯（唯一合法集合）：11/12/13/14/15/17/20/24
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4' }],
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.6' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['17px', { lineHeight: '1.5' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.3' }],
      },
      colors: {
        accent: {
          DEFAULT: '#059669', // emerald-600：品牌/主动作/focus/图表强调，唯一强调色
          soft: '#ecfdf5',
        },
        verdict: {
          hit: '#059669',
          miss: '#f43f5e',
          partial: '#d97706',
        },
      },
    },
  },
  plugins: [],
}
