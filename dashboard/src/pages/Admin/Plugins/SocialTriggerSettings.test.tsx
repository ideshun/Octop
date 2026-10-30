import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SocialTriggerPolicy,
  SocialTriggerSettings,
} from "../../../api/modules/plugins";

vi.mock("../../../api/modules/plugins", () => ({
  pluginsApi: {
    getSocialTriggerSettings: vi.fn(),
    saveSocialTriggerSettings: vi.fn(),
  },
}));
vi.mock("@/utils/antdMessage", () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", async () => {
  const { default: locale } = await import("../../../locales/zh.json");
  return {
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        const value = key
          .split(".")
          .reduce<unknown>(
            (obj, part) =>
              obj && typeof obj === "object"
                ? (obj as Record<string, unknown>)[part]
                : undefined,
            locale,
          );
        return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
          String(values?.[name] ?? name),
        );
      },
      i18n: { resolvedLanguage: "zh" },
    }),
  };
});
import { pluginsApi } from "../../../api/modules/plugins";
import { SocialTriggerSettingsPanel } from "./SocialTriggerSettings";

const policy: SocialTriggerPolicy = {
  mode: "smart",
  replyProbability: 0.25,
  smartScoreThreshold: 0.7,
  decisionModelEnabled: true,
  decisionModelTimeoutMs: 1800,
  decisionModelMaxCallsPerDay: 100,
  cooldownSeconds: 180,
  maxPassiveRepliesPerHour: 58,
  maxPassiveRepliesPerDay: 580,
  maxConsecutiveReplies: 2,
  maxBotReplyRatio: 0.5,
  randomDelayMinMs: 1000,
  randomDelayMaxMs: 3000,
  debounceMs: 1500,
  contextMessages: 20,
  contextTtlSeconds: 600,
  mentionBypassCooldown: true,
  quietHours: { enabled: false, start: "23:00", end: "08:00" },
};
const inherited = {
  policy,
  inheritedPolicy: policy,
  overrides: {},
  allowed: true,
  policySource: { mode: "defaults" },
};
const group = {
  channelKind: "qq",
  channelId: "c1",
  groupId: "same",
  groupName: "测试群",
  agentId: "expert",
  channelName: "QQ机器人",
  updatedAt: 1,
  ready: true,
  channelEnabled: true,
  groupPolicyEnabled: true,
  groupVisibility: "all",
  channelParticipationEnabled: true,
  hostActivation: "mention",
  settings: inherited,
  agentSettings: inherited,
};
const settings: SocialTriggerSettings = {
  enabled: true,
  dryRun: true,
  timezone: "Asia/Shanghai",
  decisionModelSupported: true,
  decisionModelConfigured: false,
  recent: null,
  defaults: inherited,
  channels: [{ ...group }],
  channelTypes: [{ channelKind: "qq", settings: inherited }],
  groups: [group],
};

async function select(label: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(
    await screen.findByText(option, {
      selector: ".ant-select-item-option-content",
    }),
  );
}

describe("跨通道群聊设置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue(settings);
    vi.mocked(pluginsApi.saveSocialTriggerSettings).mockResolvedValue({
      status: "ok",
    });
  });
  it("保存全局默认后重新打开仍显示全局默认及其值", async () => {
    const saved = { ...policy, replyProbability: 0.58 };
    const view = render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    await select("配置范围", "全局默认");
    const probability = screen.getByLabelText(/^参与概率/);
    await userEvent.clear(probability);
    await userEvent.type(probability, "58");
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      defaults: { ...inherited, policy: saved },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "defaults", replyProbability: 0.58 }),
      ),
    );
    view.unmount();
    render(<SocialTriggerSettingsPanel />);
    const restored = await screen.findByLabelText(/^参与概率/);
    expect(screen.getByText("全局默认")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "选择群聊" }),
    ).not.toBeInTheDocument();
    expect(Number((restored as HTMLInputElement).value)).toBe(58);
  });
  it("按所选群保存百分比并保留折叠的高级值", async () => {
    render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    await select("配置范围", "单个群聊");
    const probability = await screen.findByLabelText(/^参与概率/);
    expect(Number((probability as HTMLInputElement).value)).toBe(25);
    await userEvent.clear(probability);
    await userEvent.type(probability, "40");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "groups",
          channelKind: "qq",
          channelId: "c1",
          groupId: "same",
          replyProbability: 0.4,
          randomDelayMinMs: 1000,
          dryRun: true,
        }),
      ),
    );
  });
  it("决策模型开关与静默时段按依赖展开", async () => {
    render(<SocialTriggerSettingsPanel />);
    const toggle = await screen.findByLabelText(/^使用 Octop 决策模型/);
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText(/^决策等待上限/)).toBeInTheDocument();
    expect(screen.queryByLabelText("静默开始")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByLabelText(/^决策等待上限/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("开启静默时段"));
    expect(screen.getByLabelText("静默开始")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionModelEnabled: false,
          decisionModelTimeoutMs: 1800,
          quietHours: { enabled: true, start: "23:00", end: "08:00" },
        }),
      ),
    );
  });
  it("相同群 ID 按通道和机器人隔离", async () => {
    const octo = {
      ...group,
      channelKind: "octo",
      channelId: "c2",
      channelName: "Octo机器人",
      groupName: "另一个群",
    };
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      channels: [...settings.channels, octo],
      groups: [group, octo],
      channelTypes: [
        ...settings.channelTypes,
        { channelKind: "octo", settings: inherited },
      ],
    });
    render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    await select("配置范围", "单个群聊");
    await select("通道类型", "Octo");
    expect(screen.getByText("Octo机器人")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          channelKind: "octo",
          channelId: "c2",
          groupId: "same",
        }),
      ),
    );
  });
  it("没有群时仍能配置默认值，按每条参与时隐藏无效选项", async () => {
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      groups: [],
      defaults: { ...inherited, policy: { ...policy, mode: "always" } },
    });
    render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    expect(screen.queryByLabelText(/^参与概率/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^使用 Octop 决策模型/),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "defaults",
          mode: "always",
          replyProbability: 0.25,
        }),
      ),
    );
  });
  it("所选通道还没有群时仍能保存插件总开关", async () => {
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      channels: [
        ...settings.channels,
        { ...group, channelKind: "octo", channelId: "empty" },
      ],
      channelTypes: [
        ...settings.channelTypes,
        { channelKind: "octo", settings: inherited },
      ],
    });
    render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    await select("配置范围", "单个群聊");
    await select("通道类型", "Octo");
    expect(screen.getByLabelText("参与群聊")).toBeChecked();
    await userEvent.click(screen.getByLabelText("参与群聊"));
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "defaults", enabled: false }),
      ),
    );
  });
  it("恢复继承只重置当前范围", async () => {
    vi.mocked(pluginsApi.getSocialTriggerSettings).mockResolvedValue({
      ...settings,
      groups: [
        {
          ...group,
          settings: { ...inherited, overrides: { cooldownSeconds: 60 } },
        },
      ],
    });
    render(<SocialTriggerSettingsPanel />);
    await screen.findByText("群聊参与设置");
    await select("配置范围", "单个群聊");
    await userEvent.click(
      await screen.findByRole("button", { name: "恢复继承" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(pluginsApi.saveSocialTriggerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "groups",
          reset: true,
          channelId: "c1",
        }),
      ),
    );
    const request = vi.mocked(pluginsApi.saveSocialTriggerSettings).mock
      .calls[0][0];
    expect(request).not.toHaveProperty("enabled");
    expect(request).not.toHaveProperty("dryRun");
  });
});
