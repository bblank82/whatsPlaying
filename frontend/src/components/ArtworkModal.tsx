import { useEffect, useRef, useState } from 'react';
import type { NowPlaying } from '../types';

interface ScoreState {
  tomatometer: number | null;
  url: string | null;
  imdb_id: string | null;
  imdb_rating: string | null;
}

interface Props {
  src: string;
  nowPlaying: NowPlaying | null;
  effectiveSeries: string | null;
  scores: ScoreState | null;
  deviceName: string;
  onClose: () => void;
}

function formatTime(s: number | null): string {
  if (s == null) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

export function ArtworkModal({ src, nowPlaying, effectiveSeries, scores, deviceName, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Request true fullscreen on mount, exit on unmount
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

  // Live-ticking position
  const { position, total_time, device_state } = nowPlaying ?? {};
  const isPlaying = device_state?.toLowerCase().includes('playing') ?? false;
  const baseRef = useRef<{ position: number; at: number } | null>(null);
  const [livePos, setLivePos] = useState<number | null>(position ?? null);

  // Sync base from server position — only jump visually if it's the first value
  // or the deviation exceeds 8 s (actual seek). Small WebSocket drift doesn't reset the bar.
  useEffect(() => {
    if (position == null) { setLivePos(null); baseRef.current = null; return; }

    if (baseRef.current === null) {
      // First value on mount — initialise from server
      baseRef.current = { position, at: Date.now() };
      setLivePos(position);
      return;
    }

    const expectedNow = baseRef.current.position + (Date.now() - baseRef.current.at) / 1000;
    if (Math.abs(position - expectedNow) > 8) {
      // Significant jump (seek / stale report) — resync visually
      baseRef.current = { position, at: Date.now() };
      setLivePos(position);
    } else {
      // Small drift — update the anchor silently so future ticks stay accurate
      baseRef.current = { position, at: Date.now() };
    }
  }, [position]);

  // Tick forward every second while playing — independent of position prop changes
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

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: '#000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Blurred background art */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        filter: 'blur(40px) brightness(0.3) saturate(1.4)',
        transform: 'scale(1.1)',
      }} />

      {/* Fullscreen horizontal kiosk container */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 0 7vmin',
        boxSizing: 'border-box',
        zIndex: 1,
      }}>
        {/* "Now Playing on …" header */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '5vmin 6vmin 10vmin',
          display: 'flex', alignItems: 'center', gap: 10,
          zIndex: 3,
          background: 'none',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.7)" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span style={{ fontSize: 'clamp(16px, 3.5vmin, 26px)', color: 'rgba(255,255,255,0.65)', letterSpacing: '0.01em' }}>
            Now Playing on <span style={{ color: '#fff', fontWeight: 600 }}>{deviceName}</span>
          </span>
        </div>

        {/* Poster — full height, contained so nothing is cropped */}
        <img
          src={src}
          alt={primaryTitle ?? ''}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center center',
          }}
        />

        {/* Top vignette — softens the upper edge of the artwork */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '30%',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }} />

        {/* Strong gradient over the bottom so info text is readable */}
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: '50%',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 25%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0.98) 100%)',
          pointerEvents: 'none',
        }} />

        {/* Info panel — sits at bottom */}
        <div style={{ position: 'relative', width: '100%', padding: '0 6vmin', boxSizing: 'border-box' }}>
          {primaryTitle && (
            <p style={{
              fontSize: 'clamp(22px, 5vmin, 42px)',
              fontWeight: 700, color: '#fff',
              letterSpacing: '-0.3px', lineHeight: 1.15,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              marginBottom: 6,
            }}>
              {primaryTitle}
            </p>
          )}

          {subtitle && (
            <p style={{
              fontSize: 'clamp(14px, 3vmin, 24px)',
              color: 'rgba(255,255,255,0.5)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: 16,
            }}>
              {subtitle}
            </p>
          )}

          {pct != null && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: 'rgba(255,255,255,0.8)', borderRadius: 2,
                  transition: 'width 1s linear',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 'clamp(11px, 2.2vmin, 16px)', color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(livePos)}
                </span>
                {livePos != null && total_time != null && (
                  <span style={{ fontSize: 'clamp(11px, 2.2vmin, 16px)', color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums' }}>
                    −{formatTime(total_time - livePos)}
                  </span>
                )}
              </div>
            </div>
          )}

          {scores && (scores.tomatometer != null || scores.imdb_rating) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {scores.tomatometer != null && (
                <a href={scores.url ?? '#'} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                    background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 12px',
                    border: '1px solid rgba(255,255,255,0.12)' }}>
                  <span style={{ fontSize: 'clamp(14px, 3vmin, 20px)' }}>{scores.tomatometer >= 60 ? '🍅' : '🤢'}</span>
                  <span style={{ fontSize: 'clamp(13px, 3vmin, 20px)', fontWeight: 700, color: scores.tomatometer >= 60 ? '#FF3B30' : '#8E8E93' }}>
                    {scores.tomatometer}%
                  </span>
                </a>
              )}
              {scores.imdb_rating && imdbUrl && (
                <a href={imdbUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                    background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 12px',
                    border: '1px solid rgba(255,255,255,0.12)' }}>
                  <svg width="28" height="14" viewBox="0 0 44 22" fill="none">
                    <rect width="44" height="22" rx="3" fill="#F5C518"/>
                    <text x="22" y="16" fontSize="13" fontWeight="800" fill="#000" textAnchor="middle" fontFamily="Arial,sans-serif">IMDb</text>
                  </svg>
                  <span style={{ fontSize: 'clamp(13px, 3vmin, 20px)', fontWeight: 700, color: '#F5C518' }}>
                    {scores.imdb_rating}
                  </span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
