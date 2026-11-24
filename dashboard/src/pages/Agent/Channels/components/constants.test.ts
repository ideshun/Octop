import { describe, expect, it } from "vitest";

import {
  applyQqChannelSaveConfig,
  DEFAULT_QQ_GROUP_CONTEXT_CONFIG,
  normalizeQqGroupContextConfig,
  partitionChannelKeys,
  CHANNEL_KEYS,
  CHANNEL_FIELDS,
  hasRequiredCredentials,
  normalizeChannelFieldValue,
  replacePluginChannelKinds,
  CHANNEL_LABELS,
} from "./constants";

describe("Discord configuration", () => {
  it("exposes Discord directly within the 16-channel limit and keeps configured bots visible when overflowing", () => {
    expect(CHANNEL_KEYS).toContain("discord");
    expect(partitionChannelKeys(["discord"], new Set())).toEqual({
      featured: ["discord"],
      more: [],
    });
    expect(
      partitionChannelKeys(["weixin", "qq", "discord"], new Set(["discord"]), 2)
        .featured,
    ).toContain("discord");
    expect(
      CHANNEL_FIELDS.discord?.find((f) => f.name === "bot_token"),
    ).toMatchObject({ required: true, type: "password" });
    expect(
      CHANNEL_FIELDS.discord?.find((f) => f.name === "http_proxy_auth"),
    ).toMatchObject({ type: "password" });
  });

  it("preserves snowflake IDs exactly and validates user input", () => {
    expect(
      normalizeChannelFieldValue(
        "allowed_channel_ids",
        "1234567890123456789, 2345678901234567890\n1234567890123456789",
      ),
    ).toEqual(["1234567890123456789", "2345678901234567890"]);
    expect(normalizeChannelFieldValue("allowed_user_ids", "")).toEqual([]);
    expect(normalizeChannelFieldValue("allowed_user_ids", ["123"])).toEqual([
      "123",
    ]);
    expect(() =>
      normalizeChannelFieldValue("allowed_channel_ids", "#general"),
    ).toThrow();
  });
});

describe("partitionChannelKeys", () => {
  it("shows all channels when count is at most 16, and folds overflow beyond 16", () => {
    expect(partitionChannelKeys(CHANNEL_KEYS, new Set())).toEqual({
      featured: [...CHANNEL_KEYS],
      more: [],
    });
    const seventeen = [
      ...CHANNEL_KEYS,
      "octo",
      "plugin1",
      "plugin2",
      "plugin3",
      "plugin4",
    ] as (typeof CHANNEL_KEYS)[number][];
    const split = partitionChannelKeys(seventeen, new Set());
    expect(split.featured).toHaveLength(16);
    expect(split.featured).toContain("octo");
    expect(split.more).toEqual(["whatsapp"]);

    const withConfigured = partitionChannelKeys(
      seventeen,
      new Set(["whatsapp"]),
    );
    expect(withConfigured.featured).toContain("whatsapp");
    expect(withConfigured.featured).toHaveLength(16);
    expect(withConfigured.more).toEqual(["slack"]);
  });
});

describe("applyQqChannelSaveConfig", () => {
  it("only rewrites QQ delivery keys", () => {
    const weixin = { response_mode: "invoke", show_progress: true };
    applyQqChannelSaveConfig(weixin, "weixin");
    expect(weixin).toEqual({ response_mode: "invoke", show_progress: true });

    const qq = { streaming: false, show_progress: true, token: "t" };
    applyQqChannelSaveConfig(qq, "qq");
    expect(qq).toEqual({ token: "t", c2c_streaming: true });
  });
});

describe("normalizeQqGroupContextConfig", () => {
  it("uses safe QQ group defaults for missing config", () => {
    expect(normalizeQqGroupContextConfig(undefined)).toEqual(
      DEFAULT_QQ_GROUP_CONTEXT_CONFIG,
    );
  });

  it("accepts JSON values left by older channel form drafts", () => {
    expect(
      normalizeQqGroupContextConfig(
        '{"enabled":true,"visibility":"mention_recent","history_limit":20}',
      ),
    ).toMatchObject({
      enabled: true,
      visibility: "mention_recent",
      activation: "mention",
      history: "recent",
      history_limit: 20,
    });
  });

  it("protects legacy group configs and preserves explicit opt-out", () => {
    expect(normalizeQqGroupContextConfig({ enabled: false })).toMatchObject({
      enabled: false,
      owner_commands_only: true,
      owner_tools_only: false,
      owner_ids: [],
    });
    expect(
      normalizeQqGroupContextConfig({ owner_commands_only: false }),
    ).toMatchObject({ owner_commands_only: false });
    expect(
      normalizeQqGroupContextConfig({ owner_tools_only: true }),
    ).toMatchObject({ owner_tools_only: true });
    expect(
      normalizeQqGroupContextConfig({ owner_tools_only: false }),
    ).toMatchObject({ owner_tools_only: false });
  });

  it("normalizes owner IDs without losing per-group authorization overrides", () => {
    const groups = { "group-1": { owner_ids: ["group-owner"] } };
    expect(
      normalizeQqGroupContextConfig({
        owner_ids: [" owner-1 ", "owner-2", "owner-1", "", 123],
        groups,
      }),
    ).toMatchObject({ owner_ids: ["owner-1", "owner-2"], groups });
    expect(
      normalizeQqGroupContextConfig({ owner_ids: "owner-1, owner-2\nowner-1" }),
    ).toMatchObject({ owner_ids: ["owner-1", "owner-2"] });
  });

  it("forces mention-only visibility to discard passive history", () => {
    expect(
      normalizeQqGroupContextConfig({
        visibility: "mention_only",
        activation: "always",
        history: "recent",
      }),
    ).toMatchObject({
      visibility: "mention_only",
      activation: "mention",
      history: "none",
    });
  });

  it("keeps active replies and per-group overrides with full visibility", () => {
    const groups = {
      "group-1": { activation: "mention", history_limit: 5 },
    };
    expect(
      normalizeQqGroupContextConfig({
        visibility: "all",
        activation: "always",
        history: "recent",
        history_limit: 25,
        groups,
      }),
    ).toMatchObject({
      visibility: "all",
      activation: "always",
      history_limit: 25,
      groups,
    });
  });
});

