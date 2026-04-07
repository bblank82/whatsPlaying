# What's Playing

Real-time home theater monitoring dashboard. Shows now-playing status, artwork, and remote control for Apple TV and Kaleidescape devices. FastAPI backend with WebSocket-driven live updates; React + TypeScript frontend served directly from the backend — single process, single port.

---

## Features

- Live now-playing status and artwork for all devices
- Remote control (transport, navigation, power) for Apple TV and Kaleidescape
- Enriched metadata: TMDB poster art (season-specific for TV), Rotten Tomatoes and IMDb scores
- **Room assignment** — group devices by room; kiosk follows the playing (not just active) device in a room
- Fullscreen Now Playing kiosk mode (portrait or landscape)
- Remote kiosk management — control any connected browser from the Settings panel
- Settings panel with scan trigger, device room assignment, and debug console
- PWA-ready (installable, fullscreen manifest)
- Kaleidescape integration via TCP Control Protocol (port 10000) — title, artwork, chapter navigation, scan controls

---

## Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit
```

**`backend/.env`:**
```
SCAN_INTERVAL=30          # seconds between mDNS scans
POLL_INTERVAL=5           # seconds between status polls
TMDB_API_KEY=             # for poster art and score disambiguation
OMDB_API_KEY=             # free key available at omdbapi.com
EXTRA_HOSTS=              # comma-separated Apple TV IPs on other subnets
KALEIDESCAPE_HOSTS=       # comma-separated Kaleidescape player IPs
```

### Frontend

```bash
cd frontend
npm install
```

---

## Running

```bash
./start.sh
```

Builds the frontend then starts the backend. Everything served on **`:8000`** — no separate frontend server.

For backend-only restarts (frontend already built):
```bash
cd backend && source .venv/bin/activate && python main.py
```

To rebuild the frontend after UI changes:
```bash
cd frontend && npm run build
```

---

## Project Structure

```
whats-playing/
├── backend/
│   ├── main.py            # FastAPI server, REST + WebSocket
│   ├── atv_client.py      # Apple TV device client (pyatv)
│   ├── kscape_client.py   # Kaleidescape TCP Control Protocol client
│   ├── credentials.py     # Pairing credential store
│   ├── discovery.py       # mDNS + manual host discovery
│   ├── test_utils.py      # pytest unit tests
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── utils.test.ts  # vitest unit tests
│   │   ├── hooks/useDevices.ts
│   │   ├── contexts/debug.ts
│   │   └── components/
│   │       ├── DeviceCard.tsx
│   │       ├── ArtworkModal.tsx
│   │       ├── AdminModal.tsx
│   │       ├── RemoteModal.tsx
│   │       ├── NowPlaying.tsx
│   │       └── PairModal.tsx
│   ├── public/
│   │   ├── logo.png
│   │   ├── favicon.svg
│   │   └── manifest.json
│   └── dist/              # built output, served by backend
├── start.sh
├── CLAUDE.md              # AI context file
└── logo.png               # source logo (copy to frontend/public/ to deploy)
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | All devices with latest status |
| POST | `/api/devices/{id}/control/{action}` | Send remote command |
| GET | `/api/devices/{id}/artwork` | Artwork image bytes |
| PUT | `/api/devices/{id}/room` | Assign or clear a device's room |
| DELETE | `/api/devices/{id}` | Forget device (credentials + known list) |
| DELETE | `/api/devices/{id}/credentials` | Re-pair (forget credentials only) |
| POST | `/api/scan` | Trigger manual network scan |
| POST | `/api/devices/{id}/pair/start` | Begin Apple TV pairing |
| POST | `/api/devices/{id}/pair/finish` | Complete pairing |
| GET | `/api/scores` | RT + IMDb scores (`?title=&media_type=`) |
| GET | `/api/tmdb` | TMDB poster art (`?title=&media_type=&season_number=&episode_title=`) |
| GET | `/api/admin/hosts` | Connected browser clients with kiosk config |
| POST | `/api/admin/hosts/{client_id}/kiosk` | Set kiosk config for a client |
| WS | `/ws` | Real-time status stream |

**Control actions:** `play`, `pause`, `play_pause`, `skip_forward`, `skip_backward`, `next`, `previous`, `set_position`, `up`, `down`, `left`, `right`, `select`, `menu`, `home`, `turn_on`, `turn_off`

---

## Devices

### Apple TV
Discovered via mDNS (`pyatv`). Cross-subnet devices can be added via `EXTRA_HOSTS`. Pairing is handled in-app through the pair button on any unpaired device card.

### Kaleidescape
Configured via `KALEIDESCAPE_HOSTS`. Connects over TCP port 10000 using the Kaleidescape Control Protocol. Friendly device name is resolved by scraping `http://my-kaleidescape.local./components` on startup.

- Title and cover art fetched via `GET_CONTENT_DETAILS` using the handle from `HIGHLIGHTED_SELECTION`
- Push events enabled using the device's assigned CPDID (from `DEVICE_INFO`)
- Transport controls: play/pause, scan forward/reverse, chapter previous/next
- Progress bar seeking is not supported and is disabled in the UI

---

## Rooms

Open the Settings panel and use the **Devices** section to assign each device to a named room (e.g. `Theater`, `Living Room`). Room names are free-form strings and are persisted across restarts.

Kiosks can then be bound to a room instead of a specific device — the display will automatically follow whichever device in that room is actively playing. If multiple devices in the room are active, a **playing** device takes priority over a **paused** one.

---

## Kiosk Mode

Open the Settings panel (gear icon, top-left) from any browser to:
- Enable kiosk mode on any connected client
- Set orientation (portrait rotates the display 90° via CSS transform)
- Bind the kiosk to a **room** (any active device in that room) or a **specific device**

Clicking anywhere on the fullscreen artwork view dismisses it when not in kiosk mode.

For true fullscreen, launch Chrome with `--app=http://{host}:8000` or install as a PWA.

---

## Settings Persistence

`showUnpaired` and `debugMode` are saved to `localStorage` and restored on page load.

---

## Deploying the Frontend to AWS Amplify

The React frontend can be hosted as a static site on AWS Amplify. The FastAPI backend must be hosted separately (e.g. EC2, Fly.io) — update the frontend's API base URL to point at it before building.

An `amplify.yml` is included at the repo root. Key detail: Amplify's build environment includes RVM, which intercepts `cd` commands via a `chpwd` hook and causes phase failures. The build spec uses `npm --prefix frontend` to avoid `cd` entirely:

```yaml
preBuild:
  - npm ci --prefix frontend
build:
  - npm run build --prefix frontend
```

**Amplify console settings:**
- Build spec: auto-detected from `amplify.yml` in the repo root
- Output directory: `frontend/dist`

---

## Testing

```bash
# Backend
cd backend && source .venv/bin/activate && python -m pytest test_utils.py -v

# Frontend
cd frontend && npm test -- --run
```
