"""Compatibility adapter for the legacy built-in group participation settings."""

from __future__ import annotations

from typing import Any

from .channel_catalog import channels, load_group_names
from .channel_catalog import groups as catalog_groups

__all__ = ["channels", "groups", "load_group_names"]


def groups(server: Any) -> list[dict[str, Any]]:
    items = catalog_groups(server)
    for item in items:
        item["channelParticipationEnabled"] = (
            item.pop("pluginSettings", {}).get("social_trigger_enabled", True) is True
        )
    return items
