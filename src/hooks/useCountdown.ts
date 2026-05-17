'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseCountdownReturn {
  timeLeft: number;
  progress: number; // 0 to 1
  isActive: boolean;
  start: (durationMs: number, startAt?: string) => void;
  stop: () => void;
}

export function useCountdown(): UseCountdownReturn {
  const [timeLeft, setTimeLeft] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeRef = useRef<number>(0);

  const stop = useCallback(() => {
    setIsActive(false);
    setTimeLeft(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(
    (durationMs: number, startAt?: string) => {
      // If startAt is provided (server timestamp), compute end time from that
      const startTime = startAt ? new Date(startAt).getTime() : Date.now();
      const endTime = startTime + durationMs;
      endTimeRef.current = endTime;
      setDuration(durationMs);
      setIsActive(true);

      // Update immediately
      const remaining = Math.max(0, endTime - Date.now());
      setTimeLeft(remaining);

      if (remaining <= 0) {
        stop();
        return;
      }

      // Start interval
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const left = Math.max(0, endTimeRef.current - now);
        setTimeLeft(left);

        if (left <= 0) {
          stop();
        }
      }, 50); // 50ms for smooth progress ring
    },
    [stop]
  );

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const progress = duration > 0 ? Math.max(0, Math.min(1, timeLeft / duration)) : 0;

  return {
    timeLeft,
    progress,
    isActive,
    start,
    stop,
  };
}
