#!/usr/bin/env bash
set -e

echo "==> Setting up Apple TV Monitor"

# Backend
echo ""
echo "--- Backend (Python) ---"
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp -n .env.example .env 2>/dev/null || true
deactivate
cd ..

# Frontend
echo ""
echo "--- Frontend (Node) ---"
cd frontend
npm install
cd ..

echo ""
echo "Done! To start:"
echo ""
echo "  Terminal 1 — backend:"
echo "    cd backend && source .venv/bin/activate && python main.py"
echo ""
echo "  Terminal 2 — frontend:"
echo "    cd frontend && npm run dev"
echo ""
echo "  Then open: http://localhost:5173"
