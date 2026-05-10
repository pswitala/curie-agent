export interface ThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  title: string;
  // Optional: slab color for user message blocks. When omitted, user
  // messages use `background` as their slab. Useful for light themes where
  // the main bg is white and user blocks need a tinted backdrop to stand out.
  userBackground?: string;
  userForeground?: string;
}

export const themes: Record<string, ThemeColors> = {
  'tokyo-night': {
    primary: '#7aa2f7',
    secondary: '#2ac3de',
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    background: '#1a1b26',
    foreground: '#a9b1d6',
    muted: '#565f89',
    border: '#414868',
    title: '#7aa2f7',
    userBackground: '#24283b',
    userForeground: '#c0caf5',
  },
  nord: {
    primary: '#88c0d0',
    secondary: '#8fbcbb',
    success: '#a3be8c',
    warning: '#ebcb8b',
    error: '#bf616a',
    background: '#2e3440',
    foreground: '#d8dee9',
    muted: '#576277',
    border: '#4c566a',
    title: '#88c0d0',
    userBackground: '#3b4252',
    userForeground: '#eceff4',
  },
  dracula: {
    primary: '#bd93f9',
    secondary: '#8be9fd',
    success: '#50fa7b',
    warning: '#f1fa8c',
    error: '#ff5555',
    background: '#282a36',
    foreground: '#f8f8f2',
    muted: '#6272a4',
    border: '#6272a4',
    title: '#bd93f9',
    userBackground: '#383a46',
    userForeground: '#ffffff',
  },
  solarized: {
    primary: '#268bd2',
    secondary: '#2aa198',
    success: '#859900',
    warning: '#b58900',
    error: '#dc322f',
    background: '#002b36',
    foreground: '#839496',
    muted: '#586e75',
    border: '#586e75',
    title: '#268bd2',
    userBackground: '#073642',
    userForeground: '#eee8d5',
  },
  gruvbox: {
    primary: '#83a598',
    secondary: '#d79921',
    success: '#b8bb26',
    warning: '#fabd2f',
    error: '#fb4934',
    background: '#1d1d1d',
    foreground: '#d5c4a1',
    muted: '#7c6f64',
    border: '#504945',
    title: '#83a598',
    userBackground: '#3c3836',
    userForeground: '#fbf1c7',
  },
  black: {
    primary: '#f0f0f0',
    secondary: '#e0e0e0',
    success: '#d0d0d0',
    warning: '#ececec',
    error: '#fb4934',
    background: '#000000',
    foreground: '#ffffff',
    muted: '#808080',
    border: '#404040',
    title: '#ffffff',
    userBackground: '#1a1a1a',
    userForeground: '#ffffff',
  },
  white: {
    primary: '#000000',
    secondary: '#1a1a1a',
    success: '#2e2e2e',
    warning: '#121212',
    error: '#fb4934',
    background: '#ffffff',
    foreground: '#000000',
    muted: '#606060',
    border: '#a0a0a0',
    title: '#000000',
    // User-message slab: light-grey backdrop with the standard black text so
    // the block is clearly distinguished from the white page.
    userBackground: '#efefef',
    userForeground: '#000000',
  },
  grey: {
    primary: '#d0d0d0',
    secondary: '#a0a0a0',
    success: '#b0b0b0',
    warning: '#e0e0e0',
    error: '#ffffff',
    background: '#2a2a2a',
    foreground: '#c0c0c0',
    muted: '#707070',
    border: '#505050',
    title: '#e0e0e0',
    userBackground: '#3a3a3a',
    userForeground: '#f0f0f0',
  },
};

export function getTheme(name: string): ThemeColors {
  return themes[name] ?? themes['tokyo-night']!;
}
