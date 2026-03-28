# statusATV

Real-time Apple TV monitor and remote control dashboard. FastAPI backend with pyatv for device discovery, pairing, and playback control. React + Vite frontend with WebSocket-driven live updates, enriched metadata from TMDB/OMDB/Rotten Tomatoes, and a portrait-mode fullscreen Now Playing kiosk view.

---

## Recreation Prompt

The following prompt can be used to recreate this project from scratch:

---

Build a full-stack Apple TV monitor web application called **statusATV**. The tech stack is a **Python FastAPI backend** and a **React + TypeScript + Vite frontend** with no CSS framework (all inline styles). Run both together from the project root with `npm run dev` using `concurrently`.

---

### Project Structure

```
appletv-monitor/
├── backend/
│   ├── main.py
│   ├── atv_client.py
│   ├── credentials.py
│   ├── discovery.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── types.ts
│       ├── hooks/useDevices.ts
│       └── components/
│           ├── DeviceCard.tsx
│           ├── NowPlaying.tsx
│           ├── RemoteModal.tsx
│           ├── PairModal.tsx
│           └── ArtworkModal.tsx
├── package.json          ← root, runs both with concurrently
└── logo.png              ← white "statusATV" wordmark on black
```

---

### Backend

**Dependencies (`requirements.txt`):**
```
pyatv==0.16.1
fastapi==0.115.6
uvicorn[standard]==0.34.0
websockets==14.1
python-dotenv==1.0.1
httpx==0.27.2
```

**Environment (`.env`):**
```
SCAN_INTERVAL=30        # seconds between mDNS scans
POLL_INTERVAL=5         # seconds between status polls
TMDB_API_KEY=           # required for poster art and score disambiguation
OMDB_API_KEY=trilogy    # free fallback key; replace for higher rate limits
EXTRA_HOSTS=            # comma-separated IPs for Apple TVs on other subnets
```

---

#### `credentials.py`

JSON file store (`credentials.json`) mapping `identifier → {protocol_name: credential_str}`.

Functions:
- `get_for_device(identifier) → dict`
- `save(identifier, protocol_name, credential_str)`
- `forget(identifier)` — deletes all credentials for a device

---

#### `atv_client.py`

`DeviceClient` class wrapping a pyatv connection. Implements `PushListener` to receive real-time push updates (preferred) with polling fallback.

Key behaviour:
- On `connect()`: load stored credentials from `credentials.py`, set on services, call `pyatv.connect()`, start push listener, fetch app list (best-effort)
- Push updates call `playstatus_update()` → cache the playing dict
- `get_status()` returns: `identifier, name, address, hostname (resolved, 1s timeout), model, connected, power, now_playing`
- `_playing_to_dict(playing)` → normalize PlayStatus to JSON-safe dict with: `device_state, media_type, title, artist, album, series_name, season_number, episode_number, total_time, position, shuffle, repeat, artwork_id, artwork_available, app_id, app_name`. All enums coerced to strings, missing values to null.

---

#### `discovery.py`

Wraps `pyatv.scan()`. Returns list of device info dicts. `_conf_to_dict(conf)` converts a pyatv config to a JSON-serializable dict.

---

#### `main.py`

FastAPI server with:

**Device filtering:** `_is_appletv(conf)` — only keep devices whose model string contains `"gen4"` or `"appletv"` (excludes HomePods, AirPorts, etc.).

**Cross-subnet support:** `_probe_extra_host(ip)` — for devices mDNS can't reach. Fetches `http://{ip}:7000/info` (AirPlay plist), extracts device UUID (`pi` field) and name, builds a manual pyatv `AppleTV` config with `ManualService` entries for AirPlay (port 7000) and Companion (port 49152), loads any stored credentials. Called during startup and each discovery loop iteration for all `EXTRA_HOSTS` IPs.

