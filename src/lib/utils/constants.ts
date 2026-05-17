// ============================================
// App Constants
// ============================================

export const GAME = {
  CODE_LENGTH: 4,
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  DEFAULT_WIN_TARGET: 10,
  STEAL_WINDOW_SECONDS: 10,
  MAX_TOKENS: 5,
  BUY_CARD_COST: 3,
  STEAL_COST: 1,
  MIN_TRACKS_REQUIRED: 20,
} as const;

export const SPOTIFY = {
  AUTH_URL: 'https://accounts.spotify.com/authorize',
  TOKEN_URL: 'https://accounts.spotify.com/api/token',
  API_BASE: 'https://api.spotify.com/v1',
  SCOPES: [
    'streaming',
    'user-read-email',
    'user-read-private',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-modify-playback-state',
    'user-read-playback-state',
  ].join(' '),
  SDK_URL: 'https://sdk.scdn.co/spotify-player.js',
  PLAYER_NAME: 'Hitster Game',
} as const;

export const REALTIME = {
  CHANNEL_PREFIX: 'game:',
} as const;

export const PLAYER_COLORS = [
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#14B8A6', // Teal
] as const;

export const PLAYER_EMOJIS = [
  '🎵', '🎸', '🎹', '🥁', '🎤', '🎷', '🎺', '🎻',
] as const;
