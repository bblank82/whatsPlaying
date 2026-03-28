"""Kaleidescape Control Protocol client.

Maintains a persistent TCP connection to a Kaleidescape player on port 10000,
parses push-delivered status messages, and exposes get_status() in the same
dict shape as DeviceClient so it drops into the shared polling loop.
"""

import asyncio
import logging
import re
import socket
from typing import Optional

try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

logger = logging.getLogger(__name__)

KSCAPE_PORT = 10000
RECONNECT_DELAY = 10   # seconds between reconnect attempts


def _resolve_hostname(ip: str) -> str:
    old = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(1)
        host = socket.gethostbyaddr(ip)[0]
        if host and host != ip:
            return host
    except Exception:
        pass
    finally:
        socket.setdefaulttimeout(old)
    return ip


def _hms_to_seconds(hms: str) -> Optional[int]:
    """Convert HH:MM:SS to total seconds, return None on failure."""
    try:
        parts = hms.strip().split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        pass
    return None


# Map Kaleidescape play-state integers to pyatv-compatible state strings
_PLAY_STATE = {
    "0": "DeviceState.Idle",
    "1": "DeviceState.Paused",
    "2": "DeviceState.Playing",
    "3": "DeviceState.Playing",   # scan forward — still "playing" for UI purposes
    "4": "DeviceState.Playing",   # scan reverse
}


