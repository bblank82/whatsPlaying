# statusatv

Apple TV monitor with a FastAPI backend and React frontend.

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm

## Quick Setup

```bash
./setup.sh
```

This creates a Python virtual environment in backend/.venv, installs backend requirements, and installs frontend dependencies.

## Run

### Option 1: Start both from project root

```bash
npm install
npm run dev
```

### Option 2: Start in separate terminals

Terminal 1 (backend):

```bash
cd backend
source .venv/bin/activate
python main.py
```

Terminal 2 (frontend):

```bash
cd frontend
npm run dev
```

Then open http://localhost:5173.

## Configuration

Backend settings are in backend/.env:

- SCAN_INTERVAL: device discovery interval in seconds (default 30)
- POLL_INTERVAL: status polling interval in seconds (default 5)
- TMDB_API_KEY: optional key for richer metadata
- EXTRA_HOSTS: optional comma-separated Apple TV IPs for cross-subnet discovery

Use backend/.env.example as a starting point.

## API Endpoints

The backend runs on http://localhost:8000 and provides:

- GET /api/devices
- GET /api/devices/{identifier}
- POST /api/devices/{identifier}/control/{action}
- WebSocket /ws
