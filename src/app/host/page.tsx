'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameState } from '@/hooks/useGameState';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import { createClient } from '@/lib/supabase/client';
import { generateGameCode } from '@/lib/utils/game-code';
import { GAME, PLAYER_COLORS, PLAYER_EMOJIS } from '@/lib/utils/constants';
import { QRCodeSVG } from 'qrcode.react';
import type { GameTrack, Player } from '@/types/game';

type HostPhase = 'setup' | 'lobby' | 'playing' | 'finished';

export default function HostPage() {
  const [phase, setPhase] = useState<HostPhase>('setup');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistInfo, setPlaylistInfo] = useState<{ name: string; total_tracks: number; image_url?: string } | null>(null);
  const [tracks, setTracks] = useState<Array<{ spotify_track_id: string; track_name: string; artist_name: string; album_name: string; album_image_url: string | null; release_year: number; spotify_uri: string }>>([]);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentRoundTrack, setCurrentRoundTrack] = useState<GameTrack | null>(null);
  const [showReveal, setShowReveal] = useState(false);

  const gameState = useGameState(gameCode);
  const spotify = useSpotifyPlayer();
  const supabase = createClient();

  // Fetch playlist
  const handleFetchPlaylist = async () => {
    setIsLoadingPlaylist(true);
    setError(null);
    try {
      const res = await fetch('/api/spotify/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlaylistInfo(data.playlist);
      setTracks(data.tracks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    } finally {
      setIsLoadingPlaylist(false);
    }
  };

  // Create game session
  const handleCreateGame = async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const code = generateGameCode();

      // Create session
      const { data: session, error: sessionErr } = await supabase
        .from('game_sessions')
        .insert({
          host_user_id: user.id,
          game_code: code,
          spotify_playlist_id: playlistInfo?.name,
          spotify_playlist_name: playlistInfo?.name,
        })
        .select()
        .single();

      if (sessionErr) throw sessionErr;

      // Shuffle and insert tracks
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      const trackRows = shuffled.map((t, i) => ({
        session_id: session.id,
        spotify_track_id: t.spotify_track_id,
        track_name: t.track_name,
        artist_name: t.artist_name,
        album_name: t.album_name,
        album_image_url: t.album_image_url,
        release_year: t.release_year,
        spotify_uri: t.spotify_uri,
        deck_position: i,
      }));

      const { error: tracksErr } = await supabase.from('game_tracks').insert(trackRows);
      if (tracksErr) throw tracksErr;

      setGameCode(code);
      setSessionId(session.id);
      setPhase('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    }
  };

  // Start the game
  const handleStartGame = async () => {
    if (!sessionId || gameState.players.length < GAME.MIN_PLAYERS) return;

    await supabase
      .from('game_sessions')
      .update({ status: 'playing' })
      .eq('id', sessionId);

    gameState.broadcast({ type: 'game:started', payload: { session_id: sessionId } });
    setPhase('playing');
    handleNextRound();
  };

  // Advance to next round
  const handleNextRound = async () => {
    if (!sessionId) return;
    setShowReveal(false);

    const { data } = await supabase.rpc('advance_turn', { p_session_id: sessionId });
    if (!data) return;

    const result = data as { status: string; round?: number; player_id?: string; player_name?: string; track_id?: string; spotify_uri?: string };

    if (result.status === 'finished') {
      setPhase('finished');
      const scores = gameState.players.map((p) => ({
        player_id: p.id,
        name: p.display_name,
        cards: (gameState.allTimelines[p.id] || []).length,
      }));
      const winner = scores.sort((a, b) => b.cards - a.cards)[0];
      gameState.broadcast({ type: 'game:finished', payload: { winner_id: winner.player_id, final_scores: scores } });
      return;
    }

    // Get the track details
    const { data: track } = await supabase
      .from('game_tracks')
      .select('*')
      .eq('id', result.track_id)
      .single();

    if (track) {
      setCurrentRoundTrack(track);
      gameState.broadcast({
        type: 'round:start',
        payload: { round: result.round!, track_id: track.id, active_player_id: result.player_id!, active_player_name: result.player_name! },
      });

      // Auto-play the song
      if (spotify.isReady) {
        try { await spotify.play(track.spotify_uri); } catch {}
        gameState.broadcast({ type: 'song:playing', payload: { track_id: track.id, spotify_uri: track.spotify_uri } });
      }
    }
  };

  // Stop music and move to placement
  const handleStopMusic = async () => {
    await spotify.pause();
    gameState.broadcast({ type: 'song:stopped', payload: {} });
  };

  // Open steal window
  const handleOpenStealWindow = () => {
    if (!currentRoundTrack || !sessionId) return;
    const now = new Date().toISOString();
    supabase.from('game_sessions').update({ steal_window_start_at: now }).eq('id', sessionId);
    gameState.broadcast({
      type: 'steal:window_open',
      payload: {
        start_at: now,
        track_id: currentRoundTrack.id,
        active_player_id: gameState.session?.current_player_id || '',
      },
    });
  };

  // Resolve round
  const handleResolveRound = (wasCorrect: boolean) => {
    if (!currentRoundTrack) return;
    setShowReveal(true);
    gameState.broadcast({
      type: 'round:resolved',
      payload: {
        outcome: wasCorrect ? 'correct' : 'discarded',
        correct_year: currentRoundTrack.release_year,
        winner_id: wasCorrect ? gameState.session?.current_player_id || null : null,
        track: currentRoundTrack,
      },
    });
  };

  // Award token
  const handleAwardToken = async (player: Player) => {
    if (!sessionId) return;
    const { data } = await supabase.rpc('award_token', {
      p_player_id: player.id,
      p_session_id: sessionId,
    });
    if (data !== null) {
      gameState.broadcast({ type: 'token:awarded', payload: { player_id: player.id, new_count: data as number } });
    }
  };

  // ========== RENDER ==========

  if (phase === 'setup') {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-lg space-y-6">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl font-bold gradient-text mb-2">Game Setup</h1>
            <p className="text-text-secondary">Paste a Spotify playlist to get started</p>
            {spotify.isReady && <span className="inline-flex items-center gap-1.5 text-success text-sm mt-2"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Spotify Connected</span>}
            {spotify.error && <p className="text-error text-sm mt-2">{spotify.error}</p>}
          </div>

          <div className="glass rounded-2xl p-6 space-y-4">
            <label htmlFor="playlist-url" className="text-sm font-medium text-text-secondary">Playlist URL or ID</label>
            <div className="flex gap-3">
              <input id="playlist-url" type="text" value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/..." className="input-field flex-1" />
              <button onClick={handleFetchPlaylist} disabled={!playlistUrl || isLoadingPlaylist} className="btn-primary px-5 shrink-0">
                {isLoadingPlaylist ? '...' : 'Load'}
              </button>
            </div>

            {error && <p className="text-error text-sm">{error}</p>}

            {playlistInfo && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4 p-4 bg-surface-hover rounded-xl">
                {playlistInfo.image_url && <img src={playlistInfo.image_url} alt="" className="w-16 h-16 rounded-lg object-cover" />}
                <div>
                  <p className="font-semibold">{playlistInfo.name}</p>
                  <p className="text-text-muted text-sm">{playlistInfo.total_tracks} tracks loaded</p>
                </div>
              </motion.div>
            )}
          </div>

          {playlistInfo && tracks.length >= GAME.MIN_TRACKS_REQUIRED && (
            <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={handleCreateGame} className="btn-primary w-full text-lg">
              Create Game
            </motion.button>
          )}

          {playlistInfo && tracks.length < GAME.MIN_TRACKS_REQUIRED && (
            <p className="text-warning text-sm text-center">Need at least {GAME.MIN_TRACKS_REQUIRED} tracks (found {tracks.length})</p>
          )}
        </motion.div>
      </main>
    );
  }

  if (phase === 'lobby') {
    const joinUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/play/${gameCode}`;
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-4xl space-y-8 text-center">
          <div>
            <p className="text-text-secondary text-sm mb-2 uppercase tracking-widest">Game Code</p>
            <h1 className="game-code gradient-text">{gameCode}</h1>
            <p className="text-text-muted text-sm mt-2">Share this code or scan the QR to join</p>
          </div>

          <div className="flex flex-col md:flex-row gap-6 items-stretch justify-center w-full">
            {/* QR Code Card */}
            <div className="glass rounded-2xl p-6 flex flex-col items-center justify-center space-y-4 w-full md:w-80 shrink-0">
              <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center justify-center">
                <QRCodeSVG
                  value={joinUrl}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
              </div>
              <div className="text-center">
                <p className="text-xs text-text-muted">Or join directly at:</p>
                <p className="text-xs font-mono text-primary mt-1 select-all break-all">{joinUrl}</p>
              </div>
            </div>

            {/* Players List Card */}
            <div className="glass rounded-2xl p-6 flex-1 flex flex-col justify-between">
              <div>
                <h2 className="font-display text-xl font-bold mb-4 text-left border-b border-white/10 pb-2 flex justify-between items-center">
                  <span>Players</span>
                  <span className="text-sm font-normal text-text-secondary">{gameState.players.length}/{GAME.MAX_PLAYERS}</span>
                </h2>
                {gameState.players.length === 0 ? (
                  <p className="text-text-muted py-12">Waiting for players to join...</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-1">
                    {gameState.players.map((player, i) => (
                      <motion.div key={player.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-xl p-4 text-center">
                        <div className="text-3xl mb-1">{PLAYER_EMOJIS[i % PLAYER_EMOJIS.length]}</div>
                        <p className="font-semibold text-sm truncate" style={{ color: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>{player.display_name}</p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/10">
                <button onClick={handleStartGame} disabled={gameState.players.length < GAME.MIN_PLAYERS} className="btn-primary text-lg w-full py-3">
                  {gameState.players.length < GAME.MIN_PLAYERS ? `Need ${GAME.MIN_PLAYERS - gameState.players.length} more player(s)` : 'Start Game'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    );
  }

  if (phase === 'playing') {
    const activePlayer = gameState.players.find((p) => p.id === gameState.session?.current_player_id);
    const activeIdx = activePlayer ? gameState.players.indexOf(activePlayer) : 0;

    return (
      <main className="min-h-dvh flex flex-col px-6 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider">Round {gameState.session?.current_round || 0}</p>
            <p className="font-display text-lg font-bold gradient-text">HITSTER</p>
          </div>
          <div className="text-right">
            <p className="text-text-muted text-xs">Code</p>
            <p className="font-display font-bold text-primary">{gameCode}</p>
          </div>
        </div>

        {/* Active player indicator */}
        {activePlayer && (
          <div className="glass rounded-xl p-4 mb-4 flex items-center gap-3">
            <div className="text-2xl">{PLAYER_EMOJIS[activeIdx % PLAYER_EMOJIS.length]}</div>
            <div>
              <p className="text-sm text-text-muted">Now playing</p>
              <p className="font-display font-bold text-lg" style={{ color: PLAYER_COLORS[activeIdx % PLAYER_COLORS.length] }}>{activePlayer.display_name}</p>
            </div>
          </div>
        )}

        {/* Song / Controls */}
        <div className="glass rounded-2xl p-6 mb-4 flex-1">
          {currentRoundTrack ? (
            <div className="text-center space-y-4">
              {currentRoundTrack.album_image_url && (
                <img src={currentRoundTrack.album_image_url} alt="" className="w-48 h-48 rounded-xl mx-auto shadow-lg shadow-primary/20" />
              )}
              {showReveal ? (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                  <p className="font-display text-3xl font-bold gradient-text">{currentRoundTrack.release_year}</p>
                  <p className="text-lg font-semibold mt-2">{currentRoundTrack.track_name}</p>
                  <p className="text-text-secondary">{currentRoundTrack.artist_name}</p>
                </motion.div>
              ) : (
                <div>
                  <p className="text-text-muted">🎵 Now Playing...</p>
                  <p className="text-text-muted text-sm mt-1">Click reveal when ready</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 justify-center mt-4">
                {spotify.isPlaying ? (
                  <button onClick={handleStopMusic} className="btn-secondary text-sm">⏸ Stop Music</button>
                ) : (
                  <button onClick={() => spotify.play(currentRoundTrack.spotify_uri)} className="btn-secondary text-sm">▶ Play Again</button>
                )}
                {!showReveal && <button onClick={() => handleResolveRound(true)} className="btn-primary text-sm">✓ Correct</button>}
                {!showReveal && <button onClick={() => handleResolveRound(false)} className="btn-secondary text-sm text-error">✗ Wrong</button>}
                {!showReveal && <button onClick={handleOpenStealWindow} className="btn-secondary text-sm text-warning">⏱ Steal Window</button>}
                {showReveal && <button onClick={handleNextRound} className="btn-primary text-sm">Next Round →</button>}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-text-muted">Preparing round...</div>
          )}
        </div>

        {/* Players bar */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {gameState.players.map((player, i) => (
            <div key={player.id} className="glass rounded-xl p-3 min-w-[120px] shrink-0 text-center">
              <p className="text-lg">{PLAYER_EMOJIS[i % PLAYER_EMOJIS.length]}</p>
              <p className="text-xs font-semibold truncate" style={{ color: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>{player.display_name}</p>
              <p className="text-xs text-text-muted mt-1">{player.tokens} 🪙 · {(gameState.allTimelines[player.id] || []).length} cards</p>
              <button onClick={() => handleAwardToken(player)} className="text-xs text-accent-light mt-1 hover:underline">+1 Token</button>
            </div>
          ))}
        </div>
      </main>
    );
  }

  // Finished
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
        <h1 className="font-display text-5xl font-extrabold gradient-text mb-4">Game Over!</h1>
        <p className="text-text-secondary text-lg mb-8">Thanks for playing HITSTER</p>
        <a href="/" className="btn-primary">Play Again</a>
      </motion.div>
    </main>
  );
}
