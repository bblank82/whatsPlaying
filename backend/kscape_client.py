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


def _unescape_kscape(value: str) -> str:
    """Unescape Kaleidescape protocol value encoding (\\: → : and \\/ → /)."""
    return value.replace('\\:', ':').replace('\\/', '/')


# Map Kaleidescape play-mode integers to pyatv-compatible state strings.
# Per protocol manual: 0=nothing playing, 1=paused, 2=playing,
# 4=forward scan, 6=reverse scan.
_PLAY_STATE = {
    "0": "DeviceState.Idle",
    "1": "DeviceState.Paused",
    "2": "DeviceState.Playing",
    "4": "DeviceState.Playing",   # forward scan
    "6": "DeviceState.Playing",   # reverse scan
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
        self._highlighted_handle: Optional[str] = None  # current HIGHLIGHTED_SELECTION handle
        self._pending_content_handle: Optional[str] = None  # handle from latest CONTENT_DETAILS_OVERVIEW
        self._cover_url: Optional[str] = None
        self._position: Optional[int] = None
        self._duration: Optional[int] = None
        self._title: Optional[str] = None
        self._rating: Optional[str] = None
        self._year: Optional[int] = None
        self._model: str = "Kaleidescape"
        self._serial: Optional[str] = None
        self._cpdid: str = "01"       # updated from DEVICE_INFO; used for ENABLE_EVENTS
        self._power_on: bool = False  # updated by DEVICE_POWER_STATE push; default off until confirmed
        # Sequence counter for outgoing commands (single digit 1-9 per spec)
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

            # Request device info — CPDID from response is used for ENABLE_EVENTS
            await self._send_raw("GET_DEVICE_INFO")
            await self._send_raw("GET_DEVICE_POWER_STATE")
            await self._send_raw("GET_PLAY_STATUS")
            await self._send_raw("GET_HIGHLIGHTED_SELECTION")
            # Enable push events; re-issued with correct CPDID once DEVICE_INFO arrives
            await self._send_raw(f"ENABLE_EVENTS:{self._cpdid}")

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
        """Send a framed command to the player.

        Wire format: device_id/seq/command:params
        device_id is always '01' (directly-connected component per spec).
        seq is a single digit 1-9, cycling.
        """
        if not self._writer:
            logger.warning("Kaleidescape send skipped (no writer): %s", command)
            return
        seq = str(self._seq)
        self._seq = (self._seq % 9) + 1
        line = f"01/{seq}/{command}:\r\n"
        logger.debug("Kaleidescape >> %s", line.strip())
        try:
            self._writer.write(line.encode())
            await self._writer.drain()
        except Exception as exc:
            logger.warning("Kaleidescape send error: %s", exc)
            await self._handle_disconnect()

    async def send_command(self, action: str, pos: Optional[int] = None):
        """Send a transport or navigation command."""
        cmd_map = {
            "play":          "PLAY",
            "pause":         "PAUSE",
            "play_pause":    "PAUSE",       # Kaleidescape uses PAUSE to toggle
            "stop":          "STOP",
            "next":          "NEXT",
            "previous":      "PREVIOUS",
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
            "turn_off":      "ENTER_STANDBY",
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
        self._power_on = False
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
        logger.debug("Kaleidescape << %r", line)

        # Wire format: device_id/seq/status_code:STATUS_NAME:field1:field2:...:/checksum
        # seq is a digit for responses, '!' for push events — both handled by [^/]+
        m = re.match(r"^[^/]*/[^/]+/\d+:(\w+)(?::(.*))?$", line)
        if not m:
            logger.debug("Kaleidescape unmatched line: %r", line)
            return

        status_name = m.group(1)
        raw = re.sub(r":/\d+$", "", m.group(2) or "")
        fields = [f for f in raw.split(":") if f != ""]

        if status_name == "DEVICE_INFO":
            self._parse_device_info(fields)

        elif status_name == "PLAY_STATUS":
            self._parse_play_status(fields)

        elif status_name == "MOVIE_LOCATION":
            # Location code: 00=UI/unknown, 03=main content, 04=intermission,
            # 05=end credits, 06=disc menu. Not a content handle — ignore for metadata.
            if fields:
                logger.debug("Kaleidescape movie location: %s", fields[0])

        elif status_name == "CONTENT_DETAILS_OVERVIEW":
            # Signals start of a CONTENT_DETAILS block for a specific handle.
            # Save the handle so we can discard lines from stale/racing requests.
            handle = fields[1] if len(fields) > 1 else None
            self._pending_content_handle = handle
            logger.debug("Kaleidescape content details: %s lines for handle %s",
                         fields[0] if fields else "?", handle)

        elif status_name == "CONTENT_DETAILS":
            # Per-line name/value pairs: line_num : name : value
            self._parse_content_details_line(fields)

        elif status_name == "DEVICE_POWER_STATE":
            # Field 0: 0 = standby, 1 = on
            if fields:
                self._power_on = fields[0] != "0"
                logger.info("Kaleidescape power state: %s (%s)", fields[0], "on" if self._power_on else "standby")

        elif status_name == "HIGHLIGHTED_SELECTION":
            # Handle for the currently highlighted/playing item — use for content lookup
            if fields and fields[0]:
                handle = fields[0]
                if handle != self._highlighted_handle:
                    self._highlighted_handle = handle
                    # Clear stale metadata so old artwork isn't shown for the new title
                    self._title = None
                    self._cover_url = None
                    self._rating = None
                    self._year = None
                    self._pending_content_handle = None
                    # Request content details: format is GET_CONTENT_DETAILS:handle:passcode:
                    # (empty passcode = no parental override needed)
                    await self._send_raw(f"GET_CONTENT_DETAILS:{handle}:")

    def _parse_device_info(self, fields: list[str]):
        # Wire layout per spec: device_type : serial_num : cpdid : ip_address
        try:
            if len(fields) >= 2 and fields[1]:
                self._serial = fields[1]
            if len(fields) >= 3 and fields[2] and fields[2] != "00":
                old_cpdid = self._cpdid
                self._cpdid = fields[2]
                logger.info("Kaleidescape assigned CPDID: %s", self._cpdid)
                if self._cpdid != old_cpdid:
                    # Re-enable events with the correct assigned CPDID
                    asyncio.create_task(self._send_raw(f"ENABLE_EVENTS:{self._cpdid}"))
        except Exception:
            pass
        logger.info("Kaleidescape device: %s (%s)", self.name, self.identifier)

    def _parse_play_status(self, fields: list[str]):
        # Wire layout (protocol manual, section GET_PLAY_STATUS):
        #   mode : speed : title_num : title_length : title_loc :
        #   chap_num : chap_len : chap_loc
        # All times are in seconds (zero-padded). No handle field.
        try:
            # Field 0: play mode
            if fields:
                self._play_state = _PLAY_STATE.get(fields[0], "DeviceState.Idle")

            # Field 3: total title length in seconds
            if len(fields) > 3:
                try:
                    val = int(fields[3])
                    self._duration = val if val > 0 else None
                except ValueError:
                    pass

            # Field 4: current position within title in seconds
            if len(fields) > 4:
                try:
                    val = int(fields[4])
                    self._position = val if val >= 0 else None
                except ValueError:
                    pass

        except Exception as exc:
            logger.debug("Kaleidescape play_status parse error: %s — fields: %s", exc, fields)

    def _parse_content_details_line(self, fields: list[str]):
        # Format: line_num : name : value
        # Value may contain escaped colons (\\:) which, after splitting on ':', leave
        # the value fragmented across fields[2:]. Re-join before unescaping.
        if len(fields) < 3:
            return
        # Discard lines that belong to a stale request (racing HIGHLIGHTED_SELECTION changes)
        if self._pending_content_handle != self._highlighted_handle:
            logger.debug("Kaleidescape discarding stale content detail (pending=%s, current=%s)",
                         self._pending_content_handle, self._highlighted_handle)
            return
        name = fields[1]
        value = _unescape_kscape(":".join(fields[2:]))

        if name == "Title":
            self._title = value
            logger.info("Kaleidescape title: %s", value)
        elif name == "Cover_URL":
            self._cover_url = value
        elif name == "HiRes_cover_URL":
            # Prefer HiRes — overwrite the standard Cover_URL
            self._cover_url = value
        elif name == "Rating":
            self._rating = value
        elif name == "Year":
            try:
                self._year = int(value)
            except ValueError:
                pass

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
                "artwork_id": self._highlighted_handle,
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
            "power": "PowerState.On" if (self._connected and self._power_on) else "PowerState.Off",
            "now_playing": now_playing,
        }
