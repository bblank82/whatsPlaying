"""Apple TV discovery via mDNS/Bonjour using pyatv."""

import asyncio
import logging
from typing import Callable

import pyatv

logger = logging.getLogger(__name__)


async def scan_devices(timeout: int = 5) -> list[dict]:
    """Scan the local network for Apple TV devices and return their info."""
    logger.info("Scanning for Apple TV devices (timeout=%ds)...", timeout)
    try:
        devices = await pyatv.scan(asyncio.get_event_loop(), timeout=timeout)
    except Exception as exc:
        logger.error("Scan failed: %s", exc)
        return []

    result = []
    for conf in devices:
        result.append(_conf_to_dict(conf))
        logger.info("Found: %s at %s", conf.name, conf.address)

    return result


def _conf_to_dict(conf) -> dict:
    """Convert a pyatv AppleTV config to a serialisable dict."""
    services = []
    for svc in conf.services:
        services.append(
            {
                "protocol": str(svc.protocol),
                "port": svc.port,
            }
        )
    return {
        "identifier": conf.identifier,
        "name": conf.name,
        "address": str(conf.address),
        "model": str(conf.device_info.model) if conf.device_info else "Unknown",
        "os_version": (
            str(conf.device_info.version) if conf.device_info else "Unknown"
        ),
        "services": services,
    }
