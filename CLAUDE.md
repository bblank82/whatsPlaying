# What's Playing — Claude Context

## Project overview
Home theater monitoring dashboard. Shows now-playing status, artwork, and remote control for all AV devices on the network. Single-page React app served by the FastAPI backend.

## App name
**What's Playing** (was "statusATV" in early commits — ignore old name).

## Architecture
- **Backend**: FastAPI + uvicorn, `backend/main.py`, port 8000
- **Frontend**: React + TypeScript + Vite + Tailwind, built to `frontend/dist/`, served as static files by the backend — no separate dev server in production
- **Single process**: `./start.sh` builds the frontend then starts the backend; everything on `:8000`
- **WebSocket**: `/ws` — backend pushes device status updates to all connected browser clients

## Starting the server
```bash
./start.sh          # build frontend + start backend (production)
# or for backend-only restart (frontend already built):
cd backend && .venv/bin/python3 main.py
```

## Devices supported

### Apple TV
- Discovery via `pyatv` (mDNS + manual hosts via `EXTRA_HOSTS` in `whatsplaying_config.json`)
- Client: `backend/atv_client.py` (`DeviceClient`) — has `cred_id` attribute (credential lookup key) which may differ from `identifier` when device was first probed via `/info`; credentials always looked up via `cred_id`
- Credentials stored in `backend/credentials.json`
- Known devices persisted in `backend/known_devices.json` — loaded on startup so offline devices still appear in the UI
- Push state staleness: if `metadata.app` (live) differs from the cached push state's `app_id`, cache is discarded and a fresh poll runs. Cache older than 60 s is also discarded. `playstatus_error` clears the cache immediately.
- **Cross-subnet probing** (`_probe_extra_host`): fetches `http://{ip}:7000/info` to get `deviceID` (MAC address) — the stable identifier that matches mDNS discovery and credentials storage. `pi` in the /info response is a session UUID, NOT the device identifier — never use it as a key.
  - First tries `pyatv.scan(hosts=[ip])` to get accurate service ports; rebuilds conf with canonical MAC as service identifier to avoid UUID keys in `clients`/`known_devices`
  - Falls back to AirPlay-only manual config (port 7000) if scan returns nothing — **does NOT add Companion service** in this path because Companion port is dynamic and guessing it causes `ConnectionFailedError` with stale credentials
  - `pyatv.scan(hosts=[ip])` cannot cross subnets (returns empty); the /info HTTP fetch does work cross-subnet via OS TCP routing
- uvicorn runs with `reload=False` — `reload=True` causes watchfiles to detect `known_devices.json` writes during startup and kill in-progress connections

