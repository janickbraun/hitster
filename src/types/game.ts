// ============================================
// Game Domain Types
// ============================================

export type GameStatus = 'lobby' | 'playing' | 'finished' | 'cancelled';
export type TrackStatus = 'in_deck' | 'active' | 'placed' | 'discarded';
export type RoundOutcome = 'correct' | 'stolen' | 'discarded';
export type StealResult = 'pending' | 'won' | 'lost';

export type RoundPhase =
  | 'waiting'        // Waiting for game to start
  | 'round_start'    // New round beginning
  | 'song_playing'   // Song is being played on host
  | 'placement'      // Active player placing the card
  | 'steal_window'   // 5-second steal window
  | 'resolution'     // Round being resolved
  | 'game_over';     // Game finished

export interface GameSession {
  id: string;
  host_user_id: string;
  game_code: string;
  status: GameStatus;
  spotify_playlist_id: string | null;
  spotify_playlist_name: string | null;
  current_round: number;
  current_player_id: string | null;
  current_track_index: number;
  steal_window_start_at: string | null;
  win_target: number;
  max_players: number;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  session_id: string;
  display_name: string;
  session_token: string;
  tokens: number;
  turn_order: number;
  is_connected: boolean;
  created_at: string;
  hand_raised_at?: string | null;
}

export interface GameTrack {
  id: string;
  session_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  album_image_url: string | null;
  release_year: number;
  spotify_uri: string;
  deck_position: number;
  status: TrackStatus;
  played_at: string | null;
}

export interface PlayerTimeline {
  id: string;
  player_id: string;
  track_id: string;
  session_id: string;
  position: number;
  placed_at: string;
}

export interface StealAttempt {
  id: string;
  session_id: string;
  track_id: string;
  stealing_player_id: string;
  target_player_id: string;
  proposed_position: number;
  tokens_spent: number;
  result: StealResult;
  created_at: string;
}

export interface RoundHistory {
  id: string;
  session_id: string;
  round_number: number;
  track_id: string;
  active_player_id: string;
  active_player_position: number | null;
  was_correct: boolean | null;
  winner_player_id: string | null;
  title_token_player_id: string | null;
  outcome: RoundOutcome | null;
  resolved_at: string;
}

// ============================================
// Timeline Card (track + position for display)
// ============================================
export interface TimelineCard {
  track: GameTrack;
  position: number;
  isRevealed: boolean;
}

// ============================================
// Broadcast Event Types
// ============================================
export type BroadcastEvent =
  | { type: 'game:started'; payload: { session_id: string } }
  | { type: 'round:start'; payload: { round: number; track_id: string; active_player_id: string; active_player_name: string } }
  | { type: 'song:playing'; payload: { track_id: string; spotify_uri: string } }
  | { type: 'song:stopped'; payload: Record<string, never> }
  | { type: 'placement:confirmed'; payload: { player_id: string; position: number; track_id: string } }
  | { type: 'steal:window_open'; payload: { start_at: string; track_id: string; active_player_id: string } }
  | { type: 'steal:attempt'; payload: { stealing_player_id: string; proposed_position: number } }
  | { type: 'round:resolved'; payload: { outcome: RoundOutcome; correct_year: number; winner_id: string | null; track: GameTrack } }
  | { type: 'token:awarded'; payload: { player_id: string; new_count: number } }
  | { type: 'token:spent'; payload: { player_id: string; new_count: number } }
  | { type: 'game:finished'; payload: { winner_id: string; final_scores: { player_id: string; name: string; cards: number }[] } }
  | { type: 'player:joined'; payload: Player }
  | { type: 'player:disconnected'; payload: { player_id: string } }
  | { type: 'player:hand_changed'; payload: { player_id: string; hand_raised_at: string | null } };

// ============================================
// Game State (client-side aggregate)
// ============================================
export interface GameState {
  session: GameSession | null;
  players: Player[];
  currentTrack: GameTrack | null;
  roundPhase: RoundPhase;
  myTimeline: TimelineCard[];
  allTimelines: Record<string, TimelineCard[]>;
  stealAttempts: StealAttempt[];
  activeTrackId: string | null;
}
