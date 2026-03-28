import { describe, it, expect } from 'vitest';
import { formatTime, appLabel, APP_NAMES, parseHuluTitle, parsePlexTitle, detectPlexSeries, isGenericVideoTitle, ARTIST_AS_SERIES_APP_IDS, YOUTUBE_APP_IDS } from './utils';

// ---------------------------------------------------------------------------
// isGenericVideoTitle
// ---------------------------------------------------------------------------

describe('isGenericVideoTitle', () => {
  it('matches "Teaser" (HBO Max trailer format)', () => {
    expect(isGenericVideoTitle('Teaser')).toBe(true);
  });

  it('matches "Trailer"', () => {
    expect(isGenericVideoTitle('Trailer')).toBe(true);
  });

  it('matches "Preview"', () => {
    expect(isGenericVideoTitle('Preview')).toBe(true);
  });

  it('matches "Clip"', () => {
    expect(isGenericVideoTitle('Clip')).toBe(true);
  });

  it('matches "Promo"', () => {
    expect(isGenericVideoTitle('Promo')).toBe(true);
  });

  it('matches "Featurette"', () => {
    expect(isGenericVideoTitle('Featurette')).toBe(true);
  });

  it('matches "Sneak Peek"', () => {
    expect(isGenericVideoTitle('Sneak Peek')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isGenericVideoTitle('TEASER')).toBe(true);
    expect(isGenericVideoTitle('trailer')).toBe(true);
  });

  it('trims whitespace before matching', () => {
    expect(isGenericVideoTitle('  Teaser  ')).toBe(true);
  });

  it('returns false for null', () => {
    expect(isGenericVideoTitle(null)).toBe(false);
  });

  it('returns false for a real title', () => {
    expect(isGenericVideoTitle('The Pitt')).toBe(false);
  });

  it('does not match a title that contains the word but is not solely it', () => {
    expect(isGenericVideoTitle('Official Trailer')).toBe(false);
    expect(isGenericVideoTitle('Teaser 2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe('formatTime', () => {
  it('returns empty string for null', () => {
    expect(formatTime(null)).toBe('');
  });

  it('formats zero as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats sub-minute values', () => {
    expect(formatTime(45)).toBe('0:45');
  });

  it('zero-pads seconds', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('formats exactly one hour', () => {
    expect(formatTime(3600)).toBe('1:00:00');
  });

  it('formats multi-hour values', () => {
    expect(formatTime(7384)).toBe('2:03:04'); // 2h 3m 4s
  });

  it('zero-pads minutes in hour+ format', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });
});

// ---------------------------------------------------------------------------
// appLabel
// ---------------------------------------------------------------------------

describe('appLabel', () => {
  it('returns null for null input', () => {
    expect(appLabel(null)).toBeNull();
  });

  it('maps known Netflix bundle ID', () => {
    expect(appLabel('com.netflix.Netflix')).toBe('Netflix');
  });

  it('maps known Apple TV+ bundle ID', () => {
    expect(appLabel('com.apple.TVWatchList')).toBe('Apple TV+');
  });

  it('maps Infuse variant', () => {
    expect(appLabel('com.firecore.infuse7')).toBe('Infuse');
  });

  it('returns last dot segment for unknown bundle IDs', () => {
    expect(appLabel('com.example.SomeApp')).toBe('SomeApp');
  });

  it('returns the raw string if it has no dots', () => {
    expect(appLabel('nodots')).toBe('nodots');
  });

  it('covers all APP_NAMES keys without throwing', () => {
    for (const id of Object.keys(APP_NAMES)) {
      expect(appLabel(id)).toBe(APP_NAMES[id]);
    }
  });
});

// ---------------------------------------------------------------------------
// parseHuluTitle
// ---------------------------------------------------------------------------

describe('parseHuluTitle', () => {
  it('returns null for a plain title', () => {
    expect(parseHuluTitle('The Bear')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseHuluTitle('')).toBeNull();
  });

  it('parses series + season + episode without episode title', () => {
    const result = parseHuluTitle('Only Murders in the Building | S3 E8');
    expect(result).toEqual({ series: 'Only Murders in the Building', season: 3, episode: 8, episodeTitle: null });
  });

  it('parses series + season + episode + episode title (hyphen separator)', () => {
    const result = parseHuluTitle('The Bear | S2 E7 - Forks');
    expect(result).toEqual({ series: 'The Bear', season: 2, episode: 7, episodeTitle: 'Forks' });
  });

  it('parses episode title with en-dash separator', () => {
    const result = parseHuluTitle('Shogun | S1 E10 – Crimson Sky');
    expect(result).toEqual({ series: 'Shogun', season: 1, episode: 10, episodeTitle: 'Crimson Sky' });
  });

  it('is case-insensitive for S/E markers', () => {
    const result = parseHuluTitle('My Show | s4 e12 - Finale');
    expect(result).not.toBeNull();
    expect(result?.season).toBe(4);
    expect(result?.episode).toBe(12);
  });

  it('trims whitespace around the pipe and separator', () => {
    const result = parseHuluTitle('Archer  |  S6 E1  -  The Holdout');
    expect(result?.series).toBe('Archer');
    expect(result?.episodeTitle).toBe('The Holdout');
  });

  it('does not match a title with a pipe but no S/E pattern', () => {
    expect(parseHuluTitle('Breaking Bad | The One Who Knocks')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePlexTitle
// ---------------------------------------------------------------------------

describe('parsePlexTitle', () => {
  it('returns null for null input', () => {
    expect(parsePlexTitle(null)).toBeNull();
  });

  it('returns null for a plain title', () => {
    expect(parsePlexTitle('Pilot')).toBeNull();
  });

  it('parses middle-dot format with episode title (live Plex data)', () => {
    expect(parsePlexTitle('S1 · E1: Pilot')).toEqual({ season: 1, episode: 1, episodeTitle: 'Pilot' });
  });

  it('parses without episode title', () => {
    expect(parsePlexTitle('S2 · E4')).toEqual({ season: 2, episode: 4, episodeTitle: null });
  });

  it('parses bullet separator', () => {
    expect(parsePlexTitle('S3 • E7: The One')).toEqual({ season: 3, episode: 7, episodeTitle: 'The One' });
  });

  it('parses hyphen separator', () => {
    expect(parsePlexTitle('S1 - E2: Episode Name')).toEqual({ season: 1, episode: 2, episodeTitle: 'Episode Name' });
  });

  it('is case-insensitive', () => {
    expect(parsePlexTitle('s2 · e5: Something')).toEqual({ season: 2, episode: 5, episodeTitle: 'Something' });
  });

  it('trims whitespace around colon in episode title', () => {
    expect(parsePlexTitle('S1 · E1:  Spaced Title  ')).toEqual({ season: 1, episode: 1, episodeTitle: 'Spaced Title' });
  });
});

// ---------------------------------------------------------------------------
// detectPlexSeries
// ---------------------------------------------------------------------------

describe('detectPlexSeries', () => {
  it('returns null when no indicators are present', () => {
    expect(detectPlexSeries('The Bear', null, null)).toBeNull();
  });

  it('returns null when artist is null even if title matches', () => {
    expect(detectPlexSeries('S1 · E1: Pilot', 'Season 1', null)).toBeNull();
  });

  it('detects Plex episode title format with middle-dot', () => {
    expect(detectPlexSeries('S2 · E4: The Review', 'Season 2', 'The Bear')).toBe('The Bear');
  });

  it('detects Plex episode title format with bullet', () => {
    expect(detectPlexSeries('S1 • E1: Pilot', null, 'Some Show')).toBe('Some Show');
  });

  it('detects Plex episode title format with hyphen', () => {
    expect(detectPlexSeries('S3 - E1: Episode', null, 'My Series')).toBe('My Series');
  });

  it('detects via album "Season N" pattern even without episode-title format', () => {
    expect(detectPlexSeries('Some Title', 'Season 3', 'The Show')).toBe('The Show');
  });

  it('is case-insensitive for "Season N" album', () => {
    expect(detectPlexSeries(null, 'season 5', 'Breaking Bad')).toBe('Breaking Bad');
  });

  it('does not match "Seasons" (no trailing space+digit)', () => {
    expect(detectPlexSeries('A Song', 'Seasons of Love', 'Rent')).toBeNull();
  });

  it('does NOT trigger for plain music (no structural episode cues)', () => {
    expect(detectPlexSeries('Blinding Lights', 'After Hours', 'The Weeknd')).toBeNull();
    expect(detectPlexSeries('Blinding Lights', null, 'The Weeknd')).toBeNull();
    expect(detectPlexSeries('Blinding Lights', '', 'The Weeknd')).toBeNull();
  });
});

describe('ARTIST_AS_SERIES_APP_IDS', () => {
  it('contains Max bundle IDs', () => {
    expect(ARTIST_AS_SERIES_APP_IDS.has('com.wbd.stream')).toBe(true);
    expect(ARTIST_AS_SERIES_APP_IDS.has('com.hbo.hbonow')).toBe(true);
  });

  it('does not contain unrelated IDs', () => {
    expect(ARTIST_AS_SERIES_APP_IDS.has('com.netflix.Netflix')).toBe(false);
    expect(ARTIST_AS_SERIES_APP_IDS.has('com.hulu.plus')).toBe(false);
  });
});

describe('YOUTUBE_APP_IDS', () => {
  it('contains both YouTube bundle IDs', () => {
    expect(YOUTUBE_APP_IDS.has('com.apple.TVYouTube')).toBe(true);
    expect(YOUTUBE_APP_IDS.has('com.google.ios.youtube')).toBe(true);
  });
});
