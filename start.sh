#!/bin/bash
# Build frontend then start backend (which serves the UI at :8000)
set -e

cd "$(dirname "$0")"

echo "Building frontend..."
cd frontend && npm run build && cd ..

echo "Starting server on http://0.0.0.0:8000"
cd backend && source .venv/bin/activate && exec python main.py
