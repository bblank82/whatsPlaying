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
- `ENABLE_EVENTS:01:` — target is CPDID of device to receive events from, NOT a bitmask
- `DEVICE_POWER_STATE` field[0]: `"0"` = standby, `"1"` = on; error `020` = device is in standby (expected for most commands)
- `PLAY_STATUS` field layout: `[handle, play_state, chapter, chapter_pos_s, chapter_dur_s, play_speed, title_pos_s, title_dur_s]`
- `DEVICE_INFO` field layout: `[device_type, serial, cpdid, ip]` — field[2] is assigned CPDID (`00` = none assigned)

## Frontend structure
- `frontend/src/App.tsx` — main layout, device sort order, gear/admin button, debug panel, kiosk logic
- `frontend/src/hooks/useDevices.ts` — WebSocket connection, device state, kiosk config (including `room_id`)
- `frontend/src/contexts/debug.ts` — React context for routing log entries to the debug panel
- `frontend/src/components/DeviceCard.tsx` — per-device card, artwork, transport controls
- `frontend/src/components/ArtworkModal.tsx` — fullscreen artwork; click-to-close when not in kiosk mode
- `frontend/src/components/AdminModal.tsx` — Settings panel: show-unpaired toggle, scan button, room assignment per device, kiosk management, debug toggle
- `frontend/src/components/RemoteModal.tsx` — navigation/transport remote (no volume buttons)
- `frontend/src/components/PairModal.tsx` — pairing flow; has "Forget & Re-pair" and "Forget Device" (calls `DELETE /api/devices/{id}`)
- `frontend/src/types.ts` — shared TypeScript types

## Device sort order
Playing/paused → connected → disconnected; alphabetical within each group.

## Device persistence
- `backend/known_devices.json` — persists `{identifier, name, address, model, device_type, room}` for all seen devices
- Loaded at startup: pre-populates `latest_statuses` and `device_rooms` with offline entries so devices appear immediately
- Written whenever a new device connects (`_connect_conf`) — preserves existing `room` field
- Forget device: `DELETE /api/devices/{id}` removes from known list, credentials, clients, statuses, and `device_rooms`

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

## Kiosk mode
- Managed remotely via Settings panel (gear icon, upper-left)
- Per connected browser client: kiosk on/off, orientation (landscape/portrait), bound display target
- Binding options (in priority order):
  1. Specific device (`device_id`) — always shows that device
  2. Room (`room_id`) — shows the first playing/paused device in that room
  3. None — shows any playing/paused device on the network
- Portrait = CSS `transform: rotate(90deg)` on the inner canvas div with swapped `100vh/100vw`
- True fullscreen: PWA manifest `display: fullscreen` + launch via `--app` flag
- Clicking the artwork modal closes it when not in kiosk mode

## Settings panel (AdminModal)
- **Show unpaired devices** toggle — persisted to `localStorage`
- **Scan** button — triggers immediate mDNS re-scan
- **Devices section** — lists all devices with inline room text input (Enter or Set button saves)
- **Connected Hosts section** — per browser client kiosk config (enable/disable, orientation, display binding)
- **Developer section** — Debug panel toggle (persisted to `localStorage`)

## Debug panel
- Enabled via the Developer section in Settings
- Fixed terminal-style panel at the bottom of the UI (200px, dark background, monospace font)
- Logs two categories:
  - `→` (green): commands sent to devices (`play_pause`, `set_position`, etc.) with device name
  - `←` (cyan): WebSocket messages received (`status_update` summarized as count, `client_hello`, `kiosk_config`)
- Auto-scrolls to latest entry; Clear button; max 300 entries retained
- Implemented via `DebugContext` (provides `log()` to DeviceCard, RemoteModal) + ref-based callback to `useDevices` hook (outside the context boundary)

## Key env vars (`backend/.env`)
```
SCAN_INTERVAL=30          # seconds between mDNS scans
POLL_INTERVAL=5           # seconds between status polls
TMDB_API_KEY=...
OMDB_API_KEY=...
EXTRA_HOSTS=192.168.89.161        # comma-separated Apple TV IPs on other subnets
KALEIDESCAPE_HOSTS=192.168.75.214 # comma-separated Kaleidescape player IPs
```

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
