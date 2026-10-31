from types import SimpleNamespace

from octop_gateway import channel as gateway_channel
from octop_gateway.channel import BaseChannel, InboundReceipt

from octop.infra.gateway.process import channel_thinking


def test_channel_cleaner_uses_dispatch_thinking_visibility(monkeypatch):
    monkeypatch.setattr(BaseChannel, "_clean_output", BaseChannel._clean_output)
    monkeypatch.setattr(channel_thinking, "_PATCHED", False)
    channel_thinking.install_channel_thinking_clean()
    constraints = SimpleNamespace(show_thinking=True, thinking_template="Thinking: {content}")
    channel = SimpleNamespace(constraints=constraints, _constraints=constraints)
    channel.should_show_thinking = lambda: BaseChannel.should_show_thinking(channel)

    token = gateway_channel._inbound_receipt.set(InboundReceipt(suppress_thinking=True))
    try:
        assert BaseChannel._clean_output(channel, "<think>private</think>visible") == "visible"
    finally:
        gateway_channel._inbound_receipt.reset(token)
    assert "private" in BaseChannel._clean_output(channel, "<think>private</think>visible")
