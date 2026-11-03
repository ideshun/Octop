"""tests/unit/test_gateway.py"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from octop.config import OctopConfig
from octop.infra.agents.manager import AgentManager
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.db.services import build_shared_services
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.gateway.gateway import ChannelCreateSpec, Gateway
from octop.infra.utils.paths import PathLayout
from octop.infra.utils.ulid import new_ulid


def _make_services(tmp_path: Path):
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    return build_shared_services(db=db, paths=PathLayout(tmp_path), config=OctopConfig())


def _seed_agent(services, tmp_path: Path) -> tuple[str, int]:
    uid = UserRepo(services.db).create(username="alice", password_hash="h", role="admin")
    aid = new_ulid()
    AgentRepo(services.db).create(agent_id=aid, user_id=uid, name="bot")
    return aid, uid


@pytest.mark.asyncio
async def test_gateway_boot_and_shutdown(tmp_path: Path) -> None:
    services = _make_services(tmp_path)
    with patch("octop.infra.agents.manager.HarnessAgentManager") as mock_hm_cls:
        mock_hm_cls.return_value = MagicMock()

        registry = AgentManager(
            repos=services.repos,
            paths=services.paths,
            config=services.config,
        )
        await registry.boot()

        gw = Gateway(agent_manager=registry, repos=services.repos)
        await gw.boot()
        assert gw._channel_manager is not None
        assert gw._processor is not None

        await gw.shutdown()
        assert gw._channel_manager is None
        await registry.shutdown()


@pytest.mark.asyncio
async def test_builtin_command_is_processed_while_chat_is_busy(tmp_path: Path) -> None:
    from octop_gateway.channels.qq import QQChannel, QQConfig
    from octop_gateway.models import MessageEvent

    services = _make_services(tmp_path)
    started, release, status_seen = (asyncio.Event() for _ in range(3))

    async def processor(message):
        if message.text == "work":
            started.set()
            await release.wait()
        elif message.text == "/status":
            status_seen.set()
        yield MessageEvent.completed()

    with patch("octop.infra.agents.manager.HarnessAgentManager") as harness:
        harness.return_value = MagicMock()
        registry = AgentManager(repos=services.repos, paths=services.paths, config=services.config)
        await registry.boot()
        gateway = Gateway(agent_manager=registry, repos=services.repos)
        await gateway.boot()
        channel = QQChannel(
            processor,
            config=QQConfig(app_id="offline", secret="offline", channel_id="test-qq"),
        )
        channel.start, channel.stop = AsyncMock(), AsyncMock()
        channel._send_typing_indicator = AsyncMock()
        try:
            manager = gateway._require_channel_manager()
            await manager.add_channel(channel)
            for content in ("work", "/status"):
                manager.enqueue(
                    channel.channel_id,
                    {
                        "t": "C2C_MESSAGE_CREATE",
                        "d": {
                            "id": content,
                            "content": content,
                            "author": {"user_openid": "member"},
                        },
                    },
                )
                if content == "work":
                    await asyncio.wait_for(started.wait(), 1)
            await asyncio.wait_for(status_seen.wait(), 1)
            assert not release.is_set()
        finally:
            release.set()
            await gateway.shutdown()
            await registry.shutdown()


@pytest.mark.asyncio
async def test_create_channel_updates_existing_same_kind(tmp_path: Path) -> None:
    services = _make_services(tmp_path)
    agent_id, user_id = _seed_agent(services, tmp_path)
    registry = AgentManager(
        repos=services.repos,
        paths=services.paths,
        config=services.config,
    )
    gw = Gateway(agent_manager=registry, repos=services.repos)
    gw._channel_manager = MagicMock()
    gw._channel_manager.add_channel = AsyncMock()
    gw._channel_manager.remove_channel = AsyncMock()
    gw._channel_manager.get_channel = MagicMock(return_value=MagicMock())
    gw._processor = MagicMock()

    first_id = new_ulid()
    first = await gw.create_channel(
        ChannelCreateSpec(
            channel_id=first_id,
            agent_id=agent_id,
            user_id=user_id,
            kind="weixin",
            name="weixin",
            config={"token": "old"},
        )
    )
    second_id = new_ulid()
    second = await gw.create_channel(
        ChannelCreateSpec(
            channel_id=second_id,
            agent_id=agent_id,
            user_id=user_id,
            kind="weixin",
            name="weixin",
            config={"token": "new"},
        )
    )
    assert second.channel_id == first.channel_id
    assert json.loads(second.config_json)["token"] == "new"
    assert gw._repos.channel_repo.get(second_id) is None


@pytest.mark.asyncio
async def test_create_channel_rejects_name_taken_by_other_kind(tmp_path: Path) -> None:
    services = _make_services(tmp_path)
    agent_id, user_id = _seed_agent(services, tmp_path)
    registry = AgentManager(
        repos=services.repos,
        paths=services.paths,
        config=services.config,
    )
    gw = Gateway(agent_manager=registry, repos=services.repos)
    gw._channel_manager = MagicMock()
    gw._channel_manager.add_channel = AsyncMock()
    gw._channel_manager.remove_channel = AsyncMock()
    gw._channel_manager.get_channel = MagicMock(return_value=MagicMock())
    gw._processor = MagicMock()

    await gw.create_channel(
        ChannelCreateSpec(
            channel_id=new_ulid(),
            agent_id=agent_id,
            user_id=user_id,
            kind="feishu",
            name="shared",
            config={},
        )
    )
    with pytest.raises(OctopError) as exc:
        await gw.create_channel(
            ChannelCreateSpec(
                channel_id=new_ulid(),
                agent_id=agent_id,
                user_id=user_id,
                kind="weixin",
                name="shared",
                config={},
            )
        )
    assert exc.value.code is ErrorCode.CHANNEL_NAME_TAKEN
