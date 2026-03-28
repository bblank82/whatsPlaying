# Packaging What's Playing as a macOS App

Uses [Platypus](https://sveinbjorn.org/platypus) to wrap the app as a native macOS `.app` bundle.
Run these steps on your **development machine** — the target machine needs nothing installed.

---

## One-time Setup

**Install Platypus:**
```bash
brew install --cask platypus
```

Open the Platypus app, then install the CLI tool:
**Platypus menu → Install Command Line Tool**

---

## Building the .app

**1. Build the frontend:**
```bash
cd frontend && npm run build
```

**2. Open Platypus and configure:**

| Field | Value |
|---|---|
| **Script Type** | bash |
| **Script Path** | `/path/to/appletv-monitor/launch-app.sh` |
| **App Name** | `What's Playing` |
| **Interface** | Status Bar |
| **Icon** | `frontend/public/logo.png` |
| **Identifier** | `com.whatsplaying.app` |

**Checkboxes:**
- ✅ Remain running after execution
- ✅ Run in background
- ☐ Accept dropped items (leave unchecked)

**3. Add bundled files:**

In the **Bundled Files** section, click `+` and add the entire project folder:
```
/path/to/appletv-monitor
```

**4. Click Create** and save the `.app` to a convenient location (e.g. Desktop).

**5. Save the Platypus profile** (File → Save Profile) as `whatsplaying.platypus` in the project root — this lets you rebuild quickly from the CLI later.

---

## Deploying to the Target Machine

Copy the `.app` to the target machine and move it to `/Applications`:
```bash
cp -r "What's Playing.app" /Applications/
```

The app handles its own setup on first launch:
- **Python 3.11+** — installed automatically via Homebrew if missing
- **Python dependencies** — installed into a local venv on first launch (~30 seconds)

The only hard requirement is **Homebrew** — it cannot be installed silently because it requires `sudo`. If it's not present, the app will show a dialog with the install command.

To launch on login: **System Settings → General → Login Items** → add `What's Playing`.

---

## Updating to a New Version

**1. Pull the latest code** on your development machine.

**2. Rebuild the frontend:**
```bash
cd frontend && npm run build
```

**3. Back up credentials** from the old `.app` on the target machine (skip if you have a copy already):
```
"What's Playing.app"/Contents/Resources/appletv-monitor/backend/credentials.json
"What's Playing.app"/Contents/Resources/appletv-monitor/backend/known_devices.json
```

**4. Rebuild the `.app`** using the saved Platypus profile:
```bash
platypus --load-profile whatsplaying.platypus "What's Playing.app"
```

**5. Restore credentials** into the new bundle:
```bash
cp credentials.json "What's Playing.app/Contents/Resources/appletv-monitor/backend/credentials.json"
cp known_devices.json "What's Playing.app/Contents/Resources/appletv-monitor/backend/known_devices.json"
```

**6. Replace the app** on the target machine:
- Quit the running app from the menu bar icon
- Replace `What's Playing.app` in `/Applications`

---

## Notes

- `credentials.json` and `known_devices.json` live **inside the bundle** — always back them up before rebuilding or you'll need to re-pair your Apple TVs.
- `backend/.env` is also inside the bundle. If you've changed API keys or device IPs since the last build, update it after copying: `"What's Playing.app"/Contents/Resources/appletv-monitor/backend/.env`
- To rebuild the frontend only (no Platypus rebuild needed for UI-only changes): replace `frontend/dist/` inside the bundle directly.
