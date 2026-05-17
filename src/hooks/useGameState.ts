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

export function useGameState(gameCode: string | null): UseGameStateReturn {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentTrack, setCurrentTrack] = useState<GameTrack | null>(null);
  const [roundPhase, setRoundPhase] = useState<RoundPhase>('waiting');
  const [myTimeline, setMyTimeline] = useState<TimelineCard[]>([]);
  const [allTimelines, setAllTimelines] = useState<Record<string, TimelineCard[]>>({});
  const [stealAttempts, setStealAttempts] = useState<StealAttempt[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef(createClient());

  // Fetch the game session
  const fetchSession = useCallback(async () => {
    if (!gameCode) return;
    const { data } = await supabaseRef.current
      .from('game_sessions')
      .select('*')
      .eq('game_code', gameCode.toUpperCase())
      .single();
    if (data) setSession(data);
  }, [gameCode]);

  // Fetch players for the game
  const fetchPlayers = useCallback(async () => {
    if (!session?.id) return;
    const { data } = await supabaseRef.current
      .from('players')
      .select('*')
      .eq('session_id', session.id)
      .order('turn_order');
    if (data) setPlayers(data);
  }, [session?.id]);

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

  // Set up the Realtime channel
  useEffect(() => {
    if (!gameCode) return;

    fetchSession();

    const channel = supabaseRef.current
      .channel(`${REALTIME.CHANNEL_PREFIX}${gameCode}`, {
        config: { broadcast: { self: true } },
      })
      .on('broadcast', { event: 'game:started' }, ({ payload }) => {
        setRoundPhase('round_start');
        fetchSession();
      })
      .on('broadcast', { event: 'round:start' }, ({ payload }) => {
        setRoundPhase('song_playing');
        fetchPlayers();
        fetchAllTimelines();
      })
      .on('broadcast', { event: 'song:playing' }, ({ payload }) => {
        setRoundPhase('song_playing');
      })
      .on('broadcast', { event: 'song:stopped' }, () => {
        setRoundPhase('placement');
      })
      .on('broadcast', { event: 'placement:confirmed' }, ({ payload }) => {
        setRoundPhase('steal_window');
      })
      .on('broadcast', { event: 'steal:window_open' }, ({ payload }) => {
        setRoundPhase('steal_window');
        setStealAttempts([]);
      })
      .on('broadcast', { event: 'steal:attempt' }, ({ payload }) => {
        setStealAttempts((prev) => [...prev, payload as unknown as StealAttempt]);
      })
      .on('broadcast', { event: 'round:resolved' }, ({ payload }) => {
        setRoundPhase('resolution');
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
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabaseRef.current.removeChannel(channel);
    };
  }, [gameCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch players when session loads
  useEffect(() => {
    if (session?.id) {
      fetchPlayers();
    }
  }, [session?.id, fetchPlayers]);

  return {
    session,
    players,
    currentTrack,
    roundPhase,
    myTimeline,
    allTimelines,
    stealAttempts,
    channel: channelRef.current,
    broadcast,
    fetchPlayers,
    fetchTimeline,
    fetchAllTimelines,
    isConnected,
  };
}
