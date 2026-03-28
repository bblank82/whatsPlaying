#!/bin/bash
# Launcher for the Platypus .app bundle.
# Assumes the frontend has already been built (frontend/dist/ exists).
# Does NOT run npm build — rebuild manually with: cd frontend && npm run build

# Ensure Homebrew and system tools are on PATH (not inherited by .app bundles)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

APP_DIR="$(dirname "$0")"
cd "$APP_DIR"

# Open the browser after a short delay to let the server start
(sleep 3 && open "http://localhost:8000") &

# Start the backend (which serves the pre-built frontend)
cd backend && source .venv/bin/activate && exec python main.py
