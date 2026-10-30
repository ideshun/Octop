import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
} from "antd";
import { message } from "@/utils/antdMessage";
import {
  pluginsApi,
  type SocialTriggerGroup,
  type SocialTriggerSettings,
} from "../../../api/modules/plugins";

type FormValues = {
  enabled: boolean;
  dryRun: boolean;
  mode: "disabled" | "mention_only" | "smart" | "probability" | "always";
  replyPercent: number;
  smartPercent: number;
  decisionModelEnabled: boolean;
  cooldownSeconds: number;
  maxPassiveRepliesPerHour: number;
  maxPassiveRepliesPerDay: number;
  maxConsecutiveReplies: number;
  botRatioPercent: number;
  delayMin: number;
  delayMax: number;
  debounceMs: number;
  contextMessages: number;
  contextTtlSeconds: number;
  mentionBypassCooldown: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
};

const groupKey = (group: SocialTriggerGroup) =>
  JSON.stringify([group.channelId, group.groupId]);
const reasonText: Record<string, string> = {
  dry_run_would_trigger: "试运行：符合条件，本次没有发送",
  eligible: "符合条件，准备回复",
  reply_sent: "已发送回复",
  probability: "概率抽样未命中",
  score_below_threshold: "聊天内容相关度不足",
  hourly_limit: "已达到每小时回复上限",
  daily_limit: "已达到每天回复上限",
  quiet_hours: "当前处于静默时段",
  mention_only: "当前只响应 @",
  permission_downgraded: "群消息可见权限不足",
  sender_identity_unknown: "无法确认发送者身份",
  bot_message: "发送者是机器人",
  group_not_allowed: "群不在允许范围内",
  duplicate: "重复消息",
  reply_pending: "上一条回复结果尚未确认",
  cooldown: "尚未超过回复间隔",
  bot_reply_ratio: "机器人发言占比已达上限",
  consecutive_limit: "已达到连续回复上限",
  decision_model_unavailable: "决策模型不可用，已切换到本地规则",
  decision_model_budget: "决策模型调用已达上限，已切换到本地规则",
  reply_cancelled: "待发送的回复已取消",
  delivery_unknown: "发送结果不明确，需检查日志",
};
const sourceText: Record<string, string> = {
  defaults: "全局默认",
  channelTypes: "通道类型",
  channelInstances: "通道",
  groups: "群",
  groupAgents: "群内专家",
};

