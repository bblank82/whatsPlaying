import { useEffect, useRef, useState } from 'react';
import type { DeviceStatus } from '../types';

const WS_URL = `ws://${window.location.host}/ws`;
const RECONNECT_DELAY = 3000;

export function useDevices() {
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'status_update') {
            setDevices(msg.devices);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  async function triggerScan() {
    await fetch('/api/scan', { method: 'POST' });
  }

  return { devices, connected, triggerScan };
}
