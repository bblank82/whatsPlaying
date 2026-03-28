import { useEffect, useRef, useState } from 'react';
import { useDevices } from './hooks/useDevices';
import { DeviceCard } from './components/DeviceCard';
import { PairModal } from './components/PairModal';
import { AdminModal } from './components/AdminModal';
import { DebugContext, type LogEntry } from './contexts/debug';

export default function App() {
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('debugMode') === 'true');
  const [debugEntries, setDebugEntries] = useState<LogEntry[]>([]);
  const debugIdRef = useRef(0);
  const debugModeRef = useRef(false);
  debugModeRef.current = debugMode;

  const logRef = useRef<(dir: 'send' | 'recv', msg: string, device?: string) => void>(() => {});
  logRef.current = (direction, message, device) => {
    if (!debugModeRef.current) return;
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    setDebugEntries(prev => [...prev.slice(-299), { id: debugIdRef.current++, ts, direction, device, message }]);
  };

  const { devices, connected, triggerScan, kioskConfig } = useDevices(logRef);
  const [pairingDevice, setPairingDevice] = useState<{ id: string; name: string; isConnected: boolean } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  function handlePair(id: string) {
    const device = devices.find(d => d.identifier === id);
    if (device) setPairingDevice({ id, name: device.name, isConnected: device.connected });
  }

  const [showUnpaired, setShowUnpaired] = useState(() => localStorage.getItem('showUnpaired') === 'true');
  const onlineCount = devices.filter(d => d.connected).length;

  // Determine which device should be in kiosk mode on this host.
  // Priority: specific device_id > room_id (first active in room) > any active device
  function isKioskDevice(deviceId: string): boolean {
    if (!kioskConfig.kiosk) return false;
    if (kioskConfig.device_id) return kioskConfig.device_id === deviceId;
    const isActive = (d: (typeof devices)[0]) => {
      const s = d.now_playing?.device_state?.toLowerCase() ?? '';
      return s.includes('playing') || s.includes('paused');
    };
    if (kioskConfig.room_id) {
      const active = devices.find(d => d.room === kioskConfig.room_id && isActive(d));
      return active?.identifier === deviceId;
    }
    const active = devices.find(d => isActive(d));
    return active?.identifier === deviceId;
  }

  const debugCtx = { log: logRef.current };

  return (
    <DebugContext.Provider value={debugCtx}>
      <div style={{ minHeight: '100vh', background: '#1c1c1e', paddingBottom: debugMode ? 200 : 0 }}>

        {/* ── Nav bar ── */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#000',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: admin button + logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => setShowAdmin(true)}
                title="Admin"
                style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: 'rgba(255,255,255,0.09)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.6)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              <img src="/logo.png" alt="What's Playing" style={{ height: 28, width: 'auto', display: 'block' }} />
            </div>

            {/* Right side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#30D158' : '#FF453A', boxShadow: connected ? '0 0 6px #30D158' : 'none' }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
                {connected ? `${onlineCount} of ${devices.length} online` : 'Disconnected'}
              </span>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
          {devices.filter(d => showUnpaired || d.connected).length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12, color: 'rgba(255,255,255,0.25)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5"/><path d="M8 21h8M12 17v4"/>
              </svg>
              <p style={{ fontSize: 15 }}>{connected ? 'Scanning for devices…' : 'Connecting…'}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 12 }}>
              {[...devices]
                .filter(d => showUnpaired || d.connected)
                .sort((a, b) => {
                  const isActive = (d: typeof a) => {
                    const s = d.now_playing?.device_state?.toLowerCase() ?? '';
                    return s.includes('playing') || s.includes('paused');
                  };
                  const activeDiff = Number(isActive(b)) - Number(isActive(a));
                  if (activeDiff !== 0) return activeDiff;
                  const connDiff = Number(b.connected) - Number(a.connected);
                  if (connDiff !== 0) return connDiff;
                  return a.name.localeCompare(b.name);
                }).map(device => (
                <DeviceCard
                  key={device.identifier}
                  device={device}
                  onPair={handlePair}
                  kioskActive={isKioskDevice(device.identifier)}
                  kioskOrientation={kioskConfig.orientation}
                />
              ))}
            </div>
          )}
        </main>

        <footer style={{ textAlign: 'center', padding: '24px 0 32px', color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>
          © 2026 Brandon Blank
        </footer>

        {pairingDevice && (
          <PairModal
            deviceId={pairingDevice.id}
            deviceName={pairingDevice.name}
            isConnected={pairingDevice.isConnected}
            onClose={() => setPairingDevice(null)}
            onForget={() => setPairingDevice(null)}
          />
        )}

        {showAdmin && (
          <AdminModal
            devices={devices}
            showUnpaired={showUnpaired}
            onShowUnpairedChange={v => { setShowUnpaired(v); localStorage.setItem('showUnpaired', String(v)); }}
            onTriggerScan={triggerScan}
            debugMode={debugMode}
            onDebugModeChange={v => { setDebugMode(v); localStorage.setItem('debugMode', String(v)); }}
            onClose={() => setShowAdmin(false)}
          />
        )}

        {debugMode && (
          <DebugPanel entries={debugEntries} onClear={() => setDebugEntries([])} />
        )}
      </div>
    </DebugContext.Provider>
  );
}

function DebugPanel({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [entries]);

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
      height: 200, background: '#0a0a0a',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      fontFamily: '"SF Mono", "Fira Code", "Fira Mono", monospace',
      fontSize: 11,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#111', flexShrink: 0,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Debug</span>
        <button onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 10, padding: '2px 6px' }}>Clear</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {entries.length === 0 && (
          <span style={{ color: 'rgba(255,255,255,0.2)', paddingTop: 4 }}>Waiting for activity…</span>
        )}
        {entries.map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 10, lineHeight: '18px', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{e.ts}</span>
            <span style={{ flexShrink: 0, fontWeight: 700, color: e.direction === 'send' ? '#30D158' : '#64D2FF' }}>
              {e.direction === 'send' ? '→' : '←'}
            </span>
            {e.device && <span style={{ color: '#FFD60A', flexShrink: 0 }}>{e.device}</span>}
            <span style={{ color: e.direction === 'send' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)' }}>{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
