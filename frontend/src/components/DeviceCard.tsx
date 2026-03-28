import React, { useEffect, useState } from 'react';
import type { DeviceStatus } from '../types';
import { NowPlaying } from './NowPlaying';
import { RemoteModal } from './RemoteModal';
import { ArtworkModal } from './ArtworkModal';
import { parseHuluTitle, parsePlexTitle, detectPlexSeries, isGenericVideoTitle, ARTIST_AS_SERIES_APP_IDS, YOUTUBE_APP_IDS } from '../utils';
import { useDebug } from '../contexts/debug';

// ---------------------------------------------------------------------------
// Device icon
// ---------------------------------------------------------------------------

function DeviceIcon({ model, deviceType, name, dim }: { model: string; deviceType?: string; name: string; dim: boolean }) {
  const c = dim ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.7)';
  const c2 = dim ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.35)';
  const m = model.toLowerCase();
  const isATV = m.includes('gen4') || m.includes('appletv');

  if (deviceType === 'kaleidescape') {
    return (
      <img
        src="/kaleidescape-logo.svg"
        alt="Kaleidescape"
        style={{ width: 72, height: 38, objectFit: 'contain', opacity: dim ? 0.3 : 0.9 }}
      />
    );
  }

  if (isATV) {
    return (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="5" y="11" width="28" height="17" rx="4" fill={c}/>
        <rect x="5" y="26" width="28" height="3" rx="1.5" fill={c2}/>
        <circle cx="19" cy="19.5" r="2.5" fill="rgba(0,0,0,0.18)"/>
      </svg>
    );
  }
  // Generic device
  void name;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <rect x="7" y="7" width="24" height="24" rx="6" fill={c2}/>
      <rect x="11" y="11" width="16" height="16" rx="3" fill={c}/>
    </svg>
  );
}

