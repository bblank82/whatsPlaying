import React, { useEffect, useRef, useState } from 'react';
import type { NowPlaying } from '../types';
import { formatTime, fetchItunesAlbumArt } from '../utils';
import type { ScoreState } from '../hooks/useContentData';

interface CastMember {
  name: string;
  character: string;
  profile_url: string | null;
}

interface TmdbDetails {
  available: boolean;
  overview: string | null;
  tagline: string | null;
  genres: string[];
  year: number | null;
  runtime: number | null;
  cast: CastMember[];
  poster_url: string | null;
  fullsize_url: string | null;
  backdrop_url: string | null;
}

export interface CinematicKioskProps {
  deviceName: string;
  nowPlaying: NowPlaying | null;
  /** effectiveSeries ?? title — used for TMDB lookup */
  lookupTitle: string | null;
  mediaType: 'movie' | 'show';
  effectiveSeries: string | null;
  orientation?: 'landscape' | 'portrait';
  kioskActive?: boolean;
  onClose: () => void;
}


function formatRuntime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Shared sub-components (used in both portrait and landscape layouts)
// ---------------------------------------------------------------------------

function NowPlayingLabel({ deviceName, isPortrait }: { deviceName: string; isPortrait: boolean }) {
  const size = isPortrait ? 11 : 13;
  const mb = isPortrait ? '2vmin' : '3.5vmin';
  const fontSize = isPortrait ? 'clamp(10px, 1.8vmin, 15px)' : 'clamp(11px, 2vmin, 17px)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1vmin', marginBottom: mb }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="rgba(255,255,255,0.45)" stroke="none">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span style={{ fontSize, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}>
        Now Playing on{' '}
        <span style={{ color: 'rgba(255,255,255,0.82)', fontWeight: 600 }}>{deviceName}</span>
      </span>
    </div>
  );
}

function KioskScores({ scores, imdbUrl, isPortrait }: {
  scores: ScoreState;
  imdbUrl: string | null;
  isPortrait: boolean;
}) {
  if (scores.tomatometer == null && !scores.imdb_rating) return null;
  const pad = isPortrait ? '4px 10px' : '5px 11px';
  const tomSize = isPortrait ? 'clamp(12px, 2.3vmin, 17px)' : 'clamp(13px, 2.5vmin, 19px)';
  const scoreSize = isPortrait ? 'clamp(11px, 2.1vmin, 16px)' : 'clamp(12px, 2.3vmin, 18px)';
  const mb = isPortrait ? '1.5vmin' : '1.5vmin';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vmin', marginBottom: mb }}>
      {scores.tomatometer != null && (
        <a href={scores.url ?? '#'} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.8vmin', textDecoration: 'none',
            background: 'rgba(255,255,255,0.08)', borderRadius: 9, padding: pad,
            border: '1px solid rgba(255,255,255,0.12)' }}>
          <span style={{ fontSize: tomSize }}>{scores.tomatometer >= 60 ? '🍅' : '🤢'}</span>
          <span style={{ fontSize: scoreSize, fontWeight: 700,
            color: scores.tomatometer >= 60 ? '#FF3B30' : '#8E8E93' }}>
            {scores.tomatometer}%
          </span>
        </a>
      )}
      {scores.imdb_rating && imdbUrl && (
        <a href={imdbUrl} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.8vmin', textDecoration: 'none',
            background: 'rgba(255,255,255,0.08)', borderRadius: 9, padding: pad,
            border: '1px solid rgba(255,255,255,0.12)' }}>
          <svg width="28" height="14" viewBox="0 0 44 22" fill="none">
            <rect width="44" height="22" rx="3" fill="#F5C518"/>
            <text x="22" y="16" fontSize="13" fontWeight="800" fill="#000" textAnchor="middle" fontFamily="Arial,sans-serif">IMDb</text>
          </svg>
          <span style={{ fontSize: scoreSize, fontWeight: 700, color: '#F5C518' }}>
            {scores.imdb_rating}
          </span>
        </a>
      )}
    </div>
  );
}

