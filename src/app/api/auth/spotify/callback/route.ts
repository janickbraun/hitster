import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/spotify/auth';
import { getSpotifyUser } from '@/lib/spotify/api';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Dynamically determine the app URL from the request headers to support local network/tunnels (ngrok)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  
  // Clean protocol (in case of comma-separated list like in some proxies)
  const cleanProtocol = protocol.split(',')[0].trim();
  const origin = `${cleanProtocol}://${host}`;

  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/?error=missing_params`
    );
  }

  // Validate CSRF state
  const cookieStore = await cookies();
  const storedState = cookieStore.get('spotify_auth_state')?.value;
  cookieStore.delete('spotify_auth_state');

  if (state !== storedState) {
    return NextResponse.redirect(
      `${origin}/?error=state_mismatch`
    );
  }

  try {
    const redirectUri = `${origin}/api/auth/spotify/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Fetch Spotify user profile
    const spotifyUser = await getSpotifyUser(tokens.access_token);

    // Sign into Supabase (create user if needed)
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: spotifyUser.email || `${spotifyUser.id}@spotify.hitster`,
      password: spotifyUser.id, // Use Spotify ID as deterministic password
    });

    if (authError) {
      // User doesn't exist yet, sign them up
      const { error: signUpError } = await supabase.auth.signUp({
        email: spotifyUser.email || `${spotifyUser.id}@spotify.hitster`,
        password: spotifyUser.id,
        options: {
          data: {
            spotify_id: spotifyUser.id,
            display_name: spotifyUser.display_name,
            avatar_url: spotifyUser.images?.[0]?.url,
            is_premium: spotifyUser.product === 'premium',
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      // Sign in after signup
      await supabase.auth.signInWithPassword({
        email: spotifyUser.email || `${spotifyUser.id}@spotify.hitster`,
        password: spotifyUser.id,
      });
    }

    // Store Spotify tokens in a secure cookie
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    cookieStore.set('spotify_tokens', JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    // Store premium status
    cookieStore.set('spotify_premium', spotifyUser.product === 'premium' ? 'true' : 'false', {
      httpOnly: false, // Allow client-side access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });

    return NextResponse.redirect(`${origin}/host`);
  } catch (err) {
    console.error('Spotify callback error:', err);
    return NextResponse.redirect(
      `${origin}/?error=auth_failed`
    );
  }
}
