'use client';

import { useState, useEffect, useCallback } from 'react';
import { generateSessionToken } from '@/lib/utils/game-code';

const SESSION_TOKEN_KEY = 'hitster_session_token';
const PLAYER_DATA_KEY = 'hitster_player_data';

interface PlayerData {
  playerId: string;
  sessionId: string;
  displayName: string;
  gameCode: string;
}

interface UsePlayerSessionReturn {
  sessionToken: string;
  playerData: PlayerData | null;
  savePlayerData: (data: PlayerData) => void;
  clearSession: () => void;
  isReconnecting: boolean;
}

export function usePlayerSession(): UsePlayerSessionReturn {
  const [sessionToken, setSessionToken] = useState<string>('');
  const [playerData, setPlayerData] = useState<PlayerData | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    // Get or create session token
    let token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!token) {
      token = generateSessionToken();
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    }
    setSessionToken(token);

    // Check for existing player data
    const savedData = localStorage.getItem(PLAYER_DATA_KEY);
    if (savedData) {
      try {
        setPlayerData(JSON.parse(savedData));
      } catch {
        localStorage.removeItem(PLAYER_DATA_KEY);
      }
    }
  }, []);

  const savePlayerData = useCallback((data: PlayerData) => {
    setPlayerData(data);
    localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(data));
  }, []);

  const clearSession = useCallback(() => {
    setPlayerData(null);
    localStorage.removeItem(PLAYER_DATA_KEY);
    // Keep the session token for potential reconnection
  }, []);

  return {
    sessionToken,
    playerData,
    savePlayerData,
    clearSession,
    isReconnecting,
  };
}
