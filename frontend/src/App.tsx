import { useState } from 'react';
import { useDevices } from './hooks/useDevices';
import { DeviceCard } from './components/DeviceCard';
import { PairModal } from './components/PairModal';
import { AdminModal } from './components/AdminModal';

export default function App() {
  const { devices, connected, triggerScan, kioskConfig } = useDevices();
  const [pairingDevice, setPairingDevice] = useState<{ id: string; name: string; isConnected: boolean } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  function handlePair(id: string) {
    const device = devices.find(d => d.identifier === id);
    if (device) setPairingDevice({ id, name: device.name, isConnected: device.connected });
  }

  const [showUnpaired, setShowUnpaired] = useState(false);
  const [scanning, setScanning] = useState(false);
  const onlineCount = devices.filter(d => d.connected).length;

  async function handleScan() {
    setScanning(true);
    try { await triggerScan(); } finally { setScanning(false); }
  }

  // Determine which device should be in kiosk mode on this host.
  // device_id=null means "whichever device is actively playing".
  function isKioskDevice(deviceId: string): boolean {
    if (!kioskConfig.kiosk) return false;
    if (kioskConfig.device_id) return kioskConfig.device_id === deviceId;
    // No specific device pinned — activate on the first playing/paused device
    const active = devices.find(d => {
      const s = d.now_playing?.device_state?.toLowerCase() ?? '';
      return s.includes('playing') || s.includes('paused');
    });
    return active?.identifier === deviceId;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1c1c1e' }}>

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#30D158' : '#FF453A', boxShadow: connected ? '0 0 6px #30D158' : 'none' }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
                {connected ? `${onlineCount} of ${devices.length} online` : 'Disconnected'}
              </span>
            </div>
<button onClick={handleScan} disabled={scanning} style={{
              fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)',
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '6px 14px', cursor: scanning ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: scanning ? 0.5 : 1, transition: 'opacity 0.2s',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }}>
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
              </svg>
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {devices.filter(d => showUnpaired || d.connected).length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12, color: 'rgba(255,255,255,0.25)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2.5"/><path d="M8 21h8M12 17v4"/>
            </svg>
            <p style={{ fontSize: 15 }}>{connected ? 'Scanning for devices…' : 'Connecting…'}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
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
          onShowUnpairedChange={setShowUnpaired}
          onClose={() => setShowAdmin(false)}
        />
      )}
    </div>
  );
}