**Background tasks:**
- `discovery_loop()` — every `SCAN_INTERVAL`: mDNS scan + probe EXTRA_HOSTS, connect new devices, disconnect disappeared ones (EXTRA_HOSTS are never disconnected due to mDNS absence)
- `polling_loop()` — every `POLL_INTERVAL`: call `get_status()` on all clients, broadcast `{type: "status_update", devices: [...]}` to all WebSocket subscribers

**REST endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | All devices with latest status |
| GET | `/api/devices/{id}` | Single device (fresh poll) |
| POST | `/api/devices/{id}/control/{action}` | Remote command |
| GET | `/api/devices/{id}/artwork` | JPEG/PNG bytes (600×600) |
| POST | `/api/scan` | Trigger manual network scan |
| DELETE | `/api/devices/{id}/credentials` | Forget credentials + reconnect |
| POST | `/api/devices/{id}/pair/start` | Begin pairing |
| POST | `/api/devices/{id}/pair/finish` | Complete pairing (body: `{pairing_id, pin?}`) |
| GET | `/api/scores?title=X&media_type=movie\|show` | RT + IMDb scores |
| GET | `/api/tmdb?title=X&media_type=movie\|show` | TMDB poster art |
| WS | `/ws` | Real-time status stream |

**Control actions:** `play`, `pause`, `play_pause`, `skip_forward`, `skip_backward`, `next`, `previous`, `set_position` (?pos=N), `up`, `down`, `left`, `right`, `select`, `menu`, `home`, `volume_up`, `volume_down`, `turn_on` (uses `client._atv.power.turn_on()`), `turn_off`

**Pairing flow:**
- `start`: iterate `[Companion, MRP, AirPlay]` in priority order, skip already-paired. Call `pyatv.pair()` then `begin()`. If `device_provides_pin`, user reads PIN from TV and submits it. Otherwise, app generates a random 4-digit PIN, sends to device via `pairing.pin()`, user enters it on TV.
- `finish`: call `pairing.pin(int(pin))` if needed, then `pairing.finish()`. Save credential string. Reconnect device. Return `remaining_protocols` (protocols still unpaired).

**`/api/scores` chain:**
1. `_clean_title(title)` — strip trailing `(1996)` or `[2024]`
2. `_tmdb_best(client, title, hint)` — search TMDB for both movie and TV in parallel, pick the one with >20% higher popularity. Tiebreak: use `hint`. Fetch `external_ids` to get IMDb ID. Returns `(kind, tmdb_id, imdb_id)`.
3. OMDB lookup by IMDb ID — extract `"Rotten Tomatoes"` and `"Internet Movie Database"` from `Ratings` array.
4. RT search page scrape (`_rt_direct_url()`) — fetch `rottentomatoes.com/search`, find `data-qa="info-name"` anchors matching `/m/` or `/tv/` prefix, exact title match first then first result.
5. If OMDB didn't return RT% (common for TV shows), fetch the direct RT page and extract `"ratingValue"` from JSON-LD.

**`/api/tmdb` chain:**
1. `_clean_title(title)`
2. `_tmdb_best(client, title, hint)` — same disambiguation
3. Fetch `/3/{kind}/{tmdb_id}` for poster_path
4. Return `poster_url` (w500), `fullsize_url` (original), `tmdb_url`

---

### Frontend

**`types.ts`:**
```typescript
interface NowPlaying {
  device_state: string; media_type: string | null;
  title: string | null; artist: string | null; album: string | null;
  series_name: string | null; season_number: number | null; episode_number: number | null;
  total_time: number | null; position: number | null;
  shuffle: string | null; repeat: string | null;
  artwork_id: string | null; artwork_available: boolean;
  app_id: string | null; app_name: string | null;
}
interface DeviceStatus {
  identifier: string; name: string; address: string; hostname: string;
  model: string; connected: boolean; power: string | null;
  now_playing: NowPlaying | null;
}
```

---

**`hooks/useDevices.ts`:**

WebSocket hook connecting to `ws://{host}/ws`. On message, parse JSON and update devices state if `type === "status_update"`. Auto-reconnect after 3s on close (unless unmounting). Expose `{devices, connected, triggerScan}`. `triggerScan()` POSTs to `/api/scan`.

