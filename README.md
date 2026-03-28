# What's Playing

Real-time home theater monitoring dashboard. Shows now-playing status, artwork, and remote control for Apple TV and Kaleidescape devices. FastAPI backend with WebSocket-driven live updates; React + TypeScript frontend served directly from the backend — single process, single port.

---

## Features

- Live now-playing status and artwork for all devices
- Remote control (transport, navigation, power) for Apple TV and Kaleidescape
- Enriched metadata: TMDB poster art, Rotten Tomatoes and IMDb scores
- Fullscreen Now Playing kiosk mode (portrait or landscape)
- Remote kiosk management — control any connected browser from the Settings panel
- PWA-ready (installable, fullscreen manifest)
- Kaleidescape integration via TCP Control Protocol (port 10000)

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
appletv-monitor/
├── backend/
│   ├── main.py            # FastAPI server, REST + WebSocket
│   ├── atv_client.py      # Apple TV device client (pyatv)
│   ├── kscape_client.py   # Kaleidescape TCP Control Protocol client
│   ├── credentials.py     # Pairing credential store
│   ├── discovery.py       # mDNS + manual host discovery
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   ├── hooks/useDevices.ts
│   │   └── components/
│   │       ├── DeviceCard.tsx
│   │       ├── ArtworkModal.tsx
│   │       ├── AdminModal.tsx
│   │       ├── RemoteModal.tsx
│   │       └── PairModal.tsx
│   ├── public/
│   │   ├── logo.png
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
| POST | `/api/scan` | Trigger manual network scan |
| POST | `/api/devices/{id}/pair/start` | Begin Apple TV pairing |
| POST | `/api/devices/{id}/pair/finish` | Complete pairing |
| DELETE | `/api/devices/{id}/credentials` | Forget credentials |
| GET | `/api/scores` | RT + IMDb scores (`?title=&media_type=`) |
| GET | `/api/tmdb` | TMDB poster art (`?title=&media_type=`) |
| GET | `/api/admin/hosts` | Connected browser clients |
| POST | `/api/admin/hosts/{client_id}/kiosk` | Set kiosk config for a client |
| WS | `/ws` | Real-time status stream |

**Control actions:** `play`, `pause`, `play_pause`, `skip_forward`, `skip_backward`, `next`, `previous`, `set_position`, `up`, `down`, `left`, `right`, `select`, `menu`, `home`, `volume_up`, `volume_down`, `turn_on`, `turn_off`

---

## Devices

### Apple TV
Discovered via mDNS (`pyatv`). Cross-subnet devices can be added via `EXTRA_HOSTS`. Pairing is handled in-app through the pair button on any unpaired device card.

### Kaleidescape
Configured via `KALEIDESCAPE_HOSTS`. Connects over TCP port 10000 using the Kaleidescape Control Protocol. Friendly device name is resolved by scraping `http://my-kaleidescape.local./components` on startup.

---

## Kiosk Mode

Open the Settings panel (gear icon, top-left) from any browser to:
- Enable kiosk mode on any connected client
- Set orientation (portrait rotates the display 90° via CSS transform)
- Bind kiosk to a specific device

For true fullscreen, launch Chrome with `--app=http://{host}:8000` or install as a PWA.
