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
cd backend && source .venv/bin/activate && python main.py
```

## Devices supported

### Apple TV
- Discovery via `pyatv` (mDNS + manual hosts via `EXTRA_HOSTS` env var)
- Client: `backend/atv_client.py` (`DeviceClient`)
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
- Configured via `KALEIDESCAPE_HOSTS` env var (comma-separated IPs) in `backend/.env`
- Friendly name scraped from `http://my-kaleidescape.local./components` on connect; mDNS resolved via `socket.getaddrinfo` (asyncio DNS doesn't support mDNS) before passing to httpx
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
- `frontend/src/hooks/useDevices.ts` — WebSocket connection, device state, kiosk config (including `room_id`)
- `frontend/src/contexts/debug.ts` — React context for routing log entries to the debug panel
- `frontend/src/components/DeviceCard.tsx` — per-device card, artwork, transport controls
- `frontend/src/components/ArtworkModal.tsx` — fullscreen artwork; click-to-close when not in kiosk mode
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
- Forget device: `DELETE /api/devices/{id}` removes from known list, credentials, clients, statuses, `device_rooms`, and strips IP from `EXTRA_HOSTS`/`KALEIDESCAPE_HOSTS` in `.env`
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
- `IGNORED_DEVICES` (comma-separated identifiers in `.env`) — devices in this list are skipped by `_connect_conf` and the Kaleidescape startup loop; they remain in `known_devices.json` so they can be un-hidden from Settings

## Device pinning
- **Pin** = add device's IP to `EXTRA_HOSTS` — device reconnects by direct TCP probe even without mDNS (useful when moving networks)
- **Unpin** = remove from `EXTRA_HOSTS` — device still appears if mDNS discovers it
- Pin state is injected as `pinned: bool` into every device status in the polling loop
- `POST /api/devices/{id}/pin` and `DELETE /api/devices/{id}/pin` — update `EXTRA_HOSTS` and `.env` immediately
- Pin icon (location pin) on DeviceCard header — filled/blue when pinned; only shown for Apple TVs (Kaleidescape is always manual)

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
  - Manually configured devices (in EXTRA_HOSTS/KALEIDESCAPE_HOSTS) → trash button → full forget + removes from `.env`
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

## Kaleidescape controls
- Card and remote show scan-reverse / scan-forward icons (⏪⏩) with no "10s" label — these are variable-speed scans, not fixed seeks
- Chapter navigation buttons (PREVIOUS / NEXT wire commands) flank the scan buttons on the card; remote's Prev/Next row shows "Ch" label for Kaleidescape
- Progress bar click-to-seek is disabled for Kaleidescape (`onSeek` passed as `undefined`)

## Key env vars (`backend/.env`)
```
SCAN_INTERVAL=30          # seconds between mDNS scans
POLL_INTERVAL=5           # seconds between status polls
TMDB_API_KEY=...
OMDB_API_KEY=...
EXTRA_HOSTS=192.168.89.161        # comma-separated Apple TV IPs on other subnets
KALEIDESCAPE_HOSTS=192.168.75.214 # comma-separated Kaleidescape player IPs
IGNORED_DEVICES=                  # comma-separated device identifiers to hide from UI
```

## .env management
- `_update_env_var(key, value)` in `main.py` — safely rewrites a single `KEY=value` line in `.env` without touching other settings
- **Important**: always ensures the last line ends with `\n` before appending a new key, to prevent concatenation bugs
- Modified at runtime by: pin/unpin, add/remove host, hide/unhide device, server restart writes nothing (reads only)

## Logo / favicon
- `frontend/public/logo.png` — "What's Playing" branded logo. Source of truth is the root `logo.png`; copy to `frontend/public/logo.png` then rebuild to deploy.
- `frontend/public/favicon.svg` — geometric play icon (5-facet teal→yellow-green gradient on black rounded-rect), matching the logo mark.

## Frontend build / deploy
```bash
cd frontend && npm run build   # outputs to frontend/dist/
```
Backend serves `frontend/dist/` automatically — no config change needed after build.

## Testing
```bash
# Backend (pytest)
cd backend && source .venv/bin/activate && python -m pytest test_utils.py -v

# Frontend (vitest)
cd frontend && npm test -- --run
```
Tests cover: title cleaning, RT score parsing, RT URL matching, offline status room field, known-device room preservation, frontend utility functions (formatTime, appLabel, title parsers, generic title detection).
