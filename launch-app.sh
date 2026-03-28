#!/bin/bash
# Launcher for the Platypus .app bundle.
# Assumes the frontend has already been built (frontend/dist/ exists).
# Does NOT run npm build — rebuild manually with: cd frontend && npm run build

# Ensure Homebrew and system tools are on PATH (not inherited by .app bundles)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

APP_DIR="$(dirname "$0")"
cd "$APP_DIR"

alert() {
    osascript -e "display alert \"What's Playing\" message \"$1\" buttons {\"OK\"} default button \"OK\""
}

# Check for Homebrew — can't install silently (requires sudo + interactive terminal)
if ! command -v brew &>/dev/null; then
    alert "Homebrew is required but not installed.

Open Terminal and run:
/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"

Then relaunch What's Playing."
    exit 1
fi

# Check for Python 3.11+ — install via Homebrew if missing
if ! command -v python3 &>/dev/null || ! python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
    alert "Installing Python 3 via Homebrew. This may take a minute..."
    brew install python || {
        alert "Failed to install Python 3. Please run: brew install python"
        exit 1
    }
fi

# Set up the venv on first launch (bundled venv paths are machine-specific)
if [ ! -f "backend/.venv/bin/python" ]; then
    alert "First launch: installing dependencies. This will take about 30 seconds..."
    python3 -m venv backend/.venv
    backend/.venv/bin/pip install -q -r backend/requirements.txt || {
        alert "Failed to install Python dependencies. Check that backend/requirements.txt exists."
        exit 1
    }
fi

# Open the browser after a short delay to let the server start
(sleep 3 && open "http://localhost:8000") &

# Start the backend (which serves the pre-built frontend)
cd backend && source .venv/bin/activate && exec python main.py
