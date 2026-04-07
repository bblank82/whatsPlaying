// Shared hooks and types for content metadata, scores, and artwork.
// Used by DeviceCard and CinematicKioskView.

import { useState, useEffect } from 'react';
import type { NowPlaying } from '../types';
import {
  parseHuluTitle, parsePlexTitle, detectPlexSeries,
  isGenericVideoTitle, ARTIST_AS_SERIES_APP_IDS, YOUTUBE_APP_IDS,
  fetchItunesAlbumArt,
} from '../utils';

// ---------------------------------------------------------------------------
// ScoreState — shared by DeviceCard and CinematicKioskView
// ---------------------------------------------------------------------------

export interface ScoreState {
  tomatometer: number | null;
  audience_score: number | null;
  url: string | null;
  imdb_id: string | null;
  imdb_rating: string | null;
}

// ---------------------------------------------------------------------------
// Content metadata — pure derivation from now_playing, no React state
// ---------------------------------------------------------------------------

export interface ContentMetadata {
  effectiveSeries: string | null;
  effectiveSeason: number | null;
  effectiveEpisode: number | null;
  effectiveEpisodeTitle: string | null;
  isYouTube: boolean;
  isVideo: boolean;
  isMusic: boolean;
  lookupTitle: string | null;
  mediaTypeForApi: 'show' | 'movie';
  forceMediaType: boolean;
  /** Raw hulu parse result — needed by DeviceCard to inject effectiveEpisodeTitle */
  huluMatch: ReturnType<typeof parseHuluTitle>;
}

export function parseContentMetadata(now_playing: NowPlaying | null): ContentMetadata {
  const appId = now_playing?.app_id ?? null;
  const isYouTube = YOUTUBE_APP_IDS.has(appId ?? '');
  const isMusic = now_playing?.media_type?.toLowerCase().includes('music') ?? false;

  const huluMatch = appId === 'com.hulu.plus' ? parseHuluTitle(now_playing?.title ?? '') : null;
  const artistIsSeriesByAppId = ARTIST_AS_SERIES_APP_IDS.has(appId ?? '') && !!now_playing?.artist;
  const artistAsSeries = artistIsSeriesByAppId
    ? (now_playing?.artist ?? null)
    : detectPlexSeries(now_playing?.title ?? null, now_playing?.album ?? null, now_playing?.artist ?? null);
  const plexTitle = artistAsSeries && !artistIsSeriesByAppId
    ? parsePlexTitle(now_playing?.title ?? null)
    : null;

  const effectiveSeries = now_playing?.series_name ?? huluMatch?.series ?? artistAsSeries ?? null;
  const effectiveSeason = now_playing?.season_number ?? huluMatch?.season ?? plexTitle?.season ?? null;
  const effectiveEpisode = now_playing?.episode_number ?? huluMatch?.episode ?? plexTitle?.episode ?? null;
  const effectiveEpisodeTitle =
    huluMatch ? huluMatch.episodeTitle
    : plexTitle ? plexTitle.episodeTitle
    : artistIsSeriesByAppId ? (now_playing?.title ?? null)
    : null;

  const isGenericTitle = isGenericVideoTitle(now_playing?.title ?? null);
  const isVideo = !isGenericTitle && !isYouTube && !!(
    effectiveSeries ||
    effectiveSeason != null ||
    (now_playing?.media_type?.toLowerCase().includes('video') && now_playing?.title)
  );
  const lookupTitle = effectiveSeries ?? now_playing?.title ?? null;
  const mediaTypeForApi: 'show' | 'movie' = effectiveSeries ? 'show' : 'movie';
  const forceMediaType = !effectiveSeries && now_playing?.media_type === 'MediaType.Video';

  return {
    effectiveSeries, effectiveSeason, effectiveEpisode, effectiveEpisodeTitle,
    isYouTube, isVideo, isMusic, lookupTitle, mediaTypeForApi, forceMediaType,
    huluMatch,
  };
}

// ---------------------------------------------------------------------------
// useScores — fetches RT/IMDb scores for video content
// ---------------------------------------------------------------------------

export function useScores(
  lookupTitle: string | null,
  mediaTypeForApi: string,
  forceMediaType: boolean,
  isVideo: boolean,
  isActive: boolean,
): ScoreState | null {
  const [scores, setScores] = useState<ScoreState | null>(null);
  useEffect(() => {
    if (!lookupTitle || !isVideo || !isActive) { setScores(null); return; }
    setScores(null);
    const params = new URLSearchParams({ title: lookupTitle, media_type: mediaTypeForApi });
    if (forceMediaType) params.set('force_media_type', 'true');
    fetch(`/api/scores?${params}`)
      .then(r => r.json()).then(setScores).catch(() => {});
  }, [lookupTitle, mediaTypeForApi, forceMediaType, isVideo, isActive]);
  return scores;
}

// ---------------------------------------------------------------------------
// useContentArtwork — all artwork sources for a device card
// ---------------------------------------------------------------------------