### Kaleidescape
- TCP Control Protocol on port 10000
- Client: `backend/kscape_client.py` (`KaleidescapeClient`)
- Configured via `KALEIDESCAPE_HOSTS` list in `backend/whatsplaying_config.json` (migrated from `.env` on first run)
- Friendly name fetched via `GET_FRIENDLY_NAME` TCP command on connect; response parsed as `FRIENDLY_NAME` event
- Device name format: `"{friendly_name} (Kaleidescape)"` e.g. `"Theater (Kaleidescape)"`
- Identifier is always IP-based (`kaleidescape-{ip}`) — do NOT change `self.identifier` after init or control calls will break (clients dict key mismatch)
- Discovery loop must skip `KaleidescapeClient` instances (`isinstance` guard)
- Key power commands: `LEAVE_STANDBY` (on), `ENTER_STANDBY` (off) — `STANDBY` alone is rejected by the device
- Wire format (commands TO device): `device_id/seq/COMMAND:params` — device_id is always `01`, seq is single digit 1-9 cycling. **Do NOT swap these** (common mistake: putting seq first)
- Wire format (responses/events FROM device): `device_id/seq/status_code:STATUS_NAME:fields:/checksum` — seq is `!` for unsolicited push events
- Protocol parser regex: `r"^[^/]*/[^/]+/\d+:(\w+)(?::(.*))?$"` — handles both `/1/` (responses) and `/!/` (push events); strips checksum with `re.sub(r":/\d+$", "", ...)`
- `ENABLE_EVENTS:{cpdid}:` — target is the assigned CPDID from `DEVICE_INFO` field[2]; re-issued automatically when DEVICE_INFO arrives with a non-`00` CPDID. Initial connect uses `01` as default.
- `DEVICE_POWER_STATE` field[0]: `"0"` = standby, `"1"` = on; error `020` = device is in standby (expected for most commands)
- `PLAY_STATUS` field layout: `[mode, speed, title_num, title_length, title_loc, chap_num, chap_len, chap_loc]` — no handle field; mode: 0=idle, 1=paused, 2=playing, 4=fwd scan, 6=rev scan
- `CONTENT_DETAILS` comes in two parts: first `CONTENT_DETAILS_OVERVIEW:num_lines:handle:table:`, then N lines of `CONTENT_DETAILS:line_num:name:value:` (name/value pairs). Values are escaped: `\\:` → `:`, `\\/` → `/`
- `GET_CONTENT_DETAILS` command format: `GET_CONTENT_DETAILS:handle:passcode:` — handle from `HIGHLIGHTED_SELECTION`, passcode is empty (two trailing colons in wire form via `_send_raw`)
- `MOVIE_LOCATION` field[0] is a location code: `03`=main content, `04`=intermission, `05`=end credits — NOT a content handle
- `HIGHLIGHTED_SELECTION` field[0] is the content handle to pass to `GET_CONTENT_DETAILS`
- `DEVICE_INFO` field layout: `[device_type, serial, cpdid, ip]` — field[2] is assigned CPDID (`00` = none assigned)

## Frontend structure
- `frontend/src/App.tsx` — main layout, device sort order, gear/admin button, debug panel, kiosk logic
- `frontend/src/hooks/useDevices.ts` — WebSocket connection, device state, kiosk config (including `room_id`); exposes `reconnecting` state
- `frontend/src/hooks/useContentData.ts` — shared hooks and pure helpers: `parseContentMetadata`, `useScores`, `useContentArtwork`; used by `DeviceCard` and `CinematicKioskView`
- `frontend/src/contexts/debug.ts` — React context for routing log entries to the debug panel
- `frontend/src/components/DeviceCard.tsx` — per-device card, artwork, transport controls
- `frontend/src/components/CinematicKioskView.tsx` — fullscreen cinematic view; used for both kiosk mode and click-to-expand artwork
- `frontend/src/components/ErrorBoundary.tsx` — React class ErrorBoundary; wraps each device card so a single card failure can't crash the full UI
- `frontend/src/components/AdminModal.tsx` — Settings panel: show-unpaired toggle, scan button, add/remove device by IP, room assignment, hidden devices, kiosk management, server restart, debug toggle
- `frontend/src/components/RemoteModal.tsx` — navigation/transport remote (no volume buttons)
- `frontend/src/components/PairModal.tsx` — shows all available protocols with paired/unpaired status; individual Pair/Re-pair per protocol; "Forget & Re-pair All" and "Forget Device"
- `frontend/src/types.ts` — shared TypeScript types

## Device sort order
Playing/paused → connected → disconnected; alphabetical within each group.

## Device persistence
- `backend/known_devices.json` — persists `{identifier, name, address, model, device_type, room}` for all seen devices
- Loaded at startup: pre-populates `latest_statuses` and `device_rooms` with offline entries so devices appear immediately
- Written whenever a new device connects (`_connect_conf`) — preserves existing `room` field
- Forget device: `DELETE /api/devices/{id}` removes from known list, credentials, clients, statuses, `device_rooms`, and strips IP from `EXTRA_HOSTS`/`KALEIDESCAPE_HOSTS` in `whatsplaying_config.json`
- **Device identifier keys are always MAC addresses** (e.g. `7E:8F:CF:5C:4D:71`) for Apple TVs, `kaleidescape-{ip}` for Kaleidescape — UUID keys in `known_devices.json` indicate a stale/buggy entry from an old `_probe_extra_host` bug and should be removed