// Siri Remote silhouette — used as the remote button icon
function RemoteIcon() {
  return (
    <svg width="11" height="20" viewBox="0 0 11 20" fill="none">
      <rect x="0.6" y="0.6" width="9.8" height="18.8" rx="3.2" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="5.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="0.9"/>
      <circle cx="5.5" cy="7.5" r="1" fill="currentColor"/>
      <rect x="3.5" y="13" width="4" height="2.2" rx="0.8" fill="currentColor" opacity="0.65"/>
      <circle cx="3" cy="17.5" r="0.7" fill="currentColor" opacity="0.5"/>
      <circle cx="8" cy="17.5" r="0.7" fill="currentColor" opacity="0.5"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Control button
// ---------------------------------------------------------------------------

function ControlButton({
  onClick, children, large, title,
}: {
  onClick: () => void; children: React.ReactNode; large?: boolean; title?: string;
}) {
  const size = large ? 52 : 40;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: size, height: size, borderRadius: size / 2,
        background: large ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.85)', cursor: 'pointer', flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Scores / external links row
// ---------------------------------------------------------------------------

interface ScoreState {
  tomatometer: number | null;
  audience_score: number | null;
  url: string | null;
  imdb_id: string | null;
  imdb_rating: string | null;
}

function TomatoIcon({ fresh }: { fresh: boolean }) {
  return fresh ? (
    // RT Fresh: red tomato with green leaf
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="15" r="8" fill="#FF3B30"/>
      <path d="M9 8c0-3 2-6 5-5M12 7c0-3 2-5 4-4M12 7c0-3-2-5-4-4" stroke="#34C759" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </svg>
  ) : (
    // RT Rotten: olive-green splat
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C8 1 3 5 3 10c0 2 1 5 3 6l-1 4 4-1c1 1 2 1 3 1 5 0 9-4 9-9 0-4-4-8-9-9z" fill="#8DB600"/>
      <path d="M8 11l2 2 5-4" stroke="rgba(0,0,0,0.25)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ScoresRow({ scores }: { scores: ScoreState }) {
  const { tomatometer, audience_score, url, imdb_id, imdb_rating } = scores;
  const imdbUrl = imdb_id ? `https://www.imdb.com/title/${imdb_id}/` : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
      {/* Tomatometer — only show when we have an actual score */}
      {tomatometer != null && (
        <a href={url ?? '#'} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,59,48,0.11)', border: '1px solid rgba(255,59,48,0.22)', borderRadius: 6, padding: '2px 7px', textDecoration: 'none' }}>
          <TomatoIcon fresh={tomatometer >= 60} />
          <span style={{ fontSize: 12, fontWeight: 600, color: tomatometer >= 60 ? '#FF3B30' : '#8E8E93' }}>{tomatometer}%</span>
        </a>
      )}

      {/* Audience score */}
      {audience_score != null && (
        <a href={url ?? '#'} target="_blank" rel="noopener noreferrer" title="Audience Score"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,159,10,0.1)', border: '1px solid rgba(255,159,10,0.22)', borderRadius: 6, padding: '2px 7px', textDecoration: 'none' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#FF9F0A"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#FF9F0A' }}>{audience_score}%</span>
        </a>
      )}

      {/* IMDB rating */}
      {imdb_rating && imdbUrl && (
        <a href={imdbUrl} target="_blank" rel="noopener noreferrer" title="IMDb"
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(245,197,24,0.12)', border: '1px solid rgba(245,197,24,0.25)', borderRadius: 6, padding: '2px 7px', textDecoration: 'none' }}>
          <svg width="22" height="11" viewBox="0 0 44 22" fill="none">
            <rect width="44" height="22" rx="3" fill="#F5C518"/>
            <text x="22" y="16" fontSize="13" fontWeight="800" fill="#000" textAnchor="middle" fontFamily="Arial,sans-serif">IMDb</text>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#F5C518' }}>{imdb_rating}</span>
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeviceCard
// ---------------------------------------------------------------------------

interface Props {
  device: DeviceStatus;
  onPair: (id: string) => void;
  kioskActive?: boolean;
  kioskOrientation?: 'landscape' | 'portrait';
}

export function DeviceCard({ device, onPair, kioskActive = false, kioskOrientation = 'landscape' }: Props) {
  const { identifier, name, hostname, model, device_type, connected, power, now_playing } = device;
  const debug = useDebug();
  const isKaleidescape = device_type === 'kaleidescape';
  const isOn = power?.toLowerCase().includes('on');

  // Optimistic playback state
  const [optimistic, setOptimistic] = useState<{ deviceState?: string; positionDelta?: number } | null>(null);
  useEffect(() => { setOptimistic(null); }, [now_playing?.device_state, now_playing?.position]);

  const effectiveDeviceState = optimistic?.deviceState ?? now_playing?.device_state ?? '';
  const isPlaying = effectiveDeviceState.toLowerCase().includes('playing');
  const isPaused  = effectiveDeviceState.toLowerCase().includes('paused');
  const showControls = connected && (isPlaying || isPaused);

  // Device artwork URL
  const artworkCacheKey = now_playing?.artwork_id ?? now_playing?.title ?? null;
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  useEffect(() => {
    if ((!isPlaying && !isPaused) || !connected) { setArtworkUrl(null); return; }
    const v = encodeURIComponent(artworkCacheKey ?? 'playing');
    setArtworkUrl(`/api/devices/${encodeURIComponent(identifier)}/artwork?v=${v}`);
  }, [artworkCacheKey, isPlaying, isPaused, connected, identifier]);

  // ── Compound title parsing ─────────────────────────────────────────────────
  const appId = now_playing?.app_id ?? null;

  // YouTube: no TMDB/scores lookups; uses separate thumbnail fetch
  const isYouTube = YOUTUBE_APP_IDS.has(appId ?? '');

  // Hulu embeds "Series | S5 E8 - Episode Title" in the title field
  const huluMatch = appId === 'com.hulu.plus' ? parseHuluTitle(now_playing?.title ?? '') : null;

  // Apps where artist=series and title=episode, identified by app_id
  const artistIsSeriesByAppId = ARTIST_AS_SERIES_APP_IDS.has(appId ?? '') && !!now_playing?.artist;

  // Plex / Infuse: detected from structural metadata (album="Season N" or S1·E1 title format)
  const artistAsSeries =
    artistIsSeriesByAppId ? (now_playing?.artist ?? null) :
    detectPlexSeries(now_playing?.title ?? null, now_playing?.album ?? null, now_playing?.artist ?? null);

  // For Plex, parse the structured title to extract clean S/E numbers and episode name
  const plexTitle = artistAsSeries && !artistIsSeriesByAppId
    ? parsePlexTitle(now_playing?.title ?? null)
    : null;

  // Resolved fields — prefer native pyatv fields, then parsed, then raw
  const effectiveSeries: string | null =
    now_playing?.series_name ?? huluMatch?.series ?? artistAsSeries;

  const effectiveSeason: number | null =
    now_playing?.season_number ?? huluMatch?.season ?? plexTitle?.season ?? null;

  const effectiveEpisode: number | null =
    now_playing?.episode_number ?? huluMatch?.episode ?? plexTitle?.episode ?? null;

  const effectiveEpisodeTitle: string | null =
    huluMatch ? huluMatch.episodeTitle :
    plexTitle ? plexTitle.episodeTitle :
    artistIsSeriesByAppId ? now_playing?.title ?? null :
    null;

  const isGenericTitle = isGenericVideoTitle(now_playing?.title ?? null);

  // YouTube content should never trigger TMDB/RT lookups (channel names don't resolve).
  const isVideo = !isGenericTitle && !isYouTube && !!(
    effectiveSeries ||
    effectiveSeason != null ||
    (now_playing?.media_type?.toLowerCase().includes('video') && now_playing?.title)
  );
  const lookupTitle = effectiveSeries ?? now_playing?.title ?? null;
  const mediaTypeForApi = effectiveSeries ? 'show' : 'movie';
  // Force the media type when we're confident — prevents popularity-based mismatches
  // (e.g. "21" resolving to a TV show instead of the 2008 film).
  // Confident when: no series data and media_type is explicitly Video.
  const forceMediaType = !effectiveSeries && now_playing?.media_type === 'MediaType.Video';

  // RT scores
  const [scores, setScores] = useState<ScoreState | null>(null);
  const isActive = isPlaying || isPaused;

  useEffect(() => {
    if (!lookupTitle || !isVideo || !isActive) { setScores(null); return; }
    setScores(null);
    const params = new URLSearchParams({ title: lookupTitle, media_type: mediaTypeForApi });
    if (forceMediaType) params.set('force_media_type', 'true');
    fetch(`/api/scores?${params}`)
      .then(r => r.json()).then(setScores).catch(() => {});
  }, [lookupTitle, mediaTypeForApi, forceMediaType, isVideo, isActive]);

  // TMDB poster (w500 for card thumbnail, original for modal)
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
    // When looking up by series name, pass the episode title so the backend can
    // infer the season when season_number isn't in the metadata (e.g. HBO Max)
    if (effectiveSeries && now_playing?.title && effectiveSeason == null) {
      params.set('episode_title', now_playing.title);
    }
    fetch(`/api/tmdb?${params}`)
      .then(r => r.json()).then(d => {
        setTmdbPosterUrl(d.poster_url ?? null);
        setTmdbFullsizeUrl(d.fullsize_url ?? null);
      }).catch(() => {})
      .finally(() => setTmdbResolved(true));
  }, [lookupTitle, mediaTypeForApi, forceMediaType, effectiveSeason, now_playing?.title, isVideo, isActive]);
  // App icon from iTunes — fetched when active and no content artwork is available
  const [appIconUrl, setAppIconUrl] = useState<string | null>(null);
  useEffect(() => {
    const appId = now_playing?.app_id ?? null;
    if (!appId || !isActive) { setAppIconUrl(null); return; }
    fetch(`/api/app_icon?bundle_id=${encodeURIComponent(appId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setAppIconUrl(d?.url ?? null))
      .catch(() => {});
  }, [now_playing?.app_id, isActive]);

  const [ytThumbUrl, setYtThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isYouTube || !isActive || !now_playing?.title) { setYtThumbUrl(null); return; }
    const params = new URLSearchParams({ title: now_playing.title });
    if (now_playing.artist) params.set('channel', now_playing.artist);
    fetch(`/api/youtube_thumbnail?${params}`)
      .then(r => r.json()).then(d => setYtThumbUrl(d.thumbnail_url ?? null)).catch(() => {});
  }, [isYouTube, isActive, now_playing?.title, now_playing?.artist]);

  // Modal state
  const [showRemote, setShowRemote]   = useState(false);
  const [showArtwork, setShowArtwork] = useState(false);

  // Merge optimistic overrides + parsed compound-title fields into nowPlaying
  const effectiveNowPlaying = (() => {
    if (!now_playing) return now_playing;
    const ov: Partial<typeof now_playing> = {};
    if (optimistic?.deviceState) ov.device_state = optimistic.deviceState;
    if (optimistic?.positionDelta != null && now_playing.position != null)
      ov.position = Math.max(0, Math.min(
        now_playing.position + optimistic.positionDelta,
        now_playing.total_time ?? Infinity,
      ));
    // Inject parsed fields so NowPlaying can display them properly
    if (effectiveSeries && !now_playing.series_name) ov.series_name = effectiveSeries;
    if (effectiveSeason != null && now_playing.season_number == null) ov.season_number = effectiveSeason;
    if (effectiveEpisode != null && now_playing.episode_number == null) ov.episode_number = effectiveEpisode;
    if (effectiveEpisodeTitle && huluMatch) ov.title = effectiveEpisodeTitle;
    return Object.keys(ov).length ? { ...now_playing, ...ov } : now_playing;
  })();

  async function control(action: string) {
    if (action === 'play_pause')     setOptimistic({ deviceState: isPlaying ? 'DeviceState.Paused' : 'DeviceState.Playing' });
    else if (action === 'skip_forward')  setOptimistic({ positionDelta:  10 });
    else if (action === 'skip_backward') setOptimistic({ positionDelta: -10 });
    debug.log('send', action, name);
    await fetch(`/api/devices/${encodeURIComponent(identifier)}/control/${action}`, { method: 'POST' });
  }

  // Kaleidescape serves its own cover art directly — authoritative; don't let TMDB override it
  const kscapeCoverUrl = now_playing?.kscape_cover_url ?? null;

  // Suppress pyatv artwork while TMDB is in-flight for video content — avoids the
  // flash of wrong art before the poster loads.
  const artworkFallback = (isVideo && !tmdbResolved) ? null : (kscapeCoverUrl ?? artworkUrl);
  // When Kaleidescape provides its own cover art, use it directly (TMDB title search is
  // unreliable for sequels/subtitles and could return the wrong movie).
  const cardArtworkSrc      = kscapeCoverUrl ?? tmdbPosterUrl ?? ytThumbUrl ?? artworkFallback;
  const artworkFullscreenSrc = kscapeCoverUrl ?? tmdbFullsizeUrl ?? ytThumbUrl ?? artworkFallback;

  const borderColor = connected
    ? isPlaying ? 'rgba(48,209,88,0.35)' : 'rgba(255,255,255,0.1)'
    : 'rgba(255,255,255,0.05)';

  return (
    <>
      <div style={{
        background: connected ? '#2c2c2e' : '#232325',
        border: `1px solid ${borderColor}`,
        borderRadius: 16,
        overflow: 'hidden',
        opacity: connected ? 1 : 0.65,
        boxShadow: isPlaying
          ? '0 0 0 1px rgba(48,209,88,0.15), 0 4px 24px rgba(0,0,0,0.3)'
          : '0 2px 12px rgba(0,0,0,0.25)',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}>

        {/* ── Compact device header ── */}
        <div style={{
          padding: '11px 16px 9px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              fontSize: 14, fontWeight: 600,
              color: connected ? '#fff' : 'rgba(255,255,255,0.4)',
              letterSpacing: '-0.2px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{name}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 1 }}>{hostname}</p>
          </div>

          {connected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, marginLeft: 10 }}>
              {/* Power toggle */}
              <button
                onClick={() => control(isOn ? 'turn_off' : 'turn_on')}
                title={isOn ? 'Standby' : 'Wake'}
                style={{
                  display: 'flex', alignItems: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: isOn ? '#30D158' : 'rgba(255,255,255,0.2)',
                  filter: isOn ? 'drop-shadow(0 0 4px rgba(48,209,88,0.55))' : 'none',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 3v6"/>
                  <path d="M6.5 5A9 9 0 1 0 17.5 5"/>
                </svg>
              </button>
              {!isKaleidescape && (
                <button
                  onClick={() => onPair(identifier)}
                  title="Pair additional protocols"
                  style={{
                    width: 22, height: 22, borderRadius: 6,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Card body ── */}
        <div style={{ padding: '14px 16px 16px' }}>
          {connected ? (
            <>
              {/* Artwork + now-playing info */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>

                {/* Artwork / device icon */}
                <div
                  onClick={() => { if (artworkFullscreenSrc) setShowArtwork(true); }}
                  style={{
                    height: 80,
                    width: cardArtworkSrc ? 'auto' : 80,
                    minWidth: 80,
                    borderRadius: 12,
                    flexShrink: 0,
                    overflow: 'hidden',
                    background: 'rgba(255,255,255,0.07)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: artworkFullscreenSrc ? 'pointer' : 'default',
                  }}
                >
                  {cardArtworkSrc ? (
                    <img
                      src={cardArtworkSrc}
                      alt=""
                      style={{ height: 80, width: 'auto', display: 'block' }}
                      onError={() => { if (tmdbPosterUrl) setTmdbPosterUrl(null); else if (ytThumbUrl) setYtThumbUrl(null); else setArtworkUrl(null); }}
                    />
                  ) : (isPlaying || isPaused) && appIconUrl ? (
                    <img src={appIconUrl} alt="" style={{ width: 80, height: 80, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <DeviceIcon model={model ?? 'Unknown'} deviceType={device_type} name={name} dim={!connected} />
                  )}
                </div>

                {/* Text + scores */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <NowPlaying
                    nowPlaying={effectiveNowPlaying}
                    onSeek={isKaleidescape ? undefined : pos => {
                      debug.log('send', `set_position pos=${pos}`, name);
                      fetch(`/api/devices/${encodeURIComponent(identifier)}/control/set_position?pos=${pos}`, { method: 'POST' });
                    }}
                    resolvedSeries={artistAsSeries}
                    belowBar={isVideo && scores ? <ScoresRow scores={scores} /> : undefined}
                  />
                </div>
              </div>

              {/* Controls row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: showControls ? 'space-between' : 'flex-end',
                marginTop: 14,
                gap: 8,
              }}>
                {showControls && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isKaleidescape && (
                      <ControlButton onClick={() => control('previous')} title="Previous Chapter">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 20L9 12l10-8v16z"/><rect x="5" y="4" width="2.5" height="16" rx="1"/>
                        </svg>
                      </ControlButton>
                    )}
                    <ControlButton onClick={() => control('skip_backward')} title={isKaleidescape ? 'Scan Reverse' : 'Back 10s'}>
                      {isKaleidescape ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11 19l-9-7 9-7v14z"/><path d="M22 19l-9-7 9-7v14z"/>
                        </svg>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <svg width="16" height="13" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 17a5 5 0 1 0 0-10H6"/><path d="M6 11l-3-3 3-3"/>
                          </svg>
                          <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>10</span>
                        </div>
                      )}
                    </ControlButton>
                    <ControlButton onClick={() => control('play_pause')} large>
                      {isPlaying ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="4" y="3" width="5" height="18" rx="2"/><rect x="15" y="3" width="5" height="18" rx="2"/>
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M5 3l14 9-14 9V3z"/>
                        </svg>
                      )}
                    </ControlButton>
                    <ControlButton onClick={() => control('skip_forward')} title={isKaleidescape ? 'Scan Forward' : 'Forward 10s'}>
                      {isKaleidescape ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M13 19l9-7-9-7v14z"/><path d="M2 19l9-7-9-7v14z"/>
                        </svg>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <svg width="16" height="13" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 17a5 5 0 1 1 0-10h5"/><path d="M18 11l3-3-3-3"/>
                          </svg>
                          <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>10</span>
                        </div>
                      )}
                    </ControlButton>
                    {isKaleidescape && (
                      <ControlButton onClick={() => control('next')} title="Next Chapter">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M5 4l10 8-10 8V4z"/><rect x="16.5" y="4" width="2.5" height="16" rx="1"/>
                        </svg>
                      </ControlButton>
                    )}
                  </div>
                )}

                {/* App icon + remote button (remote hidden for Kaleidescape) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isActive && appIconUrl && (
                    <img
                      src={appIconUrl}
                      alt={now_playing?.app_name ?? ''}
                      title={now_playing?.app_name ?? undefined}
                      style={{ width: 28, height: 28, borderRadius: 7, display: 'block', flexShrink: 0 }}
                    />
                  )}
                  <button
                    onClick={() => setShowRemote(true)}
                    title="Open remote"
                    style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
                    }}
                  >
                    <RemoteIcon />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Not connected / not paired */
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <DeviceIcon model={model ?? 'Unknown'} deviceType={device_type} name={name} dim />
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
                  {isKaleidescape ? 'Disconnected' : 'Not paired'}
                </p>
              </div>
              {!isKaleidescape && (
                <button
                  onClick={() => onPair(identifier)}
                  style={{
                    fontSize: 14, fontWeight: 600, color: '#0A84FF',
                    background: 'rgba(10,132,255,0.12)',
                    border: '1px solid rgba(10,132,255,0.25)',
                    borderRadius: 10, padding: '8px 18px', cursor: 'pointer',
                  }}
                >
                  Pair
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showRemote && (
        <RemoteModal deviceId={identifier} deviceName={name} deviceType={device_type} onClose={() => setShowRemote(false)} />
      )}
      {(showArtwork || (kioskActive && artworkFullscreenSrc)) && artworkFullscreenSrc && (
        <ArtworkModal
          src={artworkFullscreenSrc}
          nowPlaying={effectiveNowPlaying ?? null}
          effectiveSeries={effectiveSeries}
          scores={scores}
          deviceName={name}
          orientation={kioskActive ? kioskOrientation : 'landscape'}
          kioskActive={kioskActive}
          onClose={() => { if (!kioskActive) setShowArtwork(false); }}
        />
      )}
    </>
  );
}