export function SocialTriggerSettingsPanel() {
  const [form] = Form.useForm<FormValues>();
  const [data, setData] = useState<SocialTriggerSettings | null>(null);
  const [group, setGroup] = useState<SocialTriggerGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mode = Form.useWatch("mode", form);
  const dryRun = Form.useWatch("dryRun", form);

  const choose = (item: SocialTriggerGroup) => {
    setGroup(item);
    const policy = item.settings.policy;
    form.setFieldsValue({
      mode: policy.mode,
      replyPercent: Math.round(policy.replyProbability * 10000) / 100,
      smartPercent: Math.round(policy.smartScoreThreshold * 10000) / 100,
      decisionModelEnabled: policy.decisionModelEnabled ?? true,
      cooldownSeconds: policy.cooldownSeconds,
      maxPassiveRepliesPerHour: policy.maxPassiveRepliesPerHour,
      maxPassiveRepliesPerDay: policy.maxPassiveRepliesPerDay,
      maxConsecutiveReplies: policy.maxConsecutiveReplies,
      botRatioPercent: Math.round(policy.maxBotReplyRatio * 10000) / 100,
      delayMin: policy.randomDelayMinMs / 1000,
      delayMax: policy.randomDelayMaxMs / 1000,
      debounceMs: policy.debounceMs,
      contextMessages: policy.contextMessages,
      contextTtlSeconds: policy.contextTtlSeconds,
      mentionBypassCooldown: policy.mentionBypassCooldown,
      quietHours: policy.quietHours,
    });
  };

  useEffect(() => {
    let active = true;
    pluginsApi
      .getSocialTriggerSettings()
      .then((result) => {
        if (!active) return;
        setData(result);
        form.setFieldsValue({ enabled: result.enabled, dryRun: result.dryRun });
        if (result.groups[0]) choose(result.groups[0]);
      })
      .catch(() => {
        if (active)
          setError(
            "无法读取设置，请确认插件已启用并加载。\n如果刚安装插件，请重启 Octop 后重试。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The form instance remains stable for this drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const save = async (values: FormValues) => {
    if (!group) return;
    if (values.delayMin > values.delayMax) {
      message.error("最短等待时间不能大于最长等待时间");
      return;
    }
    setSaving(true);
    try {
      await pluginsApi.saveSocialTriggerSettings({
        enabled: values.enabled,
        dryRun: values.dryRun,
        channelId: group.channelId,
        groupId: group.groupId,
        mode: values.mode,
        replyProbability: values.replyPercent / 100,
        smartScoreThreshold: values.smartPercent / 100,
        ...(data?.decisionModelSupported ? { decisionModelEnabled: values.decisionModelEnabled } : {}),
        cooldownSeconds: values.cooldownSeconds,
        maxPassiveRepliesPerHour: values.maxPassiveRepliesPerHour,
        maxPassiveRepliesPerDay: values.maxPassiveRepliesPerDay,
        maxConsecutiveReplies: values.maxConsecutiveReplies,
        maxBotReplyRatio: values.botRatioPercent / 100,
        randomDelayMinMs: Math.round(values.delayMin * 1000),
        randomDelayMaxMs: Math.round(values.delayMax * 1000),
        debounceMs: values.debounceMs,
        contextMessages: values.contextMessages,
        contextTtlSeconds: values.contextTtlSeconds,
        mentionBypassCooldown: values.mentionBypassCooldown,
        quietHours: values.quietHours,
      });
      const fresh = await pluginsApi.getSocialTriggerSettings();
      setData(fresh);
      const selected = fresh.groups.find(
        (item) => groupKey(item) === groupKey(group),
      );
      if (selected) choose(selected);
      message.success("设置已保存并生效");
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : "保存失败，请检查群消息权限和填写的数值",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin />;
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data?.groups.length)
    return (
      <Alert
        type="info"
        showIcon
        message="暂无可配置的 QQ 群"
        description="请先在目标群中 @ 机器人，收到回复后再打开此页面。"
      />
    );

  return (
    <section style={{ margin: "20px 0" }}>
      <h4>群聊参与设置</h4>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <div style={{ marginBottom: 8 }}>选择 QQ 群</div>
          <Select
            aria-label="选择 QQ 群"
            style={{ width: "100%" }}
            value={group ? groupKey(group) : undefined}
            options={data.groups.map((item, index) => ({
              value: groupKey(item),
              label: `${
                item.channelName || "QQ 通道"
              } · 群 ${item.groupId.slice(-6)} · ${item.agentId}${
                index === 0 ? "（最近活跃）" : ""
              }`,
            }))}
            onChange={(value) => {
              const selected = data.groups.find(
                (item) => groupKey(item) === value,
              );
              if (selected) choose(selected);
            }}
          />
          <small>
            群列表来自已接收过消息的会话；设置仅作用于所选群和专家。
          </small>
          <div>
            <small>
              普通消息还需要在 QQ 群中授权机器人获取全部群消息，Octop
              无法读取该授权状态。
            </small>
          </div>
        </div>
        {group && !group.channelEnabled && (
          <Alert type="warning" showIcon message="QQ 通道未启用。设置可以保存，启用通道后才会接收消息。" />
        )}
        {group && (!group.groupPolicyEnabled || group.groupVisibility !== "all") && (
          <Alert type="warning" showIcon message="群聊策略未开启或可见范围不是全部消息。设置可以保存，修改通道群聊策略后才能自动参与。" />
        )}
        {group && !group.channelParticipationEnabled && (
          <Alert type="warning" showIcon message="该 QQ 通道已关闭自动参与；在通道的群聊策略中开启后，插件规则才会生效。" />
        )}
        {group?.hostActivation === "always" && (
          <Alert
            type="warning"
            showIcon
            message="Octop 当前设置为每条消息都回复；关闭插件参与后，原有设置仍会生效。建议将该群改为仅 @ 回复。"
          />
        )}
        {group && !group.settings.allowed && (
          <Alert
            type="info"
            showIcon
            message="此群尚未纳入插件范围，保存后会加入。"
          />
        )}
        {data.recent && (
          <Alert
            type="info"
            showIcon
            message={`最近一次插件决策（所有群）：${
              reasonText[data.recent.reasonCode] || "其他状态，请查看日志"
            }${data.recent.decisionSource === "model" ? "（决策模型）" : data.recent.decisionSource === "rules" ? "（本地规则）" : ""}`}
          />
        )}
        {group && (
          <small>
            当前参与方式来自：
            {sourceText[group.settings.policySource.mode] || "全局默认"}
            ；保存后按所选群和专家生效。
          </small>
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values: FormValues) => void save(values)}
        >
          <Form.Item
            name="enabled"
            label="参与群聊"
            valuePropName="checked"
            extra="总开关，影响此插件管理的所有群。关闭后交由 Octop 原有规则处理。"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="dryRun"
            label="试运行"
            valuePropName="checked"
            extra="开启时不调用主助手或发送回复；启用决策模型时仍可能调用决策服务。"
          >
            <Switch />
          </Form.Item>
          {dryRun === false && (
            <Alert
              type="warning"
              showIcon
              message="试运行已关闭，符合规则的普通群消息可能触发真实回复。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item name="mode" label="参与方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "smart", label: "按聊天内容选择参与" },
                { value: "probability", label: "按概率参与" },
                { value: "always", label: "每条符合限制的消息都参与" },
                { value: "mention_only", label: "只处理 @ 机器人" },
                { value: "disabled", label: "关闭此群的插件规则" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="replyPercent"
            label="参与概率（%）"
            extra={
              mode === "smart"
                ? "先判断聊天内容是否相关，再按此概率参与。"
                : "对符合条件的普通消息按此概率参与。"
            }
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={100}
              step={1}
              disabled={mode !== "smart" && mode !== "probability"}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="decisionModelEnabled"
            label="使用 Octop 决策模型"
            valuePropName="checked"
            extra="仅用于按聊天内容选择参与。会将当前和少量近期群消息发送给 Octop 的决策服务；服务关闭、不可用或超时时自动使用本地规则。"
            hidden={!data.decisionModelSupported}
          >
            <Switch disabled={mode !== "smart"} />
          </Form.Item>
          {data.decisionModelSupported && data.decisionModelConfigured === false && (
            <Alert type="info" showIcon message="Octop 决策模型未启用或未配置，当前会使用本地规则。" />
          )}
          <Form.Item
            name="smartPercent"
            label="内容相关度门槛（%）"
            extra="仅用于按聊天内容选择参与；分数达到门槛后再按参与概率抽样。"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={100}
              disabled={mode !== "smart"}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="cooldownSeconds"
            label="两次自动回复至少间隔（秒）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={86400}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="maxPassiveRepliesPerHour"
            label="每小时最多自动回复（条）"
            extra="填 0 表示不自动回复。"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={10000}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="maxPassiveRepliesPerDay"
            label="每天最多自动回复（条）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={100000}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="delayMin"
            label="回复前最短等待（秒）"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={300} step={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="delayMax"
            label="回复前最长等待（秒）"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={300} step={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="maxConsecutiveReplies"
            label="最多连续自动回复（条）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={1}
              max={100}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="botRatioPercent"
            label="机器人回复占比上限（%）"
            extra="按最近观察到的普通消息和插件回复计算。"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="debounceMs"
            label="连续消息合并等待（毫秒）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={60000}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="contextMessages"
            label="最多参考的最近消息数"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={100}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="contextTtlSeconds"
            label="最近消息保留时间（秒）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={1}
              max={86400}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="mentionBypassCooldown"
            label="被 @ 时不受回复间隔限制"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name={["quietHours", "enabled"]}
            label="开启静默时段"
            valuePropName="checked"
            extra={`使用时区 ${data.timezone}；静默时段内不自动参与普通群聊。`}
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name={["quietHours", "start"]}
            label="静默开始"
            rules={[{ required: true }]}
          >
            <Input type="time" />
          </Form.Item>
          <Form.Item
            name={["quietHours", "end"]}
            label="静默结束"
            rules={[{ required: true }]}
          >
            <Input type="time" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存设置
          </Button>
        </Form>
      </Space>
    </section>
  );
}
