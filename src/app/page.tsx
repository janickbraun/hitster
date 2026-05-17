'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [gameCode, setGameCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const router = useRouter();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (gameCode.length >= 4) {
      router.push(`/play/${gameCode.toUpperCase()}`);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-12"
      >
        <h1 className="font-display text-6xl sm:text-7xl font-extrabold gradient-text mb-4 tracking-tight">
          HITSTER
        </h1>
        <p className="text-text-secondary text-lg sm:text-xl max-w-md mx-auto leading-relaxed">
          The music trivia game where you build a timeline of hits. Can you guess the year?
        </p>
      </motion.div>

      <div className="w-full max-w-sm space-y-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <a href="/api/auth/spotify" id="host-game-button">
            <div className="glass rounded-2xl p-6 cursor-pointer hover:border-primary/40 transition-all duration-300 group">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="font-display text-xl font-bold group-hover:text-primary-light transition-colors">Host a Game</h2>
                  <p className="text-text-muted text-sm mt-0.5">Connect Spotify & invite friends</p>
                </div>
                <svg className="w-5 h-5 text-text-muted group-hover:text-primary-light group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </a>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          {!showJoin ? (
            <button onClick={() => setShowJoin(true)} id="join-game-button" className="w-full glass rounded-2xl p-6 cursor-pointer hover:border-primary/40 transition-all duration-300 group text-left">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-surface-hover border border-border flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-accent-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="font-display text-xl font-bold group-hover:text-accent-light transition-colors">Join a Game</h2>
                  <p className="text-text-muted text-sm mt-0.5">Enter a game code to play</p>
                </div>
                <svg className="w-5 h-5 text-text-muted group-hover:text-accent-light group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ) : (
            <motion.form onSubmit={handleJoin} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-2xl p-6" suppressHydrationWarning>
              <label htmlFor="game-code-input" className="text-sm font-medium text-text-secondary mb-2 block">Game Code</label>
              <div className="flex gap-3">
                <input id="game-code-input" type="text" value={gameCode} onChange={(e) => setGameCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="ABCD" className="input-field text-center font-display text-2xl tracking-[0.3em] uppercase flex-1" autoComplete="off" autoFocus maxLength={4} suppressHydrationWarning />
                <button type="submit" disabled={gameCode.length < 4} className="btn-primary px-6 shrink-0">Go</button>
              </div>
            </motion.form>
          )}
        </motion.div>
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="text-text-muted text-xs mt-12 text-center">
        Host requires Spotify Premium · Players just need a phone
      </motion.p>
    </main>
  );
}
