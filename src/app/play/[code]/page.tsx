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
  const gameState = useGameState(gameCode);
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

  // Check for existing session
  useEffect(() => {
    if (playerSession.playerData && playerSession.playerData.gameCode === gameCode) {
      setMyPlayerId(playerSession.playerData.playerId);
      setHasJoined(true);
    }
  }, [playerSession.playerData, gameCode]);

  // Fetch my timeline when game state changes
  useEffect(() => {
    if (myPlayerId && gameState.session?.id) {
      gameState.fetchTimeline(myPlayerId).then(setMyTimeline);
    }
  }, [myPlayerId, gameState.session?.id, gameState.roundPhase]);

  // Listen for steal window
  useEffect(() => {
    if (gameState.roundPhase === 'steal_window') {
      countdown.start(GAME.STEAL_WINDOW_SECONDS * 1000);
    }
  }, [gameState.roundPhase]);

  // Listen for round resolution
  useEffect(() => {
    if (gameState.roundPhase === 'resolution') {
      // The round:resolved broadcast has the data
    }
  }, [gameState.roundPhase]);

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
          tokens: 0,
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

    // Find the active track
    const { data: activeTrack } = await supabase
      .from('game_tracks')
      .select('*')
      .eq('session_id', gameState.session.id)
      .eq('status', 'active')
      .single();

    if (!activeTrack) return;

    // Insert into timeline
    await supabase.from('player_timelines').insert({
      player_id: myPlayerId,
      track_id: activeTrack.id,
      session_id: gameState.session.id,
      position: selectedPosition,
    });

    // Update track status
    await supabase.from('game_tracks').update({ status: 'placed' }).eq('id', activeTrack.id);

    gameState.broadcast({
      type: 'placement:confirmed',
      payload: { player_id: myPlayerId, position: selectedPosition, track_id: activeTrack.id },
    });

    setSelectedPosition(null);
    gameState.fetchTimeline(myPlayerId).then(setMyTimeline);
  };

  const isMyTurn = gameState.session?.current_player_id === myPlayerId;
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const myIdx = me ? gameState.players.indexOf(me) : 0;

  // ========== JOIN FORM ==========
  if (!hasJoined) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-bold gradient-text mb-2">Join Game</h1>
            <p className="text-text-secondary">Code: <span className="font-display font-bold text-primary">{gameCode}</span></p>
          </div>
          <form onSubmit={handleJoin} className="glass rounded-2xl p-6 space-y-4">
            <div>
              <label htmlFor="player-name" className="text-sm font-medium text-text-secondary mb-2 block">Your Name</label>
              <input id="player-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 20))} placeholder="Enter your name" className="input-field text-lg" autoComplete="off" autoFocus maxLength={20} />
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

  // ========== WAITING FOR GAME START ==========
  if (gameState.session?.status === 'lobby' || gameState.roundPhase === 'waiting') {
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
          <span className="text-sm">{me?.tokens || 0} 🪙</span>
          <span className="text-xs text-text-muted">R{gameState.session?.current_round || 0}</span>
        </div>
      </div>

      {/* Status banner */}
      <AnimatePresence mode="wait">
        {isMyTurn ? (
          <motion.div key="my-turn" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-gradient-to-r from-primary to-accent rounded-xl p-3 mb-3 text-center">
            <p className="font-display font-bold text-white">Your Turn!</p>
            <p className="text-white/80 text-xs">Place the song in your timeline</p>
          </motion.div>
        ) : gameState.roundPhase === 'steal_window' ? (
          <motion.div key="steal" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-gradient-to-r from-warning to-error rounded-xl p-3 mb-3 text-center">
            <p className="font-display font-bold text-white">Steal Window!</p>
            <p className="text-white/80 text-xs">{Math.ceil(countdown.timeLeft / 1000)}s remaining</p>
            <div className="mt-2 h-1 bg-white/20 rounded-full overflow-hidden">
              <motion.div className="h-full bg-white rounded-full" style={{ width: `${countdown.progress * 100}%` }} />
            </div>
          </motion.div>
        ) : gameState.roundPhase === 'resolution' ? (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass rounded-xl p-3 mb-3 text-center">
            <p className="font-display font-bold gradient-text">Round Complete</p>
          </motion.div>
        ) : (
          <motion.div key="waiting-turn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass rounded-xl p-3 mb-3 text-center">
            <p className="text-text-muted text-sm">🎵 Listening...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3">
        <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Your Timeline ({myTimeline.length} cards)</p>

        {/* Drop zone: before first card */}
        {isMyTurn && gameState.roundPhase === 'placement' && (
          <button onClick={() => setSelectedPosition(0)} className={`w-full h-12 rounded-xl border-2 border-dashed transition-all touch-target ${selectedPosition === 0 ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}>
            <span className="text-xs text-text-muted">{selectedPosition === 0 ? '✓ Here' : 'Place here'}</span>
          </button>
        )}

        {myTimeline.map((card, idx) => (
          <div key={card.track.id}>
            <motion.div layout className="glass rounded-xl p-3 flex items-center gap-3 card-enter">
              {card.track.album_image_url && <img src={card.track.album_image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{card.track.track_name}</p>
                <p className="text-text-muted text-xs truncate">{card.track.artist_name}</p>
              </div>
              <span className="font-display font-bold text-primary text-lg shrink-0">{card.track.release_year}</span>
            </motion.div>

            {/* Drop zone: after each card */}
            {isMyTurn && gameState.roundPhase === 'placement' && (
              <button onClick={() => setSelectedPosition(idx + 1)} className={`w-full h-12 rounded-xl border-2 border-dashed mt-2 transition-all touch-target ${selectedPosition === idx + 1 ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}>
                <span className="text-xs text-text-muted">{selectedPosition === idx + 1 ? '✓ Here' : 'Place here'}</span>
              </button>
            )}
          </div>
        ))}

        {myTimeline.length === 0 && !isMyTurn && (
          <div className="text-center py-12 text-text-muted">
            <p className="text-3xl mb-2">🎵</p>
            <p>Your timeline is empty</p>
            <p className="text-xs">Cards will appear here as you play</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {isMyTurn && gameState.roundPhase === 'placement' && selectedPosition !== null && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="pb-2">
          <button onClick={handlePlaceCard} className="btn-primary w-full text-lg">
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
    </main>
  );
}
