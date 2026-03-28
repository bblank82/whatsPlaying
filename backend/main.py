"""FastAPI server — REST endpoints + WebSocket broadcast for Apple TV monitor."""

import asyncio
import ipaddress
import json
import logging
import os
import plistlib
import random
import re
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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pyatv.conf import AppleTV as ATVConf, ManualService
from pyatv.const import Protocol as _Protocol

from atv_client import DeviceClient
from credentials import get_for_device, save as save_credential, forget as forget_credentials
from kscape_client import KaleidescapeClient

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "30"))   # re-scan every N seconds
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))    # poll now-playing every N seconds
TMDB_API_KEY  = os.getenv("TMDB_API_KEY", "")
OMDB_API_KEY  = os.getenv("OMDB_API_KEY", "trilogy")  # free fallback; register at omdbapi.com for higher limits
# Comma-separated IPs for devices on other subnets that mDNS can't reach
EXTRA_HOSTS        = [h.strip() for h in os.getenv("EXTRA_HOSTS", "").split(",") if h.strip()]
# Comma-separated IPs for Kaleidescape players
KALEIDESCAPE_HOSTS = [h.strip() for h in os.getenv("KALEIDESCAPE_HOSTS", "").split(",") if h.strip()]

KIOSK_CONFIGS_PATH = os.path.join(os.path.dirname(__file__), "kiosk_configs.json")


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
# Known-device persistence
# ---------------------------------------------------------------------------

_KNOWN_DEVICES_FILE = os.path.join(os.path.dirname(__file__), "known_devices.json")


