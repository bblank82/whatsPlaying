# Installing What's Playing on a Dedicated Mac

## Prerequisites

Install these if not already present.

**Homebrew** (package manager):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Python 3.11+** and **Node.js 20+**:
```bash
brew install python node
```

---

## Install

**1. Copy the project to the machine**

Either clone from git or copy the folder via AirDrop/network share. Place it somewhere permanent:
```bash
cp -r whats-playing ~/whats-playing
```

**2. Run setup**
```bash
cd ~/whats-playing
./setup.sh
```

**3. Configure `.env`**

Edit `backend/.env` with your network specifics:
```
TMDB_API_KEY=your_key_here
OMDB_API_KEY=your_key_here         # free at omdbapi.com
EXTRA_HOSTS=192.168.x.x            # Apple TVs on other subnets (comma-separated)
KALEIDESCAPE_HOSTS=192.168.x.x     # Kaleidescape player IPs (comma-separated, if any)
SCAN_INTERVAL=30
POLL_INTERVAL=5
```

**4. Transfer credentials** (avoids re-pairing all Apple TVs)

From your current machine, copy these two files into the new `backend/` folder:
```
backend/credentials.json
backend/known_devices.json
```

**5. Test manually**
```bash
cd ~/whats-playing && ./start.sh
```
Open `http://localhost:8000` — all devices should appear.

---

## Auto-start on Boot

Create a launchd plist so the server starts automatically on login and restarts on crash.

Replace `YOUR_USERNAME` with the actual macOS username (run `whoami` if unsure):

```bash
cat > ~/Library/LaunchAgents/com.whatsplaying.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.whatsplaying</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/bblank/whats-playing/start.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/bblank/whats-playing</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/bblank/whats-playing/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/bblank/whats-playing/server.log</string>
</dict>
</plist>
EOF
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.whatsplaying.plist
```

Manage the service:
```bash
launchctl list | grep whatsplaying    # check if running
launchctl stop com.whatsplaying       # stop
launchctl start com.whatsplaying      # start
launchctl unload ~/Library/LaunchAgents/com.whatsplaying.plist  # disable autostart
```

View logs:
```bash
tail -f ~/whats-playing/server.log
```

---

## System Settings for a Dedicated Machine

| Setting | Location |
|---|---|
| **Auto-login** | System Settings → Users & Groups → Automatic Login |
| **Prevent sleep** | System Settings → Battery → Prevent automatic sleeping |
| **Local network access** | First launch will prompt — approve Python in System Settings → Privacy & Security |

---

## Accessing from Other Devices

The server binds to `0.0.0.0:8000`. Any device on the same network can reach it at:

```
http://<mac-ip>:8000
```

To find the Mac's IP address:
```bash
ipconfig getifaddr en0
```

For fullscreen kiosk use, launch Chrome with:
```bash
open -a "Google Chrome" --args --app=http://localhost:8000
```
Or install as a PWA from Chrome's address bar menu.
