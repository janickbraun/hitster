import { SPOTIFY } from '@/lib/utils/constants';

/**
 * Generates the Spotify OAuth authorization URL.
 */
export function getSpotifyAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: SPOTIFY.SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'false',
  });

  return `${SPOTIFY.AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const response = await fetch(SPOTIFY.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Spotify token exchange failed: ${error.error_description || error.error}`);
  }

  return response.json();
}

/**
 * Refreshes an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const response = await fetch(SPOTIFY.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Spotify token refresh failed: ${error.error_description || error.error}`);
  }

  return response.json();
}