def _load_known_devices() -> dict:
    try:
        with open(_KNOWN_DEVICES_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_known_devices(known: dict) -> None:
    try:
        with open(_KNOWN_DEVICES_FILE, "w") as f:
            json.dump(known, f, indent=2)
    except Exception as exc:
        logger.warning("Could not save known_devices.json: %s", exc)


def _register_known_device(status: dict) -> None:
    """Persist basic device info so it survives restarts."""
    ident = status.get("identifier")
    if not ident:
        return
    known = _load_known_devices()
    existing = known.get(ident, {})
    known[ident] = {
        "identifier": ident,
        "name": status.get("name", ""),
        "address": status.get("address", ""),
        "model": status.get("model", ""),
        "device_type": status.get("device_type", "appletv"),
        "room": existing.get("room"),  # preserve room assignment
    }
    _save_known_devices(known)


def _forget_known_device(identifier: str) -> None:
    known = _load_known_devices()
    known.pop(identifier, None)
    _save_known_devices(known)


def _offline_status(info: dict) -> dict:
    """Build a disconnected status snapshot from stored device info."""
    identifier = info["identifier"]
    return {
        "identifier": identifier,
        "name": info["name"],
        "address": info.get("address", ""),
        "hostname": "",
        "model": info.get("model", ""),
        "device_type": info.get("device_type", "appletv"),
        "room": info.get("room"),
        "connected": False,
        "paired": bool(get_for_device(identifier)),
        "power": None,
        "now_playing": None,
    }


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

clients: dict[str, DeviceClient] = {}          # identifier -> DeviceClient
latest_statuses: dict[str, dict] = {}          # identifier -> last status snapshot
active_pairings: dict[str, object] = {}        # pairing_id -> PairingHandler
device_rooms: dict[str, Optional[str]] = {}    # identifier -> room name (in-memory cache)

# WebSocket client registry
# ws_clients: client_id -> {ws, ip, hostname}
ws_clients: dict[str, dict] = {}
# kiosk config per client_id — persists across reconnects for same IP
# shape: {kiosk: bool, orientation: "landscape"|"portrait", device_id: str|None, room_id: str|None}
kiosk_configs: dict[str, dict] = {}
# ip -> client_id — allows restoring config when same host reconnects
_ip_to_client_id: dict[str, str] = {}
# ip -> kiosk config — persisted to disk so configs survive server restarts
_ip_kiosk_configs: dict[str, dict] = {}


def _load_ip_kiosk_configs():
    global _ip_kiosk_configs
    try:
        with open(KIOSK_CONFIGS_PATH) as f:
            _ip_kiosk_configs = json.load(f)
        logger.info("Loaded kiosk configs for %d IP(s)", len(_ip_kiosk_configs))
    except FileNotFoundError:
        _ip_kiosk_configs = {}
    except Exception as exc:
        logger.warning("Could not load kiosk configs: %s", exc)
        _ip_kiosk_configs = {}


def _save_ip_kiosk_configs():
    try:
        with open(KIOSK_CONFIGS_PATH, "w") as f:
            json.dump(_ip_kiosk_configs, f, indent=2)
    except Exception as exc:
        logger.warning("Could not save kiosk configs: %s", exc)

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
        # Persist so the device survives restarts even when offline
        _register_known_device(await client.get_status())


async def discovery_loop():
    """Periodically scan for new (or removed) Apple TV devices."""
    loop = asyncio.get_running_loop()
    while True:
        try:
            found = [c for c in await pyatv.scan(loop, timeout=10) if _is_appletv(c)]

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
                if isinstance(clients[ident], KaleidescapeClient):
                    continue  # managed separately — never removed by ATV discovery
                if ident not in found_ids and ident not in extra_ids:
                    # Disconnect but keep in clients — mDNS is flaky and a device
                    # that misses one scan window should not be permanently removed.
                    if clients[ident]._connected:
                        logger.info("Device not found in scan, disconnecting: %s", ident)
                        await clients[ident].disconnect()

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
            status["room"] = device_rooms.get(client.identifier)
            status["paired"] = bool(get_for_device(client.identifier)) if not isinstance(client, KaleidescapeClient) else True
            latest_statuses[client.identifier] = status
            statuses.append(status)

        if ws_clients:
            payload = json.dumps({"type": "status_update", "devices": statuses})
            dead = []
            for cid, entry in list(ws_clients.items()):
                try:
                    await entry["ws"].send_text(payload)
                except Exception:
                    dead.append(cid)
            for cid in dead:
                ws_clients.pop(cid, None)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_ip_kiosk_configs()

    # Pre-populate device list from persisted known devices (shows as offline until found)
    for info in _load_known_devices().values():
        latest_statuses[info["identifier"]] = _offline_status(info)
        device_rooms[info["identifier"]] = info.get("room")

    # Perform an immediate scan on startup
    loop = asyncio.get_running_loop()
    found = [c for c in await pyatv.scan(loop, timeout=5) if _is_appletv(c)]

    # Add extra hosts (cross-subnet devices mDNS can't reach)
    for ip in EXTRA_HOSTS:
        conf = await _probe_extra_host(ip)
        if conf:
            found.append(conf)

    for conf in found:
        await _connect_conf(conf)

    # Connect Kaleidescape players
    for ip in KALEIDESCAPE_HOSTS:
        kc = KaleidescapeClient(ip)
        clients[kc.identifier] = kc
        await kc.connect()

    # Launch background tasks
    asyncio.create_task(discovery_loop())
    asyncio.create_task(polling_loop())

    yield

    # Cleanup
    for client in clients.values():
        await client.disconnect()


app = FastAPI(title="What's Playing", lifespan=lifespan)

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
    if not client:
        return {"error": "Device not found"}

    # Kaleidescape transport control
    if isinstance(client, KaleidescapeClient):
        try:
            await client.send_command(action, pos=int(pos) if pos is not None else None)
            return {"success": True}
        except Exception as exc:
            return {"error": str(exc)}

    if not client._atv:
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


# iTunes bundle ID → app icon URL (fetched once, cached in memory)
_app_icon_cache: dict[str, Optional[str]] = {}

# Known overrides for bundle IDs that don't resolve on the iOS App Store
_APP_ICON_OVERRIDES: dict[str, str] = {
    'com.plexapp.plex': 'com.plexapp.plex',  # uses iOS bundle ID
}
# Bundle IDs that have no iOS equivalent — skip the lookup
_APP_ICON_NO_LOOKUP: set[str] = {'com.apple.TVWatchList', 'com.apple.TVMusic', 'com.apple.TVHomeSharing'}


async def _fetch_app_icon(bundle_id: str) -> Optional[str]:
    """Return an iTunes 512px icon URL for a given bundle ID, with in-memory cache."""
    if bundle_id in _app_icon_cache:
        return _app_icon_cache[bundle_id]
    if bundle_id in _APP_ICON_NO_LOOKUP:
        _app_icon_cache[bundle_id] = None
        return None
    lookup_id = _APP_ICON_OVERRIDES.get(bundle_id, bundle_id)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                "https://itunes.apple.com/lookup",
                params={"bundleId": lookup_id, "country": "us", "entity": "software"},
            )
        results = r.json().get("results", [])
        url = results[0].get("artworkUrl512") if results else None
        _app_icon_cache[bundle_id] = url
        return url
    except Exception as exc:
        logger.debug("iTunes icon lookup failed for %s: %s", bundle_id, exc)
        _app_icon_cache[bundle_id] = None
        return None


