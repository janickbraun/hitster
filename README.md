# Hitster

Hitster is a real-time multiplayer music trivia game where you build a timeline of hit songs. Listen to a track and guess its release year!

## Prerequisites

- Node.js
- Spotify Premium account (required for the game host to play music)
- Supabase project (for database and real-time multiplayer synchronization)

## Getting Started

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   Copy `.env.example` to `.env.local` and fill in your credentials for Supabase and Spotify.
   ```bash
   cp .env.example .env.local
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Play

1. The host starts a game by authenticating with Spotify. A game code will be generated.
2. Players join the game on their own devices using the game code.
3. The host plays a song.
4. Players take turns guessing the release year and placing the song correctly in their timeline.

## Technologies Used

- Next.js
- TypeScript
- Tailwind CSS
- Framer Motion
- Supabase (Database, Auth, Realtime)
- Spotify Web Playback SDK & Web API
