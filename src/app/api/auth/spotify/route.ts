import { NextResponse, type NextRequest } from 'next/server';
import { getSpotifyAuthUrl } from '@/lib/spotify/auth';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set('spotify_auth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  // Dynamically determine the app URL from the request headers to support local network/tunnels (ngrok)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  
  // Clean protocol (in case of comma-separated list like in some proxies)
  const cleanProtocol = protocol.split(',')[0].trim();
  const origin = `${cleanProtocol}://${host}`;

  const redirectUri = `${origin}/api/auth/spotify/callback`;
  const authUrl = getSpotifyAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
