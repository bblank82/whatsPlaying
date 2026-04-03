export interface NowPlaying {
  kscape_cover_url?: string | null;
  kscape_rating?: string | null;
  kscape_year?: number | null;
  device_state: string;
  media_type: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  series_name: string | null;
  season_number: number | null;
  episode_number: number | null;
  total_time: number | null;
  position: number | null;
  shuffle: string | null;
  repeat: string | null;
  artwork_id: string | null;
  artwork_available: boolean;
  app_id: string | null;
  app_name: string | null;
}

export interface DeviceStatus {
  identifier: string;
  name: string;
  address: string;
  hostname: string;
  model: string;
  device_type?: 'appletv' | 'kaleidescape';
  room: string | null;
  connected: boolean;
  paired?: boolean;
  power: string | null;
  now_playing: NowPlaying | null;
}
