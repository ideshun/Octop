"""Plugin settings API is admin-only and saves only known QQ groups."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_social_trigger_settings_permissions_and_save(env_admin_alice):
    client, _server, admin, alice = env_admin_alice
    handler = SimpleNamespace(
        config={"enabled": True, "dryRun": True, "timezone": "Asia/Shanghai"},
        settings_for=lambda *_: {"policy": {"mode": "smart"}, "allowed": True},
        recent=[],
        update_settings=AsyncMock(),
    )
    group = {"channelId": "channel", "groupId": "group", "agentId": "agent", "ready": True}
    payload = {
        "enabled": True, "dryRun": True, "channelId": "channel", "groupId": "group",
        "mode": "probability", "replyProbability": 0.2, "cooldownSeconds": 120,
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
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json=payload)
        assert response.status_code == 200, response.text
        handler.update_settings.assert_awaited_once()
        assert handler.update_settings.await_args.kwargs["policy"]["replyProbability"] == 0.2
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json={**payload, "groupId": "unknown"})
        assert response.status_code == 404
        response = await client.put("/api/plugins/social-trigger/settings", headers=admin, json={**payload, "replyProbability": 2})
        assert response.status_code == 422
