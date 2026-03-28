"""FastAPI server — REST endpoints + WebSocket broadcast for Apple TV monitor."""

import asyncio
import ipaddress
import json
import logging
import os
import plistlib
import random
import uuid
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import quote as url_quote

import httpx
import pyatv
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pyatv.conf import AppleTV as ATVConf, ManualService
from pyatv.const import Protocol as _Protocol

from atv_client import DeviceClient
from credentials import get_for_device, save as save_credential, forget as forget_credentials
from discovery import scan_devices, _conf_to_dict

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "30"))   # re-scan every N seconds
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))    # poll now-playing every N seconds
TMDB_API_KEY  = os.getenv("TMDB_API_KEY", "")
OMDB_API_KEY  = os.getenv("OMDB_API_KEY", "trilogy")  # free fallback; register at omdbapi.com for higher limits
# Comma-separated IPs for devices on other subnets that mDNS can't reach
EXTRA_HOSTS   = [h.strip() for h in os.getenv("EXTRA_HOSTS", "").split(",") if h.strip()]


def _is_appletv(conf) -> bool:
    """Return True only for Apple TV devices (filter out HomePods, AirPorts, etc.)."""
    if conf.device_info is None:
        return False
    model = str(conf.device_info.model).lower()
    # pyatv model strings for ATVs: Gen4, Gen4K, Gen4KGen2, Gen4KGen3Wifi, etc.
    return "gen4" in model or "appletv" in model


