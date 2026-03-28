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
- Credentials stored in `backend/credentials/`
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
- `frontend/src/App.tsx` — main layout, device sort order, gear/admin button
- `frontend/src/hooks/useDevices.ts` — WebSocket connection, device state, kiosk config
- `frontend/src/components/DeviceCard.tsx` — per-device card, artwork, remote controls
- `frontend/src/components/ArtworkModal.tsx` — fullscreen artwork (kiosk mode)
- `frontend/src/components/AdminModal.tsx` — Settings panel (connected hosts, kiosk management, show unpaired toggle)
- `frontend/src/components/PairModal.tsx` — pairing flow; has "Forget & Re-pair" and "Forget Device" (calls `DELETE /api/devices/{id}`)
- `frontend/src/types.ts` — shared TypeScript types

## Device sort order
Playing/paused → connected → disconnected; alphabetical within each group.

## Device persistence
- `backend/known_devices.json` — persists `{identifier, name, address, model, device_type}` for all seen devices
- Loaded at startup: pre-populates `latest_statuses` with offline entries so devices appear immediately
- Written whenever a new device connects (`_connect_conf`)
- Forget device: `DELETE /api/devices/{id}` removes from known list, credentials, clients, and statuses

## Discovery loop behavior
- mDNS scan timeout: 10 seconds
- Devices that miss a scan are **disconnected but kept** in `clients` — not deleted (mDNS is flaky)
- Kaleidescape clients are never touched by the Apple TV discovery loop

## Kiosk mode
- Managed remotely via Settings panel (gear icon, upper-left)
- Per connected browser client: kiosk on/off, orientation (landscape/portrait), bound device
- Portrait = CSS `transform: rotate(90deg)` on the inner canvas div with swapped `100vh/100vw`
- True fullscreen: PWA manifest `display: fullscreen` + launch via `--app` flag

## Key env vars (`backend/.env`)
```
SCAN_INTERVAL=30          # seconds between mDNS scans
POLL_INTERVAL=5           # seconds between status polls
TMDB_API_KEY=...
OMDB_API_KEY=...
EXTRA_HOSTS=192.168.89.161        # comma-separated Apple TV IPs on other subnets
KALEIDESCAPE_HOSTS=192.168.75.214 # comma-separated Kaleidescape player IPs
```

## Logo
`frontend/public/logo.png` — "What's Playing" branded logo with green geometric play icon on black background. Source of truth is the root `logo.png`; copy to `frontend/public/logo.png` then rebuild to deploy.

## Frontend build / deploy
```bash
cd frontend && npm run build   # outputs to frontend/dist/
```
Backend serves `frontend/dist/` automatically — no config change needed after build.
