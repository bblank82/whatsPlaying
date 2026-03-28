import { useEffect, useState } from 'react';
import type { DeviceStatus } from '../types';

interface KioskConfig {
  kiosk: boolean;
  orientation: 'landscape' | 'portrait';
  device_id: string | null;
  room_id: string | null;
}

interface HostEntry {
  client_id: string;
  ip: string;
  hostname: string;
  kiosk_config: KioskConfig;
}

interface Props {
  devices: DeviceStatus[];
  showUnpaired: boolean;
  onShowUnpairedChange: (v: boolean) => void;
  onTriggerScan: () => Promise<void>;
  onClose: () => void;
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0,
        background: value ? '#30D158' : 'rgba(255,255,255,0.15)',
        position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

export function AdminModal({ devices, showUnpaired, onShowUnpairedChange, onTriggerScan, onClose }: Props) {
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  // Local room edits: identifier -> draft room string
  const [roomDrafts, setRoomDrafts] = useState<Record<string, string>>({});
  const [savingRoom, setSavingRoom] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/admin/hosts').then(r => r.json()).then(setHosts).catch(() => {});
    const id = setInterval(() => {
      fetch('/api/admin/hosts').then(r => r.json()).then(setHosts).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Initialise room drafts from device list
  useEffect(() => {
    setRoomDrafts(prev => {
      const next = { ...prev };
      for (const d of devices) {
        if (!(d.identifier in next)) {
          next[d.identifier] = d.room ?? '';
        }
      }
      return next;
    });
  }, [devices]);

  async function update(clientId: string, patch: Partial<KioskConfig>) {
    const host = hosts.find(h => h.client_id === clientId);
    if (!host) return;
    const next = { ...host.kiosk_config, ...patch };
    setHosts(prev => prev.map(h => h.client_id === clientId ? { ...h, kiosk_config: next } : h));
    setSaving(s => ({ ...s, [clientId]: true }));
    try {
      await fetch(`/api/admin/hosts/${encodeURIComponent(clientId)}/kiosk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } finally {
      setSaving(s => ({ ...s, [clientId]: false }));
    }
  }

  async function saveRoom(identifier: string) {
    const room = roomDrafts[identifier]?.trim() || null;
    setSavingRoom(s => ({ ...s, [identifier]: true }));
    try {
      await fetch(`/api/devices/${encodeURIComponent(identifier)}/room`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
    } finally {
      setSavingRoom(s => ({ ...s, [identifier]: false }));
    }
  }

  // Derive unique room names from all devices (excluding empty/null)
  const allRooms = Array.from(
    new Set(devices.map(d => d.room).filter((r): r is string => !!r))
  ).sort();

  const connectedDevices = devices.filter(d => d.connected);

  // Encode kiosk binding select value: "room:Theater", "device:id", or ""
  function bindingValue(cfg: KioskConfig): string {
    if (cfg.device_id) return `device:${cfg.device_id}`;
    if (cfg.room_id) return `room:${cfg.room_id}`;
    return '';
  }

  function onBindingChange(clientId: string, value: string) {
    if (!value) {
      update(clientId, { device_id: null, room_id: null });
    } else if (value.startsWith('room:')) {
      update(clientId, { room_id: value.slice(5), device_id: null });
    } else if (value.startsWith('device:')) {
      update(clientId, { device_id: value.slice(7), room_id: null });
    }
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: '#2c2c2e', borderRadius: 16, width: '100%', maxWidth: 540,
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Global settings */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Show unpaired devices</span>
            <Toggle value={showUnpaired} onChange={onShowUnpairedChange} />
          </div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
          <button
            onClick={async () => { setScanning(true); try { await onTriggerScan(); } finally { setScanning(false); } }}
            disabled={scanning}
            style={{
              fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 7, padding: '5px 12px', cursor: scanning ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              opacity: scanning ? 0.5 : 1, transition: 'opacity 0.2s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            </svg>
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '65vh', overflowY: 'auto' }}>

          {/* ── Devices / rooms ── */}
          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 2px 4px' }}>Devices</p>
          {devices.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>No devices</p>
          )}
          {[...devices].sort((a, b) => a.name.localeCompare(b.name)).map(device => (
            <div key={device.identifier} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10, padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.name}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder="Room…"
                  value={roomDrafts[device.identifier] ?? ''}
                  onChange={e => setRoomDrafts(prev => ({ ...prev, [device.identifier]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveRoom(device.identifier); }}
                  style={{
                    fontSize: 12, padding: '4px 8px', borderRadius: 7, width: 120,
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', outline: 'none',
                  }}
                />
                <button
                  onClick={() => saveRoom(device.identifier)}
                  disabled={savingRoom[device.identifier]}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                    background: 'rgba(10,132,255,0.2)',
                    border: '1px solid rgba(10,132,255,0.35)',
                    color: '#0A84FF', opacity: savingRoom[device.identifier] ? 0.5 : 1,
                  }}
                >
                  {savingRoom[device.identifier] ? '…' : 'Set'}
                </button>
              </div>
            </div>
          ))}

          {/* ── Connected hosts / kiosk ── */}
          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 2px 4px' }}>Connected Hosts</p>
          {hosts.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              No connected hosts
            </p>
          )}
          {hosts.map(host => {
            const cfg = host.kiosk_config;
            const isSaving = saving[host.client_id];
            return (
              <div key={host.client_id} style={{
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${cfg.kiosk ? 'rgba(48,209,88,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12, padding: '12px 14px',
                transition: 'border-color 0.2s',
              }}>
                {/* Host identity */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: cfg.kiosk ? 12 : 0 }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{host.hostname}</p>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{host.ip}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isSaving && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Saving…</span>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Kiosk</span>
                      <Toggle value={cfg.kiosk} onChange={v => update(host.client_id, { kiosk: v })} />
                    </div>
                  </div>
                </div>

                {/* Expanded kiosk options */}
                {cfg.kiosk && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
                    {/* Orientation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', width: 80 }}>Orientation</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(['landscape', 'portrait'] as const).map(o => (
                          <button key={o} onClick={() => update(host.client_id, { orientation: o })}
                            style={{
                              fontSize: 12, padding: '4px 12px', borderRadius: 7, cursor: 'pointer',
                              background: cfg.orientation === o ? 'rgba(10,132,255,0.25)' : 'rgba(255,255,255,0.07)',
                              border: `1px solid ${cfg.orientation === o ? 'rgba(10,132,255,0.5)' : 'rgba(255,255,255,0.1)'}`,
                              color: cfg.orientation === o ? '#0A84FF' : 'rgba(255,255,255,0.55)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {o.charAt(0).toUpperCase() + o.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Binding: room or specific device */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', width: 80 }}>Display</span>
                      <select
                        value={bindingValue(cfg)}
                        onChange={e => onBindingChange(host.client_id, e.target.value)}
                        style={{
                          flex: 1, fontSize: 13, padding: '5px 10px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: '#fff', cursor: 'pointer', outline: 'none',
                        }}
                      >
                        <option value="">— Any active device —</option>
                        {allRooms.length > 0 && (
                          <optgroup label="Room">
                            {allRooms.map(r => (
                              <option key={r} value={`room:${r}`}>{r} (any active)</option>
                            ))}
                          </optgroup>
                        )}
                        {connectedDevices.length > 0 && (
                          <optgroup label="Specific device">
                            {connectedDevices.map(d => (
                              <option key={d.identifier} value={`device:${d.identifier}`}>{d.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
