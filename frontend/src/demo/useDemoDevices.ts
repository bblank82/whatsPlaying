import { useEffect, useRef, useState } from 'react';
import type { DeviceStatus } from '../types';

// Base device definitions — positions are starting values; playing devices tick forward
const BASE_DEVICES: DeviceStatus[] = [
  {
    identifier: 'demo-living',
    name: 'Living Room',
    address: '192.168.1.101',
    hostname: 'appletv-living.local',
    model: 'Gen4K',
    device_type: 'appletv',
    room: 'Living Room',
    connected: true,
    paired: true,
    power: 'PowerState.On',
    now_playing: {
      device_state: 'DeviceState.Playing',
      media_type: 'MediaType.Video',
      title: 'Too Much and Not Enough',
      artist: null,
      album: null,
      series_name: 'Succession',
      season_number: 3,
      episode_number: 7,
      total_time: 3240,
      position: 1200,
      shuffle: null,
      repeat: null,
      artwork_id: null,
      artwork_available: false,
      app_id: 'com.netflix.Netflix',
      app_name: 'Netflix',
    },
  },
  {
    identifier: 'demo-theater',
    name: 'Theater',
    address: '192.168.1.102',
    hostname: 'appletv-theater.local',
    model: 'Gen4K',
    device_type: 'appletv',
    room: 'Theater',
    connected: true,
    paired: true,
    power: 'PowerState.On',
    now_playing: {
      device_state: 'DeviceState.Paused',
      media_type: 'MediaType.Video',
      title: 'The Dark Knight',
      artist: null,
      album: null,
      series_name: null,
      season_number: null,
      episode_number: null,
      total_time: 9180,
      position: 4500,
      shuffle: null,
      repeat: null,
      artwork_id: null,
      artwork_available: false,
      app_id: 'com.plexapp.plex',
      app_name: 'Plex',
    },
  },
];

export function useDemoDevices(): DeviceStatus[] {
  const startRef = useRef(Date.now());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  void tick; // triggers re-render each second
  const elapsed = Math.floor((Date.now() - startRef.current) / 1000);

  return BASE_DEVICES.map(d => {
    const np = d.now_playing;
    if (!np || np.device_state !== 'DeviceState.Playing') return d;
    return {
      ...d,
      now_playing: {
        ...np,
        position: Math.min((np.position ?? 0) + elapsed, np.total_time ?? Infinity),
      },
    };
  });
}
