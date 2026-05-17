import { SPOTIFY } from '@/lib/utils/constants';
import type { SpotifyPlaylistItem, SpotifyPlaylist, SpotifyUser } from '@/types/spotify';

/**
 * Fetches the current user's Spotify profile.
 */
export async function getSpotifyUser(accessToken: string): Promise<SpotifyUser> {
  const response = await fetch(`${SPOTIFY.API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error('Failed to fetch Spotify user');
  return response.json();
}

/**
 * Fetches playlist metadata.
 */
export async function getPlaylist(
  playlistId: string,
  accessToken: string
): Promise<SpotifyPlaylist> {
  const response = await fetch(
    `${SPOTIFY.API_BASE}/playlists/${playlistId}?fields=id,name,description,images,tracks(total),owner(display_name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) throw new Error('Failed to fetch playlist');
  return response.json();
}

/**
 * Fetches ALL items from a Spotify playlist with pagination.
 * Uses the correct `/playlists/{id}/items` endpoint.
 */
export async function getPlaylistItems(
  playlistId: string,
  accessToken: string
): Promise<SpotifyPlaylistItem[]> {
  const allItems: SpotifyPlaylistItem[] = [];
  let url: string | null =
    `${SPOTIFY.API_BASE}/playlists/${playlistId}/items?fields=items(added_at,track(id,name,uri,artists(id,name),album(id,name,images,release_date,release_date_precision),duration_ms,preview_url)),next,total&limit=100`;

  while (url) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch playlist items: ${response.status} ${errorData.error?.message || ''}`
      );
    }

    const data: { items: SpotifyPlaylistItem[]; next: string | null } = await response.json();
    allItems.push(...data.items);
    url = data.next;
  }

  return allItems;
}

/**
 * Extracts a Spotify playlist ID from various URL formats.
 */
export function extractPlaylistId(input: string): string | null {
  // Direct ID
  if (/^[a-zA-Z0-9]{22}$/.test(input)) return input;

  // Various URL formats
  const patterns = [
    /spotify\.com\/playlist\/([a-zA-Z0-9]{22})/,
    /spotify:playlist:([a-zA-Z0-9]{22})/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Extracts the release year from a Spotify track's release_date field.
 */
export function extractReleaseYear(releaseDate: string): number {
  return parseInt(releaseDate.substring(0, 4), 10);
}

/**
 * Starts playback of a track on the Spotify player.
 */
export async function startPlayback(
  accessToken: string,
  deviceId: string,
  spotifyUri: string
): Promise<void> {
  const response = await fetch(
    `${SPOTIFY.API_BASE}/me/player/play?device_id=${deviceId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [spotifyUri] }),
    }
  );

  if (!response.ok && response.status !== 204) {
    throw new Error('Failed to start playback');
  }
}

/**
 * Pauses playback on the Spotify player.
 */
export async function pausePlayback(
  accessToken: string,
  deviceId: string
): Promise<void> {
  const response = await fetch(
    `${SPOTIFY.API_BASE}/me/player/pause?device_id=${deviceId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok && response.status !== 204) {
    throw new Error('Failed to pause playback');
  }
}
