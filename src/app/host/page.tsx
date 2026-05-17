'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameState } from '@/hooks/useGameState';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import { useCountdown } from '@/hooks/useCountdown';
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
  const [hasPlayedCurrentTrack, setHasPlayedCurrentTrack] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown();
  const hasStartedCountdownRef = useRef(false);
  const hasTriggeredAutoRevealRef = useRef(false);
  const hasOpenedStealWindowRef = useRef(false);
  const hasTimerRunRef = useRef(false);

  const getPlayerCardCount = (playerId: string) => {
    const timeline = gameState.allTimelines[playerId] || [];
    const verifiedTimeline = timeline.filter(
      (card) => !currentRoundTrack || card.track.id !== currentRoundTrack.id
    );
    return Math.max(1, verifiedTimeline.length);
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  const gameState = useGameState(gameCode, null, true);
  const spotify = useSpotifyPlayer();
  const supabase = createClient();

  // Track whether the timer has started ticking in this steal window
  if (gameState.roundPhase === 'steal_window' && countdown.timeLeft > 0) {
    hasTimerRunRef.current = true;
  }

  // Restore game session from local storage on mount
  useEffect(() => {
    const restoreSession = async () => {
      const savedCode = localStorage.getItem('hitster_host_game_code');
      const savedSessionId = localStorage.getItem('hitster_host_session_id');

      if (!savedCode || !savedSessionId) return;

      try {
        const { data: session, error: sessionErr } = await supabase
          .from('game_sessions')
          .select('*')
          .eq('id', savedSessionId)
          .single();

        if (sessionErr || !session) {
          localStorage.removeItem('hitster_host_game_code');
          localStorage.removeItem('hitster_host_session_id');
          return;
        }

        if (session.status === 'finished' || session.status === 'cancelled') {
          localStorage.removeItem('hitster_host_game_code');
          localStorage.removeItem('hitster_host_session_id');
          return;
        }

        setGameCode(session.game_code);
        setSessionId(session.id);
        setPhase(session.status === 'playing' ? 'playing' : 'lobby');

        // If playing, query current track using the session's current_track_index
        if (session.status === 'playing') {
          const { data: activeTrack } = await supabase
            .from('game_tracks')
            .select('*')
            .eq('session_id', session.id)
            .eq('deck_position', session.current_track_index)
            .maybeSingle();

          if (activeTrack) {
            setCurrentRoundTrack(activeTrack);
          }
        }
      } catch (err) {
        console.error('Failed to restore game session:', err);
      }
    };

    restoreSession();
  }, [supabase]);

  // Auto-skip turn if active player is disconnected
  useEffect(() => {
    if (phase !== 'playing' || !gameState.session?.current_player_id) return;

    const activePlayer = gameState.players.find((p) => p.id === gameState.session?.current_player_id);
    if (!activePlayer || activePlayer.is_connected) return;

    // Active player is disconnected! Set up a timer to auto-skip
    const timer = setTimeout(() => {
      console.log(`Auto-skipping turn for disconnected player: ${activePlayer.display_name}`);
      handleNextRound();
    }, 10000); // 10 seconds timeout

    return () => clearTimeout(timer);
  }, [phase, gameState.session?.current_player_id, gameState.players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the countdown when we transition to steal_window phase
  useEffect(() => {
    if (gameState.roundPhase === 'steal_window') {
      const startAt = gameState.session?.steal_window_start_at;
      countdown.start(GAME.STEAL_WINDOW_SECONDS * 1000, startAt || undefined);
      hasStartedCountdownRef.current = true;
    } else {
      countdown.stop();
      hasStartedCountdownRef.current = false;
      hasTriggeredAutoRevealRef.current = false;
      hasTimerRunRef.current = false;
    }
  }, [gameState.roundPhase, gameState.session?.steal_window_start_at]);

  // Synchronize steal window start time on the database when entering steal_window phase
  useEffect(() => {
    if (gameState.roundPhase === 'steal_window' && !hasOpenedStealWindowRef.current) {
      hasOpenedStealWindowRef.current = true;
      handleOpenStealWindow();
    } else if (gameState.roundPhase !== 'steal_window') {
      hasOpenedStealWindowRef.current = false;
    }
  }, [gameState.roundPhase]);

  // Auto-reveal song after 10s if no hands are raised
  useEffect(() => {
    if (
      gameState.roundPhase === 'steal_window' &&
      hasStartedCountdownRef.current &&
      hasTimerRunRef.current &&
      countdown.timeLeft <= 0 &&
      !showReveal &&
      !hasTriggeredAutoRevealRef.current
    ) {
      hasTriggeredAutoRevealRef.current = true;
      const hasRaisedHand = gameState.players.some((p) => !!p.hand_raised_at);
      if (!hasRaisedHand) {
        console.log('No hands raised, automatically revealing round details...');
        handleRevealRound();
      } else {
        console.log('Minimum 1 hand raised, waiting for manual reveal by host...');
      }
    }
  }, [gameState.roundPhase, countdown.timeLeft, showReveal, gameState.players]);

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

      localStorage.setItem('hitster_host_game_code', code);
      localStorage.setItem('hitster_host_session_id', session.id);

      setGameCode(code);
      setSessionId(session.id);
      setPhase('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    }
  };

  // Quit the game and clean up local storage
  const handleQuitGame = async () => {
    if (confirm('Are you sure you want to quit the current game?')) {
      if (sessionId) {
        await supabase
          .from('game_sessions')
          .update({ status: 'cancelled' })
          .eq('id', sessionId);
      }
      localStorage.removeItem('hitster_host_game_code');
      localStorage.removeItem('hitster_host_session_id');
      setGameCode(null);
      setSessionId(null);
      setPhase('setup');
      setCurrentRoundTrack(null);
    }
  };

  // Start the game
  const handleStartGame = async () => {
    if (!sessionId || gameState.players.length < GAME.MIN_PLAYERS) return;

    setError(null);
    try {
      // Fetch the first N tracks from the deck for starting cards
      const { data: startingTracks, error: startingErr } = await supabase
        .from('game_tracks')
        .select('*')
        .eq('session_id', sessionId)
        .order('deck_position', { ascending: true })
        .limit(gameState.players.length);

      if (startingErr || !startingTracks || startingTracks.length < gameState.players.length) {
        throw new Error('Failed to draw starting tracks for players');
      }

      // Prepare timeline cards for each player at position 0
      const timelineInserts = gameState.players.map((player, idx) => ({
        player_id: player.id,
        track_id: startingTracks[idx].id,
        session_id: sessionId,
        position: 0,
      }));

      // Insert starting cards into players' timelines
      const { error: timelinesErr } = await supabase
        .from('player_timelines')
        .insert(timelineInserts);

      if (timelinesErr) throw timelinesErr;

      // Update these starting tracks' statuses to 'placed' so they are skipped in deck
      const startingTrackIds = startingTracks.map((t) => t.id);
      const { error: tracksErr } = await supabase
        .from('game_tracks')
        .update({ status: 'placed' })
        .in('id', startingTrackIds);

      if (tracksErr) throw tracksErr;

      // Update game session status to playing
      await supabase
        .from('game_sessions')
        .update({ status: 'playing' })
        .eq('id', sessionId);

      gameState.broadcast({ type: 'game:started', payload: { session_id: sessionId } });
      setPhase('playing');
      await handleNextRound();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    }
  };

  // Advance to next round
  const handleNextRound = async () => {
    if (!sessionId) return;
    setHasPlayedCurrentTrack(false);
    setShowReveal(false);

    // Check if any player has won (reached win target, default 10 cards)
    const winTarget = gameState.session?.win_target || 10;
    const scores = gameState.players.map((p) => ({
      player_id: p.id,
      name: p.display_name,
      cards: getPlayerCardCount(p.id),
    }));
    const winner = scores.find((p) => p.cards >= winTarget);

    if (winner) {
      await supabase
        .from('game_sessions')
        .update({ status: 'finished' })
        .eq('id', sessionId);

      setPhase('finished');
      localStorage.removeItem('hitster_host_game_code');
      localStorage.removeItem('hitster_host_session_id');

      gameState.broadcast({
        type: 'game:finished',
        payload: { winner_id: winner.player_id, final_scores: scores },
      });
      return;
    }

    const { data } = await supabase.rpc('advance_turn', { p_session_id: sessionId });
    if (!data) return;

    const result = data as { status: string; round?: number; player_id?: string; player_name?: string; track_id?: string; spotify_uri?: string };

    if (result.status === 'finished') {
      setPhase('finished');
      localStorage.removeItem('hitster_host_game_code');
      localStorage.removeItem('hitster_host_session_id');
      const finalScores = gameState.players.map((p) => ({
        player_id: p.id,
        name: p.display_name,
        cards: getPlayerCardCount(p.id),
      }));
      const topWinner = finalScores.sort((a, b) => b.cards - a.cards)[0];
      gameState.broadcast({ type: 'game:finished', payload: { winner_id: topWinner.player_id, final_scores: finalScores } });
      return;
    }

    // Get the track details
    const { data: track } = await supabase
      .from('game_tracks')
      .select('*')
      .eq('id', result.track_id)
      .single();

    if (track) {
      // Reset all raised hands for the session in the database
      await supabase
        .from('players')
        .update({ hand_raised_at: null })
        .eq('session_id', sessionId);

      setCurrentRoundTrack(track);
      gameState.broadcast({
        type: 'round:start',
        payload: { round: result.round!, track_id: track.id, active_player_id: result.player_id!, active_player_name: result.player_name! },
      });

      // Auto-play the song
      if (spotify.isReady) {
        try {
          await spotify.play(track.spotify_uri);
          setHasPlayedCurrentTrack(true);
        } catch {}
        gameState.broadcast({ type: 'song:playing', payload: { track_id: track.id, spotify_uri: track.spotify_uri } });
      }
    }
  };

  // Stop music and move to placement
  const handleStopMusic = async () => {
    await spotify.pause();
    gameState.broadcast({ type: 'song:stopped', payload: {} });
  };

  // Play or resume the round's track and broadcast playing
  const handlePlayMusic = async () => {
    if (!currentRoundTrack) return;
    const isCurrentTrackLoaded = hasPlayedCurrentTrack || spotify.currentState?.track_window?.current_track?.uri === currentRoundTrack.spotify_uri;
    
    if (isCurrentTrackLoaded) {
      await spotify.resume();
      setHasPlayedCurrentTrack(true);
    } else {
      await spotify.play(currentRoundTrack.spotify_uri);
      setHasPlayedCurrentTrack(true);
    }
    
    gameState.broadcast({ type: 'song:playing', payload: { track_id: currentRoundTrack.id, spotify_uri: currentRoundTrack.spotify_uri } });
  };

  // Open steal window
  const handleOpenStealWindow = async () => {
    if (!currentRoundTrack || !sessionId) return;
    const now = new Date().toISOString();
    
    // Update track status in the database to 'placed' (as the Host has permission to do so under RLS)
    await supabase.from('game_tracks').update({ status: 'placed' }).eq('id', currentRoundTrack.id);
    
    await supabase.from('game_sessions').update({ steal_window_start_at: now }).eq('id', sessionId);
    gameState.broadcast({
      type: 'steal:window_open',
      payload: {
        start_at: now,
        track_id: currentRoundTrack.id,
        active_player_id: gameState.session?.current_player_id || '',
      },
    });
  };

  // Reveal round details and resolve
  const handleRevealRound = async () => {
    if (!currentRoundTrack || !sessionId || !gameState.session?.current_player_id) return;
    setShowReveal(true);

    // Clear steal window start time on database so late/reconnecting players don't see the timer active
    await supabase
      .from('game_sessions')
      .update({ steal_window_start_at: null })
      .eq('id', sessionId);

    const activePlayerId = gameState.session.current_player_id;
    const activePlayerTimeline = gameState.allTimelines[activePlayerId] || [];
    
    // Original timeline of active player (excluding the mystery card being guessed)
    const originalTimeline = activePlayerTimeline.filter(
      (card) => card.track.id !== currentRoundTrack.id
    );

    // 1. Calculate correct chronological position in original timeline
    let correctPosition = 0;
    for (let i = 0; i < originalTimeline.length; i++) {
      if (currentRoundTrack.release_year >= originalTimeline[i].track.release_year) {
        correctPosition = i + 1;
      }
    }

    // 2. Find active player's guess position
    const activePlayerGuessCard = activePlayerTimeline.find(
      (card) => card.track.id === currentRoundTrack.id
    );
    const activePlayerGuessPosition = activePlayerGuessCard ? activePlayerGuessCard.position : null;

    let outcome: 'correct' | 'stolen' | 'discarded' = 'discarded';
    let winnerId: string | null = null;

    if (activePlayerGuessPosition === correctPosition) {
      // Active player is correct!
      outcome = 'correct';
      winnerId = activePlayerId;
      
      // Update track status to placed
      await supabase
        .from('game_tracks')
        .update({ status: 'placed' })
        .eq('id', currentRoundTrack.id);

      // Query database for all steal attempts for this track
      const { data: steals } = await supabase
        .from('steal_attempts')
        .select('*')
        .eq('session_id', sessionId)
        .eq('track_id', currentRoundTrack.id);

      // Mark all steal attempts for this round as lost
      await supabase
        .from('steal_attempts')
        .update({ result: 'lost' })
        .eq('session_id', sessionId)
        .eq('track_id', currentRoundTrack.id);

      // Deduct 1 token from each unsuccessful stealer
      if (steals) {
        for (const steal of steals) {
          const player = gameState.players.find(p => p.id === steal.stealing_player_id);
          if (player) {
            await supabase
              .from('players')
              .update({ tokens: Math.max(0, player.tokens - 1) })
              .eq('id', steal.stealing_player_id);
          }
        }
      }
    } else {
      // Active player is wrong!
      // Delete incorrect card from active player's timeline
      await supabase.rpc('delete_timeline_card', {
        p_player_id: activePlayerId,
        p_session_id: sessionId,
        p_track_id: currentRoundTrack.id,
      });

      // Query database for steal attempts for this track
      const { data: steals } = await supabase
        .from('steal_attempts')
        .select('*')
        .eq('session_id', sessionId)
        .eq('track_id', currentRoundTrack.id);

      const winningSteal = steals?.find((s) => s.proposed_position === correctPosition);

      if (winningSteal) {
        // A stealer got it right!
        outcome = 'stolen';
        winnerId = winningSteal.stealing_player_id;

        // Update winning steal attempt to won
        await supabase
          .from('steal_attempts')
          .update({ result: 'won' })
          .eq('id', winningSteal.id);

        // Mark other steal attempts as lost & deduct their tokens
        if (steals) {
          const losingSteals = steals.filter((s) => s.id !== winningSteal.id);
          const losingStealIds = losingSteals.map((s) => s.id);
          
          if (losingStealIds.length > 0) {
            await supabase
              .from('steal_attempts')
              .update({ result: 'lost' })
              .in('id', losingStealIds);
          }

          // Deduct 1 token from all losing stealers
          for (const steal of losingSteals) {
            const player = gameState.players.find(p => p.id === steal.stealing_player_id);
            if (player) {
              await supabase
                .from('players')
                .update({ tokens: Math.max(0, player.tokens - 1) })
                .eq('id', steal.stealing_player_id);
            }
          }
        }

        // Award card to winning stealer (their tokens remain unchanged!)
        const stealerTimeline = gameState.allTimelines[winningSteal.stealing_player_id] || [];
        const nextPosition = stealerTimeline.length;

        await supabase.from('player_timelines').insert({
          player_id: winningSteal.stealing_player_id,
          track_id: currentRoundTrack.id,
          session_id: sessionId,
          position: nextPosition,
        });

        // Update track status to placed
        await supabase
          .from('game_tracks')
          .update({ status: 'placed' })
          .eq('id', currentRoundTrack.id);
      } else {
        // Nobody got it right!
        outcome = 'discarded';
        
        // Update track status to discarded
        await supabase
          .from('game_tracks')
          .update({ status: 'discarded' })
          .eq('id', currentRoundTrack.id);

        // Mark all steal attempts as lost
        await supabase
          .from('steal_attempts')
          .update({ result: 'lost' })
          .eq('session_id', sessionId)
          .eq('track_id', currentRoundTrack.id);

        // Deduct 1 token from all stealers (since nobody won!)
        if (steals) {
          for (const steal of steals) {
            const player = gameState.players.find(p => p.id === steal.stealing_player_id);
            if (player) {
              await supabase
                .from('players')
                .update({ tokens: Math.max(0, player.tokens - 1) })
                .eq('id', steal.stealing_player_id);
            }
          }
        }
      }
    }

    // 3. Save to round_history
    await supabase.from('round_history').insert({
      session_id: sessionId,
      round_number: gameState.session?.current_round || 1,
      track_id: currentRoundTrack.id,
      active_player_id: activePlayerId,
      active_player_position: activePlayerGuessPosition,
      was_correct: activePlayerGuessPosition === correctPosition,
      winner_player_id: winnerId,
      outcome: outcome,
    });

    // 4. Broadcast resolution
    gameState.broadcast({
      type: 'round:resolved',
      payload: {
        outcome: outcome,
        correct_year: currentRoundTrack.release_year,
        winner_id: winnerId,
        track: currentRoundTrack,
      },
    });

    // Hydrate host timelines immediately
    gameState.fetchAllTimelines();
  };

  // Award token (manually add a token to player's balance, capped at 5)
  const handleAwardToken = async (player: Player) => {
    if (player.tokens >= 5) return;

    const newTokens = Math.min(5, player.tokens + 1);
    const { error } = await supabase
      .from('players')
      .update({ tokens: newTokens })
      .eq('id', player.id);

    if (error) return;

    // Broadcast token update so player UI updates instantly
    gameState.broadcast({
      type: 'token:awarded',
      payload: { player_id: player.id, new_count: newTokens },
    });

    // Refresh local player list on the host
    gameState.fetchPlayers();
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

          <div className="glass rounded-2xl p-6 space-y-4" suppressHydrationWarning>
            <label htmlFor="playlist-url" className="text-sm font-medium text-text-secondary">Playlist URL or ID</label>
            <div className="flex gap-3">
              <input id="playlist-url" type="text" value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/..." className="input-field flex-1" suppressHydrationWarning />
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
              <div className="text-center w-full">
                <p className="text-xs text-text-muted">Or join directly at:</p>
                <p className="text-xs font-mono text-primary mt-1 mb-2 select-all break-all">{joinUrl}</p>
                <button
                  onClick={() => handleCopyLink(joinUrl)}
                  className="w-full btn-secondary text-xs py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-surface-hover hover:text-white transition-all active:scale-[0.98] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <span className="text-success text-sm">✓</span>
                      <span className="text-success font-medium">Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
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
                      <motion.div 
                        key={player.id} 
                        initial={{ opacity: 0, scale: 0.8 }} 
                        animate={{ opacity: 1, scale: 1 }} 
                        className={`glass rounded-xl p-4 text-center transition-all ${!player.is_connected ? 'opacity-50 border-error/20 bg-error/5' : ''}`}
                      >
                        <div className="text-3xl mb-1">{PLAYER_EMOJIS[i % PLAYER_EMOJIS.length]}</div>
                        <p className="font-semibold text-sm truncate" style={{ color: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>{player.display_name}</p>
                        {!player.is_connected && <p className="text-[10px] text-error font-medium mt-1">Offline</p>}
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 flex gap-3">
                <button onClick={handleQuitGame} className="btn-secondary py-3 px-6 text-error border-error/20 hover:bg-error/10">
                  Quit Game
                </button>
                <button onClick={handleStartGame} disabled={gameState.players.length < GAME.MIN_PLAYERS} className="btn-primary text-lg flex-1 py-3">
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
    const activePlayerTimeline = activePlayer ? (gameState.allTimelines[activePlayer.id] || []) : [];
    const originalTimeline = activePlayerTimeline.filter(
      (card) => card.track.id !== currentRoundTrack?.id
    );

    return (
      <main className="h-screen flex flex-col justify-between px-6 py-3 select-none overflow-hidden max-w-7xl mx-auto w-full">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider">Round {gameState.session?.current_round || 0}</p>
            <p className="font-display text-base font-bold gradient-text">HITSTER</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-text-muted text-[10px]">Code</p>
              <p className="font-display font-bold text-primary text-sm">{gameCode}</p>
            </div>
            <button onClick={handleQuitGame} className="btn-secondary py-1 px-2.5 text-[10px] text-error border-error/20 hover:bg-error/10">
              Quit Game
            </button>
          </div>
        </div>

        {/* Steal Window & Hands Raised Status Banner for Host */}
        {gameState.roundPhase === 'steal_window' && (
          <div className="glass rounded-xl p-2.5 mb-2 border border-warning/30 bg-warning/5 text-center relative overflow-hidden animate-fade-in shrink-0">
            <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-warning to-error transition-all duration-75" style={{ width: `${countdown.progress * 100}%` }} />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-left">
                <p className="font-display font-black text-warning flex items-center gap-1.5 uppercase text-xs">
                  <span className="animate-pulse">⚡</span> Steal Window Active
                </p>
                <p className="text-[10px] text-text-secondary mt-0.5">
                  {gameState.players.some(p => !!p.hand_raised_at) 
                    ? '✋ Hand raised! Host must reveal manually.' 
                    : '⏳ No hands raised. Will reveal automatically when timer ends.'}
                </p>
              </div>
              <div className="flex items-center gap-2 justify-center sm:justify-end">
                <span className="text-[10px] font-bold bg-warning/10 border border-warning/20 px-2 py-0.5 rounded text-warning-light font-mono">
                  ⏱️ {Math.ceil(countdown.timeLeft / 1000)}s remaining
                </span>
                {!showReveal && (
                  <button onClick={handleRevealRound} className="btn-primary py-0.5 px-2 text-[10px]">
                    👁 Reveal Now
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Active player timeline cards - now also serves as the Active Turn indicator */}
        {activePlayer && (
          <div 
            className={`glass rounded-xl p-3 mb-2 border transition-all duration-300 shrink-0 ${
              !activePlayer.is_connected ? 'border-error/40 bg-error/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'bg-surface/30'
            }`}
            style={activePlayer.is_connected ? {
              borderColor: `${PLAYER_COLORS[activeIdx % PLAYER_COLORS.length]}33`,
              boxShadow: `0 0 15px ${PLAYER_COLORS[activeIdx % PLAYER_COLORS.length]}10`
            } : undefined}
          >
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span 
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      !activePlayer.is_connected ? 'bg-error' : ''
                    }`}
                    style={activePlayer.is_connected ? { backgroundColor: PLAYER_COLORS[activeIdx % PLAYER_COLORS.length] } : undefined}
                  />
                  <span 
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      !activePlayer.is_connected ? 'bg-error' : ''
                    }`}
                    style={activePlayer.is_connected ? { backgroundColor: PLAYER_COLORS[activeIdx % PLAYER_COLORS.length] } : undefined}
                  />
                </span>
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                  <span className="text-sm">{PLAYER_EMOJIS[activeIdx % PLAYER_EMOJIS.length]}</span>
                  <span className="font-bold text-text-primary" style={{ color: PLAYER_COLORS[activeIdx % PLAYER_COLORS.length] }}>
                    {activePlayer.display_name}
                  </span>
                  <span>&apos;s Turn</span>
                  {!activePlayer.is_connected && (
                    <span className="text-error font-semibold text-[10px] normal-case ml-1 flex items-center gap-1 animate-pulse">
                      (Disconnected)
                    </span>
                  )}
                </h3>
              </div>
              
              {/* Skip turn button if disconnected */}
              {!activePlayer.is_connected && (
                <button 
                  onClick={handleNextRound} 
                  className="btn-secondary py-1 px-2.5 text-[10px] text-error border-error/20 hover:bg-error/10 flex items-center gap-1 animate-bounce"
                >
                  <span>Skip Turn</span>
                  <span className="bg-error/20 px-1 py-0.2 rounded font-mono text-[9px]">10s</span>
                </button>
              )}
            </div>

            {(!gameState.allTimelines[activePlayer.id] || gameState.allTimelines[activePlayer.id].length === 0) ? (
              <p className="text-xs text-text-muted italic py-1 text-left animate-pulse">No cards placed yet. This round will be their first card!</p>
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 select-none scrollbar-thin">
                {gameState.allTimelines[activePlayer.id]
                  .map((card, cardIdx, arr) => {
                    const isCurrentRoundTrack = currentRoundTrack && card.track.id === currentRoundTrack.id;
                    const isRevealed = !isCurrentRoundTrack || showReveal;

                    return (
                      <div key={card.track.id} className="flex items-center gap-2 shrink-0">
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className={`border rounded-lg p-2 w-32 text-center shadow-lg relative group overflow-hidden transition-all duration-500 ${
                            isCurrentRoundTrack
                              ? isRevealed
                                ? 'bg-success/15 border-success/40' // Revealed
                                : 'bg-primary/10 border-primary/40 border-dashed animate-pulse' // Unrevealed placement
                              : 'bg-white/5 border-white/10' // Standard card
                          }`}
                        >
                          {isCurrentRoundTrack && !isRevealed ? (
                            <>
                              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center animate-pulse mx-auto mb-1.5 shrink-0">
                                <span className="text-base animate-spin-slow">💿</span>
                              </div>
                              <span className="font-display font-black text-primary-light text-sm block animate-pulse">
                                ????
                              </span>
                              <p className="font-bold text-[9px] text-primary-light truncate mt-0.5 animate-pulse">
                                Mystery Card
                              </p>
                            </>
                          ) : (
                            <>
                              {card.track.album_image_url && (
                                <img
                                  src={card.track.album_image_url}
                                  alt=""
                                  className="w-10 h-10 rounded object-cover mx-auto mb-1.5 border border-white/10 group-hover:scale-105 transition-transform duration-300"
                                />
                              )}
                              <span className="font-display font-black text-primary text-sm block">
                                {card.track.release_year}
                              </span>
                              <p className="font-semibold text-[9px] text-text-primary truncate mt-0.5">
                                {card.track.track_name}
                              </p>
                              <p className="text-[8px] text-text-muted truncate">
                                {card.track.artist_name}
                              </p>
                            </>
                          )}
                        </motion.div>
                        {cardIdx < arr.length - 1 && (
                          <div className="h-[2px] w-3 bg-white/10 shrink-0 relative flex items-center justify-center">
                            <div className="w-1 h-1 rounded-full bg-primary/60" />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Steal Attempts Board */}
        {gameState.stealAttempts.length > 0 && activePlayer && (
          <div className="glass rounded-xl p-3 mb-2 border border-warning/20 bg-warning/5 text-left relative overflow-hidden shrink-0">
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-warning/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-1.5">
              <h3 className="font-display text-xs font-black text-warning tracking-wider flex items-center gap-1.5 uppercase">
                <span className="animate-pulse">⚡</span> Passive Player Guesses & Steals
              </h3>
              <span className="text-[9px] text-text-muted font-medium bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                Steal Window active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {(() => {
                // Pre-calculate correct position for display if revealed
                let correctPos = 0;
                if (currentRoundTrack) {
                  for (let i = 0; i < originalTimeline.length; i++) {
                    if (currentRoundTrack.release_year >= originalTimeline[i].track.release_year) {
                      correctPos = i + 1;
                    }
                  }
                }

                return gameState.stealAttempts.map((steal) => {
                  const stealer = gameState.players.find((p) => p.id === steal.stealing_player_id);
                  const stealerIdx = stealer ? gameState.players.indexOf(stealer) : 0;
                  
                  const pos = steal.proposed_position;
                  let positionLabel = '';
                  
                  if (originalTimeline.length === 0) {
                    positionLabel = 'First card';
                  } else if (pos === 0) {
                    positionLabel = `Before ${originalTimeline[0].track.release_year}`;
                  } else if (pos === originalTimeline.length) {
                    positionLabel = `After ${originalTimeline[originalTimeline.length - 1].track.release_year}`;
                  } else {
                    positionLabel = `Between ${originalTimeline[pos - 1].track.release_year} and ${originalTimeline[pos].track.release_year}`;
                  }

                  const isCorrect = showReveal && (pos === correctPos);

                  return (
                    <motion.div
                      key={steal.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`glass rounded-xl p-2 border flex items-center justify-between transition-all duration-300 ${
                        showReveal
                          ? isCorrect
                            ? 'border-success/30 bg-success/10 shadow-lg shadow-success/5'
                            : 'border-error/20 bg-error/5 opacity-70'
                          : 'border-white/5 bg-surface/40 hover:border-warning/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-surface/80 flex items-center justify-center text-lg shrink-0 shadow-inner border border-white/5">
                          {PLAYER_EMOJIS[stealerIdx % PLAYER_EMOJIS.length]}
                        </div>
                        <div className="min-w-0">
                          <p
                            className="text-xs font-bold truncate"
                            style={{ color: PLAYER_COLORS[stealerIdx % PLAYER_COLORS.length] }}
                          >
                            {stealer?.display_name || 'Player'}
                          </p>
                          <p className="text-[9px] text-text-secondary mt-0.5 flex items-center gap-1">
                            <span>Guess:</span>
                            <span className="font-semibold text-warning-light truncate max-w-[120px]">{positionLabel}</span>
                          </p>
                        </div>
                      </div>

                      {/* Status pill badge */}
                      {showReveal ? (
                        <span className={`text-[8px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded-full ${
                          isCorrect
                            ? 'bg-success/20 text-success border border-success/30'
                            : 'bg-error/20 text-error border border-error/30'
                        }`}>
                          {isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                      ) : (
                        <span className="text-[8px] font-semibold bg-warning/20 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                          <span>🔒</span> Locked
                        </span>
                      )}
                    </motion.div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Song / Controls */}
        <div className="glass rounded-2xl p-4 mb-2 flex-1 flex flex-col justify-center min-h-0">
          {currentRoundTrack ? (
            <div className="text-center space-y-3">
              {currentRoundTrack.album_image_url && (
                <div className="w-32 h-32 mx-auto relative rounded-xl overflow-hidden shadow-lg shadow-primary/20 bg-surface/50 border border-white/10 flex items-center justify-center shrink-0">
                  <AnimatePresence mode="wait">
                    {showReveal ? (
                      <motion.img 
                        key="cover"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        src={currentRoundTrack.album_image_url} 
                        alt="" 
                        className="w-full h-full object-cover" 
                      />
                    ) : (
                      <motion.div 
                        key="placeholder"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.3 }}
                        className="flex flex-col items-center justify-center space-y-2"
                      >
                        <motion.div 
                          animate={spotify.isPlaying ? { rotate: 360 } : {}}
                          transition={spotify.isPlaying ? { repeat: Infinity, duration: 8, ease: "linear" } : {}}
                          className="w-16 h-16 rounded-full border-4 border-double border-white/20 flex items-center justify-center bg-gradient-to-tr from-primary/30 to-accent/30 shadow-inner animate-pulse"
                        >
                          <span className="text-2xl filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]">🎵</span>
                        </motion.div>
                        <p className="text-[10px] font-semibold tracking-widest uppercase text-text-muted/70">
                          {spotify.isPlaying ? 'Playing...' : 'Paused'}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              
              {showReveal ? (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="shrink-0">
                  <p className="font-display text-2xl font-bold gradient-text">{currentRoundTrack.release_year}</p>
                  <p className="text-sm font-semibold mt-1 truncate max-w-md mx-auto">{currentRoundTrack.track_name}</p>
                  <p className="text-xs text-text-secondary truncate max-w-md mx-auto">{currentRoundTrack.artist_name}</p>
                </motion.div>
              ) : (
                <div className="shrink-0">
                  <p className="text-text-muted text-xs">Click reveal when ready</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 justify-center mt-2 shrink-0">
                {spotify.isPlaying ? (
                  <button onClick={handleStopMusic} className="btn-secondary text-xs py-1.5 px-4">⏸ Pause</button>
                ) : (
                  <button onClick={handlePlayMusic} className="btn-secondary text-xs py-1.5 px-4">
                    {hasPlayedCurrentTrack || spotify.currentState?.track_window?.current_track?.uri === currentRoundTrack.spotify_uri ? '▶ Resume' : '▶ Play'}
                  </button>
                )}
                {!showReveal && <button onClick={handleRevealRound} className="btn-primary text-xs py-1.5 px-4">👁 Reveal</button>}
                {showReveal && <button onClick={handleNextRound} className="btn-primary text-xs py-1.5 px-4">Next Round →</button>}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-text-muted shrink-0">Preparing round...</div>
          )}
        </div>

        {/* Players bar */}
        <div className="flex gap-2 overflow-x-auto pb-1 shrink-0">
          {gameState.players.map((player, i) => (
            <div key={player.id} className={`glass rounded-xl p-2 min-w-[100px] shrink-0 text-center transition-all border relative ${!player.is_connected ? 'opacity-50 border-error/20 bg-error/5' : 'border-white/5'}`}>
              {(() => {
                const handRaisedPlayers = gameState.players
                  .filter((p) => p.hand_raised_at)
                  .sort((a, b) => new Date(a.hand_raised_at!).getTime() - new Date(b.hand_raised_at!).getTime());
                
                const priorityIndex = handRaisedPlayers.findIndex((p) => p.id === player.id);
                const priority = priorityIndex !== -1 ? priorityIndex + 1 : null;
                
                if (!priority) return null;
                
                return (
                  <div className="absolute top-1 right-1 flex items-center justify-center bg-gradient-to-tr from-success to-emerald-500 text-white rounded-full w-4 h-4 text-[8px] font-bold border border-success/20 shadow-md shadow-success/20 animate-bounce">
                    ✋{priority}
                  </div>
                );
              })()}
              <p className="text-base">{PLAYER_EMOJIS[i % PLAYER_EMOJIS.length]}</p>
              <p className="text-[10px] font-semibold truncate" style={{ color: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                {player.display_name} {!player.is_connected && <span className="text-error font-medium">(Offline)</span>}
              </p>
              <p className="text-[9px] text-text-muted mt-0.5">{player.tokens} 🪙 · {getPlayerCardCount(player.id)} cards</p>
              <button onClick={() => handleAwardToken(player)} className="text-[9px] text-warning-light mt-0.5 hover:underline">+1 Token</button>
            </div>
          ))}
        </div>

        {/* Connected Spotify ID Bottom Bar */}
        <div className="mt-1 pt-1.5 border-t border-white/5 flex flex-col items-center justify-center gap-1 select-none shrink-0 w-full">
          <div className="flex items-center gap-2 flex-wrap justify-center text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${spotify.deviceId ? 'bg-success animate-pulse' : 'bg-error'}`} />
            <span className="font-medium text-text-secondary">
              {spotify.deviceId ? `Spotify Connected (ID: ${spotify.deviceId.slice(0, 6)}...)` : 'No playing device found'}
            </span>
            <button 
              onClick={() => spotify.transferPlayback()} 
              disabled={!spotify.deviceId} 
              className="text-primary font-semibold hover:underline ml-1 cursor-pointer disabled:opacity-50 flex items-center gap-0.5"
            >
              🔄 Refresh Device
            </button>
          </div>
          {!spotify.deviceId && (
            <p className="text-[9px] text-warning/80 text-center">
              ⚠️ Spotify Premium & Web SDK required. Please open Spotify or check authorization.
            </p>
          )}
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
