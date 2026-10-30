"""Plugin settings API is admin-only and saves only known QQ groups."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_channel_plugin_settings_visible_to_authenticated_channel_user(env_admin_alice):
    client, _server, _admin, alice = env_admin_alice
    settings = [{"plugin_id": "social", "name": "custom_switch"}]
    with patch("octop.infra.gateway.plugin_channels.plugin_channel_settings", return_value=settings):
        response = await client.get("/api/channels/plugin-settings", headers=alice)
    assert response.status_code == 200
    assert response.json() == settings


@pytest.mark.asyncio
async def test_social_trigger_settings_permissions_and_save(env_admin_alice):
    client, _server, admin, alice = env_admin_alice
    handler = SimpleNamespace(
        config={"enabled": True, "dryRun": True, "timezone": "Asia/Shanghai"},
        settings_for=lambda *_: {"policy": {"mode": "smart"}, "allowed": True},
        recent=[],
        update_settings=AsyncMock(),
        bind_decision_scorer=lambda _: None,
    )
    group = {"channelId": "channel", "groupId": "group", "agentId": "agent", "ready": True}
    payload = {
        "enabled": True, "dryRun": True, "channelId": "channel", "groupId": "group",
        "mode": "probability", "replyProbability": 0.2, "cooldownSeconds": 120, "decisionModelEnabled": False,
        "maxPassiveRepliesPerHour": 3, "maxPassiveRepliesPerDay": 10,
        "randomDelayMinMs": 1000, "randomDelayMaxMs": 3000,
        "smartScoreThreshold": 0.7, "maxConsecutiveReplies": 2, "maxBotReplyRatio": 0.5,
        "debounceMs": 1500, "contextMessages": 20, "contextTtlSeconds": 600,
        "mentionBypassCooldown": True, "quietHours": {"enabled": False, "start": "23:00", "end": "08:00"},
    }
    with patch("octop.api.routers.plugins._social_trigger", return_value=handler), patch(
        "octop.api.routers.plugins._social_trigger_groups", side_effect=lambda _: [dict(group)]
    ):
        assert (await client.get("/api/plugins/social-trigger/settings", headers=alice)).status_code == 403
        assert (await client.put("/api/plugins/social-trigger/settings", headers=alice, json=payload)).status_code == 403
        response = await client.get("/api/plugins/social-trigger/settings", headers=admin)
        assert response.status_code == 200
        assert response.json()["groups"][0]["settings"]["policy"]["mode"] == "smart"
        assert response.json()["decisionModelSupported"] is True
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json=payload)
        assert response.status_code == 200, response.text
        handler.update_settings.assert_awaited_once()
        assert handler.update_settings.await_args.kwargs["policy"]["replyProbability"] == 0.2
        assert handler.update_settings.await_args.kwargs["policy"]["decisionModelEnabled"] is False
        old_client_payload = {key: value for key, value in payload.items() if key != "decisionModelEnabled"}
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json=old_client_payload)
        assert response.status_code == 200
        assert "decisionModelEnabled" not in handler.update_settings.await_args.kwargs["policy"]
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json={**payload, "groupId": "unknown"})
        assert response.status_code == 404
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json={**payload, "replyProbability": 2})
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_social_trigger_settings_can_be_saved_when_channel_is_disabled(env_admin_alice):
    client, _server, admin, _alice = env_admin_alice
    handler = SimpleNamespace(update_settings=AsyncMock())
    group = {"channelId": "channel", "groupId": "group", "agentId": "agent", "ready": False}
    payload = {
        "enabled": True, "dryRun": True, "channelId": "channel", "groupId": "group",
        "mode": "probability", "replyProbability": 0.2, "cooldownSeconds": 120, "decisionModelEnabled": True,
        "maxPassiveRepliesPerHour": 3, "maxPassiveRepliesPerDay": 10,
        "randomDelayMinMs": 1000, "randomDelayMaxMs": 3000,
        "smartScoreThreshold": 0.7, "maxConsecutiveReplies": 2, "maxBotReplyRatio": 0.5,
        "debounceMs": 1500, "contextMessages": 20, "contextTtlSeconds": 600,
        "mentionBypassCooldown": True, "quietHours": {"enabled": False, "start": "23:00", "end": "08:00"},
    }
    with patch("octop.api.routers.plugins._social_trigger", return_value=handler), patch(
        "octop.api.routers.plugins._social_trigger_groups", return_value=[group]
    ):
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json=payload)
        assert response.status_code == 200, response.text
        handler.update_settings.assert_awaited_once()
        assert "decisionModelEnabled" not in handler.update_settings.await_args.kwargs["policy"]

        handler.update_settings.side_effect = ValueError("具体的配置错误")
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json=payload)
        assert response.status_code == 400
        assert response.json()["detail"] == "具体的配置错误"


def test_social_trigger_groups_distinguishes_disabled_channel_and_group_policy():
    from octop.api.routers.plugins import _social_trigger_groups

    channel = SimpleNamespace(
        kind="qq", channel_id="channel", agent_id="main", name="QQ", enabled=False,
        config_json='{"group_context":{"enabled":true,"visibility":"all"}}',
    )
    session = SimpleNamespace(
        channel_type="qq", channel_chat_type="group", channel_id="channel",
        channel_subject_id="group", updated_at=1,
    )
    repos = SimpleNamespace(
        channel_repo=SimpleNamespace(list_all=lambda: [channel]),
        session_repo=SimpleNamespace(list_by_agent=lambda *_args, **_kwargs: [session]),
    )
    groups = _social_trigger_groups(SimpleNamespace(services=SimpleNamespace(repos=repos)))
    assert len(groups) == 1
    assert groups[0]["ready"] is False
    assert groups[0]["channelEnabled"] is False
    assert groups[0]["groupPolicyEnabled"] is True
    assert groups[0]["groupVisibility"] == "all"
