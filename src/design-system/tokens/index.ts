/**
 * Typed AKBARAL! design primitives.
 * Keep these values aligned with design-system/tokens.json, which generates
 * the web, React Native and iOS consumers.
 */
export const colors = {
  primary: {
    50: '#eef7f0',
    100: '#dceddf',
    200: '#bbd8c2',
    300: '#94c5a1',
    400: '#69ad7d',
    500: '#2f8348',
    600: '#286f3d',
    700: '#205b32',
    800: '#194726',
    900: '#12351d',
    950: '#0b2413',
  },
  neutral: {
    0: '#ffffff',
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  semantic: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },
} as const;

export const typography = {
  fontFamily: {
    sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
  },
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
    '6xl': '3.75rem',
    '7xl': '4.5rem',
  },
  weights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
  40: '10rem',
  48: '12rem',
} as const;

export const effects = {
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
    glow: '0 0 40px -10px rgb(47 131 72 / 0.4)',
    'glow-lg': '0 0 60px -15px rgb(47 131 72 / 0.5)',
  },
  gradients: {
    hero: 'linear-gradient(135deg, #07100b 0%, #102318 50%, #1d4b2b 100%)',
    accent: 'linear-gradient(135deg, #69ad7d 0%, #2f8348 52%, #205b32 100%)',
    mesh: 'radial-gradient(ellipse at 20% 30%, rgba(47, 131, 72, 0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 70%, rgba(40, 111, 61, 0.1) 0%, transparent 50%)',
  },
  animations: {
    duration: { fast: '150ms', normal: '300ms', slow: '500ms', slower: '800ms', slowest: '1200ms' },
    easing: {
      default: 'cubic-bezier(0.4, 0, 0.2, 1)',
      bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      smooth: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      dramatic: 'cubic-bezier(0.87, 0, 0.13, 1)',
    },
  },
} as const;

export const radii = { sm: 6, md: 10, lg: 16, xl: 24, full: 999 } as const;
export type ColorTokens = typeof colors;
