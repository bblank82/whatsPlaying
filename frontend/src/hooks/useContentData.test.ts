import { describe, it, expect } from 'vitest';
import { parseContentMetadata } from './useContentData';
import type { NowPlaying } from '../types';

function np(overrides: Partial<NowPlaying>): NowPlaying {
  return {
    title: null,
    artist: null,
    album: null,
    app_id: null,
    media_type: null,
    device_state: null,
    position: null,
    total_time: null,
    series_name: null,
    season_number: null,
    episode_number: null,
    artwork_id: null,
    kscape_cover_url: null,
    ...overrides,
  } as NowPlaying;
}

// ---------------------------------------------------------------------------
// parseContentMetadata — pure derivation tests
// ---------------------------------------------------------------------------

describe('parseContentMetadata — null input', () => {
  it('returns safe defaults for null now_playing', () => {
    const result = parseContentMetadata(null);
    expect(result.isVideo).toBe(false);
    expect(result.isMusic).toBe(false);
    expect(result.isYouTube).toBe(false);
    expect(result.effectiveSeries).toBeNull();
    expect(result.lookupTitle).toBeNull();
  });
});

describe('parseContentMetadata — YouTube detection', () => {
  it('detects YouTube by app_id', () => {
    const result = parseContentMetadata(np({ app_id: 'com.google.ios.youtube', title: 'Never Gonna Give You Up' }));
    expect(result.isYouTube).toBe(true);
    expect(result.isVideo).toBe(false); // YouTube suppresses isVideo
  });
});

describe('parseContentMetadata — music', () => {
  it('detects music media type', () => {
    const result = parseContentMetadata(np({ media_type: 'MediaType.Music', title: 'Midnight Rain', artist: 'Taylor Swift' }));
    expect(result.isMusic).toBe(true);
    expect(result.isVideo).toBe(false);
  });
});

describe('parseContentMetadata — Hulu series', () => {
  it('parses Hulu title into series + episode', () => {
    const result = parseContentMetadata(np({
      app_id: 'com.hulu.plus',
      title: 'The Bear | S2 E5 - Sheridan',
      media_type: 'MediaType.Video',
    }));
    expect(result.effectiveSeries).toBe('The Bear');
    expect(result.effectiveSeason).toBe(2);
    expect(result.effectiveEpisode).toBe(5);
    expect(result.isVideo).toBe(true);
    expect(result.mediaTypeForApi).toBe('show');
  });
});

describe('parseContentMetadata — series_name from metadata', () => {
  it('uses series_name directly when provided', () => {
    const result = parseContentMetadata(np({
      series_name: 'Succession',
      season_number: 3,
      episode_number: 7,
      title: 'Too Much Birthday',
      media_type: 'MediaType.Video',
    }));
    expect(result.effectiveSeries).toBe('Succession');
    expect(result.effectiveSeason).toBe(3);
    expect(result.effectiveEpisode).toBe(7);
    expect(result.lookupTitle).toBe('Succession');
    expect(result.mediaTypeForApi).toBe('show');
  });
});

describe('parseContentMetadata — plain movie', () => {
  it('treats title as movie when no series info', () => {
    const result = parseContentMetadata(np({
      title: 'The Dark Knight',
      media_type: 'MediaType.Video',
    }));
    expect(result.effectiveSeries).toBeNull();
    expect(result.lookupTitle).toBe('The Dark Knight');
    expect(result.mediaTypeForApi).toBe('movie');
    expect(result.isVideo).toBe(true);
  });
});

describe('parseContentMetadata — generic video titles', () => {
  it('suppresses isVideo for generic titles like "Teaser"', () => {
    const result = parseContentMetadata(np({
      title: 'Teaser',
      media_type: 'MediaType.Video',
    }));
    expect(result.isVideo).toBe(false);
  });

  it('suppresses isVideo for "Trailer"', () => {
    const result = parseContentMetadata(np({
      title: 'Trailer',
      media_type: 'MediaType.Video',
    }));
    expect(result.isVideo).toBe(false);
  });
});

describe('parseContentMetadata — forceMediaType', () => {
  it('sets forceMediaType when media_type is MediaType.Video and no series', () => {
    const result = parseContentMetadata(np({
      title: 'Dune: Part Two',
      media_type: 'MediaType.Video',
    }));
    expect(result.forceMediaType).toBe(true);
  });

  it('does not set forceMediaType when series is known', () => {
    const result = parseContentMetadata(np({
      series_name: 'Succession',
      title: 'Episode 7',
      media_type: 'MediaType.Video',
    }));
    expect(result.forceMediaType).toBe(false);
  });
});

describe('parseContentMetadata — ARTIST_AS_SERIES_APP_IDS', () => {
  it('uses artist as series for Max (HBO Max)', () => {
    // com.wbd.stream encodes series as artist, episode title as title
    const result = parseContentMetadata(np({
      app_id: 'com.wbd.stream',
      artist: 'The White Lotus',
      title: 'Ciao',
      media_type: 'MediaType.Video',
    }));
    expect(result.effectiveSeries).toBe('The White Lotus');
    expect(result.effectiveEpisodeTitle).toBe('Ciao');
    expect(result.mediaTypeForApi).toBe('show');
  });
});
