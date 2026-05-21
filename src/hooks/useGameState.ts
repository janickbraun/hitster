'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { REALTIME } from '@/lib/utils/constants';
import type {
  GameSession,
  Player,
  GameTrack,
  RoundPhase,
  TimelineCard,
  StealAttempt,
  BroadcastEvent,
  GameState,
} from '@/types/game';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseGameStateReturn extends GameState {
  channel: RealtimeChannel | null;
  broadcast: (event: BroadcastEvent) => void;
  fetchPlayers: () => Promise<void>;
  fetchTimeline: (playerId: string) => Promise<TimelineCard[]>;
  fetchAllTimelines: () => Promise<void>;
  isConnected: boolean;
}

export function useGameState(
  gameCode: string | null,
  myPlayerId?: string | null,
  isHost?: boolean
): UseGameStateReturn {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentTrack, setCurrentTrack] = useState<GameTrack | null>(null);
  const [roundPhase, setRoundPhase] = useState<RoundPhase>('waiting');
  const [myTimeline, setMyTimeline] = useState<TimelineCard[]>([]);
  const [allTimelines, setAllTimelines] = useState<Record<string, TimelineCard[]>>({});
  const [stealAttempts, setStealAttempts] = useState<StealAttempt[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef(createClient());
  const lastConnectedStatesRef = useRef<Record<string, boolean>>({});

  // Fetch the game session
  const fetchSession = useCallback(async () => {
    if (!gameCode) return;
    const { data } = await supabaseRef.current
      .from('game_sessions')
      .select('*')
      .eq('game_code', gameCode.toUpperCase())
      .single();
    if (data) {
      setSession(data);
      if (data.status === 'playing') {
        supabaseRef.current
          .from('game_tracks')
          .select('id')
          .eq('session_id', data.id)
          .eq('deck_position', data.current_track_index)
          .single()
          .then(({ data: activeTrack }) => {
            if (activeTrack) {
              setActiveTrackId(activeTrack.id);
            }
          });
      }
      // If the game session has status 'playing', but our local roundPhase is still 'waiting',
      // transition to an active phase to let the player view and play the game.
      setRoundPhase((prev) => {
        if (prev === 'waiting' && data.status === 'playing') {
          if (data.steal_window_start_at) {
            const startAt = new Date(data.steal_window_start_at).getTime();
            const now = Date.now();
            const elapsed = now - startAt;
            // 15 seconds window duration (matches GAME.STEAL_WINDOW_SECONDS * 1000)
            if (elapsed < 15000) {
              return 'steal_window';
            }
          }
          return 'placement';
        }
        return prev;
      });
    }
  }, [gameCode]);

  // Fetch players for the game
  const fetchPlayers = useCallback(async () => {
    if (!session?.id) return;
    const { data } = await supabaseRef.current
      .from('players')
      .select('*')
      .eq('session_id', session.id)
      .order('turn_order');
    if (data) {
      setPlayers(data);
      // Initialize the ref with DB values
      data.forEach((p) => {
        lastConnectedStatesRef.current[p.id] = p.is_connected;
      });
    }
  }, [session?.id]);

  // Fetch steal attempts for the current round/track
  const fetchStealAttempts = useCallback(async () => {
    if (!session?.id || !activeTrackId) return;
    const { data } = await supabaseRef.current
      .from('steal_attempts')
      .select('*')
      .eq('session_id', session.id)
      .eq('track_id', activeTrackId);
    if (data) {
      setStealAttempts(data);
    }
  }, [session?.id, activeTrackId]);

  // Fetch a player's timeline
  const fetchTimeline = useCallback(
    async (playerId: string): Promise<TimelineCard[]> => {
      if (!session?.id) return [];
      const { data } = await supabaseRef.current
        .from('player_timelines')
        .select('*, game_tracks(*)')
        .eq('player_id', playerId)
        .eq('session_id', session.id)
        .order('position');

      if (!data) return [];
      return data.map((entry: { game_tracks: GameTrack; position: number }) => ({
        track: entry.game_tracks,
        position: entry.position,
        isRevealed: true,
      }));
    },
    [session?.id]
  );

  // Fetch all players' timelines
  const fetchAllTimelines = useCallback(async () => {
    if (!session?.id || players.length === 0) return;
    const timelines: Record<string, TimelineCard[]> = {};
    for (const player of players) {
      timelines[player.id] = await fetchTimeline(player.id);
    }
    setAllTimelines(timelines);
  }, [session?.id, players, fetchTimeline]);

  // Broadcast an event to the game channel
  const broadcast = useCallback(
    (event: BroadcastEvent) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: event.type,
        payload: event.payload,
      });
    },
    []
  );

  // Track presence when subscribed and myPlayerId is available
  useEffect(() => {
    const channel = channelRef.current;
    if (channel && isConnected && myPlayerId) {
      channel.track({
        player_id: myPlayerId,
        online_at: new Date().toISOString(),
      }).catch((err) => {
        console.error('Error tracking presence:', err);
      });
    }
  }, [isConnected, myPlayerId]);

  // Set up the Realtime channel
  useEffect(() => {
    if (!gameCode) return;

    fetchSession();

    const channel = supabaseRef.current
      .channel(`${REALTIME.CHANNEL_PREFIX}${gameCode}`, {
        config: { broadcast: { self: true } },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const activeIds = new Set<string>();
        Object.values(state).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.player_id) {
              activeIds.add(p.player_id);
            }
          });
        });

        setPlayers((prev) => {
          const mapped = prev.map((player) => {
            const isConnectedNow = activeIds.has(player.id);

            // If we are the host, sync to the database when connection status changes
            if (isHost && session?.id) {
              const wasConnected = lastConnectedStatesRef.current[player.id];
              if (wasConnected !== isConnectedNow) {
                lastConnectedStatesRef.current[player.id] = isConnectedNow;

                if (session.status === 'lobby' && !isConnectedNow) {
                  // Player disconnected during lobby, delete them from DB so lobby doesn't get stuck
                  supabaseRef.current
                    .from('players')
                    .delete()
                    .eq('id', player.id)
                    .then(({ error }) => {
                      if (error) {
                        console.error('Failed to remove player from lobby:', error);
                      } else {
                        broadcast({ type: 'player:left', payload: { player_id: player.id } });
                      }
                    });
                } else {
                  // Update DB asynchronously
                  supabaseRef.current
                    .from('players')
                    .update({ is_connected: isConnectedNow })
                    .eq('id', player.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to sync player connection status:', error);
                    });
                }
              }
            }

            return {
              ...player,
              is_connected: isConnectedNow,
            };
          });

          // If in lobby, filter out disconnected players immediately to avoid layout flicker
          if (session?.status === 'lobby') {
            return mapped.filter((p) => activeIds.has(p.id));
          }
          return mapped;
        });
      })
      .on('broadcast', { event: 'game:started' }, ({ payload }) => {
        setRoundPhase('round_start');
        fetchSession();
      })
      .on('broadcast', { event: 'round:start' }, ({ payload }) => {
        const p = payload as { round: number; track_id: string; active_player_id: string; active_player_name: string };
        setRoundPhase('song_playing');
        setCurrentTrack(null);
        setActiveTrackId(p.track_id);
        setStealAttempts([]);
        setSession((prev) => prev ? { ...prev, current_round: p.round, current_player_id: p.active_player_id } : null);
        fetchSession();
        setPlayers((prev) => prev.map((player) => ({ ...player, hand_raised_at: null })));
        fetchPlayers();
        fetchAllTimelines();
      })
      .on('broadcast', { event: 'player:hand_changed' }, ({ payload }) => {
        const p = payload as { player_id: string; hand_raised_at: string | null };
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === p.player_id ? { ...player, hand_raised_at: p.hand_raised_at } : player
          )
        );
      })
      .on('broadcast', { event: 'song:playing' }, ({ payload }) => {
        setRoundPhase('song_playing');
      })
      .on('broadcast', { event: 'song:stopped' }, () => {
        setRoundPhase('placement');
      })
      .on('broadcast', { event: 'placement:confirmed' }, ({ payload }) => {
        setRoundPhase('steal_window');
        const p = payload as { player_id: string; position: number; track_id: string };
        setActiveTrackId(p.track_id);
        fetchAllTimelines();
      })
      .on('broadcast', { event: 'steal:window_open' }, ({ payload }) => {
        const p = payload as { start_at: string; track_id: string; active_player_id: string };
        setRoundPhase('steal_window');
        setActiveTrackId(p.track_id);
        setSession((prev) => prev ? { ...prev, current_player_id: p.active_player_id, steal_window_start_at: p.start_at } : null);
        fetchSession();
        setStealAttempts([]);
      })
      .on('broadcast', { event: 'steal:attempt' }, ({ payload }) => {
        setStealAttempts((prev) => {
          const attempt = payload as unknown as StealAttempt;
          if (prev.some((s) => s.id === attempt.id)) return prev;
          return [...prev, attempt];
        });
        fetchPlayers();
      })
      .on('broadcast', { event: 'round:resolved' }, ({ payload }) => {
        const p = payload as { winner_id: string | null; track: GameTrack };
        setRoundPhase('resolution');
        setCurrentTrack(p.track);
        setActiveTrackId(null);
        fetchSession();
        fetchAllTimelines();
        fetchPlayers();
      })
      .on('broadcast', { event: 'token:awarded' }, ({ payload }) => {
        const p = payload as { player_id: string; new_count: number };
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === p.player_id ? { ...player, tokens: p.new_count } : player
          )
        );
      })
      .on('broadcast', { event: 'token:spent' }, ({ payload }) => {
        const p = payload as { player_id: string; new_count: number };
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === p.player_id ? { ...player, tokens: p.new_count } : player
          )
        );
      })
      .on('broadcast', { event: 'game:finished' }, ({ payload }) => {
        setRoundPhase('game_over');
        fetchSession();
      })
      .on('broadcast', { event: 'player:joined' }, ({ payload }) => {
        const newPlayer = payload as Player;
        setPlayers((prev) => {
          if (prev.some((p) => p.id === newPlayer.id)) return prev;
          return [...prev, newPlayer];
        });
      })
      .on('broadcast', { event: 'player:disconnected' }, ({ payload }) => {
        const p = payload as { player_id: string };
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === p.player_id ? { ...player, is_connected: false } : player
          )
        );
      })
      .on('broadcast', { event: 'player:left' }, ({ payload }) => {
        const p = payload as { player_id: string };
        setPlayers((prev) => prev.filter((player) => player.id !== p.player_id));
      })
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabaseRef.current.removeChannel(channel);
    };
  }, [gameCode, isHost, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch players when session loads
  useEffect(() => {
    if (session?.id) {
      fetchPlayers();
    }
  }, [session?.id, fetchPlayers]);

  // Fetch steal attempts when steal window is active
  useEffect(() => {
    if (roundPhase === 'steal_window' && session?.id && activeTrackId) {
      fetchStealAttempts();
    }
  }, [roundPhase, session?.id, activeTrackId, fetchStealAttempts]);

  // Fetch all timelines when session, players, or round phase changes
  useEffect(() => {
    if (session?.id && players.length > 0) {
      fetchAllTimelines();
    }
  }, [session?.id, players.length, roundPhase, fetchAllTimelines]);

  return {
    session,
    players,
    currentTrack,
    roundPhase,
    myTimeline,
    allTimelines,
    stealAttempts,
    activeTrackId,
    channel: channelRef.current,
    broadcast,
    fetchPlayers,
    fetchTimeline,
    fetchAllTimelines,
    isConnected,
  };
}