## Room concept
- Each device can be assigned to a named room (string, e.g. `"Theater"`, `"Living Room"`)
- Room is set via `PUT /api/devices/{id}/room` — persisted in `known_devices.json` and in the `device_rooms` in-memory cache
- Room is injected into every device status dict in the polling loop
- Kiosk can be bound to a room: it activates on the first playing/paused device in that room
- Binding priority: `device_id` > `room_id` > any active device

## Discovery loop behavior
- mDNS scan timeout: 10 seconds
- Devices that miss a scan are **disconnected but kept** in `clients` — not deleted (mDNS is flaky)
- Kaleidescape clients are never touched by the Apple TV discovery loop
- `IGNORED_DEVICES` (list in `whatsplaying_config.json`) — devices in this list are skipped by `_connect_conf` and the Kaleidescape startup loop; they remain in `known_devices.json` so they can be un-hidden from Settings
- Hide/unhide: `POST /api/devices/{id}/ignore` / `DELETE /api/devices/{id}/ignore`


## Kiosk mode
- Managed remotely via Settings panel (gear icon, upper-left)
- Per connected browser client: kiosk on/off, orientation (landscape/portrait), bound display target
- Binding options (in priority order):
  1. Specific device (`device_id`) — always shows that device
  2. Room (`room_id`) — shows the active device in that room; playing takes priority over paused
  3. None — shows any active device on the network; playing takes priority over paused
- Portrait = CSS `transform: rotate(90deg)` on the inner canvas div with swapped `100vh/100vw`
- True fullscreen: PWA manifest `display: fullscreen` + launch via `--app` flag
- Clicking the artwork modal closes it when not in kiosk mode

## Settings panel (AdminModal)
- **Show unpaired devices** toggle — persisted to `localStorage`
- **Scan** button — triggers immediate mDNS re-scan
- **Devices section** — "Add device by IP" form (type: Apple TV or Kaleidescape); lists all devices with room input and hide/remove buttons
  - Auto-discovered devices → hide button (eye-slash) → adds to `IGNORED_DEVICES`
  - Manually configured devices (in EXTRA_HOSTS/KALEIDESCAPE_HOSTS) → trash button → full forget + removes from `whatsplaying_config.json`
- **Hidden section** — appears when `IGNORED_DEVICES` is non-empty; shows hidden devices with Unhide button
- **Connected Hosts section** — per browser client kiosk config (enable/disable, orientation, display binding)
- **Developer section** — Debug panel toggle; Restart server button (two-step confirm → `POST /api/admin/restart` → SIGTERM → launchctl restarts)

## Debug panel
- Enabled via the Developer section in Settings
- Fixed terminal-style panel at the bottom of the UI (200px, dark background, monospace font)
- Logs two categories:
  - `→` (green): commands sent to devices (`play_pause`, `set_position`, etc.) with device name
  - `←` (cyan): WebSocket messages received (`status_update` summarized as count, `client_hello`, `kiosk_config`)
- Auto-scrolls to latest entry; Clear button; max 300 entries retained
- Implemented via `DebugContext` (provides `log()` to DeviceCard, RemoteModal) + ref-based callback to `useDevices` hook (outside the context boundary)

