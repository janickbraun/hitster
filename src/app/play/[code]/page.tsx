'use client';

import { useState, useEffect, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameState } from '@/hooks/useGameState';
import { usePlayerSession } from '@/hooks/usePlayerSession';
import { useCountdown } from '@/hooks/useCountdown';
import { createClient } from '@/lib/supabase/client';
import { GAME, PLAYER_COLORS, PLAYER_EMOJIS } from '@/lib/utils/constants';
import { QRCodeSVG } from 'qrcode.react';
import type { GameTrack, TimelineCard } from '@/types/game';

export default function PlayerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const gameCode = code.toUpperCase();
  const playerSession = usePlayerSession();
  const countdown = useCountdown();
  const supabase = createClient();

  const [displayName, setDisplayName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [myTimeline, setMyTimeline] = useState<TimelineCard[]>([]);
  const [roundResult, setRoundResult] = useState<{ outcome: string; year: number; track: GameTrack } | null>(null);
  const [copied, setCopied] = useState(false);
  const [placementStatus, setPlacementStatus] = useState<'correct' | 'wrong' | null>(null);
  const [checkedTrackId, setCheckedTrackId] = useState<string | null>(null);

  const gameState = useGameState(gameCode, myPlayerId, false);

  const isMyTurn = gameState.session?.current_player_id === myPlayerId;
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const mySteal = gameState.stealAttempts.find((s) => s.stealing_player_id === myPlayerId);
  const displayTokens = me ? (mySteal ? Math.max(0, me.tokens - 1) : me.tokens) : 0;
  const myIdx = me ? gameState.players.indexOf(me) : 0;
  const activePlayer = gameState.players.find((p) => p.id === gameState.session?.current_player_id);
  const activeIdx = activePlayer ? gameState.players.indexOf(activePlayer) : -1;

  // Timeline of the active player
  const activePlayerTimeline = activePlayer ? (gameState.allTimelines[activePlayer.id] || []) : [];
  
  // Active player's timeline excluding the unrevealed active track
  const originalTimeline = activePlayerTimeline.filter(
    (card) => card.track.id !== gameState.activeTrackId
  );

  // Active player's unrevealed guess position
  const activePlayerGuessCard = activePlayerTimeline.find(
    (card) => card.track.id === gameState.activeTrackId
  );
  const activePlayerGuessPosition = activePlayerGuessCard ? activePlayerGuessCard.position : null;

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  // Check for existing session and reconnect
  useEffect(() => {
    const tryReconnect = async () => {
      if (playerSession.playerData && playerSession.playerData.gameCode === gameCode && playerSession.sessionToken) {
        try {
          const { data, error } = await supabase.rpc('reconnect_game', {
            p_game_code: gameCode,
            p_session_token: playerSession.sessionToken,
          });

          if (error) throw error;

          if (data) {
            const result = data as { player_id: string; session_id: string; display_name: string; game_code: string; game_status: string };
            setMyPlayerId(result.player_id);
            setHasJoined(true);

            // Notify others we reconnected
            gameState.broadcast({
              type: 'player:joined',
              payload: {
                id: result.player_id,
                session_id: result.session_id,
                display_name: result.display_name,
                session_token: '',
                tokens: 1,
                turn_order: 0,
                is_connected: true,
                created_at: new Date().toISOString(),
              },
            });
          } else {
            // Reconnection failed (invalid session or deleted player)
            playerSession.clearSession();
          }
        } catch (err) {
          console.error('Failed to reconnect:', err);
          // Fallback to local storage state on temporary connection errors
          setMyPlayerId(playerSession.playerData.playerId);
          setHasJoined(true);
        }
      }
    };

    tryReconnect();
  }, [playerSession.playerData, gameCode, playerSession.sessionToken]);

  // Fetch my timeline when game state changes
  useEffect(() => {
    if (myPlayerId && gameState.session?.id) {
      gameState.fetchTimeline(myPlayerId).then(setMyTimeline);
    }
  }, [myPlayerId, gameState.session?.id, gameState.roundPhase]);

  // Listen for steal window
  useEffect(() => {
    if (gameState.roundPhase === 'steal_window') {
      countdown.start(GAME.STEAL_WINDOW_SECONDS * 1000, gameState.session?.steal_window_start_at || undefined);
    }
  }, [gameState.roundPhase, gameState.session?.steal_window_start_at]);

  // Reset check status when round starts
  useEffect(() => {
    if (gameState.roundPhase !== 'resolution') {
      setPlacementStatus(null);
      setCheckedTrackId(null);
    }
  }, [gameState.roundPhase]);

  // Check placement when round is resolved
  useEffect(() => {
    if (
      gameState.roundPhase === 'resolution' &&
      isMyTurn &&
      myTimeline.length > 0 &&
      gameState.currentTrack &&
      checkedTrackId !== gameState.currentTrack.id
    ) {
      setCheckedTrackId(gameState.currentTrack.id);

      const placedCard = myTimeline.find((card) => card.track.id === gameState.currentTrack?.id);
      if (!placedCard) return;

      const years = myTimeline.map((card) => card.track.release_year);
      let isCorrect = true;
      for (let i = 0; i < years.length - 1; i++) {
        if (years[i] > years[i + 1]) {
          isCorrect = false;
          break;
        }
      }

      if (!isCorrect) {
        setPlacementStatus('wrong');
        // Delete incorrect card from timeline atomically
        supabase.rpc('delete_timeline_card', {
          p_player_id: myPlayerId,
          p_session_id: gameState.session?.id,
          p_track_id: gameState.currentTrack.id
        }).then(() => {
          // Fetch timeline again after delete
          gameState.fetchTimeline(myPlayerId!).then(setMyTimeline);
        });
      } else {
        setPlacementStatus('correct');
      }
    }
  }, [gameState.roundPhase, myTimeline, isMyTurn, gameState.currentTrack, checkedTrackId, myPlayerId, supabase, gameState]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !playerSession.sessionToken) return;

    setIsJoining(true);
    setJoinError(null);

    try {
      const { data, error } = await supabase.rpc('join_game', {
        p_game_code: gameCode,
        p_display_name: displayName.trim(),
        p_session_token: playerSession.sessionToken,
      });

      if (error) throw error;

      const result = data as { player_id: string; session_id: string };
      setMyPlayerId(result.player_id);
      setHasJoined(true);

      playerSession.savePlayerData({
        playerId: result.player_id,
        sessionId: result.session_id,
        displayName: displayName.trim(),
        gameCode,
      });

      // Notify others
      gameState.broadcast({
        type: 'player:joined',
        payload: {
          id: result.player_id,
          session_id: result.session_id,
          display_name: displayName.trim(),
          session_token: '',
          tokens: 1,
          turn_order: gameState.players.length + 1,
          is_connected: true,
          created_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsJoining(false);
    }
  };

  const handlePlaceCard = async () => {
    if (selectedPosition === null || !myPlayerId || !gameState.session?.id) return;

    // Find the active track by ID if available, otherwise fallback to 'active' status
    const trackId = gameState.activeTrackId;
    const query = supabase
      .from('game_tracks')
      .select('*')
      .eq('session_id', gameState.session.id);
    
    const { data: activeTrack } = trackId 
      ? await query.eq('id', trackId).single()
      : await query.eq('status', 'active').single();

    if (!activeTrack) return;

    // Shift subsequent cards in the timeline to make room
    await supabase.rpc('shift_timeline_positions', {
      p_player_id: myPlayerId,
      p_session_id: gameState.session.id,
      p_position: selectedPosition,
    });

    // Insert into timeline
    await supabase.from('player_timelines').insert({
      player_id: myPlayerId,
      track_id: activeTrack.id,
      session_id: gameState.session.id,
      position: selectedPosition,
    });

    // Notify host and other players of confirmed placement (host will update track status to 'placed')
    gameState.broadcast({
      type: 'placement:confirmed',
      payload: { player_id: myPlayerId, position: selectedPosition, track_id: activeTrack.id },
    });

    setSelectedPosition(null);
    gameState.fetchTimeline(myPlayerId).then(setMyTimeline);
  };

  const handlePlaceSteal = async (position: number) => {
    if (!myPlayerId || !gameState.session?.id || !gameState.activeTrackId || !activePlayer?.id) return;
    if (!me || me.tokens < 1) return;

    // Double check that the position isn't claimed in local state
    const alreadyClaimed = gameState.stealAttempts.some(s => s.proposed_position === position);
    if (alreadyClaimed) return;

    // Insert steal attempt
    const { data: attempt, error: attemptErr } = await supabase
      .from('steal_attempts')
      .insert({
        session_id: gameState.session.id,
        track_id: gameState.activeTrackId,
        stealing_player_id: myPlayerId,
        target_player_id: activePlayer.id,
        proposed_position: position,
        tokens_spent: 1,
        result: 'pending',
      })
      .select()
      .single();

    if (attemptErr || !attempt) return;

    // Broadcast the attempt
    gameState.broadcast({
      type: 'steal:attempt',
      payload: attempt,
    });

    // Update local timelines/session/players
    gameState.fetchPlayers();
  };

  const handleToggleHand = async () => {
    if (!myPlayerId || !gameState.session?.id || isMyTurn) return;

    // Check if hand is currently raised
    const isHandRaised = !!me?.hand_raised_at;
    const newHandRaisedAt = isHandRaised ? null : new Date().toISOString();

    try {
      // Update DB
      const { error } = await supabase
        .from('players')
        .update({ hand_raised_at: newHandRaisedAt })
        .eq('id', myPlayerId);

      if (error) throw error;

      // Broadcast the change
      gameState.broadcast({
        type: 'player:hand_changed',
        payload: { player_id: myPlayerId, hand_raised_at: newHandRaisedAt },
      });
    } catch (err) {
      console.error('Failed to toggle hand raised state:', err);
    }
  };

  const renderStealSlot = (position: number) => {
    // Check if the active player guessed this slot
    const isActivePlayerGuess = position === activePlayerGuessPosition;
    
    // Check if another stealer already claimed this slot
    const claimingStealer = gameState.stealAttempts.find(s => s.proposed_position === position);

    if (isActivePlayerGuess) {
      return (
        <div className="rounded-xl p-2.5 flex items-center gap-2.5 border border-dashed border-primary bg-primary/5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center animate-pulse shrink-0">
            <span className="text-xs animate-spin-slow">💿</span>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="font-bold text-[10px] text-primary-light animate-pulse">Mystery Song</p>
            <p className="text-text-muted text-[9px]">{activePlayer?.display_name}&apos;s Guess</p>
          </div>
          <span className="font-display font-bold text-primary-light text-xs shrink-0 animate-pulse">????</span>
        </div>
      );
    }

    if (claimingStealer) {
      const stealerPlayer = gameState.players.find(p => p.id === claimingStealer.stealing_player_id);
      return (
        <div className="rounded-xl p-2 flex items-center gap-2 border border-warning/20 bg-warning/5 opacity-80">
          <span className="text-xs">🔒</span>
          <span className="text-[10px] font-semibold text-warning-light">
            Claimed by {stealerPlayer?.display_name || 'Another Player'}
          </span>
        </div>
      );
    }

    // If it's not the steal window yet, all slots are locked/waiting
    if (gameState.roundPhase !== 'steal_window') {
      return (
        <div className="w-full rounded-xl border border-dashed border-white/5 py-1.5 text-center text-[10px] text-text-muted select-none">
          ⏳ Locked until placement confirmed
        </div>
      );
    }

    // If it is the steal window but the user has 0 tokens remaining
    if (displayTokens < 1) {
      return (
        <div className="w-full rounded-xl border border-dashed border-error/10 py-1.5 text-center text-[10px] text-error/60 select-none">
          🚫 Stealing costs 1 token
        </div>
      );
    }

    // Otherwise, it is an available slot to steal!
    return (
      <button
        onClick={() => handlePlaceSteal(position)}
        className="w-full rounded-xl border border-dashed border-warning/30 hover:border-warning/60 hover:bg-warning/5 transition-all py-1.5 text-center text-[10px] font-bold text-warning-light flex items-center justify-center gap-1.5"
      >
        <span>⚡</span> Steal here
      </button>
    );
  };



  // ========== JOIN FORM ==========
  if (!hasJoined) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-bold gradient-text mb-2">Join Game</h1>
            <p className="text-text-secondary">Code: <span className="font-display font-bold text-primary">{gameCode}</span></p>
          </div>
          <form onSubmit={handleJoin} className="glass rounded-2xl p-6 space-y-4" suppressHydrationWarning>
            <div>
              <label htmlFor="player-name" className="text-sm font-medium text-text-secondary mb-2 block">Your Name</label>
              <input id="player-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 20))} placeholder="Enter your name" className="input-field text-lg" autoComplete="off" autoFocus maxLength={20} suppressHydrationWarning />
            </div>
            {joinError && <p className="text-error text-sm">{joinError}</p>}
            <button type="submit" disabled={!displayName.trim() || isJoining} className="btn-primary w-full text-lg">
              {isJoining ? 'Joining...' : 'Join Game'}
            </button>
          </form>
        </motion.div>
      </main>
    );
  }

  // ========== LOADING SESSION ==========
  if (!gameState.session) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center animate-fade-in">
        <div className="space-y-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-text-muted text-sm animate-pulse">Connecting to game...</p>
        </div>
      </main>
    );
  }

  // ========== WAITING FOR GAME START ==========
  if (gameState.session.status === 'lobby') {
    const joinUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/play/${gameCode}`;
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-sm w-full">
          <div className="text-4xl animate-bounce">🎵</div>
          <h1 className="font-display text-2xl font-bold">Waiting for host</h1>
          <p className="text-text-secondary">You&apos;re in! The game will start soon.</p>

          {/* Join Link / QR Code for other players */}
          <div className="glass rounded-2xl p-6 flex flex-col items-center justify-center space-y-4">
            <p className="text-sm font-semibold text-text-secondary">Invite friends to join!</p>
            <div className="bg-white p-3 rounded-2xl shadow-xl flex items-center justify-center">
              <QRCodeSVG
                value={joinUrl}
                size={160}
                level="H"
                includeMargin={false}
              />
            </div>
            <div className="w-full text-center">
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
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2" />
                    </svg>
                    <span>Copy Join Link</span>
                  </>
                )}
              </button>
            </div>
            <div>
              <p className="text-xs text-text-muted">Game Code</p>
              <p className="font-display font-bold text-lg text-primary">{gameCode}</p>
            </div>
          </div>

          <div className="glass rounded-2xl p-6">
            <p className="text-sm text-text-muted mb-3">Players joined</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {gameState.players.map((p, i) => (
                <span key={p.id} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ backgroundColor: `${PLAYER_COLORS[i % PLAYER_COLORS.length]}20`, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                  {PLAYER_EMOJIS[i % PLAYER_EMOJIS.length]} {p.display_name}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </main>
    );
  }

  // ========== GAME FINISHED ==========
  if (gameState.session?.status === 'finished' || gameState.roundPhase === 'game_over') {
    const scores = gameState.players.map((p, idx) => ({
      ...p,
      idx,
      cards: Math.max(1, (gameState.allTimelines[p.id] || []).length),
    }));
    const sortedScores = [...scores].sort((a, b) => b.cards - a.cards);
    const winnerPlayer = sortedScores[0];
    const winnerIdx = winnerPlayer ? winnerPlayer.idx : 0;

    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 max-w-sm w-full glass p-6 rounded-2xl">
          <div className="text-6xl animate-bounce">🏆</div>
          <h1 className="font-display text-4xl font-extrabold gradient-text">Game Over!</h1>
          
          {winnerPlayer ? (
            <div className="space-y-1">
              <p className="text-text-secondary text-sm">Winner</p>
              <p className="text-xl font-bold font-display" style={{ color: PLAYER_COLORS[winnerIdx % PLAYER_COLORS.length] }}>
                {PLAYER_EMOJIS[winnerIdx % PLAYER_EMOJIS.length]} {winnerPlayer.display_name}
              </p>
            </div>
          ) : (
            <p className="text-text-secondary text-sm">The game has ended!</p>
          )}

          <div className="pt-4 border-t border-white/5 space-y-2">
            <p className="text-xs text-text-muted uppercase tracking-wider text-left mb-2">Final Standings</p>
            {gameState.players
              .map((p, idx) => ({
                ...p,
                idx,
                cards: Math.max(1, (gameState.allTimelines[p.id] || []).length)
              }))
              .sort((a, b) => b.cards - a.cards)
              .map((player) => (
                <div key={player.id} className="flex justify-between items-center text-sm py-1.5 border-b border-white/5 last:border-0">
                  <span className="font-medium" style={{ color: PLAYER_COLORS[player.idx % PLAYER_COLORS.length] }}>
                    {PLAYER_EMOJIS[player.idx % PLAYER_EMOJIS.length]} {player.display_name}
                  </span>
                  <span className="text-text-muted font-mono">{player.cards} cards</span>
                </div>
              ))
            }
          </div>

          <a href="/" className="btn-primary w-full py-3 inline-block rounded-xl font-semibold">
            Play Again
          </a>
        </motion.div>
      </main>
    );
  }

  // ========== GAME VIEW ==========
  return (
    <main className="min-h-dvh flex flex-col px-4 py-4 game-active">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{PLAYER_EMOJIS[myIdx % PLAYER_EMOJIS.length]}</span>
          <span className="font-display font-bold text-sm" style={{ color: PLAYER_COLORS[myIdx % PLAYER_COLORS.length] }}>{me?.display_name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">{displayTokens} 🪙</span>
        </div>
      </div>

      {/* Status banner */}
      <AnimatePresence mode="wait">
        {isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement') ? (
          <motion.div key="my-turn" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-primary rounded-xl p-3 mb-3 text-center">
            <p className="font-display font-bold text-white">Your Turn!</p>
            <p className="text-white/80 text-xs">Place the song in your timeline</p>
          </motion.div>
        ) : gameState.roundPhase === 'steal_window' ? (
          <motion.div key="steal" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-warning rounded-xl p-3 mb-3 text-center">
            <p className="font-display font-bold text-white">Steal Window!</p>
            <p className="text-white/80 text-xs">{Math.ceil(countdown.timeLeft / 1000)}s remaining</p>
            <div className="mt-2 h-1 bg-white/20 rounded-full overflow-hidden">
              <motion.div className="h-full bg-white rounded-full" style={{ width: `${countdown.progress * 100}%` }} />
            </div>
          </motion.div>
        ) : gameState.roundPhase === 'resolution' ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={`glass rounded-xl p-4 mb-3 text-center border-2 ${
              isMyTurn
                ? placementStatus === 'correct'
                  ? 'border-success/40 bg-success/5'
                  : placementStatus === 'wrong'
                  ? 'border-error/40 bg-error/5'
                  : 'border-white/10'
                : myTimeline.some(card => card.track.id === gameState.currentTrack?.id) && gameState.stealAttempts.some(s => s.stealing_player_id === myPlayerId)
                ? 'border-success/40 bg-success/5 animate-pulse'
                : gameState.stealAttempts.some(s => s.stealing_player_id === myPlayerId)
                ? 'border-error/40 bg-error/5'
                : 'border-white/10'
            }`}
          >
            {isMyTurn ? (
              <div className="mb-2">
                {placementStatus === 'correct' && (
                  <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="space-y-1">
                    <p className="font-display font-bold text-xl text-success flex items-center justify-center gap-1.5">
                      <span>🎉</span> Correct Placement!
                    </p>
                    <p className="text-text-secondary text-xs">
                      Excellent ear! The song is locked into your timeline.
                    </p>
                  </motion.div>
                )}
                {placementStatus === 'wrong' && (
                  <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="space-y-1">
                    <p className="font-display font-bold text-xl text-error flex items-center justify-center gap-1.5">
                      <span>❌</span> Wrong Placement!
                    </p>
                    <p className="text-text-secondary text-xs">
                      Almost! The card has been discarded.
                    </p>
                  </motion.div>
                )}
                {!placementStatus && <p className="text-sm text-text-muted animate-pulse">Calculating result...</p>}
              </div>
            ) : (
              <div className="mb-2">
                {(() => {
                  const mySteal = gameState.stealAttempts.find(s => s.stealing_player_id === myPlayerId);
                  const hasStolenCard = myTimeline.some(card => card.track.id === gameState.currentTrack?.id);
                  
                  if (hasStolenCard && mySteal) {
                    return (
                      <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="space-y-1">
                        <p className="font-display font-bold text-xl text-success flex items-center justify-center gap-1.5 animate-bounce">
                          <span>⚡🎉</span> Successful Steal!
                        </p>
                        <p className="text-text-secondary text-xs">
                          Incredible guess! You successfully stole the card and kept your token.
                        </p>
                      </motion.div>
                    );
                  } else if (mySteal) {
                    return (
                      <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="space-y-1">
                        <p className="font-display font-bold text-base text-error flex items-center justify-center gap-1.5">
                          <span>❌💔</span> Steal Failed!
                        </p>
                        <p className="text-text-secondary text-xs">
                          Incorrect slot. Your token count decreased by 1.
                        </p>
                      </motion.div>
                    );
                  }

                  return (
                    <div>
                      <p className="font-display font-bold text-base text-primary">Round Revealed!</p>
                      <p className="text-text-muted text-xs">Waiting for host to start next round</p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Revealed Track info card */}
            {gameState.currentTrack && (
              <div className="mt-2 p-2.5 bg-white/5 rounded-lg flex items-center gap-3 border border-white/5 text-left">
                {gameState.currentTrack.album_image_url && (
                  <img src={gameState.currentTrack.album_image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0 animate-fade-in" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs truncate">{gameState.currentTrack.track_name}</p>
                  <p className="text-text-muted text-[10px] truncate">{gameState.currentTrack.artist_name}</p>
                </div>
                <span className="font-display font-bold text-primary text-base shrink-0">
                  {gameState.currentTrack.release_year}
                </span>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="waiting-turn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass rounded-xl p-3 mb-3 text-center">
            <p className="text-text-muted text-sm flex items-center justify-center gap-1.5 flex-wrap">
              <span>🎵 Listening...</span>
              {activePlayer && (
                <span className="text-xs">
                  (Active: <strong style={{ color: PLAYER_COLORS[activeIdx % PLAYER_COLORS.length] }}>{activePlayer.display_name}</strong>&apos;s turn)
                </span>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Steal Board for passive players */}
      {!isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement' || gameState.roundPhase === 'steal_window') && (
        <div className="glass rounded-2xl p-4 mb-4 border border-warning/20 bg-warning/5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h3 className="font-display font-bold text-sm text-warning flex items-center gap-1.5">
              ⚡ Steal the Card!
              {gameState.roundPhase === 'steal_window' && (
                <span className="text-[10px] bg-warning/20 text-warning border border-warning/30 px-2 py-0.5 rounded-full font-mono animate-pulse shrink-0">
                  ⏱️ {Math.ceil(countdown.timeLeft / 1000)}s
                </span>
              )}
            </h3>
            <span className="text-xs text-text-muted">
              Your Tokens: <strong className="text-warning-light">{displayTokens} 🪙</strong>
            </span>
          </div>

          <div className="space-y-3">
            {gameState.roundPhase === 'steal_window' ? (
              gameState.stealAttempts.some(s => s.stealing_player_id === myPlayerId) ? (
                <div className="bg-success/10 border border-success/20 rounded-xl p-2.5 text-center">
                  <p className="text-xs font-semibold text-success flex items-center justify-center gap-1.5">
                    <span>✔️</span> Steal Attempt Submitted!
                  </p>
                  <p className="text-[9px] text-text-muted mt-0.5">
                    Guessed position {
                      gameState.stealAttempts.find(s => s.stealing_player_id === myPlayerId)?.proposed_position
                    }. Waiting for resolution...
                  </p>
                </div>
              ) : displayTokens < 1 ? (
                <div className="bg-error/10 border border-error/20 rounded-xl p-2.5 text-center">
                  <p className="text-xs font-semibold text-error flex items-center justify-center gap-1.5">
                    <span>⚠️</span> No Tokens Remaining
                  </p>
                  <p className="text-[9px] text-text-muted mt-0.5">
                    Stealing costs 1 token. You have 0 tokens.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-secondary text-left leading-relaxed">
                  Select an empty slot in <strong>{activePlayer?.display_name || 'their'}&apos;s</strong> timeline to steal the card! (Costs 1 token)
                </p>
              )
            ) : (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-2.5 text-center animate-pulse">
                <p className="text-xs font-semibold text-primary-light flex items-center justify-center gap-1.5">
                  <span>⏳</span> Inspecting Timeline
                </p>
                <p className="text-[9px] text-text-muted mt-0.5">
                  Waiting for {activePlayer?.display_name || 'active player'} to confirm their placement...
                </p>
              </div>
            )}

            {/* Active Player Timeline Preview */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <p className="text-[10px] text-text-muted uppercase tracking-wider text-left">
                {activePlayer?.display_name}&apos;s Guess Row
              </p>

              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {/* Position 0 slot */}
                {renderStealSlot(0)}

                {originalTimeline.map((card, idx) => (
                  <div key={card.track.id} className="space-y-2">
                    {/* The regular card */}
                    <div className="glass rounded-xl p-2.5 flex items-center gap-2.5 bg-white/5 border border-white/10 opacity-70">
                      {card.track.album_image_url && <img src={card.track.album_image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-semibold text-xs truncate">{card.track.track_name}</p>
                        <p className="text-text-muted text-[10px] truncate">{card.track.artist_name}</p>
                      </div>
                      <span className="font-display font-bold text-text-muted text-sm shrink-0">{card.track.release_year}</span>
                    </div>

                    {/* Drop zone / Steal slot after this card */}
                    {renderStealSlot(idx + 1)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3">
        <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Your Timeline ({myTimeline.length} cards)</p>

        {/* Floating active card prompting placement if none chosen */}
        {isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement') && selectedPosition === null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass rounded-xl p-3 border border-primary/30 bg-primary/5 text-center mb-3"
          >
            <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1.5">Active Song (Covered)</p>
            <div className="flex items-center gap-3 justify-center">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center animate-spin-slow shrink-0 shadow-lg shadow-primary/20">
                <span className="text-lg">💿</span>
              </div>
              <div className="text-left flex-1 min-w-0">
                <p className="font-bold text-xs text-primary-light">???</p>
                <p className="text-text-secondary text-[10px]">Select a position in your timeline to place this card</p>
              </div>
              <span className="font-display font-bold text-text-muted text-base shrink-0">????</span>
            </div>
          </motion.div>
        )}

        {/* Drop zone / Covered card placeholder before first card */}
        {isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement') && (
          selectedPosition === 0 ? (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl p-3 flex items-center gap-3 border-2 border-dashed border-primary bg-primary/10 shadow-lg shadow-primary/10"
            >
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center animate-pulse shrink-0">
                <span className="text-base animate-spin-slow">💿</span>
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-bold text-xs text-primary-light animate-pulse">???</p>
                <p className="text-text-muted text-[10px]">Positioned here (Covered)</p>
              </div>
              <span className="font-display font-bold text-primary-light text-base shrink-0 animate-pulse">????</span>
            </motion.div>
          ) : (
            <button onClick={() => setSelectedPosition(0)} className={`w-full rounded-xl border-2 border-dashed transition-all touch-target py-2 ${selectedPosition === null ? 'h-12 border-border hover:border-primary/50' : 'h-10 border-border/40 hover:border-primary/50 text-xs'}`}>
              <span className="text-text-muted">{selectedPosition === null ? 'Place here' : 'Move here'}</span>
            </button>
          )
        )}

        {myTimeline.map((card, idx) => {
          const isTrackRevealed = card.track.id !== gameState.activeTrackId || gameState.roundPhase === 'resolution' || gameState.roundPhase === 'game_over';

          return (
            <div key={card.track.id} className="space-y-2">
              <motion.div layout className="glass rounded-xl p-3 flex items-center gap-3 card-enter">
                {isTrackRevealed ? (
                  <>
                    {card.track.album_image_url && <img src={card.track.album_image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-semibold text-sm truncate">{card.track.track_name}</p>
                      <p className="text-text-muted text-xs truncate">{card.track.artist_name}</p>
                    </div>
                    <span className="font-display font-bold text-primary text-lg shrink-0">{card.track.release_year}</span>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center animate-pulse shrink-0">
                      <span className="text-lg animate-spin-slow">💿</span>
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-bold text-sm text-primary-light animate-pulse">Mystery Song</p>
                      <p className="text-text-muted text-xs">Waiting for host to reveal...</p>
                    </div>
                    <span className="font-display font-bold text-primary-light text-base shrink-0 animate-pulse">????</span>
                  </>
                )}
              </motion.div>

            {/* Drop zone / Covered card placeholder after each card */}
            {isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement') && (
              selectedPosition === idx + 1 ? (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-xl p-3 flex items-center gap-3 border-2 border-dashed border-primary bg-primary/10 shadow-lg shadow-primary/10"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center animate-pulse shrink-0">
                    <span className="text-base animate-spin-slow">💿</span>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-bold text-xs text-primary-light animate-pulse">???</p>
                    <p className="text-text-muted text-[10px]">Positioned here (Covered)</p>
                  </div>
                  <span className="font-display font-bold text-primary-light text-base shrink-0 animate-pulse">????</span>
                </motion.div>
              ) : (
                <button onClick={() => setSelectedPosition(idx + 1)} className={`w-full rounded-xl border-2 border-dashed transition-all touch-target py-2 ${selectedPosition === null ? 'h-12 border-border hover:border-primary/50' : 'h-10 border-border/40 hover:border-primary/50 text-xs'}`}>
                  <span className="text-text-muted">{selectedPosition === null ? 'Place here' : 'Move here'}</span>
                </button>
              )
            )}
          </div>
        );
      })}

        {myTimeline.length === 0 && !isMyTurn && (
          <div className="text-center py-12 text-text-muted">
            <p className="text-3xl mb-2">🎵</p>
            <p>Your timeline is empty</p>
            <p className="text-xs">Cards will appear here as you play</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {isMyTurn && (gameState.roundPhase === 'song_playing' || gameState.roundPhase === 'placement') && selectedPosition !== null && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="pb-2">
          <button onClick={handlePlaceCard} className="btn-primary w-full text-lg cursor-pointer">
            Confirm Placement
          </button>
        </motion.div>
      )}

      {/* Token actions */}
      <div className="flex gap-2 pb-safe">
        {me && me.tokens >= GAME.BUY_CARD_COST && (
          <button className="btn-secondary flex-1 text-xs py-3">Buy Card ({GAME.BUY_CARD_COST} 🪙)</button>
        )}
      </div>

      {/* Floating Hand Raise Button for passive players */}
      {!isMyTurn && (
        <div className="fixed bottom-6 right-6 z-50">
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleToggleHand}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 relative border overflow-hidden ${
              me?.hand_raised_at
                ? 'bg-success border-success/30 shadow-success/30 text-white'
                : 'bg-primary border-primary/30 shadow-primary/30 text-white'
            }`}
          >
            {/* Pulsing glow underlay */}
            <div className="absolute inset-0 bg-white/10 opacity-0 hover:opacity-100 transition-opacity" />
            {me?.hand_raised_at && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
              </span>
            )}
            
            <span className={`text-2xl transition-transform duration-300 ${me?.hand_raised_at ? 'scale-110 rotate-12' : 'hover:-rotate-12'}`}>
              ✋
            </span>
          </motion.button>
        </div>
      )}
    </main>
  );
}
