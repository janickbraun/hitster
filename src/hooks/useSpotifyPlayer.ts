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
  transferPlayback: () => Promise<void>;
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
    let spotifyPlayer: SpotifyWebPlayer | null = null;

    const initializePlayer = () => {
      if (playerRef.current) return; // Already initialized

      const playerInstance = new window.Spotify.Player({
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

      // Set refs and state
      playerRef.current = playerInstance;
      setPlayer(playerInstance);
      spotifyPlayer = playerInstance;

      // Ready
      playerInstance.addListener('ready', async (data: unknown) => {
        const { device_id } = data as { device_id: string };
        setDeviceId(device_id);
        setIsReady(true);
        setError(null);

        // Programmatically transfer playback to this device to make it active
        const attemptTransfer = async (retries = 2, delayMs = 500) => {
          try {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            const token = await getAccessToken();
            const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                device_ids: [device_id],
                play: false,
              }),
            });
            
            if (!transferRes.ok) {
              if (retries > 0) {
                return attemptTransfer(retries - 1, delayMs * 2);
              }
              const errText = await transferRes.text().catch(() => '');
              console.warn(`Failed to transfer playback to web player device: ${transferRes.status} ${errText}`);
            }
          } catch (err) {
            console.warn('Failed to transfer playback to web player:', err);
          }
        };
        
        attemptTransfer();
      });

      // Not Ready
      playerInstance.addListener('not_ready', () => {
        setIsReady(false);
      });

      // Player state changed
      playerInstance.addListener('player_state_changed', (data: unknown) => {
        const state = data as SpotifyPlayerState | null;
        if (state) {
          setCurrentState(state);
          setIsPlaying(!state.paused);
        }
      });

      // Errors
      playerInstance.addListener('initialization_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Init error: ${message}`);
      });
      playerInstance.addListener('authentication_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Auth error: ${message}`);
      });
      playerInstance.addListener('account_error', (data: unknown) => {
        const { message } = data as { message: string };
        setError(`Account error: ${message}. Spotify Premium is required.`);
      });

      playerInstance.connect();
    };

    // If SDK is already loaded and ready in window
    if (window.Spotify && window.Spotify.Player) {
      initializePlayer();
    } else {
      // Define the callback for when SDK loads
      window.onSpotifyWebPlaybackSDKReady = initializePlayer;

      // Add the script if not already added
      if (!document.getElementById('spotify-player-script')) {
        const script = document.createElement('script');
        script.id = 'spotify-player-script';
        script.src = SPOTIFY.SDK_URL;
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      if (spotifyPlayer) {
        spotifyPlayer.disconnect();
        playerRef.current = null;
        setPlayer(null);
        setDeviceId(null);
        setIsReady(false);
      }
    };
  }, [getAccessToken]);

  const play = useCallback(
    async (uri: string) => {
      try {
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
        if (!res.ok && res.status !== 204) {
          let errorMsg = 'Playback failed';
          try {
            const data = await res.json();
            if (data.error?.message) {
              errorMsg = `Playback failed: ${data.error.message}`;
            }
          } catch {}
          throw new Error(errorMsg);
        }
        setError(null);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Playback failed';
        setError(errMsg);
        console.warn('Spotify Playback Warning:', err);
      }
    },
    [deviceId, getAccessToken]
  );

  const transferPlayback = useCallback(async () => {
    if (!deviceId) return;
    try {
      const token = await getAccessToken();
      const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      });
      if (!transferRes.ok) {
        throw new Error('Failed to transfer playback to this device');
      }
      setError(null);
    } catch (err) {
      console.warn('Failed to transfer playback:', err);
      setError(err instanceof Error ? err.message : 'Failed to transfer playback');
    }
  }, [deviceId, getAccessToken]);

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
    transferPlayback,
    error,
  };
}