## TMDB poster art
- `/api/tmdb` accepts optional `season_number` and `episode_title` params
- For TV shows: if `season_number` is provided, fetches the season-specific poster
- If `season_number` is absent but `episode_title` is given, infers the season by searching all season episode lists in parallel (`_find_season_by_episode`), then fetches that season's poster
- Falls back to show-level poster if no season art exists
- Frontend passes `episode_title = now_playing.title` whenever `effectiveSeries` is set and `effectiveSeason` is null (e.g. HBO Max doesn't report season metadata)

## Backend metadata cache
- In-memory TTL cache (`_METADATA_CACHE`) on `/api/scores`, `/api/tmdb`, and `/api/tmdb/details`
- TTL: 1 hour (`_METADATA_TTL = 3600`)
- Helpers: `_cache_get(key)` returns cached value or `None`; `_cache_set(key, value)` stores with expiry and evicts expired entries when cache exceeds 500 keys
- Cache keys are tuples of endpoint name + all query params (title, media_type, etc.)

## Kaleidescape controls
- Card and remote show scan-reverse / scan-forward icons (⏪⏩) with no "10s" label — these are variable-speed scans, not fixed seeks
- Chapter navigation buttons (PREVIOUS / NEXT wire commands) flank the scan buttons on the card; remote's Prev/Next row shows "Ch" label for Kaleidescape
- Progress bar click-to-seek is enabled for Kaleidescape (`SET_POSITION:HH:MM:SS` wire command)

## Key env vars (`backend/.env`)
```
SCAN_INTERVAL=30   # seconds between mDNS scans
POLL_INTERVAL=5    # seconds between status polls
TMDB_API_KEY=...
OMDB_API_KEY=...
```
`EXTRA_HOSTS`, `KALEIDESCAPE_HOSTS`, and `IGNORED_DEVICES` are **not** stored in `.env` at runtime — they live in `backend/whatsplaying_config.json` and are migrated from `.env` on first run.

## Runtime config (`backend/whatsplaying_config.json`)
- Stores `extra_hosts`, `kaleidescape_hosts`, `ignored_devices` as JSON arrays
- Written by `_save_runtime_config()` whenever pin/unpin, add/remove host, or hide/unhide runs
- Migrated from `.env` on first run by `_migrate_from_env()` — values read from `.env` and written to the JSON file
- `GET /api/config/hosts` — returns current lists; `POST /api/config/hosts` — adds a device by IP (`host_type`: `"appletv"` or `"kaleidescape"`)

## Logo / favicon
- `frontend/public/logo.png` — "What's Playing" branded logo. Source of truth is the root `logo.png`; copy to `frontend/public/logo.png` then rebuild to deploy.
- `frontend/public/favicon.svg` — geometric play icon (5-facet teal→yellow-green gradient on black rounded-rect), matching the logo mark.

## Frontend build / deploy
```bash
cd frontend && npm run build   # outputs to frontend/dist/
```
Backend serves `frontend/dist/` automatically — no config change needed after build.

## Demo mode
- Activated via URL param: `http://localhost:8000/?demo`
- Entirely frontend-only — no WebSocket connection, no backend device APIs used
- Shows four mock devices across three rooms:
  - **Living Room** — Apple TV — Netflix — *Succession* S3E7, actively playing (position ticks every second)
  - **Theater** — Apple TV — Plex — *The Dark Knight*, paused partway through
  - **Theater (Kaleidescape)** — Kaleidescape Strato — *Dune: Part Two*, actively playing
  - **Bedroom** — Apple TV — Apple Music — *Midnight Rain* by Taylor Swift (*Midnights*), actively playing
- Pair button and "Pair" link are hidden on all cards in demo mode (`isDemo` prop on `DeviceCard`)
- Header shows an amber **DEMO** badge; gear/admin button is hidden
- Each card has a **Kiosk** (landscape) and **Kiosk ↕** (portrait) button that open `CinematicKioskView`
- Demo kiosk overlays can be closed with Escape or by clicking anywhere (unlike real kiosk mode which is non-dismissible)
- Implemented in `frontend/src/demo/useDemoDevices.ts`; wired into `App.tsx` via the `isDemo` flag; `useDevices` accepts an `enabled` param to skip the WebSocket when false

## Cinematic kiosk view
- **The only kiosk view, and also the click-to-expand artwork view** — `frontend/src/components/CinematicKioskView.tsx`
- `ArtworkModal` has been removed
- Fetches rich metadata from `/api/tmdb/details` (overview, cast, genres, tagline, backdrop, year, runtime) and `/api/scores` independently — **skipped entirely for music content**
- Props: `deviceName`, `nowPlaying`, `lookupTitle`, `mediaType`, `effectiveSeries`, `orientation` (`'landscape'` | `'portrait'`), `kioskActive` (false in demo, true in production — controls click-to-dismiss and cursor), `onClose`
- Rendered at App level (not inside DeviceCard) — in demo via `demoKiosk` state; in production when `kioskConfig.kiosk && kioskHasContent`
- **Music layout**: when `nowPlaying.media_type` contains `"music"`, renders a centered layout — album art (from iTunes Search API), track title, artist, album, app name, progress bar. No TMDB/scores fetched.
- **iTunes album art** (`CinematicKioskView` + `DeviceCard`): fetches from `https://itunes.apple.com/search?term={artist}+{album}&media=music&entity=album&limit=1` when `isMusic`. Uses `artworkUrl100` from the first result, URL-substituted to `600x600bb`. No API key required. Also used as the blurred backdrop in the music kiosk layout.
- **Backdrop**: blurred/darkened `<img>` element covering the full canvas (`filter: blur(40px) brightness(0.35) saturate(1.3)`, scaled 1.07×); uses backdrop URL falling back to poster, falling back to `albumArtUrl` for music
- **Landscape layout**: flex row — contained poster with drop shadow (38% left), info panel (62% right)
- **Portrait layout**: 58/42 absolute split using CSS coordinates (which are rotated 90° CW relative to the visual display):
  - Poster section: `position: absolute, top: 0, height: 58%` → occupies visual **right** 58%
  - Info panel: `position: absolute, bottom: 0, height: 42%` → occupies visual **left** 42%
  - Info panel uses `justifyContent: flex-end` to pack content toward CSS bottom = **visual left edge** of screen
  - CSS `top` maps to visual **right**; CSS `bottom` maps to visual **left** (counter-intuitive — see rotation note below)
- **Portrait rotation note**: canvas has `width: 100vh; height: 100vw; transform: rotate(90deg)`. After 90° CW rotation in CSS Y-down coordinates: `visual_x = viewport_width - css_y`, `visual_y = css_x`. So CSS top→visual right, CSS bottom→visual left, CSS left→visual top, CSS right→visual bottom.
- **Cast cards**: circular avatars with `objectPosition: top` cropping; falls back to initial letter on image error
- **Live position tick**: same base-ref extrapolation as `DeviceCard` — 1s interval, 8s drift threshold
- **Backend endpoint** `/api/tmdb/details`: accepts `title`, `media_type`, optional `season_number` + `episode_number`; returns `overview`, `tagline`, `genres`, `year`, `runtime`, `cast[]`, `poster_url`, `fullsize_url`, `backdrop_url`, `vote_average`
  - For TV shows with `season_number` + `episode_number`, fetches episode-specific overview from `GET /tv/{id}/season/{s}/episode/{e}` and uses it in place of the series overview; falls back to series overview if the episode has none or the fetch fails
  - Frontend passes `nowPlaying.season_number` and `nowPlaying.episode_number` when available; effect re-runs if either changes

## WebSocket connection state
- `useDevices` exposes `connected` (WS open) and `reconnecting` (true after first disconnect, cleared on reconnect)
- `App.tsx` header dot: green = connected, amber = reconnecting, red = never connected / permanently disconnected
- Status text: "N of N online" / "Reconnecting…" / "Disconnected"

## Testing
```bash
# Backend (pytest)
cd backend && source .venv/bin/activate && python -m pytest test_utils.py -v

# Frontend (vitest)
cd frontend && npm test -- --run
```
Tests cover: title cleaning, RT score parsing, RT URL matching, offline status room field, known-device room preservation, frontend utility functions (formatTime, appLabel, title parsers, generic title detection), `parseContentMetadata` (null input, YouTube/music detection, Hulu parsing, series metadata, generic title suppression, forceMediaType, ARTIST_AS_SERIES_APP_IDS).
