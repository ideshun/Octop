"""Bounded plugin archive preparation; no process registry changes here."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from octop_harness.plugins import PluginManifest


def install_dependencies(source: Path) -> None:
    manifest = PluginManifest.load(source / "plugin.yaml")
    commands: list[list[str]] = []
    requirements = source / "requirements.txt"
    if requirements.is_file():
        commands.append(["-r", str(requirements)])
    if manifest.requires:
        commands.append(list(manifest.requires))
    uv = shutil.which("uv")
    installer = (
        [uv, "pip", "install", "--python", sys.executable]
        if uv
        else [sys.executable, "-m", "pip", "install"]
    )
    for args in commands:
        subprocess.run(
            [*installer, *args],
            check=True,
            capture_output=True,
            timeout=120,
        )
