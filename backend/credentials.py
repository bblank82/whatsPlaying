"""Persist pyatv credentials to a local JSON file."""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)
CREDS_FILE = Path(__file__).parent / "credentials.json"


def _load() -> dict:
    if CREDS_FILE.exists():
        try:
            return json.loads(CREDS_FILE.read_text())
        except Exception as exc:
            logger.warning("Could not read credentials file: %s", exc)
    return {}


def get_for_device(identifier: str) -> dict:
    """Return {protocol_name: credential_str} for the given device."""
    return _load().get(identifier, {})


def save(identifier: str, protocol: str, credential: str) -> None:
    """Persist a credential for one protocol of a device."""
    all_creds = _load()
    all_creds.setdefault(identifier, {})[protocol] = credential
    CREDS_FILE.write_text(json.dumps(all_creds, indent=2))
    logger.info("Saved %s credential for %s", protocol, identifier)


def forget(identifier: str) -> None:
    """Remove all stored credentials for a device."""
    all_creds = _load()
    if identifier in all_creds:
        del all_creds[identifier]
        CREDS_FILE.write_text(json.dumps(all_creds, indent=2))
        logger.info("Forgot credentials for %s", identifier)
