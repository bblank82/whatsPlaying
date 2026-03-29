import { useEffect, useRef, useState } from 'react';

type Step = 'protocols' | 'starting' | 'enter_pin' | 'show_pin' | 'finishing' | 'done_partial' | 'done' | 'error';

const PROTO_DESCRIPTIONS: Record<string, string> = {
  Companion: 'Device control and basic app state.',
  MRP:       'Full media metadata and playback info.',
  AirPlay:   'Richer media info for third-party apps.',
};

interface ProtocolInfo {
  name: string;
  available: boolean;
  paired: boolean;
}

interface Props {
  deviceId: string;
  deviceName: string;
  isConnected?: boolean;
  onClose: () => void;
  onForget?: () => void;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

function IconCircle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 28,
      background: `${color}22`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginBottom: 4,
    }}>
      {children}
    </div>
  );
}

const btn: React.CSSProperties = {
  flex: 1, borderRadius: 12, padding: '11px 0',
  fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none',
  transition: 'opacity 0.15s',
};

// ---------------------------------------------------------------------------
// PairModal
// ---------------------------------------------------------------------------

export function PairModal({ deviceId, deviceName, isConnected, onClose, onForget }: Props) {
  const [step, setStep]             = useState<Step>(isConnected ? 'protocols' : 'starting');
  const [protocols, setProtocols]   = useState<ProtocolInfo[]>([]);
  const [proLoading, setProLoading] = useState(isConnected ?? false);
  const [pairingId, setPairingId]   = useState('');
  const [protocol, setProtocol]     = useState('');
  const [pin, setPin]               = useState('');
  const [shownPin, setShownPin]     = useState('');
  const [error, setError]           = useState('');
  const [remaining, setRemaining]   = useState<string[]>([]);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const startedRef  = useRef(false);

  useEffect(() => {
    if (isConnected) {
      loadProtocols();
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    startPairing();
  }, []);

  useEffect(() => {
    if (step === 'enter_pin') pinInputRef.current?.focus();
  }, [step]);

  async function loadProtocols() {
    setProLoading(true);
    try {
      const r = await fetch(`/api/devices/${deviceId}/pairing`);
      const data = await r.json();
      setProtocols(data.protocols ?? []);
    } catch { /* ignore */ }
    finally { setProLoading(false); }
  }

  async function forgetAndStart() {
    try { await fetch(`/api/devices/${deviceId}/credentials`, { method: 'DELETE' }); } catch { /* ignore */ }
    startPairing();
  }

  async function forgetDevice() {
    try { await fetch(`/api/devices/${deviceId}`, { method: 'DELETE' }); } catch { /* ignore */ }
    onForget?.();
    onClose();
  }

  async function startPairing(proto?: string) {
    startedRef.current = true;
    setStep('starting');
    setError('');
    setPin('');
    const url = proto
      ? `/api/devices/${deviceId}/pair/start?protocol=${encodeURIComponent(proto)}`
      : `/api/devices/${deviceId}/pair/start`;
    try {
      const res  = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (data.error) { setError(data.error); setStep('error'); return; }
      setPairingId(data.pairing_id);
      setProtocol(data.protocol);
      if (data.device_provides_pin) {
        setStep('enter_pin');
      } else {
        setShownPin(data.pin);
        setStep('show_pin');
      }
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }

  async function finishPairing() {
    setStep('finishing');
    try {
      const body: Record<string, string> = { pairing_id: pairingId };
      if (pin) body.pin = pin;
      const res  = await fetch(`/api/devices/${deviceId}/pair/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setStep('error'); return; }
      if (isConnected) {
        // Return to protocol overview with refreshed status
        await loadProtocols();
        setStep('protocols');
      } else {
        const rem: string[] = data.remaining_protocols ?? [];
        setRemaining(rem);
        setStep(rem.length > 0 ? 'done_partial' : 'done');
      }
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }

  // ---------------------------------------------------------------------------
  // Layout shell
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 340,
            background: '#1c1c1e',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Title bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                {isConnected ? 'Pairing' : 'Pair with Apple TV'}
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{deviceName}</p>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 26, height: 26, borderRadius: 13,
                background: 'rgba(255,255,255,0.09)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.5)',
                fontSize: 18, lineHeight: 1,
              }}
            >×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 18px 20px' }}>

            {/* ── Protocol overview (connected devices) ── */}
            {step === 'protocols' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {proLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.3)' }}>
                    <Spinner />
                  </div>
                ) : (
                  protocols.filter(p => p.available).map(p => (
                    <div key={p.name} style={{
                      background: '#2c2c2e', borderRadius: 12,
                      padding: '11px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      {/* Status dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                        background: !p.available ? 'rgba(255,255,255,0.2)'
                          : p.paired ? '#30D158' : 'rgba(255,255,255,0.2)',
                        boxShadow: p.available && p.paired ? '0 0 6px #30D15866' : 'none',
                      }} />
                      {/* Name + description */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1 }}>{p.name}</p>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3, lineHeight: 1.3 }}>
                          {PROTO_DESCRIPTIONS[p.name]}
                        </p>
                      </div>
                      {/* Status label + button */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: p.paired ? '#30D158' : 'rgba(255,255,255,0.3)' }}>
                          {p.paired ? 'Paired' : 'Not paired'}
                        </span>
                        <button
                          onClick={() => startPairing(p.name)}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
                            cursor: 'pointer',
                            background: p.paired ? 'rgba(255,255,255,0.08)' : 'rgba(10,132,255,0.22)',
                            border: `1px solid ${p.paired ? 'rgba(255,255,255,0.12)' : 'rgba(10,132,255,0.4)'}`,
                            color: p.paired ? 'rgba(255,255,255,0.55)' : '#0A84FF',
                          }}
                        >
                          {p.paired ? 'Re-pair' : 'Pair'}
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {/* Destructive actions */}
                {!proLoading && (
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
                    <button
                      onClick={forgetAndStart}
                      style={{ ...btn, flex: 'none', background: 'rgba(255,69,58,0.15)', color: '#FF453A', border: '1px solid rgba(255,69,58,0.25)' }}
                    >
                      Forget &amp; Re-pair All
                    </button>
                    {onForget && (
                      <button
                        onClick={forgetDevice}
                        style={{ ...btn, flex: 'none', background: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}
                      >
                        Forget Device
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Loading / finishing ── */}
            {(step === 'starting' || step === 'finishing') && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 0', gap: 12, color: 'rgba(255,255,255,0.35)' }}>
                <Spinner />
                <p style={{ fontSize: 13 }}>
                  {step === 'starting' ? 'Initiating pairing…' : 'Finishing up…'}
                </p>
              </div>
            )}

            {/* ── Enter PIN (device shows PIN, user types it) ── */}
            {step === 'enter_pin' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  A PIN is displayed on <span style={{ color: '#fff', fontWeight: 500 }}>{deviceName}</span>. Enter it below.
                </p>
                <input
                  ref={pinInputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && pin.length === 4 && finishPairing()}
                  placeholder="0000"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#2c2c2e', borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '12px 16px', textAlign: 'center',
                    fontSize: 32, fontFamily: 'monospace', letterSpacing: '0.5em',
                    color: '#fff', outline: 'none',
                  }}
                />
                {protocol && (
                  <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>
                    via {protocol}
                  </p>
                )}
                <button
                  onClick={finishPairing}
                  disabled={pin.length < 4}
                  style={{ ...btn, flex: 'none', background: '#0A84FF', color: '#fff', opacity: pin.length < 4 ? 0.3 : 1 }}
                >
                  Continue
                </button>
              </div>
            )}

            {/* ── Show PIN (app shows PIN, user enters on TV) ── */}
            {step === 'show_pin' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  Enter this code on <span style={{ color: '#fff', fontWeight: 500 }}>{deviceName}</span> when prompted.
                </p>
                <div style={{
                  background: '#2c2c2e', borderRadius: 14,
                  padding: '18px 0', textAlign: 'center',
                }}>
                  <span style={{ fontSize: 40, fontFamily: 'monospace', letterSpacing: '0.4em', color: '#fff', fontWeight: 600 }}>
                    {shownPin}
                  </span>
                </div>
                {protocol && (
                  <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>
                    via {protocol}
                  </p>
                )}
                <button onClick={finishPairing} style={{ ...btn, flex: 'none', background: '#0A84FF', color: '#fff' }}>
                  Done
                </button>
              </div>
            )}

            {/* ── Partially done (first-time / non-connected flow) ── */}
            {step === 'done_partial' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
                <IconCircle color="#30D158">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </IconCircle>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                  {protocol} Paired
                </p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 260, lineHeight: 1.5 }}>
                  Pair additional protocols for more features.
                </p>
                {remaining.map(proto => (
                  <div key={proto} style={{
                    width: '100%', background: '#2c2c2e', borderRadius: 12,
                    padding: '12px 14px', textAlign: 'left',
                  }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{proto}</p>
                    {PROTO_DESCRIPTIONS[proto] && (
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 3 }}>{PROTO_DESCRIPTIONS[proto]}</p>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 4 }}>
                  {remaining.length > 0 && (
                    <button onClick={() => startPairing()} style={{ ...btn, background: '#0A84FF', color: '#fff' }}>
                      Pair {remaining[0]}
                    </button>
                  )}
                  <button onClick={onClose} style={{ ...btn, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* ── Fully done ── */}
            {step === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '8px 0' }}>
                <IconCircle color="#30D158">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </IconCircle>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Paired Successfully</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>The device will appear connected shortly.</p>
                <button onClick={onClose} style={{ ...btn, flex: 'none', width: '100%', marginTop: 8, background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
                  Done
                </button>
              </div>
            )}

            {/* ── Error ── */}
            {step === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
                <IconCircle color="#FF453A">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="2.2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </IconCircle>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Pairing Failed</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', maxWidth: 260, lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {error}
                </p>
                <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 4 }}>
                  <button
                    onClick={() => isConnected ? setStep('protocols') : startPairing()}
                    style={{ ...btn, background: '#0A84FF', color: '#fff' }}
                  >
                    {isConnected ? 'Back' : 'Try Again'}
                  </button>
                  <button onClick={onClose} style={{ ...btn, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
