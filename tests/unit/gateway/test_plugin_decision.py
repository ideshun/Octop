"""Optional decision-model access for inbound plugins."""

from types import SimpleNamespace

import pytest
from octop_harness.decision.client import HttpDecisionClient
from octop_harness.decision.config import DecisionConfig
from octop_harness.plugins.registry import PluginRegistry

from octop.infra.gateway.gateway import Gateway


@pytest.mark.asyncio
async def test_inbound_plugin_uses_current_decision_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    class Handler:
        provider = None

        def bind_decision_scorer(self, provider):
            self.provider = provider

        async def handle(self, channel, message, dispatch):
            return False

    handler = Handler()
    monkeypatch.setattr(PluginRegistry, "all_inbound", lambda _: [handler])
    store = SimpleNamespace(harness_config=lambda: None)
    gateway = Gateway.__new__(Gateway)
    gateway._agent_manager = SimpleNamespace(decision=store)
    assert await gateway._plugin_inbound(None, None, None) is False
    assert await handler.provider() is None

    store.harness_config = lambda: DecisionConfig(enabled=True, provider="custom", endpoint="https://example.test")

    async def fake_score(self, **kwargs):
        return {"participate": 0.9}

    monkeypatch.setattr(HttpDecisionClient, "score_async", fake_score)
    scorer = await handler.provider()
    assert await scorer(state="test", statements=[("participate", "test")]) == {"participate": 0.9}