@app.get("/api/app_icon")
async def get_app_icon(bundle_id: str):
    """Return the iTunes App Store icon URL for a bundle ID."""
    url = await _fetch_app_icon(bundle_id)
    if not url:
        return Response(status_code=404)
    return {"url": url}


@app.get("/api/devices/{identifier}/artwork")
async def get_artwork(identifier: str):
    """Return current artwork for a device (JPEG/PNG bytes)."""
    client = clients.get(identifier)
    if not client:
        return Response(status_code=404)

    # Kaleidescape: proxy cover image from player HTTP server
    if isinstance(client, KaleidescapeClient):
        url = client._cover_url
        if not url:
            return Response(status_code=404)
        try:
            async with httpx.AsyncClient(timeout=5) as hc:
                r = await hc.get(url)
            if r.status_code != 200:
                return Response(status_code=404)
            ct = r.headers.get("content-type", "image/jpeg")
            return Response(content=r.content, media_type=ct)
        except Exception as exc:
            logger.debug("Kaleidescape artwork fetch failed: %s", exc)
            return Response(status_code=404)

    # Apple TV
    if not client._atv:
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
    loop = asyncio.get_running_loop()
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
    return re.sub(r'\s*[\(\[]\d{4}[\)\]]\s*$', '', title).strip()


