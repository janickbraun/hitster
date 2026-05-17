import { NextResponse, type NextRequest } from 'next/server';
import { refreshAccessToken } from '@/lib/spotify/auth';
import { cookies } from 'next/headers';
import type { SpotifyTokens } from '@/types/spotify';

/**
 * Returns a fresh Spotify access token, refreshing if needed.
 * Called by the client to get a token for the Web Playback SDK.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const tokensCookie = cookieStore.get('spotify_tokens');

  if (!tokensCookie) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tokens: SpotifyTokens = JSON.parse(tokensCookie.value);

  // Check if token is expired (with 60s buffer)
  if (Date.now() >= tokens.expires_at - 60000) {
    try {
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      const newTokens: SpotifyTokens = {
        access_token: refreshed.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };

      cookieStore.set('spotify_tokens', JSON.stringify(newTokens), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      });

      return NextResponse.json({ access_token: newTokens.access_token });
    } catch {
      return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
    }
  }

  return NextResponse.json({ access_token: tokens.access_token });
}
