#!/bin/bash
# Build frontend then start backend (which serves the UI at :8000)
set -e

# Ensure Homebrew and system tools are on PATH (not inherited by launchd or .app bundles)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$(dirname "$0")"

echo "Building frontend..."
cd frontend && npm run build && cd ..

echo "Starting server on http://0.0.0.0:8000"
cd backend && exec .venv/bin/python3 main.py
