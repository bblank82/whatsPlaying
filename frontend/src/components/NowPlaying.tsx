import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NowPlaying as NowPlayingType } from '../types';
import { formatTime, appLabel } from '../utils';

function Equalizer() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 16, flexShrink: 0 }}>
      {[['eq1',3],['eq2',9],['eq3',5]].map(([cls, h]) => (
        <span key={cls} className={String(cls)} style={{
          width: 3, height: Number(h), borderRadius: 2,
          background: '#30D158', display: 'inline-block',
        }} />
      ))}
    </div>
  );
}

interface Props {
  nowPlaying: NowPlayingType | null;
  onSeek?: (position: number) => void;
  belowBar?: ReactNode;
  resolvedSeries?: string | null; // caller-resolved series name (e.g. from artist field for Plex)
}

export function NowPlaying({ nowPlaying, onSeek, belowBar, resolvedSeries }: Props) {
  // Destructure with defaults so hooks below are always called unconditionally.
  const {
    device_state = '', title = null, artist = null, album = null,
    series_name = null, season_number = null, episode_number = null,
    position = null, total_time = null, app_id = null, app_name = null,
  } = nowPlaying ?? {};

  const state = device_state.toLowerCase();
  const isPlaying = state.includes('playing');
  const isPaused  = state.includes('paused');
  const isIdle    = state.includes('idle') && !title;
  const displayApp = app_name ?? appLabel(app_id);

  // resolvedSeries may come from the artist field (Plex and similar apps that encode
  // TV show metadata as: artist=series, album="Season N", title="S1 · E1: Episode Title")
  const effectiveSeries = series_name ?? resolvedSeries ?? null;
  const isTvShow = !!(effectiveSeries || (season_number != null) || (episode_number != null));
  // Fall back to app name when no content title is available (e.g. Netflix blocking metadata)
  const primaryTitle = isTvShow ? (effectiveSeries ?? title) : (title ?? ((isPlaying || isPaused) ? displayApp : null));

  const subtitle = (() => {
    if (isTvShow) {
      const ep = [
        season_number != null ? `S${season_number}` : null,
        episode_number != null ? `E${episode_number}` : null,
      ].filter(Boolean).join('');
      // Episode title is in `title`; if it looks like "S1 · E1: Name" use it as-is
      if (effectiveSeries && title && title !== effectiveSeries) {
        return ep && !title.match(/^S\d+/) ? `${title} · ${ep}` : title;
      }
      return ep || null;
    }
    if (artist && album) return `${artist} — ${album}`;
    if (artist) return artist;
    return null;
  })();

  // Interpolate position client-side — tick forward every second while playing.
  // Hooks must be called unconditionally (Rules of Hooks), so they live before any
  // early returns.
  const baseRef = useRef<{ position: number; at: number } | null>(null);
  const [livePosition, setLivePosition] = useState<number | null>(position);

  useEffect(() => {
    if (position == null) { setLivePosition(null); baseRef.current = null; return; }

    if (baseRef.current === null) {
      baseRef.current = { position, at: Date.now() };
      setLivePosition(position);
      return;
    }

    const expectedNow = baseRef.current.position + (Date.now() - baseRef.current.at) / 1000;
    if (Math.abs(position - expectedNow) > 8) {
      baseRef.current = { position, at: Date.now() };
      setLivePosition(position);
    } else {
      baseRef.current = { position, at: Date.now() };
    }
  }, [position]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!baseRef.current) return;
      const elapsed = (Date.now() - baseRef.current.at) / 1000;
      const next = baseRef.current.position + elapsed;
      setLivePosition(total_time != null ? Math.min(next, total_time) : next);
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, total_time]);

  const pct = total_time && livePosition != null ? Math.min(100, (livePosition / total_time) * 100) : null;

  // Early returns — after all hooks
  if (!nowPlaying) {
    return <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>No media info</p>;
  }
  if (isIdle) {
    if (displayApp) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>{displayApp}</p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>· no media info</p>
        </div>
      );
    }
    return <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>Idle</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* State indicator */}
        <div style={{ flexShrink: 0, width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 2 }}>
          {isPlaying ? (
            <Equalizer />
          ) : isPaused ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,159,10,1)">
              <rect x="4" y="3" width="5" height="18" rx="2"/><rect x="15" y="3" width="5" height="18" rx="2"/>
            </svg>
          ) : null}
        </div>

        {/* Title + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {primaryTitle ? (
            <p style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {primaryTitle}
            </p>
          ) : (
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              {device_state.replace('DeviceState.', '')}
            </p>
          )}
          {subtitle && (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </p>
          )}
        </div>

      </div>

      {/* Progress bar — click to seek */}
      {pct != null && (
        <>
          <div
            onClick={e => {
              if (!onSeek || total_time == null) return;
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const newPos = Math.round(fraction * total_time);
              baseRef.current = { position: newPos, at: Date.now() };
              setLivePosition(newPos);
              onSeek(newPos);
            }}
            style={{
              marginTop: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 2, height: 4,
              overflow: 'visible', cursor: onSeek ? 'pointer' : 'default', position: 'relative',
            }}
          >
            <div style={{ height: '100%', width: `${pct}%`, background: 'rgba(255,255,255,0.7)', borderRadius: 2, transition: 'width 1s linear' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <div>{belowBar}</div>
            {livePosition != null && total_time ? (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(total_time - livePosition)}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