export interface ContentArtworkParams {
  identifier: string;
  connected: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  isActive: boolean;
  isVideo: boolean;
  isYouTube: boolean;
  isMusic: boolean;
  now_playing: NowPlaying | null;
  lookupTitle: string | null;
  mediaTypeForApi: string;
  forceMediaType: boolean;
  effectiveSeries: string | null;
  effectiveSeason: number | null;
}

export interface ContentArtworkResult {
  cardArtworkSrc: string | null;
  artworkFullscreenSrc: string | null;
  tmdbResolved: boolean;
  appIconUrl: string | null;
}

export function useContentArtwork({
  identifier, connected, isPlaying, isPaused, isActive,
  isVideo, isYouTube, isMusic, now_playing,
  lookupTitle, mediaTypeForApi, forceMediaType, effectiveSeries, effectiveSeason,
}: ContentArtworkParams): ContentArtworkResult {

  // Native device artwork
  const artworkCacheKey = now_playing?.artwork_id ?? now_playing?.title ?? null;
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  useEffect(() => {
    if ((!isPlaying && !isPaused) || !connected) { setArtworkUrl(null); return; }
    const v = encodeURIComponent(artworkCacheKey ?? 'playing');
    setArtworkUrl(`/api/devices/${encodeURIComponent(identifier)}/artwork?v=${v}`);
  }, [artworkCacheKey, isPlaying, isPaused, connected, identifier]);

  // TMDB poster
  const [tmdbPosterUrl, setTmdbPosterUrl]     = useState<string | null>(null);
  const [tmdbFullsizeUrl, setTmdbFullsizeUrl] = useState<string | null>(null);
  const [tmdbResolved, setTmdbResolved]       = useState(false);
  useEffect(() => {
    if (!lookupTitle || !isVideo || !isActive) {
      setTmdbPosterUrl(null); setTmdbFullsizeUrl(null); setTmdbResolved(false); return;
    }
    setTmdbResolved(false);
    const params = new URLSearchParams({ title: lookupTitle, media_type: mediaTypeForApi });
    if (forceMediaType) params.set('force_media_type', 'true');
    if (effectiveSeason != null) params.set('season_number', String(effectiveSeason));
    if (effectiveSeries && now_playing?.title && effectiveSeason == null)
      params.set('episode_title', now_playing.title);
    fetch(`/api/tmdb?${params}`)
      .then(r => r.json()).then(d => {
        setTmdbPosterUrl(d.poster_url ?? null);
        setTmdbFullsizeUrl(d.fullsize_url ?? null);
      }).catch(() => {})
      .finally(() => setTmdbResolved(true));
  }, [lookupTitle, mediaTypeForApi, forceMediaType, effectiveSeason, now_playing?.title, isVideo, isActive]);

  // App icon
  const [appIconUrl, setAppIconUrl] = useState<string | null>(null);
  useEffect(() => {
    const appId = now_playing?.app_id ?? null;
    if (!appId || !isActive) { setAppIconUrl(null); return; }
    fetch(`/api/app_icon?bundle_id=${encodeURIComponent(appId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setAppIconUrl(d?.url ?? null))
      .catch(() => {});
  }, [now_playing?.app_id, isActive]);

  // YouTube thumbnail
  const [ytThumbUrl, setYtThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isYouTube || !isActive || !now_playing?.title) { setYtThumbUrl(null); return; }
    const params = new URLSearchParams({ title: now_playing.title });
    if (now_playing.artist) params.set('channel', now_playing.artist);
    fetch(`/api/youtube_thumbnail?${params}`)
      .then(r => r.json()).then(d => setYtThumbUrl(d.thumbnail_url ?? null)).catch(() => {});
  }, [isYouTube, isActive, now_playing?.title, now_playing?.artist]);

  // iTunes album art (music)
  const [itunesArtUrl, setItunesArtUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isMusic || !isActive) { setItunesArtUrl(null); return; }
    fetchItunesAlbumArt(now_playing?.artist ?? null, now_playing?.album ?? null, now_playing?.title ?? null)
      .then(url => setItunesArtUrl(url));
  }, [isMusic, isActive, now_playing?.artist, now_playing?.album, now_playing?.title]);

  // Resolve final artwork sources
  const kscapeCoverUrl = now_playing?.kscape_cover_url ?? null;
  const artworkFallback = (isVideo && !tmdbResolved) ? null : (kscapeCoverUrl ?? artworkUrl);
  const cardArtworkSrc      = kscapeCoverUrl ?? tmdbPosterUrl ?? itunesArtUrl ?? ytThumbUrl ?? artworkFallback;
  const artworkFullscreenSrc = kscapeCoverUrl ?? tmdbFullsizeUrl ?? itunesArtUrl ?? ytThumbUrl ?? artworkFallback;

  return { cardArtworkSrc, artworkFullscreenSrc, tmdbResolved, appIconUrl };
}
