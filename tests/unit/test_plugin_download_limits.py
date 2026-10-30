"""Downloads have explicit per-read and total budgets."""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest

from octop.infra.agents.plugins import manager
from octop.infra.errors import OctopError


class Response(io.BytesIO):
    headers: dict[str, str] = {}


def test_download_limits_bytes(tmp_path: Path) -> None:
    with (
        patch.object(manager, "_MAX_PLUGIN_ARCHIVE_BYTES", 3),
        patch.object(manager.urllib.request, "urlopen", return_value=Response(b"1234")) as opened,
        pytest.raises(OctopError, match="exceeds"),
    ):
        manager._download_plugin_archive("https://example.test/plugin.zip", tmp_path / "plugin.zip")
    assert opened.call_args.kwargs["timeout"] == 30


def test_download_total_budget(tmp_path: Path) -> None:
    with (
        patch.object(manager.time, "monotonic", side_effect=[0, 121]),
        patch.object(manager.urllib.request, "urlopen", return_value=Response(b"1234")),
        pytest.raises(OctopError, match="budget"),
    ):
        manager._download_plugin_archive("https://example.test/plugin.zip", tmp_path / "plugin.zip")
