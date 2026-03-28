import { useCallback } from 'react';

interface Props {
  deviceId: string;
  deviceName: string;
  onClose: () => void;
}

const btnBase: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  color: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.12s',
};

function Btn({
  onClick,
  children,
  style,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.16)'; }}
      onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
      style={{ ...btnBase, ...style }}
    >
      {children}
    </button>
  );
}

export function RemoteModal({ deviceId, deviceName, onClose }: Props) {
  const send = useCallback(
    (action: string) =>
      fetch(`/api/devices/${encodeURIComponent(deviceId)}/control/${action}`, { method: 'POST' }),
    [deviceId],
  );

  const BODY_W = 196;
  const PAD_X = 20;
  const inner = BODY_W - PAD_X * 2;
  const padSize = inner;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Remote body */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: BODY_W,
          background: 'linear-gradient(180deg, #2c2c2e 0%, #1c1c1e 100%)',
          borderRadius: 38,
          padding: `22px ${PAD_X}px 30px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 40px 100px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.09)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.4)', letterSpacing: '-0.1px' }}>
            {deviceName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Power button */}
            <button
              onClick={() => send('turn_on')}
              title="Wake"
              style={{
                width: 26, height: 26, borderRadius: 13,
                background: 'rgba(255,255,255,0.08)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                <line x1="12" y1="2" x2="12" y2="12"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                width: 22, height: 22, borderRadius: 11,
                background: 'rgba(255,255,255,0.08)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.8" strokeLinecap="round">
                <path d="M1 1l8 8M9 1L1 9"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Row 1: Menu + Home */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Btn onClick={() => send('menu')} title="Menu / Back" style={{ width: 68, height: 34, borderRadius: 10, gap: 5, fontSize: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Menu
          </Btn>
          <Btn onClick={() => send('home')} title="Home" style={{ width: 68, height: 34, borderRadius: 10 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </Btn>
        </div>

        {/* Clickpad */}
        <div style={{
          position: 'relative',
          width: padSize,
          height: padSize,
          borderRadius: 18,
          background: 'rgba(255,255,255,0.055)',
          border: '1px solid rgba(255,255,255,0.09)',
          overflow: 'hidden',
          alignSelf: 'center',
        }}>
          {/* Up zone */}
          <button
            onClick={() => send('up')}
            title="Up"
            style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '28%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10, color: 'rgba(255,255,255,0.28)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          {/* Down zone */}
          <button
            onClick={() => send('down')}
            title="Down"
            style={{ position: 'absolute', bottom: 0, left: '18%', right: '18%', height: '28%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 10, color: 'rgba(255,255,255,0.28)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          {/* Left zone */}
          <button
            onClick={() => send('left')}
            title="Left"
            style={{ position: 'absolute', left: 0, top: '18%', bottom: '18%', width: '28%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 10, color: 'rgba(255,255,255,0.28)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          {/* Right zone */}
          <button
            onClick={() => send('right')}
            title="Right"
            style={{ position: 'absolute', right: 0, top: '18%', bottom: '18%', width: '28%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, color: 'rgba(255,255,255,0.28)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          {/* Center select */}
          <button
            onClick={() => send('select')}
            title="Select"
            style={{
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              width: '38%', height: '38%',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.09)',
              border: '1px solid rgba(255,255,255,0.13)',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Play/Pause */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Btn onClick={() => send('play_pause')} title="Play / Pause" style={{ width: 70, height: 38, borderRadius: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="4" width="4" height="16" rx="1.5"/>
              <rect x="15" y="4" width="4" height="16" rx="1.5"/>
            </svg>
          </Btn>
        </div>

        {/* Prev / Next */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Btn onClick={() => send('previous')} title="Previous" style={{ width: 68, height: 34, borderRadius: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 20L9 12l10-8v16z"/><rect x="5" y="4" width="2.5" height="16" rx="1"/>
            </svg>
          </Btn>
          <Btn onClick={() => send('next')} title="Next" style={{ width: 68, height: 34, borderRadius: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 4l10 8-10 8V4z"/><rect x="16.5" y="4" width="2.5" height="16" rx="1"/>
            </svg>
          </Btn>
        </div>

        {/* Skip ±10 */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Btn onClick={() => send('skip_backward')} title="Back 10s" style={{ width: 68, height: 34, borderRadius: 10, gap: 3, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 17a5 5 0 1 0 0-10H6"/><path d="M6 11l-3-3 3-3"/>
            </svg>
            10
          </Btn>
          <Btn onClick={() => send('skip_forward')} title="Forward 10s" style={{ width: 68, height: 34, borderRadius: 10, gap: 3, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
            10
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 17a5 5 0 1 1 0-10h5"/><path d="M18 11l3-3-3-3"/>
            </svg>
          </Btn>
        </div>

        {/* Volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <Btn onClick={() => send('volume_down')} title="Volume Down" style={{ width: 46, height: 36, borderRadius: 10, fontSize: 20, fontWeight: 300, letterSpacing: 0 }}>−</Btn>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }} />
          <Btn onClick={() => send('volume_up')} title="Volume Up" style={{ width: 46, height: 36, borderRadius: 10, fontSize: 20, fontWeight: 300 }}>+</Btn>
        </div>
      </div>
    </div>
  );
}