class KaleidescapeClient:
    """Manages a connection to one Kaleidescape player."""

    # Assigned once DEVICE_INFO is received
    identifier: str
    name: str

    def __init__(self, ip: str):
        self.address = ip
        self.identifier = f"kaleidescape-{ip}"
        self.name = "Kaleidescape (Kaleidescape)"
        self._hostname: Optional[str] = None
        self._connected = False
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None

        # Cached state updated by push messages
        self._play_state: str = "DeviceState.Idle"
        self._title: Optional[str] = None
        self._movie_location: Optional[str] = None   # current handle
        self._cover_url: Optional[str] = None
        self._position: Optional[int] = None
        self._duration: Optional[int] = None
        self._content_type: Optional[str] = None     # "movie", "music", etc.
        self._rating: Optional[str] = None
        self._year: Optional[int] = None
        self._model: str = "Kaleidescape"
        self._serial: Optional[str] = None
        # Sequence counter for outgoing commands
        self._seq = 1

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def _fetch_friendly_name(self):
        """Scrape the Kaleidescape web UI to get the configured device name."""
        if not _HTTPX_AVAILABLE:
            return
        try:
            # asyncio's DNS resolver doesn't support mDNS; pre-resolve via socket
            loop = asyncio.get_event_loop()
            infos = await loop.run_in_executor(
                None, lambda: socket.getaddrinfo("my-kaleidescape.local.", 80, socket.AF_INET)
            )
            server_ip = infos[0][4][0]
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"http://{server_ip}/components",
                    headers={"Host": "my-kaleidescape.local."},
                )
                html = resp.text
            blocks = re.split(r'<div class="component_container', html)
            for block in blocks:
                ip_match = re.search(
                    r'<td class="data_value">\s*' + re.escape(self.address) + r'\s*</td>', block
                )
                if ip_match:
                    name_match = re.search(r'friendly_name[^>]+value="([^"]+)"', block)
                    if name_match and name_match.group(1).strip():
                        self.name = f"{name_match.group(1).strip()} (Kaleidescape)"
                        logger.info("Kaleidescape friendly name: %s", self.name)
                    break
        except Exception as exc:
            logger.debug("Could not fetch Kaleidescape friendly name: %s", exc)

    async def connect(self) -> bool:
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.address, KSCAPE_PORT), timeout=5
            )
            self._connected = True
            logger.info("Connected to Kaleidescape at %s", self.address)
            await self._fetch_friendly_name()

            # Request device info and enable push events
            await self._send_raw("GET_DEVICE_INFO")
            await self._send_raw("GET_PLAY_STATUS")
            await self._send_raw("GET_HIGHLIGHTED_SELECTION")
            # Enable all event notifications (bitmask of all 1s for relevant events)
            await self._send_raw("ENABLE_EVENTS:01111111111111111")

            # Start background reader
            self._reader_task = asyncio.create_task(self._read_loop())
            return True
        except Exception as exc:
            logger.warning("Kaleidescape connect failed (%s): %s", self.address, exc)
            self._connected = False
            return False

    async def disconnect(self):
        self._connected = False
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None
        if self._reconnect_task:
            self._reconnect_task.cancel()
            self._reconnect_task = None
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
            self._writer = None
        self._reader = None

    async def _send_raw(self, command: str):
        """Send a framed command to the player."""
        if not self._writer:
            return
        seq = f"{self._seq:02d}"
        self._seq = (self._seq % 99) + 1
        line = f"{seq}/1/{command}:\r\n"
        try:
            self._writer.write(line.encode())
            await self._writer.drain()
        except Exception as exc:
            logger.debug("Kaleidescape send error: %s", exc)
            await self._handle_disconnect()

    async def send_command(self, action: str, pos: Optional[int] = None):
        """Send a transport or navigation command."""
        cmd_map = {
            "play":          "PLAY",
            "pause":         "PAUSE",
            "play_pause":    "PAUSE",       # Kaleidescape uses PAUSE to toggle
            "stop":          "STOP",
            "next":          "NEXT_TRACK",
            "previous":      "PREVIOUS_TRACK",
            "skip_forward":  "SCAN_FORWARD",
            "skip_backward": "SCAN_REVERSE",
            # Navigation
            "up":            "UP",
            "down":          "DOWN",
            "left":          "LEFT",
            "right":         "RIGHT",
            "select":        "SELECT",
            "menu":          "BACK",
            "home":          "TOP_MENU",
            # Power
            "turn_on":       "LEAVE_STANDBY",
            "turn_off":      "STANDBY",
            # Volume (routed to zone controller if available)
            "volume_up":     "VOLUME_UP",
            "volume_down":   "VOLUME_DOWN",
        }
        if action == "set_position" and pos is not None:
            h, rem = divmod(int(pos), 3600)
            m, s = divmod(rem, 60)
            await self._send_raw(f"SET_POSITION:{h:02d}:{m:02d}:{s:02d}")
        elif action in cmd_map:
            await self._send_raw(cmd_map[action])

    # ------------------------------------------------------------------
    # Push-message reader loop
    # ------------------------------------------------------------------

    async def _read_loop(self):
        """Read lines from the TCP connection and parse push messages."""
        try:
            while self._connected and self._reader:
                try:
                    line = await asyncio.wait_for(self._reader.readline(), timeout=60)
                except asyncio.TimeoutError:
                    # No data for 60s — send a keepalive and keep reading
                    logger.debug("Kaleidescape keepalive (%s)", self.address)
                    await self._send_raw("GET_PLAY_STATUS")
                    continue
                if not line:
                    break
                await self._parse_line(line.decode("utf-8", errors="replace").strip())
        except asyncio.CancelledError:
            return
        except Exception as exc:
            logger.warning("Kaleidescape read error (%s): %s", self.address, exc)

        await self._handle_disconnect()

    async def _handle_disconnect(self):
        if not self._connected:
            return
        self._connected = False
        self._play_state = "DeviceState.Idle"
        logger.info("Kaleidescape disconnected (%s) — reconnecting in %ds", self.address, RECONNECT_DELAY)
        self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def _reconnect_loop(self):
        while not self._connected:
            await asyncio.sleep(RECONNECT_DELAY)
            logger.info("Kaleidescape reconnecting to %s…", self.address)
            if await self.connect():
                return

    # ------------------------------------------------------------------
    # Protocol parser
    # ------------------------------------------------------------------

    async def _parse_line(self, line: str):
        """Parse one response/push line from the player."""
        if not line or line.startswith("#"):
            return  # comment / blank

        # Format: /1/STATUS_NAME field1:field2:...:/
        # or:     seq/1/STATUS_NAME field1:field2:...:/
        # Strip leading sequence and /1/
        m = re.match(r"^(?:\d+)?/\d+/(\w+)\s*(.*?)/?$", line)
        if not m:
            return

        status_name = m.group(1)
        payload = m.group(2).rstrip("/").strip()
        fields = payload.split(":") if payload else []

        if status_name == "DEVICE_INFO":
            # Fields: friendly_name:model:type:hardware:software:...
            # Actual field layout varies by firmware; we just grab what we can
            self._parse_device_info(fields)

        elif status_name == "PLAY_STATUS":
            self._parse_play_status(fields)

        elif status_name == "MOVIE_LOCATION":
            # Pushed when the highlighted/playing item changes: handle
            if fields:
                handle = fields[0]
                if handle and handle != self._movie_location:
                    self._movie_location = handle
                    self._cover_url = f"http://{self.address}:{KSCAPE_PORT}/img/{handle}"
                    # Request full content details for the new handle
                    await self._send_raw(f"GET_CONTENT_DETAILS:{handle}")

        elif status_name == "CONTENT_DETAILS":
            self._parse_content_details(fields)

        elif status_name == "HIGHLIGHTED_SELECTION":
            # Same as MOVIE_LOCATION — use whichever arrives
            if fields:
                handle = fields[0]
                if handle and not self._movie_location:
                    self._movie_location = handle
                    self._cover_url = f"http://{self.address}:{KSCAPE_PORT}/img/{handle}"
                    await self._send_raw(f"GET_CONTENT_DETAILS:{handle}")

    def _parse_device_info(self, fields: list[str]):
        # Typical layout (varies): friendly_name, serial, model, ...
        # We try positions known from the protocol spec; fall back gracefully
        try:
            if len(fields) >= 1 and fields[0]:
                self.name = f"{fields[0]} (Kaleidescape)"
            if len(fields) >= 2 and fields[1]:
                self._serial = fields[1]
                self.identifier = f"kaleidescape-{self._serial}"
            if len(fields) >= 3 and fields[2]:
                self._model = f"Kaleidescape {fields[2]}"
        except Exception:
            pass
        logger.info("Kaleidescape device: %s (%s)", self.name, self.identifier)

    def _parse_play_status(self, fields: list[str]):
        # Protocol spec layout for PLAY_STATUS:
        # status_code : movie_location_handle : play_state : chapter :
        # chapter_start : chapter_end : movie_position : movie_duration :
        # play_speed : ui_state : ...
        # Positions vary slightly across firmware versions.
        # We look for the play state (0-4), position (HH:MM:SS), duration (HH:MM:SS).
        try:
            # Field 0: 4-digit status code (e.g. "0400")
            # Field 1: movie_location handle
            # Field 2: play_state
            # Fields further in contain time values in HH:MM:SS format
            if len(fields) > 1 and fields[1]:
                handle = fields[1]
                if handle and handle != self._movie_location:
                    self._movie_location = handle
                    self._cover_url = f"http://{self.address}:{KSCAPE_PORT}/img/{handle}"

            if len(fields) > 2:
                self._play_state = _PLAY_STATE.get(fields[2], "DeviceState.Idle")

            # Find HH:MM:SS values — position comes before duration in the field list
            time_values = []
            for f in fields[3:]:
                if re.match(r"^\d{1,2}:\d{2}:\d{2}$", f):
                    time_values.append(_hms_to_seconds(f))

            # First time value = chapter position, skip to movie position/duration
            # Layout is: chapter_start, chapter_end, movie_position, movie_duration
            # We want the last two time values
            if len(time_values) >= 2:
                self._position = time_values[-2]
                self._duration = time_values[-1]
            elif len(time_values) == 1:
                self._position = time_values[0]

        except Exception as exc:
            logger.debug("Kaleidescape play_status parse error: %s — fields: %s", exc, fields)

    def _parse_content_details(self, fields: list[str]):
        # Layout: handle, title, type, rating, year, ...
        try:
            if len(fields) > 1 and fields[1]:
                self._title = fields[1]
            if len(fields) > 2 and fields[2]:
                self._content_type = fields[2].lower()
            if len(fields) > 3 and fields[3]:
                self._rating = fields[3]
            if len(fields) > 4 and fields[4]:
                try:
                    self._year = int(fields[4])
                except ValueError:
                    pass
        except Exception as exc:
            logger.debug("Kaleidescape content_details parse error: %s", exc)

    # ------------------------------------------------------------------
    # Status dict (same shape as DeviceClient.get_status)
    # ------------------------------------------------------------------

    async def get_status(self) -> dict:
        if self._hostname is None:
            self._hostname = _resolve_hostname(self.address)

        is_active = self._play_state in ("DeviceState.Playing", "DeviceState.Paused")

        now_playing = None
        if is_active or self._title:
            now_playing = {
                "device_state": self._play_state,
                "media_type": "MediaType.Video",
                "title": self._title,
                "artist": None,
                "album": None,
                "series_name": None,
                "season_number": None,
                "episode_number": None,
                "total_time": self._duration,
                "position": self._position,
                "shuffle": None,
                "repeat": None,
                "artwork_id": self._movie_location,
                "artwork_available": bool(self._cover_url),
                "app_id": None,
                "app_name": "Kaleidescape",
                "kscape_cover_url": self._cover_url,
                "kscape_rating": self._rating,
                "kscape_year": self._year,
            }

        return {
            "identifier": self.identifier,
            "name": self.name,
            "address": self.address,
            "hostname": self._hostname,
            "model": self._model,
            "device_type": "kaleidescape",
            "connected": self._connected,
            "power": "PowerState.On" if self._connected else "PowerState.Off",
            "now_playing": now_playing,
        }