describe("Telegram configuration", () => {
  it("exposes typed activation and streaming choices with Gateway defaults", () => {
    const fields = CHANNEL_FIELDS.telegram!;
    expect(fields.find((f) => f.name === "group_activation")).toMatchObject({
      type: "select",
      options: ["always", "mention", "mention_or_reply"],
      defaultValue: "always",
      legacyDefaultValue: "always",
    });
    expect(fields.find((f) => f.name === "topic_isolation")).toMatchObject({
      type: "switch",
      defaultValue: false,
      legacyDefaultValue: false,
    });
    expect(fields.find((f) => f.name === "edited_messages")?.defaultValue).toBe(
      false,
    );
    expect(fields.find((f) => f.name === "streaming_mode")?.options).toEqual([
      "off",
      "auto",
      "edit",
      "draft",
    ]);
  });

  it("serializes signed chat IDs as exact strings without weakening user ID validation", () => {
    expect(
      normalizeChannelFieldValue(
        "allowed_chat_ids",
        "-1001234567890123456,42 -1001234567890123456",
      ),
    ).toEqual(["-1001234567890123456", "42"]);
    expect(normalizeChannelFieldValue("allowed_chat_ids", "")).toEqual([]);
    expect(
      normalizeChannelFieldValue("allowed_chat_ids", [-100123, "42"]),
    ).toEqual(["-100123", "42"]);
    for (const invalid of ["@group", "1.2", "-", "1e3"]) {
      expect(() =>
        normalizeChannelFieldValue("allowed_chat_ids", invalid),
      ).toThrow();
    }
    expect(() =>
      normalizeChannelFieldValue("allowed_user_ids", "-42"),
    ).toThrow();
  });
});

describe("Slack and WhatsApp configuration", () => {
  it("includes Slack and dual-mode WhatsApp in catalogue and validates credentials", () => {
    expect(CHANNEL_KEYS).toContain("slack");
    expect(CHANNEL_KEYS).toContain("whatsapp");
    expect(
      partitionChannelKeys(["slack", "whatsapp"], new Set()).featured,
    ).toEqual(["slack", "whatsapp"]);
    expect(hasRequiredCredentials("slack", { bot_token: "xoxb-123" })).toBe(
      true,
    );
    expect(hasRequiredCredentials("slack", {})).toBe(false);
    expect(
      hasRequiredCredentials("whatsapp", {
        provider: "cloud",
        access_token: "EAAB",
        phone_number_id: "123",
      }),
    ).toBe(true);
    expect(
      hasRequiredCredentials("whatsapp", {
        provider: "waha",
        bridge_url: "http://127.0.0.1:3000",
      }),
    ).toBe(true);

    const slackFields = CHANNEL_FIELDS.slack!;
    expect(slackFields.find((f) => f.name === "reply_broadcast")).toMatchObject(
      {
        type: "select",
        options: ["off", "first", "all"],
        optionLabelPrefix: "channels.slackReplyBroadcastOption_",
        defaultValue: "first",
        legacyDefaultValue: "first",
      },
    );
    expect(
      slackFields.find((f) => f.name === "thread_follow_up"),
    ).toMatchObject({
      type: "switch",
      defaultValue: true,
      legacyDefaultValue: true,
    });
    expect(
      slackFields.find((f) => f.name === "fetch_thread_context"),
    ).toMatchObject({
      type: "switch",
      defaultValue: true,
      legacyDefaultValue: true,
    });
    expect(hasRequiredCredentials("whatsapp", { provider: "waha" })).toBe(
      false,
    );
    expect(normalizeQqGroupContextConfig(undefined, "qq")).toMatchObject({
      visibility: "auto",
      owner_commands_only: true,
    });
    expect(normalizeQqGroupContextConfig(undefined, "slack")).toMatchObject({
      visibility: "all",
      owner_commands_only: false,
    });
    expect(normalizeQqGroupContextConfig(undefined, "feishu")).toMatchObject({
      visibility: "all",
      owner_commands_only: false,
    });
  });
});

describe("plugin channel catalogue reconciliation", () => {
  it("replaces metadata, removes disabled kinds and preserves builtins", () => {
    const entry = {
      kind: "acme",
      label: "Acme",
      icon: "",
      intro_url: "",
      plugin_id: "owner",
    };
    try {
      replacePluginChannelKinds([entry]);
      expect(CHANNEL_KEYS).toContain("acme");
      replacePluginChannelKinds([{ ...entry, label: "Updated" }]);
      expect((CHANNEL_LABELS as Record<string, string>).acme).toBe("Updated");
      replacePluginChannelKinds([]);
      expect(CHANNEL_KEYS).not.toContain("acme");
      expect(CHANNEL_KEYS).toContain("telegram");
    } finally {
      replacePluginChannelKinds([]);
    }
  });
});
