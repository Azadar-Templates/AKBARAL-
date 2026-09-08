/* AKBARAL! mobile design tokens — single source of truth.
   Keep in sync with public/styles.css (dark base). */

export const palette = {
  gold: '#ffcf5c',
  goldDeep: '#f9a826',
  cyan: '#5ee7ff',
  blue: '#4a8cff',
  violet: '#bba4ff',
  green: '#34d399',
  red: '#ff6b7e',
  white: '#eef3ff',
  text: '#eef3ff',
  textSoft: '#b8c6e6',
  textDim: '#8293b7',
  textFaint: '#5a6a8f',
  bg: '#060a14',
  bg2: '#0a1022',
  bg3: '#0d1530',
  surface: '#0c1329',
  surface2: '#111b3a',
  surfaceStrong: '#16224a',
  line: 'rgba(128,156,217,0.14)',
  lineStrong: 'rgba(128,156,217,0.28)',
  lineGold: 'rgba(255,207,92,0.35)',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glow: {
    shadowColor: palette.cyan,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
};
