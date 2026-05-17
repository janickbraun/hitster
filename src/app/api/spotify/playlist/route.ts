import { NextResponse, type NextRequest } from 'next/server';
import { getPlaylist, getPlaylistItems, extractPlaylistId, extractReleaseYear } from '@/lib/spotify/api';
import { cookies } from 'next/headers';
import type { SpotifyTokens } from '@/types/spotify';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const tokensCookie = cookieStore.get('spotify_tokens');

  if (!tokensCookie) {
    return NextResponse.json({ error: 'Not authenticated with Spotify' }, { status: 401 });
  }

  const tokens: SpotifyTokens = JSON.parse(tokensCookie.value);
  const body = await request.json();
  const { playlistUrl } = body;

  const playlistId = extractPlaylistId(playlistUrl || '');
  if (!playlistId) {
    return NextResponse.json({ error: 'Invalid playlist URL' }, { status: 400 });
  }

  try {
    // Fetch playlist metadata
    const playlist = await getPlaylist(playlistId, tokens.access_token);

    // Fetch all tracks
    const items = await getPlaylistItems(playlistId, tokens.access_token);

    // Filter and transform tracks
    const tracks = items
      .filter((item) => item.track && item.track.id) // Filter out null/deleted tracks
      .map((item) => ({
        spotify_track_id: item.track!.id,
        track_name: item.track!.name,
        artist_name: item.track!.artists.map((a) => a.name).join(', '),
        album_name: item.track!.album.name,
        album_image_url: item.track!.album.images[0]?.url || null,
        release_year: extractReleaseYear(item.track!.album.release_date),
        spotify_uri: item.track!.uri,
      }));

    return NextResponse.json({
      playlist: {
        id: playlist.id,
        name: playlist.name,
        total_tracks: tracks.length,
        image_url: playlist.images[0]?.url,
        owner: playlist.owner.display_name,
      },
      tracks,
    });
  } catch (err) {
    console.error('Playlist fetch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch playlist' },
      { status: 500 }
    );
  }
}
