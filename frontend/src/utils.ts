// Pure utility functions shared between components and tests.

export function formatTime(s: number | null): string {
  if (s == null) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

export const APP_NAMES: Record<string, string> = {
  'com.netflix.Netflix': 'Netflix',
  'com.apple.TVWatchList': 'Apple TV+',
  'com.apple.TVMovies': 'Movies',
  'com.apple.TVShows': 'TV Shows',
  'com.apple.TVMusic': 'Apple Music',
  'com.apple.TVHomeSharing': 'Home Sharing',
  'com.hulu.plus': 'Hulu',
  'com.amazon.aiv.AIVApp': 'Prime Video',
  'com.disney.disneyplus': 'Disney+',
  'com.hbo.hbonow': 'Max',
  'com.wbd.stream': 'Max',
  'com.spotify.client': 'Spotify',
  'com.plex.plex-tv': 'Plex',
  'com.apple.TVAirPlay': 'AirPlay',
  'com.apple.TVPhotos': 'Photos',
  'com.apple.TVYouTube': 'YouTube',
  'com.google.ios.youtube': 'YouTube',
  'com.madebysofa.Infuse': 'Infuse',
  'com.firecore.infuse7': 'Infuse',
};

export function appLabel(appId: string | null): string | null {
  if (!appId) return null;
  return APP_NAMES[appId] ?? appId.split('.').pop() ?? appId;
}

// Titles that indicate a trailer/teaser — suppress TMDB/scores lookups for these.
const GENERIC_TITLE_RE = /^(teaser|trailer|preview|clip|promo|featurette|sneak peek)$/i;
export function isGenericVideoTitle(title: string | null): boolean {
  return GENERIC_TITLE_RE.test((title ?? '').trim());
}

// Hulu encodes episode info in the title: "Series | S5 E8 - Episode Title"
const HULU_RE = /^(.+?)\s*\|\s*S(\d+)\s*E(\d+)(?:\s*[-–]\s*(.+))?$/i;

export interface HuluParsed {
  series: string;
  season: number;
  episode: number;
  episodeTitle: string | null;
}

export function parseHuluTitle(title: string): HuluParsed | null {
  const m = HULU_RE.exec(title);
  if (!m) return null;
  return {
    series: m[1],
    season: parseInt(m[2]),
    episode: parseInt(m[3]),
    episodeTitle: m[4] ?? null,
  };
}

// Plex / Infuse: artist = series, album = "Season N", title = "S1 · E1: Episode Title"
// Only uses structural signals from the metadata itself — app-specific logic uses app_id instead.
export function detectPlexSeries(
  title: string | null,
  album: string | null,
  artist: string | null,
): string | null {
  if (!artist) return null;
  const titleLooksLikeEpisode = /^S\d+\s*[·•\-]\s*E\d+/i.test(title ?? '');
  const albumLooksLikeSeason = /^season\s+\d+/i.test(album ?? '');
  return titleLooksLikeEpisode || albumLooksLikeSeason ? artist : null;
}

// Plex encodes title as "S1 · E1: Episode Name" — extract season, episode, and title.
export interface PlexTitleParsed {
  season: number;
  episode: number;
  episodeTitle: string | null;
}

export function parsePlexTitle(title: string | null): PlexTitleParsed | null {
  if (!title) return null;
  const m = /^S(\d+)\s*[·•\-]\s*E(\d+)(?:\s*:\s*(.+))?$/i.exec(title.trim());
  if (!m) return null;
  return {
    season: parseInt(m[1]),
    episode: parseInt(m[2]),
    episodeTitle: m[3]?.trim() ?? null,
  };
}

// Apps that encode artist=series, title=episode with no structural album cues
export const ARTIST_AS_SERIES_APP_IDS = new Set([
  'com.wbd.stream',   // Max (HBO Max)
  'com.hbo.hbonow',   // Max (legacy bundle ID)
]);

export const YOUTUBE_APP_IDS = new Set([
  'com.apple.TVYouTube',
  'com.google.ios.youtube',
]);

// Fetch album art from the iTunes Search API (no API key required).
// Returns a 600x600 artwork URL, or null if nothing found.
export async function fetchItunesAlbumArt(artist: string | null, album: string | null, title: string | null): Promise<string | null> {
  const term = [artist, album ?? title].filter(Boolean).join(' ');
  if (!term) return null;
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=album&limit=1`);
    const data = await res.json();
    const raw: string | undefined = data?.results?.[0]?.artworkUrl100;
    return raw ? raw.replace('100x100bb', '600x600bb') : null;
  } catch {
    return null;
  }
}
