"""Sony Blu-ray Player (IRCC-IP) client.

Supports transport control and basic navigation via SOAP/IRCC over HTTP on port 50001.
Note: Sony players do not report rich 'Now Playing' metadata via this protocol.
"""

import asyncio
import logging
import socket
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SONY_PORT = 50001
RECONNECT_DELAY = 10

# Standard Sony IRCC Codes (Base64 encoded for SOAP payload)
IRCC_CODES = {
    "Confirm":    "AAAAAgAAABoAAAB8Aw==",
    "Up":         "AAAAAgAAABoAAAB0Aw==",
    "Down":       "AAAAAgAAABoAAAB1Aw==",
    "Left":       "AAAAAgAAABoAAAB2Aw==",
    "Right":      "AAAAAgAAABoAAAB3Aw==",
    "Home":        "AAAAAgAAABoAAAB7Aw==",
    "Options":     "AAAAAgAAABoAAABvAw==",
    "Return":      "AAAAAgAAABoAAAB9Aw==",
    "Play":        "AAAAAgAAABoAAABaAw==",
    "Pause":       "AAAAAgAAABoAAABbAw==",
    "Stop":        "AAAAAgAAABoAAABjAw==",
    "Next":        "AAAAAgAAABoAAABlAw==",
    "Prev":        "AAAAAgAAABoAAABmAw==",
    "Forward":     "AAAAAgAAABoAAABcAw==",
    "Rewind":      "AAAAAgAAABoAAABdAw==",
    "Blue":        "AAAAAgAAABoAAABnAw==",
    "Red":         "AAAAAgAAABoAAABpAw==",
    "Green":       "AAAAAgAAABoAAABoAw==",
    "Yellow":      "AAAAAgAAABoAAABqAw==",
    "SubTitle":    "AAAAAgAAABoAAABjAw==", # Sometimes same as stop? No, check.
    "Audio":       "AAAAAgAAABoAAABkAw==",
    "TopMenu":     "AAAAAgAAABoAAAB6Aw==",
    "PopUpMenu":   "AAAAAgAAABoAAAB7Aw==",
}


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


class SonyClient:
    """Manages control of a Sony Blu-ray player via IRCC-IP."""

    def __init__(self, ip: str):
        self.address = ip
        self.identifier = f"sony-{ip}"
        self.name = f"Sony Blu-ray ({ip})"
        self._hostname: Optional[str] = None
        self._connected = False
        self._power_on = False
        self._model = "Sony Blu-ray"
        self._client = httpx.AsyncClient(timeout=3)

    async def connect(self) -> bool:
        """Check if the player is reachable and responding to IRCC."""
        try:
            # Try to get the IRCC service description or just ping the port
            # Sony players often provide a list of commands at /getRemoteCommandList
            url = f"http://{self.address}:{SONY_PORT}/getRemoteCommandList"
            resp = await self._client.get(url)
            if resp.status_code == 200:
                self._connected = True
                self._power_on = True # If it responds to HTTP it's generally awake
                logger.info("Connected to Sony Blu-ray at %s", self.address)
                return True
        except Exception as exc:
            logger.debug("Sony check failed at %s: %s", self.address, exc)
            
        # Fallback: simple TCP connect check for newer models that might use different paths
        try:
            fut = asyncio.open_connection(self.address, SONY_PORT)
            _, writer = await asyncio.wait_for(fut, timeout=2)
            writer.close()
            await writer.wait_closed()
            self._connected = True
            self._power_on = True
            logger.info("Sony Blu-ray detected via port check at %s", self.address)
            return True
        except Exception:
            pass

        self._connected = False
        return False

    async def disconnect(self):
        self._connected = False
        await self._client.aclose()

    async def send_command(self, action: str):
        """Send an IRCC command via SOAP."""
        cmd_map = {
            "play":          "Play",
            "pause":         "Pause",
            "play_pause":    "Pause",
            "stop":          "Stop",
            "next":          "Next",
            "previous":      "Prev",
            "skip_forward":  "Forward",
            "skip_backward": "Rewind",
            "up":            "Up",
            "down":          "Down",
            "left":          "Left",
            "right":         "Right",
            "select":        "Confirm",
            "menu":          "Options",
            "home":          "Home",
            "return":        "Return",
            "top_menu":      "TopMenu",
        }
        
        button = cmd_map.get(action)
        if not button:
            logger.warning("Sony command not supported: %s", action)
            return

        code = IRCC_CODES.get(button)
        if not code:
            logger.warning("Sony IRCC code not found for button: %s", button)
            return

        url = f"http://{self.address}:{SONY_PORT}/IRCC"
        headers = {
            "Content-Type": 'text/xml; charset=utf-8',
            "SOAPACTION": '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
            "User-Agent": "TVSideView/2.0.1 CFNetwork/672.0.8 Darwin/14.0.0",
        }
        
        # Sony SOAP payload for IRCC
        body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">
      <IRCCCode>{code}</IRCCCode>
    </u:X_SendIRCC>
  </s:Body>
</s:Envelope>"""

        try:
            resp = await self._client.post(url, headers=headers, content=body)
            if resp.status_code == 200:
                logger.debug("Sent Sony command %s (%s)", action, button)
            else:
                logger.warning("Sony command %s failed: %d", action, resp.status_code)
        except Exception as exc:
            logger.warning("Sony send error: %s", exc)

    async def get_status(self) -> dict:
        if self._hostname is None:
            self._hostname = _resolve_hostname(self.address)

        # Sony players don't provide rich metadata easily via IP
        # We report basic connectivity and power state
        
        # Periodically re-check connectivity if it was off
        if not self._connected:
            await self.connect()

        return {
            "identifier": self.identifier,
            "name": self.name,
            "address": self.address,
            "hostname": self._hostname,
            "model": self._model,
            "device_type": "sony",
            "connected": self._connected,
            "power": "PowerState.On" if (self._connected and self._power_on) else "PowerState.Off",
            "now_playing": None,
        }
