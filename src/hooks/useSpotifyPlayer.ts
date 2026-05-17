'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SPOTIFY } from '@/lib/utils/constants';
import type { SpotifyWebPlayer, SpotifyPlayerState } from '@/types/spotify';

interface UseSpotifyPlayerReturn {
  player: SpotifyWebPlayer | null;
  deviceId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  currentState: SpotifyPlayerState | null;
  play: (uri: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  error: string | null;
}

export function useSpotifyPlayer(): UseSpotifyPlayerReturn {
  const [player, setPlayer] = useState<SpotifyWebPlayer | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentState, setCurrentState] = useState<SpotifyPlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<SpotifyWebPlayer | null>(null);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const res = await fetch('/api/auth/spotify/token');
    if (!res.ok) throw new Error('Failed to get access token');
    const data = await res.json();
    return data.access_token;
  }, []);

  useEffect(() => {
    // Load the Spotify SDK script
    if (document.getElementById('spotify-player-script')) return;

    const script = document.createElement('script');
    script.id = 'spotify-player-script';
    script.src = SPOTIFY.SDK_URL;
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const spotifyPlayer = new window.Spotify.Player({
        name: SPOTIFY.PLAYER_NAME,
        getOAuthToken: async (cb) => {
          try {
            const token = await getAccessToken();
            cb(token);
          } catch (err) {
            setError('Failed to authenticate with Spotify');
          }
        },
        volume: 0.8,
      });

      // Ready
      spotifyPlayer.addListener('ready', (data: unknown) => {
        const { device_id } = data as { device_id: string };
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);
      });

      // Not Ready
      spotifyPlayer.addListener('not_ready', () => {
        setIsReady(false);
      });

      // Player state changed
      spotifyPlayer.addListener('player_state_changed', (data: unknown) => {
        const state = data as SpotifyPlayerState | null;
        if (state) {
          setCurrentState(state);
          setIsPlaying(!state.paused);
        }
      });

      // Errors
      spotifyPlayer.addListener('initialization_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Init error: ${message}`);
      });
      spotifyPlayer.addListener('authentication_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Auth error: ${message}`);
      });
      spotifyPlayer.addListener('account_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Account error: ${message}. Spotify Premium is required.`);
      });

      spotifyPlayer.connect();
      playerRef.current = spotifyPlayer;
      setPlayer(spotifyPlayer);
    };

    return () => {
      playerRef.current?.disconnect();
    };
  }, [getAccessToken]);

  const play = useCallback(
    async (uri: string) => {
      if (!deviceId) throw new Error('Player not ready');
      const token = await getAccessToken();
      const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [uri] }),
        }
      );
      if (!res.ok && res.status !== 204) throw new Error('Playback failed');
    },
    [deviceId, getAccessToken]
  );

  const pause = useCallback(async () => {
    await playerRef.current?.pause();
  }, []);

  const resume = useCallback(async () => {
    await playerRef.current?.resume();
  }, []);

  const setVolumeLevel = useCallback(async (volume: number) => {
    await playerRef.current?.setVolume(Math.max(0, Math.min(1, volume)));
  }, []);

  return {
    player,
    deviceId,
    isReady,
    isPlaying,
    currentState,
    play,
    pause,
    resume,
    setVolume: setVolumeLevel,
    error,
  };
}