async def _tmdb_best(client, title: str, hint: str, force_hint: bool = False) -> tuple:
    """Search TMDB for both movie and TV; return (kind, tmdb_id, imdb_id) for the best match.

    ``hint`` is 'movie' or 'show' from the caller.  When ``force_hint`` is True the hint
    is treated as authoritative and only the matching type is searched, skipping the
    popularity comparison.  Use this when the media type is known with high confidence
    (e.g. Plex reporting MediaType.Video with no series metadata).
    """
    if force_hint:
        search_type = "movie" if hint == "movie" else "tv"
        r = await client.get(
            f"https://api.themoviedb.org/3/search/{search_type}",
            params={"api_key": TMDB_API_KEY, "query": title},
        )
        results = r.json().get("results", [])
        item = results[0] if results else None
        kind = search_type
    else:
        movie_r, tv_r = await asyncio.gather(
            client.get("https://api.themoviedb.org/3/search/movie",
                       params={"api_key": TMDB_API_KEY, "query": title}),
            client.get("https://api.themoviedb.org/3/search/tv",
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
    # Extract release year for disambiguation (movies: release_date, TV: first_air_date)
    date_str = (item or {}).get("release_date") or (item or {}).get("first_air_date") or ""
    year = int(date_str[:4]) if date_str and date_str[:4].isdigit() else None
    imdb_id = None
    if tmdb_id:
        ext = await client.get(
            f"https://api.themoviedb.org/3/{kind}/{tmdb_id}/external_ids",
            params={"api_key": TMDB_API_KEY},
        )
        imdb_id = ext.json().get("imdb_id")
    return kind, tmdb_id, imdb_id, year


def _rt_score_from_page(html: str) -> Optional[int]:
    """Extract tomatometer from an RT movie/show page via JSON-LD ratingValue."""
    m = re.search(r'"ratingValue"\s*:\s*"(\d+)"', html)
    if m:
        return int(m.group(1))
    return None


def _rt_direct_url(html: str, title: str, media_type: str) -> Optional[str]:
    """Parse RT search page HTML to find the direct URL for the best-matching result.

    Returns None if no candidate has a title that is a close match — callers should
    fall back to the RT search URL rather than linking to the wrong page.
    """
    prefix = "/tv/" if media_type == "show" else "/m/"
    # Extract (url, link_text) from data-qa="info-name" anchors
    pattern = re.compile(
        r'href="(https://www\.rottentomatoes\.com' + re.escape(prefix) + r'[^"]+)"[^>]*data-qa="info-name"[^>]*>\s*(.*?)\s*</a>',
        re.DOTALL,
    )
    candidates = [(m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()) for m in pattern.finditer(html)]
    if not candidates:
        return None
    title_lower = title.lower()
    # Exact match
    for url, name in candidates:
        if name.lower() == title_lower:
            return url
    # Partial match: candidate name starts with the title (handles "21 (2008)", "The Bear (2022)")
    for url, name in candidates:
        name_lower = name.lower()
        if name_lower.startswith(title_lower) and (
            len(name_lower) == len(title_lower) or not name_lower[len(title_lower)].isalnum()
        ):
            return url
    # No close match — return None so caller uses RT search URL instead
    return None


@app.get("/api/scores")
async def get_rt_scores(title: str, media_type: str = "movie", force_media_type: bool = False):
    """Return RT critic score via TMDB → OMDB, with a direct RT page URL scraped from RT search."""
    title = _clean_title(title)
    rt_search_url = f"https://www.rottentomatoes.com/search?search={url_quote(title)}"

    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            # Step 1: Use _tmdb_best to find correct kind + imdb_id
            imdb_id = None
            kind = "movie"
            year = None
            if TMDB_API_KEY:
                kind, _tmdb_id, imdb_id, year = await _tmdb_best(client, title, media_type, force_hint=force_media_type)

            if not imdb_id:
                return {"tomatometer": None, "audience_score": None, "url": rt_search_url}

            # Use "title year" for RT search when year is known — prevents short/ambiguous
            # titles (e.g. "21") from matching unrelated results on RT.
            rt_search_query = f"{title} {year}" if year else title

            # Step 1b + 2: OMDB and RT search in parallel
            omdb_resp, rt_resp = await asyncio.gather(
                client.get("https://www.omdbapi.com/", params={"i": imdb_id, "apikey": OMDB_API_KEY}),
                client.get("https://www.rottentomatoes.com/search", params={"search": rt_search_query},
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

            # Parse RT search page for direct URL — try with year query first, fall back
            # to title-only match to handle cases where RT omits the year from the slug.
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


async def _find_season_by_episode(client, tmdb_id: int, episode_title: str) -> Optional[int]:
    """Search a TV show's seasons on TMDB to find which season contains the given episode title.

    Fetches all season episode lists in parallel. Returns the season number on match, or None.
    """
    show = await client.get(
        f"https://api.themoviedb.org/3/tv/{tmdb_id}",
        params={"api_key": TMDB_API_KEY},
    )
    seasons = [s for s in show.json().get("seasons", []) if s.get("season_number", 0) > 0]
    if not seasons:
        return None

    season_numbers = [s["season_number"] for s in seasons]
    responses = await asyncio.gather(*[
        client.get(
            f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{n}",
            params={"api_key": TMDB_API_KEY},
        )
        for n in season_numbers
    ], return_exceptions=True)

    ep_lower = episode_title.lower().strip()
    for season_num, resp in zip(season_numbers, responses):
        if isinstance(resp, Exception) or resp.status_code != 200:
            continue
        for ep in resp.json().get("episodes", []):
            if (ep.get("name") or "").lower().strip() == ep_lower:
                return season_num
    return None


@app.get("/api/tmdb")
async def get_tmdb(title: str, media_type: str = "movie", force_media_type: bool = False,
                   season_number: Optional[int] = None, episode_title: Optional[str] = None):
    """Look up TMDB for high-res poster art. Requires TMDB_API_KEY env var.

    For TV shows, uses ``season_number`` when provided. When it's absent but
    ``episode_title`` is given, searches season episode lists to infer the season,
    then returns season-specific artwork. Falls back to show-level poster.
    """
    if not TMDB_API_KEY:
        return {"available": False}
    title = _clean_title(title)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            kind, tmdb_id, _imdb_id, _year = await _tmdb_best(client, title, media_type, force_hint=force_media_type)
            if not tmdb_id:
                return {"available": False}

            poster = None

            if kind == "tv":
                resolved_season = season_number

                # No season from metadata — try to infer from episode title
                if resolved_season is None and episode_title:
                    try:
                        resolved_season = await _find_season_by_episode(client, tmdb_id, episode_title)
                        if resolved_season is not None:
                            logger.debug("TMDB inferred season %s for %r ep %r", resolved_season, title, episode_title)
                    except Exception as exc:
                        logger.debug("TMDB episode season inference failed for %r: %s", title, exc)

                if resolved_season is not None:
                    try:
                        season_detail = await client.get(
                            f"https://api.themoviedb.org/3/tv/{tmdb_id}/season/{resolved_season}",
                            params={"api_key": TMDB_API_KEY},
                        )
                        if season_detail.status_code == 200:
                            poster = season_detail.json().get("poster_path")
                    except Exception as exc:
                        logger.debug("TMDB season poster fetch failed for %r S%s: %s", title, resolved_season, exc)

            # Fall back to show/movie level poster
            if not poster:
                detail = await client.get(
                    f"https://api.themoviedb.org/3/{kind}/{tmdb_id}",
                    params={"api_key": TMDB_API_KEY},
                )
                poster = detail.json().get("poster_path")

            return {
                "available": True,
                "poster_url": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
                "fullsize_url": f"https://image.tmdb.org/t/p/original{poster}" if poster else None,
                "tmdb_url": f"https://www.themoviedb.org/{kind}/{tmdb_id}" if tmdb_id else None,
            }
    except Exception as exc:
        logger.debug("TMDB lookup failed for %r: %s", title, exc)
    return {"available": False}


_YT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

@app.get("/api/youtube_thumbnail")
async def get_youtube_thumbnail(title: str, channel: Optional[str] = None):
    """Scrape YouTube search to find a thumbnail for a video by title + channel."""
    query = f"{title} {channel}".strip() if channel else title
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            r = await client.get(
                "https://www.youtube.com/results",
                params={"search_query": query},
                headers=_YT_HEADERS,
            )
        # YouTube embeds {"videoId":"..."} in the page JSON — first unique ID is the top result
        ids = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', r.text)
        video_id = next((id for id in ids if id), None) if ids else None
        if not video_id:
            return {"available": False}
        return {
            "available": True,
            "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            "video_id": video_id,
        }
    except Exception as exc:
        logger.debug("YouTube thumbnail lookup failed for %r: %s", query, exc)
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


@app.delete("/api/devices/{identifier}")
async def forget_device(identifier: str):
    """Remove a device entirely — credentials, known list, and active client."""
    forget_credentials(identifier)
    _forget_known_device(identifier)
    client = clients.pop(identifier, None)
    if client:
        await client.disconnect()
    latest_statuses.pop(identifier, None)
    device_rooms.pop(identifier, None)
    return {"success": True}


class RoomBody(BaseModel):
    room: Optional[str] = None


@app.put("/api/devices/{identifier}/room")
async def set_device_room(identifier: str, body: RoomBody):
    """Assign or clear the room for a device."""
    device_rooms[identifier] = body.room
    known = _load_known_devices()
    if identifier in known:
        known[identifier]["room"] = body.room
        _save_known_devices(known)
    if identifier in latest_statuses:
        latest_statuses[identifier]["room"] = body.room
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

    loop = asyncio.get_running_loop()
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
# Admin: connected hosts + kiosk management
# ---------------------------------------------------------------------------

def _default_kiosk_config() -> dict:
    return {"kiosk": False, "orientation": "landscape", "device_id": None, "room_id": None}


@app.get("/api/admin/hosts")
async def admin_list_hosts():
    """Return all currently connected WebSocket clients with their kiosk config."""
    return [
        {
            "client_id": cid,
            "ip": entry["ip"],
            "hostname": entry.get("hostname", entry["ip"]),
            "kiosk_config": kiosk_configs.get(cid, _default_kiosk_config()),
        }
        for cid, entry in ws_clients.items()
    ]


class KioskConfigBody(BaseModel):
    kiosk: bool
    orientation: str = "landscape"
    device_id: Optional[str] = None
    room_id: Optional[str] = None


@app.post("/api/admin/hosts/{client_id}/kiosk")
async def admin_set_kiosk(client_id: str, body: KioskConfigBody):
    """Update kiosk config for a connected host and push the change via WebSocket."""
    config = {"kiosk": body.kiosk, "orientation": body.orientation, "device_id": body.device_id, "room_id": body.room_id}
    kiosk_configs[client_id] = config

    entry = ws_clients.get(client_id)
    if entry:
        # Persist by IP so config survives server restarts
        _ip_kiosk_configs[entry["ip"]] = config
        _save_ip_kiosk_configs()
        try:
            await entry["ws"].send_text(json.dumps({"type": "kiosk_config", **config}))
        except Exception:
            pass

    return {"ok": True}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Identify the client — honour X-Forwarded-For set by Vite's proxy
    forwarded_for = websocket.headers.get("x-forwarded-for")
    client_ip = (forwarded_for.split(",")[0].strip() if forwarded_for
                 else (websocket.client.host if websocket.client else "unknown"))
    client_id = _ip_to_client_id.get(client_ip) or str(uuid.uuid4())
    _ip_to_client_id[client_ip] = client_id

    # Resolve hostname for display
    import socket as _socket
    try:
        hostname = _socket.gethostbyaddr(client_ip)[0]
    except Exception:
        hostname = client_ip

    ws_clients[client_id] = {"ws": websocket, "ip": client_ip, "hostname": hostname}
    logger.info("WebSocket client connected: %s (%s) total=%d", hostname, client_ip, len(ws_clients))

    # Restore kiosk config: in-memory (same session reconnect) → persisted (server restart)
    if client_id not in kiosk_configs and client_ip in _ip_kiosk_configs:
        kiosk_configs[client_id] = _ip_kiosk_configs[client_ip]
        logger.info("Restored kiosk config for %s from disk", client_ip)

    # Send hello with client_id + current kiosk config
    kiosk_cfg = kiosk_configs.get(client_id, _default_kiosk_config())
    await websocket.send_text(json.dumps({
        "type": "client_hello",
        "client_id": client_id,
        **kiosk_cfg,
    }))

    # Send current device state immediately
    await websocket.send_text(
        json.dumps({"type": "status_update", "devices": list(latest_statuses.values())})
    )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_clients.pop(client_id, None)
        logger.info("WebSocket client disconnected: %s total=%d", client_ip, len(ws_clients))


# ---------------------------------------------------------------------------
# Static frontend — served from ../frontend/dist
# ---------------------------------------------------------------------------

_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.isdir(_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Serve known static files from dist root directly
        candidate = os.path.join(_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_DIST, "index.html"))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
