// ============================================
// Spotify API Types
// ============================================

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SpotifyUser {
  id: string;
  display_name: string;
  email: string;
  images: { url: string }[];
  product: string; // 'premium' | 'free' | 'open'
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: { id: string; name: string }[];
  album: {
    id: string;
    name: string;
    images: { url: string; height: number; width: number }[];
    release_date: string;
    release_date_precision: 'year' | 'month' | 'day';
  };
  duration_ms: number;
  preview_url: string | null;
}

export interface SpotifyPlaylistItem {
  added_at: string;
  track: SpotifyTrack | null; // null for episodes or deleted tracks
}

export interface SpotifyPlaylistResponse {
  items: SpotifyPlaylistItem[];
  next: string | null;
  total: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  images: { url: string }[];
  tracks: { total: number };
  owner: { display_name: string };
}

export interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      id: string;
      name: string;
      uri: string;
      artists: { name: string }[];
      album: {
        name: string;
        images: { url: string }[];
      };
    };
  };
}

// Spotify Web Playback SDK types
export interface SpotifyWebPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, callback: (data: unknown) => void) => void;
  removeListener: (event: string) => void;
  getCurrentState: () => Promise<SpotifyPlayerState | null>;
  setName: (name: string) => Promise<void>;
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (position_ms: number) => Promise<void>;
}

declare global {
  interface Window {
    Spotify: {
      Player: new (config: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyWebPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}
