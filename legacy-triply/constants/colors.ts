import { Platform } from 'react-native';

/**
 * Triply design tokens.
 *
 * Brand references from the approved Triply direction:
 * Warm Ivory #F8F6F1, Midnight Navy #101828, Ocean Blue #1677FF,
 * Coral #FF6B5F and Mint #4FD1B5.
 *
 * `primaryAction` is intentionally darker than Ocean Blue so 15px white
 * button labels meet the 4.5:1 contrast target without changing the brand
 * token used for links, indicators and suggestions.
 */
const colors = {
  light: {
    text: '#172033',
    tint: '#1677FF',
    background: '#F8F6F1',
    backgroundDark: '#101828',
    overlay: 'rgba(16,24,40,0.48)',
    foreground: '#172033',
    card: '#FFFFFF',
    cardForeground: '#172033',
    primary: '#1677FF',
    primaryAction: '#0B63CE',
    primaryContainer: '#E8F1FF',
    primaryForeground: '#FFFFFF',
    secondary: '#4FD1B5',
    secondaryForeground: '#101828',
    muted: '#F1F3F5',
    mutedForeground: '#667085',
    accent: '#FF6B5F',
    accentForeground: '#101828',
    destructive: '#B42318',
    destructiveForeground: '#FFFFFF',
    destructiveContainer: '#FDECEA',
    warning: '#9A6412',
    warningContainer: '#FFF3D8',
    offline: '#667085',
    simulated: '#667085',
    border: '#E4E7EC',
    input: '#E4E7EC',
    sand: '#FF6B5F',
    sky: '#E8F1FF',
    sage: '#4FD1B5',
    ink: '#172033',
  },
  dark: {
    text: '#F8F6F1',
    tint: '#8AB8FF',
    background: '#101828',
    backgroundDark: '#101828',
    overlay: 'rgba(0,0,0,0.64)',
    foreground: '#F8F6F1',
    card: '#182235',
    cardForeground: '#F8F6F1',
    primary: '#8AB8FF',
    primaryAction: '#5E9CFF',
    primaryContainer: '#223B66',
    primaryForeground: '#101828',
    secondary: '#75DEC8',
    secondaryForeground: '#101828',
    muted: '#202B3E',
    mutedForeground: '#B6C0D0',
    accent: '#FF9A91',
    accentForeground: '#101828',
    destructive: '#FF9D95',
    destructiveForeground: '#101828',
    destructiveContainer: '#4A1D1A',
    warning: '#F2C26D',
    warningContainer: '#4B391B',
    offline: '#B6C0D0',
    simulated: '#B6C0D0',
    border: '#344054',
    input: '#344054',
    sand: '#FF9A91',
    sky: '#223B66',
    sage: '#75DEC8',
    ink: '#F8F6F1',
  },
  radius: 18,
} as const;

export const designTokens = {
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 28, xxl: 36 },
  radius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  touch: { min: 44, comfortable: 52 },
  typography: {
    eyebrow: { family: 'Inter_600SemiBold', size: 11 },
    body: { family: 'Inter_400Regular', size: 14, lineHeight: 21 },
    label: { family: 'Inter_600SemiBold', size: 12 },
    title: { family: 'Inter_700Bold', size: 22 },
  },
  shadow: {
    card: Platform.select({
      web: { boxShadow: '0px 3px 10px rgba(16,24,40,0.06)' },
      default: { shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
    }),
  },
} as const;

export default colors;