async def _probe_extra_host(ip: str) -> Optional[ATVConf]:
    """Probe an Apple TV by IP (for cross-subnet devices mDNS can't reach).

    Fetches /info on the AirPlay port to get the device UUID and name, then
    builds a manual pyatv config with AirPlay + Companion services.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as hc:
            r = await hc.get(f"http://{ip}:7000/info")
        info = plistlib.loads(r.content)
        identifier = info.get("pi") or info.get("deviceID") or ip
        name = info.get("name") or f"Apple TV ({ip})"

        # Build credential dicts from stored creds if available
        stored = get_for_device(identifier)
        def _creds(proto_name: str) -> Optional[str]:
            return stored.get(proto_name)

        conf = ATVConf(ipaddress.IPv4Address(ip), name=name)
        conf.add_service(ManualService(identifier, _Protocol.AirPlay,   7000,  {}, credentials=_creds("AirPlay")))
        conf.add_service(ManualService(identifier, _Protocol.Companion, 49152, {}, credentials=_creds("Companion")))
        logger.info("Probed extra host %s → %s (%s)", ip, name, identifier)
        return conf
    except Exception as exc:
        logger.warning("Could not probe extra host %s: %s", ip, exc)
        return None

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

clients: dict[str, DeviceClient] = {}          # identifier -> DeviceClient
latest_statuses: dict[str, dict] = {}          # identifier -> last status snapshot
websocket_connections: list[WebSocket] = []
active_pairings: dict[str, object] = {}        # pairing_id -> PairingHandler

# Protocol priority for pairing (best for metadata first)
_PAIRING_PRIORITY = [_Protocol.Companion, _Protocol.MRP, _Protocol.AirPlay]
_PROTO_NAME = {p: str(p).split(".")[-1] for p in _PAIRING_PRIORITY}


class PairFinishRequest(BaseModel):
    pairing_id: str
    pin: Optional[str] = None


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _connect_conf(conf) -> None:
    """Connect a device config if not already connected."""
    ident = conf.identifier
    if ident not in clients:
        logger.info("New device: %s (%s)", conf.name, ident)
        client = DeviceClient(conf)
        clients[ident] = client
        await client.connect()


async def discovery_loop():
    """Periodically scan for new (or removed) Apple TV devices."""
    loop = asyncio.get_event_loop()
    while True:
        try:
            found = [c for c in await pyatv.scan(loop, timeout=5) if _is_appletv(c)]

            # Add extra hosts (cross-subnet devices mDNS can't reach)
            for ip in EXTRA_HOSTS:
                conf = await _probe_extra_host(ip)
                if conf:
                    found.append(conf)

            found_ids = {c.identifier for c in found}

            for conf in found:
                await _connect_conf(conf)

            # Mark devices that disappeared as disconnected (skip pinned extra hosts)
            extra_ids = set()
            for ip in EXTRA_HOSTS:
                # Keep extra hosts in clients even when mDNS scan doesn't see them
                for ident, c in clients.items():
                    if hasattr(c, 'conf') and str(c.conf.address) == ip:
                        extra_ids.add(ident)

            for ident in list(clients.keys()):
                if ident not in found_ids and ident not in extra_ids:
                    logger.info("Device gone: %s", ident)
                    await clients[ident].disconnect()
                    del clients[ident]
                    latest_statuses.pop(ident, None)

        except Exception as exc:
            logger.error("Discovery loop error: %s", exc)

        await asyncio.sleep(SCAN_INTERVAL)


async def polling_loop():
    """Poll every connected device for its current status and broadcast to WS clients."""
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        if not clients:
            continue

        statuses = []
        for client in list(clients.values()):
            status = await client.get_status()
            latest_statuses[client.identifier] = status
            statuses.append(status)

        if websocket_connections:
            payload = json.dumps({"type": "status_update", "devices": statuses})
            dead = []
            for ws in websocket_connections:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                websocket_connections.remove(ws)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Perform an immediate scan on startup
    loop = asyncio.get_event_loop()
    found = [c for c in await pyatv.scan(loop, timeout=5) if _is_appletv(c)]

    # Add extra hosts (cross-subnet devices mDNS can't reach)
    for ip in EXTRA_HOSTS:
        conf = await _probe_extra_host(ip)
        if conf:
            found.append(conf)

    for conf in found:
        await _connect_conf(conf)

    # Launch background tasks
    asyncio.create_task(discovery_loop())
    asyncio.create_task(polling_loop())

    yield

    # Cleanup
    for client in clients.values():
        await client.disconnect()


app = FastAPI(title="Apple TV Monitor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/api/devices")
async def list_devices():
    """Return all currently known devices with their latest status."""
    return {"devices": list(latest_statuses.values())}


@app.get("/api/devices/{identifier}")
async def get_device(identifier: str):
    """Return the latest status for a single device."""
    client = clients.get(identifier)
    if not client:
        return {"error": "Device not found"}, 404
    status = await client.get_status()
    latest_statuses[identifier] = status
    return status


@app.post("/api/devices/{identifier}/control/{action}")
async def control_device(identifier: str, action: str, pos: Optional[float] = None):
    """Send a remote-control command to a device."""
    client = clients.get(identifier)
    if not client or not client._atv:
        return {"error": "Device not connected"}
    rc = client._atv.remote_control
    try:
        if action == "play":
            await rc.play()
        elif action == "pause":
            await rc.pause()
        elif action == "play_pause":
            await rc.play_pause()
        elif action == "skip_forward":
            await rc.skip_forward()
        elif action == "skip_backward":
            await rc.skip_backward()
        elif action == "next":
            await rc.next()
        elif action == "previous":
            await rc.previous()
        elif action == "set_position":
            if pos is None:
                return {"error": "pos query parameter required"}
            await rc.set_position(int(pos))
        elif action == "up":
            await rc.up()
        elif action == "down":
            await rc.down()
        elif action == "left":
            await rc.left()
        elif action == "right":
            await rc.right()
        elif action == "select":
            await rc.select()
        elif action == "menu":
            await rc.menu()
        elif action == "home":
            await rc.home()
        elif action == "volume_up":
            await rc.volume_up()
        elif action == "volume_down":
            await rc.volume_down()
        elif action == "turn_on":
            await client._atv.power.turn_on()
        elif action == "turn_off":
            await client._atv.power.turn_off()
        else:
            return {"error": f"Unknown action: {action}"}
        return {"success": True}
    except Exception as exc:
        logger.debug("Control %s failed for %s: %s", action, identifier, exc)
        return {"error": str(exc)}


@app.get("/api/devices/{identifier}/artwork")
async def get_artwork(identifier: str):
    """Return current artwork for a device (JPEG/PNG bytes)."""
    client = clients.get(identifier)
    if not client or not client._atv:
        return Response(status_code=404)
    try:
        artwork = await client._atv.metadata.artwork(width=600, height=600)
        if artwork is None:
            return Response(status_code=404)
        return Response(content=artwork.bytes, media_type=artwork.mimetype)
    except Exception as exc:
        logger.debug("Artwork fetch failed for %s: %s", identifier, exc)
        return Response(status_code=404)


@app.post("/api/scan")
async def trigger_scan():
    """Manually trigger a device scan."""
    loop = asyncio.get_event_loop()
    found = [c for c in await pyatv.scan(loop, timeout=5) if _is_appletv(c)]
    new_devices = []
    for conf in found:
        ident = conf.identifier
        if ident not in clients:
            client = DeviceClient(conf)
            clients[ident] = client
            await client.connect()
            new_devices.append(conf.name)
    return {"scanned": len(found), "new_devices": new_devices}


# ---------------------------------------------------------------------------
# Scores / metadata endpoints
# ---------------------------------------------------------------------------

def _clean_title(title: str) -> str:
    """Strip trailing year annotations like '(1996)' or '[2024]' from titles."""
    import re as _re
    return _re.sub(r'\s*[\(\[]\d{4}[\)\]]\s*$', '', title).strip()


async def _tmdb_best(client, title: str, hint: str) -> tuple:
    """Search TMDB for both movie and TV; return (kind, tmdb_id, imdb_id) for the best match.

    ``hint`` is 'movie' or 'show' from the caller — used only as a tiebreaker when
    popularity scores are within 20% of each other.
    """
    movie_r, tv_r = await asyncio.gather(
        client.get(f"https://api.themoviedb.org/3/search/movie",
                   params={"api_key": TMDB_API_KEY, "query": title}),
        client.get(f"https://api.themoviedb.org/3/search/tv",
                   params={"api_key": TMDB_API_KEY, "query": title}),
    )
    movies = movie_r.json().get("results", [])
    shows  = tv_r.json().get("results", [])
    bm = movies[0] if movies else None
    bs = shows[0]  if shows  else None

    if bm and not bs:
        kind, item = "movie", bm
    elif bs and not bm:
        kind, item = "tv", bs
    else:
        mp = bm.get("popularity", 0) if bm else 0
        sp = bs.get("popularity", 0) if bs else 0
        # Prefer the significantly more popular result; fall back to hint
        if sp > mp * 1.2:
            kind, item = "tv", bs
        elif mp > sp * 1.2:
            kind, item = "movie", bm
        else:
            kind, item = ("tv", bs) if hint == "show" else ("movie", bm)

    tmdb_id = item.get("id") if item else None
    imdb_id = None
    if tmdb_id:
        ext = await client.get(
            f"https://api.themoviedb.org/3/{kind}/{tmdb_id}/external_ids",
            params={"api_key": TMDB_API_KEY},
        )
        imdb_id = ext.json().get("imdb_id")
    return kind, tmdb_id, imdb_id


def _rt_score_from_page(html: str) -> Optional[int]:
    """Extract tomatometer from an RT movie/show page via JSON-LD ratingValue."""
    import re as _re
    m = _re.search(r'"ratingValue"\s*:\s*"(\d+)"', html)
    if m:
        return int(m.group(1))
    return None


def _rt_direct_url(html: str, title: str, media_type: str) -> Optional[str]:
    """Parse RT search page HTML to find the direct URL for the best-matching result."""
    import re as _re
    prefix = "/tv/" if media_type == "show" else "/m/"
    # Extract (url, link_text) from data-qa="info-name" anchors
    pattern = _re.compile(
        r'href="(https://www\.rottentomatoes\.com' + _re.escape(prefix) + r'[^"]+)"[^>]*data-qa="info-name"[^>]*>\s*(.*?)\s*</a>',
        _re.DOTALL,
    )
    candidates = [(m.group(1), _re.sub(r'<[^>]+>', '', m.group(2)).strip()) for m in pattern.finditer(html)]
    if not candidates:
        return None
    # Exact match first, then closest
    title_lower = title.lower()
    for url, name in candidates:
        if name.lower() == title_lower:
            return url
    # Fallback: first result
    return candidates[0][0]


@app.get("/api/scores")
async def get_rt_scores(title: str, media_type: str = "movie"):
    """Return RT critic score via TMDB → OMDB, with a direct RT page URL scraped from RT search."""
    import httpx
    title = _clean_title(title)
    rt_search_url = f"https://www.rottentomatoes.com/search?search={url_quote(title)}"

    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            # Step 1: Use _tmdb_best to find correct kind + imdb_id
            imdb_id = None
            kind = "movie"
            if TMDB_API_KEY:
                kind, _tmdb_id, imdb_id = await _tmdb_best(client, title, media_type)

            if not imdb_id:
                return {"tomatometer": None, "audience_score": None, "url": rt_search_url}

            # Step 1b + 2: OMDB and RT search in parallel
            omdb_resp, rt_resp = await asyncio.gather(
                client.get("https://www.omdbapi.com/", params={"i": imdb_id, "apikey": OMDB_API_KEY}),
                client.get("https://www.rottentomatoes.com/search", params={"search": title},
                           headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}),
            )

            # Parse OMDB
            omdb = omdb_resp.json()
            if omdb.get("Response") != "True":
                raise ValueError(omdb.get("Error", "OMDB error"))
            ratings = {r["Source"]: r["Value"] for r in omdb.get("Ratings", [])}
            rt_raw   = ratings.get("Rotten Tomatoes")
            tomatometer  = int(rt_raw.rstrip("%")) if rt_raw else None
            imdb_raw = ratings.get("Internet Movie Database")
            imdb_rating  = imdb_raw.split("/")[0] if imdb_raw else None

            # Parse RT search page for direct URL (use resolved kind, not the hint)
            rt_kind = "show" if kind == "tv" else "movie"
            rt_url = _rt_direct_url(rt_resp.text, title, rt_kind) or rt_search_url

            # OMDB often omits RT scores for TV shows — scrape the RT page directly
            if tomatometer is None and rt_url != rt_search_url:
                try:
                    rt_page = await client.get(rt_url, headers={
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    })
                    tomatometer = _rt_score_from_page(rt_page.text)
                except Exception as rt_exc:
                    logger.debug("RT page scrape failed for %r: %s", rt_url, rt_exc)

            return {
                "tomatometer": tomatometer,
                "audience_score": None,
                "url": rt_url,
                "imdb_id": imdb_id,
                "imdb_rating": imdb_rating,
            }

    except Exception as exc:
        logger.debug("Scores lookup failed for %r: %s", title, exc)
    return {"tomatometer": None, "audience_score": None, "url": rt_search_url}


@app.get("/api/tmdb")
async def get_tmdb(title: str, media_type: str = "movie"):
    """Look up TMDB for high-res poster art. Requires TMDB_API_KEY env var."""
    if not TMDB_API_KEY:
        return {"available": False}
    import httpx
    title = _clean_title(title)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            kind, tmdb_id, _imdb_id = await _tmdb_best(client, title, media_type)
            if not tmdb_id:
                return {"available": False}
            # Fetch full details for poster path
            detail = await client.get(
                f"https://api.themoviedb.org/3/{kind}/{tmdb_id}",
                params={"api_key": TMDB_API_KEY},
            )
            item = detail.json()
            poster = item.get("poster_path")
            return {
                "available": True,
                "poster_url": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
                "fullsize_url": f"https://image.tmdb.org/t/p/original{poster}" if poster else None,
                "tmdb_url": f"https://www.themoviedb.org/{kind}/{tmdb_id}" if tmdb_id else None,
            }
    except Exception as exc:
        logger.debug("TMDB lookup failed for %r: %s", title, exc)
    return {"available": False}


# ---------------------------------------------------------------------------
# Credential management
# ---------------------------------------------------------------------------

@app.delete("/api/devices/{identifier}/credentials")
async def delete_credentials(identifier: str):
    """Forget all stored credentials for a device and reconnect unpaired."""
    forget_credentials(identifier)
    client = clients.get(identifier)
    if client:
        await client.disconnect()
        await client.connect()  # reconnects without credentials
    return {"success": True}


# ---------------------------------------------------------------------------
# Pairing endpoints
# ---------------------------------------------------------------------------

@app.post("/api/devices/{identifier}/pair/start")
async def start_pairing(identifier: str):
    """Initiate pyatv pairing for the next unpaired protocol on a device."""
    client = clients.get(identifier)
    if not client:
        return {"error": "Device not found"}

    already_stored = get_for_device(identifier)
    available = {svc.protocol for svc in client.conf.services}
    # Skip protocols we already have credentials for
    candidates = [p for p in _PAIRING_PRIORITY if p in available and _PROTO_NAME[p] not in already_stored]
    if not candidates:
        return {"error": "All supported protocols are already paired"}

    loop = asyncio.get_event_loop()
    pairing = None
    last_error = ""
    chosen_protocol = None
    for protocol in candidates:
        try:
            p = await pyatv.pair(client.conf, protocol, loop)
            await p.begin()
            pairing = p
            chosen_protocol = protocol
            break
        except Exception as exc:
            logger.warning("Pairing via %s failed: %s", _PROTO_NAME.get(protocol, protocol), exc)
            last_error = str(exc)

    if pairing is None:
        return {"error": last_error or "All pairing protocols failed"}

    pairing_id = str(uuid.uuid4())
    active_pairings[pairing_id] = pairing
    proto_name = _PROTO_NAME[chosen_protocol]

    result: dict = {
        "pairing_id": pairing_id,
        "protocol": proto_name,
        "device_provides_pin": pairing.device_provides_pin,
    }

    if not pairing.device_provides_pin:
        # App generates the PIN; user must enter it on the Apple TV
        pin = random.randint(1000, 9999)
        pairing.pin(pin)
        result["pin"] = str(pin)

    return result


@app.post("/api/devices/{identifier}/pair/finish")
async def finish_pairing(identifier: str, body: PairFinishRequest):
    """Complete pairing. Supply the PIN shown on the TV when device_provides_pin=true."""
    pairing = active_pairings.pop(body.pairing_id, None)
    if not pairing:
        return {"error": "Pairing session not found or expired"}

    try:
        if pairing.device_provides_pin and body.pin:
            pairing.pin(int(body.pin))
        await pairing.finish()
    except Exception as exc:
        await pairing.close()
        return {"error": str(exc)}

    if not pairing.has_paired:
        await pairing.close()
        return {"error": "Pairing failed — wrong PIN or device rejected"}

    proto_name = str(pairing.service.protocol).split(".")[-1]
    save_credential(identifier, proto_name, pairing.service.credentials)
    await pairing.close()
    logger.info("Paired %s via %s", identifier, proto_name)

    # Reconnect with the new credentials
    client = clients.get(identifier)
    if client:
        await client.disconnect()
        await client.connect()

    # Report which protocols still don't have credentials
    stored_now = get_for_device(identifier)
    available = {svc.protocol for svc in client.conf.services} if client else set()
    remaining = [_PROTO_NAME[p] for p in _PAIRING_PRIORITY if p in available and _PROTO_NAME[p] not in stored_now]

    return {"success": True, "protocol": proto_name, "remaining_protocols": remaining}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websocket_connections.append(websocket)
    logger.info("WebSocket client connected (total: %d)", len(websocket_connections))

    # Send current state immediately on connect
    await websocket.send_text(
        json.dumps({"type": "status_update", "devices": list(latest_statuses.values())})
    )

    try:
        while True:
            # Keep the connection alive; client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket_connections.remove(websocket)
        logger.info("WebSocket client disconnected (total: %d)", len(websocket_connections))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
