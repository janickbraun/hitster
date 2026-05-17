# Hitster

Hitster is a real-time multiplayer music trivia game where you build a timeline of hit songs. Listen to a track and guess its release year!

## Prerequisites

- Node.js
- Spotify Premium account (required for the game host to play music)
- Supabase project (for database and real-time multiplayer synchronization)

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
