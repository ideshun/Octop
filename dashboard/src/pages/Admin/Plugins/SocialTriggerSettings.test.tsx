import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/modules/plugins", () => ({
  pluginsApi: {
    getSocialTriggerSettings: vi.fn(),
    saveSocialTriggerSettings: vi.fn(),
  },
}));
vi.mock("@/utils/antdMessage", () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));

import { pluginsApi } from "../../../api/modules/plugins";
import { SocialTriggerSettingsPanel } from "./SocialTriggerSettings";

const settings = {
  enabled: true,
  dryRun: true,
  timezone: "Asia/Shanghai",
  recent: null,
  groups: [
    {
      channelId: "c1",
      groupId: "test-group",
      agentId: "main",
      channelName: "QQ",
      updatedAt: 1,
      ready: true,
      channelEnabled: true,
      groupPolicyEnabled: true,
      groupVisibility: "all",
      channelParticipationEnabled: true,
      hostActivation: "mention",
      settings: {
        allowed: true,
        policySource: { mode: "defaults" },
        policy: {
          mode: "probability" as const,
          replyProbability: 0.25,
          smartScoreThreshold: 0.7,
          cooldownSeconds: 180,
          maxPassiveRepliesPerHour: 3,
          maxPassiveRepliesPerDay: 10,
          maxConsecutiveReplies: 2,
          maxBotReplyRatio: 0.5,
          randomDelayMinMs: 1000,
          randomDelayMaxMs: 3000,
          debounceMs: 1500,
          contextMessages: 20,
          contextTtlSeconds: 600,
          mentionBypassCooldown: true,
          quietHours: { enabled: false, start: "23:00", end: "08:00" },
        },
      },
    },
  ],
};

describe("QQ 群聊设置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue(settings);
    vi.mocked(pluginsApi.saveSocialTriggerSettings).mockResolvedValue({
      status: "ok",
    });
  });

  it("显示已有设置并将更改保存到所选群", async () => {
    render(<SocialTriggerSettingsPanel />);
    expect(await screen.findByText("群聊参与设置")).toBeInTheDocument();
    const probability = screen.getByLabelText("参与概率（%）");
    expect(probability).toHaveValue("25");
    await userEvent.clear(probability);
    await userEvent.type(probability, "40");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: "c1",
          groupId: "test-group",
          replyProbability: 0.4,
          dryRun: true,
        }),
      ),
    );
  });

  it("通道关闭时说明原因，仍可保存设置", async () => {
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      groups: [{ ...settings.groups[0], ready: false, channelEnabled: false }],
    });
    render(<SocialTriggerSettingsPanel />);
    expect(await screen.findByText("QQ 通道未启用。设置可以保存，启用通道后才会接收消息。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledOnce());
  });

  it("按每条消息参与时仍保留不适用的概率设置", async () => {
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      groups: [
        {
          ...settings.groups[0],
          settings: {
            ...settings.groups[0].settings,
            policy: { ...settings.groups[0].settings.policy, mode: "always" },
          },
        },
      ],
    });
    render(<SocialTriggerSettingsPanel />);
    expect(await screen.findByLabelText("参与概率（%）")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "always", replyProbability: 0.25 }),
      ),
    );
  });
});