function KioskProgressBar({ pct, livePos, total_time, isPortrait }: {
  pct: number;
  livePos: number | null;
  total_time: number | null | undefined;
  isPortrait: boolean;
}) {
  const fontSize = isPortrait ? 'clamp(9px, 1.6vmin, 13px)' : 'clamp(10px, 1.7vmin, 14px)';
  return (
    <div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.13)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'rgba(255,255,255,0.72)',
          borderRadius: 2, transition: 'width 1s linear' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8vmin' }}>
        <span style={{ fontSize, color: 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(livePos)}
        </span>
        {livePos != null && total_time != null && (
          <span style={{ fontSize, color: 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
            −{formatTime(total_time - livePos)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cast avatar
// ---------------------------------------------------------------------------

function CastCard({ cast, isPortrait }: { cast: CastMember; isPortrait: boolean }) {
  const [imgError, setImgError] = useState(false);
  const showImg = cast.profile_url && !imgError;
  const maxW = isPortrait ? '16vmin' : '11vmin';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8vmin', maxWidth: maxW }}>
      {showImg ? (
        <img
          src={cast.profile_url!}
          alt={cast.name}
          onError={() => setImgError(true)}
          style={{
            width: isPortrait ? 'clamp(44px, 9vmin, 68px)' : 'clamp(52px, 8vmin, 74px)',
            height: isPortrait ? 'clamp(44px, 9vmin, 68px)' : 'clamp(52px, 8vmin, 74px)',
            borderRadius: '50%',
            objectFit: 'cover',
            objectPosition: 'top',
            border: '2px solid rgba(255,255,255,0.18)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: isPortrait ? 'clamp(44px, 9vmin, 68px)' : 'clamp(52px, 8vmin, 74px)',
          height: isPortrait ? 'clamp(44px, 9vmin, 68px)' : 'clamp(52px, 8vmin, 74px)',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.09)',
          border: '2px solid rgba(255,255,255,0.13)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          fontSize: 'clamp(16px, 3vmin, 26px)',
          color: 'rgba(255,255,255,0.45)',
          fontWeight: 700,
        }}>
          {cast.name.charAt(0)}
        </div>
      )}
      <div style={{ textAlign: 'center', width: '100%' }}>
        <p style={{
          fontSize: 'clamp(9px, 1.5vmin, 13px)',
          color: 'rgba(255,255,255,0.88)',
          fontWeight: 600,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: maxW,
        }}>{cast.name}</p>
        {cast.character && (
          <p style={{
            fontSize: 'clamp(8px, 1.2vmin, 11px)',
            color: 'rgba(255,255,255,0.35)',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: maxW,
          }}>{cast.character}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CinematicKioskView({
  deviceName,
  nowPlaying,
  lookupTitle,
  mediaType,
  effectiveSeries,
  orientation = 'landscape',
  kioskActive = false,
  onClose,
}: CinematicKioskProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<TmdbDetails | null>(null);
  const [scores, setScores] = useState<ScoreState | null>(null);
  const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);

  // Request fullscreen on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);

  // Close on fullscreen exit or Escape
  useEffect(() => {
    function onFsChange() { if (!document.fullscreenElement) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const isMusic = nowPlaying?.media_type?.toLowerCase().includes('music') ?? false;

  // Fetch album art from iTunes Search API
  useEffect(() => {
    if (!isMusic) { setAlbumArtUrl(null); return; }
    let cancelled = false;
    fetchItunesAlbumArt(nowPlaying?.artist ?? null, nowPlaying?.album ?? null, nowPlaying?.title ?? null)
      .then(url => { if (!cancelled) setAlbumArtUrl(url); });
    return () => { cancelled = true; };
  }, [isMusic, nowPlaying?.artist, nowPlaying?.album, nowPlaying?.title]);

  // Fetch TMDB details (overview, cast, genres, etc.) — skip for music
  useEffect(() => {
    if (!lookupTitle || isMusic) { setDetails(null); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ title: lookupTitle, media_type: mediaType });
    if (nowPlaying?.season_number != null)
      params.set('season_number', String(nowPlaying.season_number));
    if (nowPlaying?.episode_number != null)
      params.set('episode_number', String(nowPlaying.episode_number));
    fetch(`/api/tmdb/details?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then((d: TmdbDetails) => { if (d.available) setDetails(d); })
      .catch(() => {});
    return () => controller.abort();
  }, [lookupTitle, mediaType, isMusic, nowPlaying?.season_number, nowPlaying?.episode_number]);

  // Fetch scores — skip for music
  useEffect(() => {
    if (!lookupTitle || isMusic) { setScores(null); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ title: lookupTitle, media_type: mediaType });
    fetch(`/api/scores?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then(setScores)
      .catch(() => {});
    return () => controller.abort();
  }, [lookupTitle, mediaType, isMusic]);

  // Live-ticking position
  const { position, total_time, device_state } = nowPlaying ?? {};
  const isPlaying = device_state?.toLowerCase().includes('playing') ?? false;
  const baseRef = useRef<{ position: number; at: number } | null>(null);
  const [livePos, setLivePos] = useState<number | null>(position ?? null);

  useEffect(() => {
    if (position == null) { setLivePos(null); baseRef.current = null; return; }
    if (baseRef.current === null) {
      baseRef.current = { position, at: Date.now() };
      setLivePos(position);
      return;
    }
    const expectedNow = baseRef.current.position + (Date.now() - baseRef.current.at) / 1000;
    if (Math.abs(position - expectedNow) > 8) {
      baseRef.current = { position, at: Date.now() };
      setLivePos(position);
    } else {
      baseRef.current = { position, at: Date.now() };
    }
  }, [position]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!baseRef.current) return;
      const next = baseRef.current.position + (Date.now() - baseRef.current.at) / 1000;
      setLivePos(total_time != null ? Math.min(next, total_time) : next);
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, total_time]);

  const pct = total_time && livePos != null ? Math.min(100, (livePos / total_time) * 100) : null;

  // Titles
  const primaryTitle = effectiveSeries ?? nowPlaying?.title ?? null;
  const subtitle = (() => {
    if (!nowPlaying) return null;
    const { title, series_name, season_number, episode_number } = nowPlaying;
    const series = series_name ?? effectiveSeries;
    if (series && title && title !== series) return title;
    const ep = [
      season_number != null ? `S${season_number}` : null,
      episode_number != null ? `E${episode_number}` : null,
    ].filter(Boolean).join('');
    return ep || null;
  })();

  const imdbUrl = scores?.imdb_id ? `https://www.imdb.com/title/${scores.imdb_id}/` : null;

  const isPortrait = orientation === 'portrait';
  const posterSrc = details?.fullsize_url ?? details?.poster_url ?? null;
  const backdropSrc = details?.backdrop_url ?? posterSrc ?? albumArtUrl;
  const castToShow = isPortrait
    ? (details?.cast ?? []).slice(0, 4)
    : (details?.cast ?? []).slice(0, 5);

  const canvasStyle: React.CSSProperties = isPortrait ? {
    position: 'fixed',
    width: '100vh',
    height: '100vw',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(90deg)',
    transformOrigin: 'center center',
    zIndex: 400,
    overflow: 'hidden',
    background: '#000',
  } : {
    position: 'fixed', inset: 0, zIndex: 400,
    background: '#000',
    overflow: 'hidden',
  };

  return (
    <div
      ref={containerRef}
      onClick={!kioskActive ? onClose : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: '#000', cursor: kioskActive ? 'default' : 'pointer' }}
    >
      <div style={canvasStyle}>

        {/* Blurred backdrop — cinematic widescreen behind everything */}
        {backdropSrc && (
          <img
            src={backdropSrc}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              filter: 'blur(40px) brightness(0.35) saturate(1.3)',
              transform: 'scale(1.07)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Subtle vignette to deepen edges */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }} />

        {/* ── Main layout ── */}
        {isMusic ? (

          /* ================================================================
             MUSIC: centered track info, no TMDB, no scores
             ================================================================ */
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '6vmin',
            boxSizing: 'border-box',
          }}>

            {/* Album art or music note placeholder */}
            {albumArtUrl ? (
              <img
                src={albumArtUrl}
                alt={nowPlaying?.album ?? nowPlaying?.title ?? ''}
                style={{
                  width: 'clamp(120px, 22vmin, 220px)',
                  height: 'clamp(120px, 22vmin, 220px)',
                  borderRadius: 16,
                  objectFit: 'cover',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
                  marginBottom: '4vmin',
                  flexShrink: 0,
                }}
              />
            ) : (
              <div style={{
                width: 'clamp(80px, 16vmin, 140px)',
                height: 'clamp(80px, 16vmin, 140px)',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '4vmin',
                flexShrink: 0,
              }}>
                <svg
                  width="clamp(36px,7vmin,62px)" height="clamp(36px,7vmin,62px)"
                  viewBox="0 0 24 24" fill="none"
                  stroke="rgba(255,255,255,0.55)" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
            )}

            {/* Track title */}
            {nowPlaying?.title && (
              <h1 style={{
                fontSize: 'clamp(28px, 5.5vmin, 60px)',
                fontWeight: 800,
                color: '#fff',
                letterSpacing: '-0.5px',
                lineHeight: 1.1,
                textAlign: 'center',
                margin: '0 0 1.5vmin',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                textOverflow: 'ellipsis',
              }}>
                {nowPlaying.title}
              </h1>
            )}

            {/* Artist */}
            {nowPlaying?.artist && (
              <p style={{
                fontSize: 'clamp(16px, 3vmin, 30px)',
                color: 'rgba(255,255,255,0.72)',
                fontWeight: 500,
                textAlign: 'center',
                marginBottom: '0.8vmin',
              }}>
                {nowPlaying.artist}
              </p>
            )}

            {/* Album */}
            {nowPlaying?.album && (
              <p style={{
                fontSize: 'clamp(12px, 2vmin, 20px)',
                color: 'rgba(255,255,255,0.35)',
                fontStyle: 'italic',
                textAlign: 'center',
                marginBottom: '5vmin',
              }}>
                {nowPlaying.album}
              </p>
            )}

            {/* App name */}
            {nowPlaying?.app_name && (
              <p style={{
                fontSize: 'clamp(10px, 1.6vmin, 14px)',
                color: 'rgba(255,255,255,0.28)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '4vmin',
              }}>
                {nowPlaying.app_name}
              </p>
            )}

            {/* Progress bar */}
            {pct != null && (
              <div style={{ width: '100%', maxWidth: 480 }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.13)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: 'rgba(255,255,255,0.72)', borderRadius: 2,
                    transition: 'width 1s linear',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8vmin' }}>
                  <span style={{
                    fontSize: 'clamp(9px, 1.6vmin, 13px)',
                    color: 'rgba(255,255,255,0.28)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{formatTime(livePos)}</span>
                  {livePos != null && total_time != null && (
                    <span style={{
                      fontSize: 'clamp(9px, 1.6vmin, 13px)',
                      color: 'rgba(255,255,255,0.28)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>−{formatTime(total_time - livePos)}</span>
                  )}
                </div>
              </div>
            )}

            {/* Device name */}
            <div style={{
              position: 'absolute', bottom: '3vmin',
              display: 'flex', alignItems: 'center', gap: '0.8vmin',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <span style={{ fontSize: 'clamp(10px, 1.6vmin, 13px)', color: 'rgba(255,255,255,0.3)' }}>
                Now Playing on <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{deviceName}</span>
              </span>
            </div>

          </div>

        ) : isPortrait ? (

          /* ================================================================
             PORTRAIT: poster fills canvas (contain), info overlaid at bottom
             After 90° CW rotation: CSS bottom = visual left edge
             ================================================================ */
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>

            {/* Poster — top 58% of CSS canvas (= visual right after rotation) */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '58%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '4vmin 8vmin 2vmin',
              boxSizing: 'border-box',
            }}>
              {posterSrc && (
                <img
                  src={posterSrc}
                  alt={primaryTitle ?? ''}
                  style={{
                    height: '100%',
                    width: 'auto',
                    objectFit: 'contain',
                    borderRadius: 12,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',
                  }}
                />
              )}
            </div>

            {/* Gradient bridge from poster area into info panel */}
            <div style={{
              position: 'absolute', top: '40%', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.88) 45%, rgba(0,0,0,0.97) 100%)',
              pointerEvents: 'none',
            }} />

            {/* Info panel — bottom 42% of CSS canvas (= visual left after rotation).
                flex-end packs items toward CSS bottom = visual left edge of screen */}
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0, height: '42%',
              padding: '1vmin 5vmin 4vmin',
              boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            }}>

              <NowPlayingLabel deviceName={deviceName} isPortrait={true} />

              {/* Primary title */}
              {primaryTitle && (
                <h1 style={{
                  fontSize: 'clamp(22px, 4.8vmin, 42px)',
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.1,
                  margin: '0 0 0.6vmin',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {primaryTitle}
                </h1>
              )}

              {/* Episode subtitle */}
              {subtitle && (
                <p style={{
                  fontSize: 'clamp(12px, 2.2vmin, 18px)',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '1.2vmin',
                }}>
                  {subtitle}
                </p>
              )}

              {/* Year · Runtime · Genres inline */}
              <div style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1vmin',
                fontSize: 'clamp(10px, 1.7vmin, 14px)',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '2vmin',
              }}>
                {details?.year && <span>{details.year}</span>}
                {details?.year && details?.runtime && <span style={{ opacity: 0.4 }}>·</span>}
                {details?.runtime && <span>{formatRuntime(details.runtime)}</span>}
                {(details?.genres ?? []).length > 0 && (details?.year || details?.runtime) && (
                  <span style={{ opacity: 0.4 }}>·</span>
                )}
                {(details?.genres ?? []).map((g, i) => (
                  <React.Fragment key={g}>
                    {i > 0 && <span style={{ opacity: 0.4 }}>/</span>}
                    <span>{g}</span>
                  </React.Fragment>
                ))}
              </div>

              {/* Overview — 2 lines max */}
              {details?.overview && (
                <p style={{
                  fontSize: 'clamp(11px, 1.85vmin, 15px)',
                  color: 'rgba(255,255,255,0.58)',
                  lineHeight: 1.6,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  textOverflow: 'ellipsis',
                  marginBottom: '2.5vmin',
                }}>
                  {details.overview}
                </p>
              )}

              {/* Cast row */}
              {castToShow.length > 0 && (
                <div style={{ marginBottom: '2.5vmin' }}>
                  <p style={{
                    fontSize: 'clamp(8px, 1.3vmin, 10px)',
                    color: 'rgba(255,255,255,0.28)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    marginBottom: '1.5vmin',
                  }}>Starring</p>
                  <div style={{ display: 'flex', gap: '3.5vmin', flexWrap: 'nowrap' }}>
                    {castToShow.map((c, i) => (
                      <CastCard key={i} cast={c} isPortrait={isPortrait} />
                    ))}
                  </div>
                </div>
              )}

              {scores && <KioskScores scores={scores} imdbUrl={imdbUrl} isPortrait={true} />}
              {pct != null && <KioskProgressBar pct={pct} livePos={livePos} total_time={total_time} isPortrait={true} />}

            </div>
          </div>

        ) : (

          /* ================================================================
             LANDSCAPE: flex row — poster left, info right
             ================================================================ */
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'row', zIndex: 1 }}>

            {/* Poster panel */}
            <div style={{
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 38%',
              padding: '5vmin 2vmin 5vmin 5vmin',
            }}>
              {posterSrc ? (
                <img
                  src={posterSrc}
                  alt={primaryTitle ?? ''}
                  style={{
                    objectFit: 'contain',
                    borderRadius: 14,
                    boxShadow: '0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',
                    height: '88%',
                    maxWidth: '100%',
                    width: 'auto',
                  }}
                />
              ) : (
                <div style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '88%', aspectRatio: '2/3',
                }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2">
                    <rect x="2" y="3" width="20" height="14" rx="2.5"/>
                    <path d="M8 21h8M12 17v4"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Info panel */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              boxSizing: 'border-box',
              padding: '5vmin 5vmin 5vmin 2.5vmin',
              overflowY: 'auto',
              scrollbarWidth: 'none',
            }}>

              <NowPlayingLabel deviceName={deviceName} isPortrait={false} />

              {/* Primary title */}
              {primaryTitle && (
                <h1 style={{
                  fontSize: 'clamp(26px, 5.2vmin, 54px)',
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.1,
                  margin: '0 0 0.6vmin',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {primaryTitle}
                </h1>
              )}

              {/* Episode / subtitle */}
              {subtitle && (
                <p style={{
                  fontSize: 'clamp(12px, 2.3vmin, 20px)',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '1.5vmin',
                }}>
                  {subtitle}
                </p>
              )}

              {/* Year · Runtime */}
              {details && (details.year || details.runtime) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '1.2vmin',
                  fontSize: 'clamp(11px, 1.8vmin, 15px)',
                  color: 'rgba(255,255,255,0.45)',
                  marginBottom: '1.5vmin',
                }}>
                  {details.year && <span>{details.year}</span>}
                  {details.year && details.runtime && (
                    <span style={{ opacity: 0.4, fontSize: '0.8em' }}>•</span>
                  )}
                  {details.runtime && <span>{formatRuntime(details.runtime)}</span>}
                </div>
              )}

              {/* Genre tags */}
              {(details?.genres ?? []).length > 0 && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '1vmin',
                  marginBottom: '2.5vmin',
                }}>
                  {details!.genres.map(g => (
                    <span key={g} style={{
                      fontSize: 'clamp(9px, 1.6vmin, 13px)',
                      color: 'rgba(255,255,255,0.55)',
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 100,
                      padding: '2px 10px',
                      letterSpacing: '0.03em',
                      lineHeight: 1.8,
                    }}>{g}</span>
                  ))}
                </div>
              )}

              {/* Tagline */}
              {details?.tagline && (
                <p style={{
                  fontSize: 'clamp(12px, 2.1vmin, 18px)',
                  color: 'rgba(255,255,255,0.38)',
                  fontStyle: 'italic',
                  marginBottom: '1.8vmin',
                  lineHeight: 1.4,
                }}>
                  "{details.tagline}"
                </p>
              )}

              {/* Overview */}
              {details?.overview && (
                <p style={{
                  fontSize: 'clamp(11px, 1.9vmin, 16px)',
                  color: 'rgba(255,255,255,0.62)',
                  lineHeight: 1.65,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 5,
                  WebkitBoxOrient: 'vertical',
                  textOverflow: 'ellipsis',
                  marginBottom: '3.5vmin',
                }}>
                  {details.overview}
                </p>
              )}

              {/* Cast */}
              {castToShow.length > 0 && (
                <div style={{ marginBottom: '3vmin' }}>
                  <p style={{
                    fontSize: 'clamp(8px, 1.4vmin, 11px)',
                    color: 'rgba(255,255,255,0.28)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    marginBottom: '1.8vmin',
                  }}>Starring</p>
                  <div style={{ display: 'flex', gap: '3vmin', flexWrap: 'nowrap' }}>
                    {castToShow.map((c, i) => (
                      <CastCard key={i} cast={c} isPortrait={isPortrait} />
                    ))}
                  </div>
                </div>
              )}

              {/* Spacer pushes scores+progress to bottom */}
              <div style={{ flex: 1 }} />

              {scores && <KioskScores scores={scores} imdbUrl={imdbUrl} isPortrait={false} />}
              {pct != null && <KioskProgressBar pct={pct} livePos={livePos} total_time={total_time} isPortrait={false} />}

            </div>
          </div>

        )}
      </div>
    </div>
  );
}
