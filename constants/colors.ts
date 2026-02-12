export const colors = {
  primary: {
    50: '#E7E8ED', 100: '#D0D2DB', 200: '#A1A5B7', 300: '#717893', 400: '#4F5775',
    500: '#30364F', 600: '#2A2F45', 700: '#24283B', 800: '#1D2131', 900: '#171A27', 950: '#0E1018'
  },
  secondary: {
    50: '#F6F8F9', 100: '#EDF0F2', 200: '#DCE2E6', 300: '#CAD4DA', 400: '#B9C5CE',
    500: '#ACBAC4', 600: '#9BA8B1', 700: '#89969E', 800: '#677076', 900: '#454B4F'
  },
  accent_warm: {
    50: '#FAF9F4', 100: '#F5F3E9', 200: '#EBE7D3', 300: '#E1D9BC', 400: '#D7CB9F',
    500: '#CDBE82', 600: '#B9AB75', 700: '#91865C', 800: '#6A6243', 900: '#443F2B'
  },
  accent_light: {
    50: '#FFFFFF', 100: '#FDFDF8', 200: '#FAF9F0', 300: '#F5F5E5', 400: '#F0F0DB',
    500: '#E6E6C0', 600: '#D1D1AF', 700: '#A6A68B', 800: '#7B7B67', 900: '#515144'
  },
  // Semantic colors
  positive: '#4ADE80',
  negative: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',
} as const;

export type ColorScale = typeof colors.primary;
export type SemanticColor = typeof colors.positive;