---

**`App.tsx`:**

Dark full-page layout (`background: #1c1c1e`). Sticky black header with logo (`/logo.png`, height 28px), connection status dot (green glow if connected), device count label, "Show unpaired" iOS-style toggle switch, and a "Scan" button with spinning refresh icon while scanning. Main content: responsive grid (`auto-fill, minmax(380px, 1fr)`), cards sorted connected-first then alphabetically. Footer: `© 2026 Brandon Blank`.

---

**`components/DeviceCard.tsx`:**

**Header:** Device name (bold, truncated) + hostname below. Right side: power toggle (dot indicator, "On"/"Standby" label, click to `turn_on`/`turn_off`) + pair button (+ icon, 22×22px, rounded-6).

**Body when connected:**
- Left: 80px tall artwork thumbnail. Source priority: TMDB w500 poster → Apple device artwork → device icon SVG. Clickable if fullsize src available → opens ArtworkModal. `onError` falls back down the chain.
- Right: `NowPlaying` component with `resolvedSeries` and `belowBar` (ScoresRow) props.

**Controls row** (shown only if playing or paused):
- Back 10s: arc arrow SVG + "10" text label stacked in flex column
- Play/pause: large 52px circle button, filled pause bars or play triangle
- Forward 10s: same style, mirrored arrow
- Remote button (always shown): Siri Remote silhouette SVG (tall rounded rect, circle trackpad, volume dots)

**Compound title parsing** (in order):
1. **Hulu:** `/^(.+?)\s*\|\s*S(\d+)\s*E(\d+)(?:\s*[-–]\s*(.+))?$/i` on `title` — extract series, season, episode, episodeTitle
2. **Plex/Infuse:** title matches `/^S\d+\s*[·•\-]\s*E\d+/i` OR album matches `/^season\s+\d+/i` → use `artist` as series
3. Pyatv `series_name` field (native, most reliable)

Inject parsed fields into `effectiveNowPlaying` override so NowPlaying renders correctly. Use `effectiveSeries` for TMDB/RT lookup title.

**Scores (ScoresRow):** Fetch `/api/scores` when `isActive && isVideo`. Show RT badge only if `tomatometer != null` (hide if score unavailable even if URL exists). RT icon: fresh tomato SVG (red circle + green leaf) if ≥60%, rotten splat SVG (olive-green blob) if <60%. IMDb badge (yellow rect). Fetch pauses if device goes idle.

**Not-connected state:** Device icon (dimmed) + "Not paired" + blue "Pair" button.

---

**`components/NowPlaying.tsx`:**

Takes `nowPlaying`, `onSeek`, `belowBar`, `resolvedSeries` props.

Layout:
- State icon column (equalizer bars animation while playing, amber pause icon while paused)
- Title + subtitle column:
  - `effectiveSeries = series_name ?? resolvedSeries` → use as primary title for TV
  - Subtitle for TV: episode title (if different from series) + S/E code if not already embedded in title
  - Subtitle for music: `artist — album`
- Progress bar (click to seek) with `onClick` calculating fraction × total_time
- Below-bar row: `belowBar` slot (left) + remaining time (right, tabular-nums)

Live position interpolation:
- `baseRef = {position, at: Date.now()}` anchors the server value
- 1s interval ticks forward: `base.position + (now - base.at) / 1000`
- On new `position` prop: if `|position - expected| > 8s` → resync visually; otherwise silent re-anchor (prevents stale server values from resetting the bar)

App name table: bundle ID → friendly name for Netflix, Apple TV+, Plex, Hulu, Prime, Disney+, Max, Spotify, Infuse, YouTube, etc.

---

**`components/RemoteModal.tsx`:**

Full-screen backdrop (blur + dim), click backdrop to close. Remote body (196px wide, dark gradient, 38px border-radius). From top to bottom:
- Header: device name label + power/wake button (⏻ icon) + close (×)
- Row: Menu (← icon + text) + Home (house icon) buttons
- Clickpad square: absolute-positioned transparent buttons for up/down/left/right zones + circular center select button
- Play/pause button (centered)
- Previous/Next row
- Skip ±10s row (arc arrow + "10" text)
- Volume row: −/+ buttons flanking a decorative spacer bar

