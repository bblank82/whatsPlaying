"""Manages persistent connections to Apple TV devices and polls now-playing state."""

import asyncio
import logging
import socket
from typing import Optional

import pyatv
from pyatv.const import DeviceState, MediaType, PowerState
from pyatv.interface import PushListener

from credentials import get_for_device

logger = logging.getLogger(__name__)


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


class DeviceClient(PushListener):
    """Holds an active connection to one Apple TV and exposes now-playing info."""

    def __init__(self, conf):
        self.conf = conf
        self.identifier: str = conf.identifier
        self.name: str = conf.name
        self.address: str = str(conf.address)
        self._atv = None
        self._connected = False
        self._hostname: Optional[str] = None
        self._cached_playing: Optional[dict] = None  # last push update
        self._app_map: dict[str, str] = {}           # bundle_id -> display name
        self._current_app_id:   Optional[str] = None
        self._current_app_name: Optional[str] = None

    # ------------------------------------------------------------------
    # PushListener callbacks
    # ------------------------------------------------------------------

    def playstatus_update(self, updater, playstatus) -> None:
        self._cached_playing = _playing_to_dict(playstatus, self._app_map)
        logger.debug("Push update for %s: %s", self.name, self._cached_playing)

    def playstatus_error(self, updater, exception) -> None:
        logger.debug("Push update error for %s: %s", self.name, exception)

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        try:
            stored = get_for_device(self.identifier)
            for svc in self.conf.services:
                proto_name = str(svc.protocol).split(".")[-1]
                if proto_name in stored:
                    svc.credentials = stored[proto_name]

            self._atv = await pyatv.connect(self.conf, asyncio.get_running_loop())
            self._connected = True

            # Subscribe to push updates for real-time playback state
            self._atv.push_updater.listener = self
            self._atv.push_updater.start()

            # Fetch app list for bundle-ID → name mapping (best-effort)
            try:
                apps = await self._atv.apps.app_list()
                self._app_map = {a.identifier: a.name for a in apps if a.identifier and a.name}
                logger.debug("Loaded %d apps for %s", len(self._app_map), self.name)
            except Exception:
                pass  # app_list not available on all protocols

            logger.info("Connected to %s (push updates active)", self.name)
            return True
        except Exception as exc:
            logger.warning("Could not connect to %s: %s", self.name, exc)
            self._connected = False
            return False

    async def disconnect(self):
        if self._atv:
            self._atv.close()
            self._atv = None
            self._connected = False
            self._cached_playing = None

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def get_status(self) -> dict:
        """Return a snapshot of the device's current state."""
        if self._hostname is None:
            self._hostname = _resolve_hostname(self.address)
        model = self.conf.device_info.model if self.conf.device_info else None
        base = {
            "identifier": self.identifier,
            "name": self.name,
            "address": self.address,
            "hostname": self._hostname,
            "model": str(model).replace("DeviceModel.", "") if model else "Unknown",
            "connected": self._connected,
            "power": None,
            "now_playing": None,
        }

        if not self._connected or not self._atv:
            return base

        try:
            base["power"] = str(self._atv.power.power_state)

            # Get currently active app — more reliable than app_id on the playing state
            try:
                active_app = self._atv.metadata.app
                if active_app:
                    self._current_app_id   = active_app.identifier
                    self._current_app_name = active_app.name
            except Exception:
                pass

            if self._cached_playing is not None:
                # Prefer push-delivered state — it's more accurate than polling
                base["now_playing"] = self._cached_playing
            else:
                # Fall back to poll once; result may be stale for Companion
                playing = await self._atv.metadata.playing()
                base["now_playing"] = _playing_to_dict(playing, self._app_map)

            # Patch app_id/app_name into now_playing if the playing state didn't report them
            if base["now_playing"] and not base["now_playing"].get("app_id"):
                base["now_playing"] = {
                    **base["now_playing"],
                    "app_id":   self._current_app_id,
                    "app_name": self._current_app_name or self._app_map.get(self._current_app_id or ""),
                }

        except Exception as exc:
            logger.debug("Status fetch failed for %s: %s", self.name, exc)
            base["connected"] = False

        return base


def _playing_to_dict(playing, app_map: Optional[dict] = None) -> Optional[dict]:
    if playing is None:
        return None

    state = playing.device_state
    app_id = getattr(playing, "app_id", None)
    app_name = (app_map or {}).get(app_id) if app_id else None

    if state in (DeviceState.Idle, DeviceState.Loading) and not playing.title:
        return {"device_state": str(state), "title": None, "app_id": app_id, "app_name": app_name, "artwork_id": None, "artwork_available": False}

    return {
        "device_state": str(state),
        "media_type": str(playing.media_type) if playing.media_type else None,
        "title": playing.title,
        "artist": playing.artist,
        "album": playing.album,
        "series_name": playing.series_name,
        "season_number": playing.season_number,
        "episode_number": playing.episode_number,
        "total_time": playing.total_time,
        "position": playing.position,
        "shuffle": str(playing.shuffle) if playing.shuffle is not None else None,
        "repeat": str(playing.repeat) if playing.repeat is not None else None,
        "artwork_id": getattr(playing, "artwork_id", None) or None,
        "artwork_available": bool(getattr(playing, "artwork_id", None)),
        "app_id": app_id,
        "app_name": app_name,
    }
