import { useEffect, useState } from 'react';
import type { DeviceStatus } from '../types';

interface KioskConfig {
  kiosk: boolean;
  orientation: 'landscape' | 'portrait';
  device_id: string | null;
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

export function AdminModal({ devices, showUnpaired, onShowUnpairedChange, onClose }: Props) {
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/admin/hosts').then(r => r.json()).then(setHosts).catch(() => {});
    // Refresh every 5s while open
    const id = setInterval(() => {
      fetch('/api/admin/hosts').then(r => r.json()).then(setHosts).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

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

  const connectedDevices = devices.filter(d => d.connected);

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
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Show unpaired devices</span>
          <Toggle value={showUnpaired} onChange={onShowUnpairedChange} />
        </div>

        {/* Host list */}
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '65vh', overflowY: 'auto' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 2px 4px' }}>Connected Hosts</p>
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

                    {/* Device binding */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', width: 80 }}>Device</span>
                      <select
                        value={cfg.device_id ?? ''}
                        onChange={e => update(host.client_id, { device_id: e.target.value || null })}
                        style={{
                          flex: 1, fontSize: 13, padding: '5px 10px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: '#fff', cursor: 'pointer', outline: 'none',
                        }}
                      >
                        <option value="">— Any active device —</option>
                        {connectedDevices.map(d => (
                          <option key={d.identifier} value={d.identifier}>{d.name}</option>
                        ))}
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