---

**`components/PairModal.tsx`:**

Steps: `confirm_forget | starting | enter_pin | show_pin | finishing | done_partial | done | error`

- If device `isConnected`: open at `confirm_forget` step (no auto-start). Show warning triangle, "Forget & Re-pair?" with Cancel + red destructive button. On confirm: DELETE credentials then startPairing().
- If not connected: auto-start pairing on mount (StrictMode guard with `startedRef`).
- `enter_pin`: numeric input (inputMode="numeric", maxLength=4, monospace 32px, 0.5em letter-spacing), Enter key shortcut, disabled Continue until 4 digits.
- `show_pin`: large 40px monospace PIN display.
- `done_partial`: list remaining protocols with descriptions, "Pair {next}" button.
- All inline styles, dark glass aesthetic matching rest of app.

---

**`components/ArtworkModal.tsx`:**

On mount: `requestFullscreen()`. On unmount: `exitFullscreen()`. Close on `fullscreenchange` (fullscreen exited) or `keydown Escape`.

**Rotated portrait layout for TV display:**
```
width: 100vh, height: 100vw
transform: translate(-50%, -50%) rotate(90deg)
```
This swaps viewport dimensions so content fills a physically portrait TV screen.

**Layers (bottom to top):**
1. Blurred background: `filter: blur(40px) brightness(0.3) saturate(1.4); transform: scale(1.1)` (scale prevents blur edges)
2. Artwork image: `objectFit: cover; objectPosition: center top` (fills from top, crops bottom)
3. Bottom gradient: `height: 50%; transparent → rgba(0,0,0,0.98)` (makes bottom text readable)
4. Top gradient: `rgba(0,0,0,0.85) → transparent` over header area
5. "Now Playing on **{deviceName}**" header with filled play icon
6. Info panel (bottom, `position: relative`):
   - Primary title (clamp 22–42px, 2-line clamp)
   - Subtitle (clamp 14–24px)
   - Progress bar (4px, white fill, 1s linear transition)
   - Elapsed / remaining time
   - RT + IMDb score badges (clamp 13–20px)

Live position: same 8s-threshold resync logic as NowPlaying, split into two `useEffect`s (position sync vs interval tick).

---

### Visual Design System

**Colors:**
- Page background: `#1c1c1e`
- Card background: `#2c2c2e` (connected), `#232325` (disconnected)
- Header/nav: `#000`
- Playing accent: `#30D158` (green)
- Pause accent: `#FF9F0A` (amber)
- Primary action: `#0A84FF` (blue)
- Destructive: `#FF453A` (red)
- Text primary: `#fff`
- Text secondary: `rgba(255,255,255,0.45)`
- Borders: `rgba(255,255,255,0.08–0.12)`

**Cards:** 16px border-radius, green glow border + box-shadow while playing, dimmed border while idle.

**Buttons:** `rgba(255,255,255,0.07–0.12)` fill, `rgba(255,255,255,0.1)` border, 8–12px border-radius. No Tailwind — all inline styles.

**Modals:** `backdropFilter: blur(14px)`, `rgba(0,0,0,0.72)` overlay, `zIndex: 200` (PairModal), `300` (RemoteModal), `400` (ArtworkModal).

---

### Setup

```bash
# Python backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install

# Root runner
cd ..
npm install   # installs concurrently
npm run dev   # starts both
```

Root `package.json` scripts:
```json
{
  "dev": "concurrently --kill-others --names 'backend,frontend' --prefix-colors 'cyan,magenta' 'npm run backend' 'npm run frontend'",
  "backend": "cd backend && source .venv/bin/activate && python main.py",
  "frontend": "cd frontend && npm run dev"
}
```

Vite proxy config (`vite.config.ts`):
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8000',
    '/ws': { target: 'ws://localhost:8000', ws: true }
  }
}
```
