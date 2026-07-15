import { isAbsolute } from "node:path";

export interface NativeMentionInput {
  type: "mention";
  name: string;
  path: string;
}

export interface NativeSkillInput {
  type: "skill";
  name: string;
  path: string;
}

export type NativeWorkspaceInput = NativeMentionInput | NativeSkillInput;

export interface NativeConnectionAction {
  label: string;
  installUrl: string;
}

export interface NativeWorkspaceSnapshot {
  context: string;
  invocationTokens: string[];
  inputs: NativeWorkspaceInput[];
  connectionActions: NativeConnectionAction[];
  accessibleConnectorCount: number;
}

export interface NativeConnectorSelection {
  label: string;
  marketplaceName: string;
  marketplacePath?: string;
  remoteMarketplaceName?: string;
  pluginName: string;
  installed?: boolean;
  enabled?: boolean;
  requiresApp: boolean;
  preferredSkillSuffixes: string[];
}

export interface NativePluginResolution {
  selection: NativeConnectorSelection;
  detail?: unknown;
}

export interface NativeAppInventory {
  data: unknown[];
  complete: boolean;
}

interface ConnectorSpec {
  label: string;
  marketplaceName: "openai-curated" | "digital-colleague-prototype";
  pluginName: string;
  requiresApp: boolean;
}

const CONNECTORS: readonly ConnectorSpec[] = [
  {
    label: "Gmail",
    marketplaceName: "openai-curated",
    pluginName: "gmail",
    requiresApp: true,
  },
  {
    label: "Google Calendar",
    marketplaceName: "openai-curated",
    pluginName: "google-calendar",
    requiresApp: true,
  },
  {
    label: "Outlook Email",
    marketplaceName: "openai-curated",
    pluginName: "outlook-email",
    requiresApp: true,
  },
  {
    label: "Outlook Calendar",
    marketplaceName: "openai-curated",
    pluginName: "outlook-calendar",
    requiresApp: true,
  },
  {
    label: "Teams",
    marketplaceName: "openai-curated",
    pluginName: "teams",
    requiresApp: true,
  },
  {
    label: "SharePoint",
    marketplaceName: "openai-curated",
    pluginName: "sharepoint",
    requiresApp: true,
  },
  {
    label: "Slack",
    marketplaceName: "openai-curated",
    pluginName: "slack",
    requiresApp: true,
  },
  {
    label: "Notion",
    marketplaceName: "openai-curated",
    pluginName: "notion",
    requiresApp: true,
  },
];

const M365_WORKFLOW: ConnectorSpec = {
  label: "Microsoft 365 workflow",
  marketplaceName: "digital-colleague-prototype",
  pluginName: "digital-colleague-m365",
  requiresApp: false,
};

interface InstalledPlugin {
  marketplaceName: string;
  marketplacePath?: string;
  remoteMarketplaceName?: string;
  pluginName: string;
  installed: boolean;
  enabled: boolean;
}

interface PluginApp {
  id: string;
  name: string;
  installUrl?: string;
}

interface PluginSkill {
  name: string;
  path: string;
  enabled: boolean;
}

interface PluginDetail {
  apps: PluginApp[];
  skills: PluginSkill[];
}

interface AppInfo {
  id: string;
  name?: string;
  installUrl?: string;
  isAccessible: boolean;
  isEnabled: boolean;
}

export function isNativeAppId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installedPlugins(value: unknown): InstalledPlugin[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.marketplaces)) return undefined;
  const plugins: InstalledPlugin[] = [];
  for (const rawMarketplace of value.marketplaces) {
    if (
      !isRecord(rawMarketplace) ||
      typeof rawMarketplace.name !== "string" ||
      !Array.isArray(rawMarketplace.plugins)
    ) {
      continue;
    }
    const marketplacePath =
      typeof rawMarketplace.path === "string" && isAbsolute(rawMarketplace.path)
        ? rawMarketplace.path
        : undefined;
    const remoteMarketplaceName =
      !marketplacePath && rawMarketplace.name.endsWith("-remote")
        ? rawMarketplace.name
        : undefined;
    const marketplaceName = remoteMarketplaceName
      ? rawMarketplace.name.slice(0, -"-remote".length)
      : rawMarketplace.name;
    for (const rawPlugin of rawMarketplace.plugins) {
      if (
        !isRecord(rawPlugin) ||
        typeof rawPlugin.name !== "string" ||
        typeof rawPlugin.installed !== "boolean" ||
        typeof rawPlugin.enabled !== "boolean"
      ) {
        continue;
      }
      plugins.push({
        marketplaceName,
        marketplacePath,
        remoteMarketplaceName,
        pluginName: rawPlugin.name,
        installed: rawPlugin.installed,
        enabled: rawPlugin.enabled,
      });
    }
  }
  return plugins;
}

function requestedSpecs(text: string): ConnectorSpec[] {
  const selected = new Set<string>();
  const m365 =
    /\b(?:microsoft|office)\s*365\b|\bm365\b|微軟\s*365/i.test(text);
  const dailyBrief =
    /(?:今天|今日).{0,16}(?:最重要|重點|三件事|待辦|優先|安排|摘要|簡報)|(?:整理|列出|摘要).{0,8}(?:今天|今日)|\bdaily\s+(?:brief|digest)\b/i.test(
      text,
    );
  const outlook = /\boutlook\b/i.test(text);
  const email =
    /\bgmail\b|\be-?mail\b|\binbox\b|郵件|信件|信箱|收信|寄信|回信|哪些信|封信|待回覆/i.test(
      text,
    );
  const calendar =
    /\bcalendar\b|行事曆|日曆|行程|會議|約會|排程/i.test(text);

  if (m365) {
    selected.add("outlook-email");
    selected.add("outlook-calendar");
    selected.add("teams");
    selected.add("sharepoint");
  } else if (dailyBrief) {
    selected.add("gmail");
    selected.add("google-calendar");
  }
  if (outlook && email) selected.add("outlook-email");
  if (outlook && calendar) selected.add("outlook-calendar");
  if (!outlook && email) selected.add("gmail");
  if (!outlook && calendar) selected.add("google-calendar");
  if (
    /\b(?:microsoft\s+)?teams\b|\bplanner\b|Teams\s*(?:訊息|聊天|頻道|會議)/i.test(
      text,
    )
  ) {
    selected.add("teams");
  }
  if (
    /\bsharepoint\b|\bone\s*drive\b|\bonedrive\b|SharePoint|OneDrive/i.test(
      text,
    )
  ) {
    selected.add("sharepoint");
  }
  if (/\bslack\b/i.test(text)) selected.add("slack");
  if (/\bnotion\b|Notion|卡片|知識庫/i.test(text)) selected.add("notion");

  return CONNECTORS.filter((connector) => selected.has(connector.pluginName));
}

function m365WorkflowSkill(text: string): string | undefined {
  const microsoftSuite =
    /\b(?:microsoft|office)\s*365\b|\bm365\b|微軟\s*365/i.test(text);
  const document =
    /\bsharepoint\b|\bone\s*drive\b|\bonedrive\b|SharePoint|OneDrive/i.test(
      text,
    );
  const teams = /\b(?:microsoft\s+)?teams\b|\bplanner\b/i.test(text);
  const daily =
    /今天|今日|明天|明日|摘要|重點|優先|\bdaily\b|\bbrief\b|\bdigest\b/i.test(
      text,
    );
  const setup =
    /設定|設置|安裝|連接|連線|授權|權限|驗證|檢查|稽核|\bsetup\b|\bconnect\b|\baudit\b/i.test(
      text,
    );
  const meeting =
    /會議|meeting/i.test(text) &&
    /準備|會前|會後|追蹤|跟進|follow.?up|prep/i.test(text);

  if (microsoftSuite && setup) return "m365-workspace-setup";
  if (meeting) return "m365-meeting-followup";
  if ((microsoftSuite || (teams && document)) && daily) {
    return "m365-daily-brief";
  }
  if (document) return "m365-document-workspace";
  if (microsoftSuite) return "m365-workspace-setup";
  return undefined;
}

function requestedWorkspaceSpecs(text: string): ConnectorSpec[] {
  const workflow = m365WorkflowSkill(text);
  return workflow
    ? [M365_WORKFLOW, ...requestedSpecs(text)]
    : requestedSpecs(text);
}

function preferredSkillSuffixes(pluginName: string, text: string): string[] {
  if (pluginName === "gmail") {
    const triage =
      /處理|整理|摘要|重點|重要|優先|未讀|收件匣|\binbox\b|待回覆/i.test(
        text,
      );
    return triage ? ["gmail-inbox-triage", "gmail"] : ["gmail"];
  }
  if (pluginName === "outlook-email") {
    const triage =
      /處理|整理|摘要|重點|重要|優先|未讀|收件匣|\binbox\b|待回覆|\bbrief\b|\bdigest\b/i.test(
        text,
      );
    return triage
      ? ["outlook-email-inbox-triage", "outlook-email"]
      : ["outlook-email"];
  }
  if (pluginName === "outlook-calendar") {
    const daily =
      /今天|今日|明天|明日|摘要|重點|安排|\bdaily\b|\bbrief\b|\bagenda\b/i.test(
        text,
      );
    return daily
      ? ["outlook-calendar-daily-brief", "outlook-calendar"]
      : ["outlook-calendar"];
  }
  if (pluginName === "teams") {
    if (/\bplanner\b|Planner|任務|待辦/i.test(text)) {
      return ["teams-planner-task-management", "teams"];
    }
    if (/今天|今日|摘要|重點|\bdaily\b|\bdigest\b/i.test(text)) {
      return ["teams-daily-digest", "teams"];
    }
    return ["teams"];
  }
  return [pluginName];
}

export function nativeConnectorIntentKey(text: string): string {
  return requestedWorkspaceSpecs(text)
    .map((connector) => {
      const preferred = connector.requiresApp
        ? preferredSkillSuffixes(connector.pluginName, text)[0]
        : m365WorkflowSkill(text);
      return preferred && preferred !== connector.pluginName
        ? `${connector.pluginName}:${preferred}`
        : connector.pluginName;
    })
    .join(",");
}

export function selectNativeConnectors(
  pluginInventory: unknown,
  text: string,
): NativeConnectorSelection[] {
  const installed = installedPlugins(pluginInventory);
  return requestedWorkspaceSpecs(text).map((connector) => {
    const plugin = installed?.find(
      (candidate) =>
        candidate.marketplaceName === connector.marketplaceName &&
        candidate.pluginName === connector.pluginName,
    );
    return {
      label: connector.label,
      marketplaceName: connector.marketplaceName,
      marketplacePath: plugin?.marketplacePath,
      remoteMarketplaceName: plugin?.remoteMarketplaceName,
      pluginName: connector.pluginName,
      installed: installed ? (plugin?.installed ?? false) : undefined,
      enabled: installed ? (plugin?.enabled ?? false) : undefined,
      requiresApp: connector.requiresApp,
      preferredSkillSuffixes: preferredSkillSuffixes(
        connector.requiresApp
          ? connector.pluginName
          : (m365WorkflowSkill(text) ?? connector.pluginName),
        text,
      ),
    };
  });
}

function parsePluginDetail(value: unknown): PluginDetail | undefined {
  if (!isRecord(value) || !isRecord(value.plugin)) return undefined;
  const rawApps = Array.isArray(value.plugin.apps) ? value.plugin.apps : [];
  const rawSkills = Array.isArray(value.plugin.skills)
    ? value.plugin.skills
    : [];
  const apps: PluginApp[] = [];
  const skills: PluginSkill[] = [];

  for (const rawApp of rawApps) {
    if (
      !isRecord(rawApp) ||
      !isNativeAppId(rawApp.id) ||
      typeof rawApp.name !== "string" ||
      rawApp.name.trim().length === 0
    ) {
      continue;
    }
    apps.push({
      id: rawApp.id,
      name: rawApp.name,
      installUrl: safeInstallUrl(rawApp.installUrl),
    });
  }
  for (const rawSkill of rawSkills) {
    if (
      !isRecord(rawSkill) ||
      typeof rawSkill.name !== "string" ||
      typeof rawSkill.path !== "string" ||
      !isAbsolute(rawSkill.path) ||
      typeof rawSkill.enabled !== "boolean"
    ) {
      continue;
    }
    skills.push({
      name: rawSkill.name,
      path: rawSkill.path,
      enabled: rawSkill.enabled,
    });
  }
  return { apps, skills };
}

function parseAppInfo(value: unknown): AppInfo | undefined {
  if (
    !isRecord(value) ||
    !isNativeAppId(value.id) ||
    typeof value.isAccessible !== "boolean" ||
    typeof value.isEnabled !== "boolean"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    installUrl: safeInstallUrl(value.installUrl),
    isAccessible: value.isAccessible,
    isEnabled: value.isEnabled,
  };
}

function safeInstallUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      (parsed.hostname !== "chatgpt.com" &&
        !parsed.hostname.endsWith(".chatgpt.com"))
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function skillSuffix(name: string): string {
  return name.split(":").at(-1) ?? name;
}

function selectSkill(
  detail: PluginDetail,
  preferredSuffixes: string[],
): PluginSkill | undefined {
  const enabled = detail.skills.filter((skill) => skill.enabled);
  for (const suffix of preferredSuffixes) {
    const selected = enabled.find(
      (skill) => skillSuffix(skill.name) === suffix,
    );
    if (selected) return selected;
  }
  return undefined;
}

export function nativeAppIds(resolutions: NativePluginResolution[]): string[] {
  const ids = new Set<string>();
  for (const resolution of resolutions) {
    const detail = parsePluginDetail(resolution.detail);
    for (const app of detail?.apps ?? []) ids.add(app.id);
  }
  return [...ids];
}

export function nativeUnresolvedAppNames(
  resolutions: NativePluginResolution[],
): string[] {
  const names = new Set<string>();
  for (const resolution of resolutions) {
    const { selection } = resolution;
    if (
      !selection.requiresApp ||
      selection.installed !== true ||
      selection.enabled !== true
    ) {
      continue;
    }
    const detail = parsePluginDetail(resolution.detail);
    const declaredApp = detail?.apps.find(
      (app) => slug(app.name) === slug(selection.label),
    );
    if (!declaredApp) names.add(selection.label.toLowerCase());
  }
  return [...names];
}

export function buildNativeWorkspaceSnapshot(
  resolutions: NativePluginResolution[],
  appInventory?: NativeAppInventory,
): NativeWorkspaceSnapshot {
  const lines = [
    "# NATIVE CAPABILITY SNAPSHOT",
    "以下狀態由 Codex app-server 主機提供，是本回合的能力事實來源。plugin 安裝、帳號連線與本回合工具叫用是三個不同狀態。",
  ];
  const invocationTokens: string[] = [];
  const inputs: NativeWorkspaceInput[] = [];
  const connectionActions: NativeConnectionAction[] = [];
  let accessibleConnectorCount = 0;
  const inputKeys = new Set<string>();
  const apps = (appInventory?.data ?? [])
    .map(parseAppInfo)
    .filter((app): app is AppInfo => app !== undefined);

  const addToken = (token: string) => {
    if (!invocationTokens.includes(token)) invocationTokens.push(token);
  };
  const addInput = (input: NativeWorkspaceInput) => {
    const key = `${input.type}:${input.path}`;
    if (inputKeys.has(key)) return;
    inputKeys.add(key);
    inputs.push(input);
  };

  if (resolutions.length === 0) {
    lines.push("- 本回合未選用 workspace connector。");
  }

  for (const resolution of resolutions) {
    const { selection } = resolution;
    if (selection.installed === undefined) {
      lines.push(
        `- ${selection.label} plugin：安裝狀態無法確認；不要猜測，也不要自行送出安裝建議。`,
      );
      continue;
    }
    if (!selection.installed) {
      lines.push(`- ${selection.label} plugin：未安裝。`);
      continue;
    }
    if (!selection.enabled) {
      lines.push(`- ${selection.label} plugin：已安裝但目前停用。`);
      continue;
    }

    lines.push(`- ${selection.label} plugin：已安裝並啟用。`);
    lines.push(
      `- 不得說 ${selection.label} plugin 尚未安裝，也不得再次送出安裝建議。`,
    );
    addToken(`@${selection.pluginName}`);
    addInput({
      type: "mention",
      name: selection.label,
      path: `plugin://${selection.pluginName}@${selection.marketplaceName}`,
    });

    const detail = parsePluginDetail(resolution.detail);
    const skill = detail
      ? selectSkill(detail, selection.preferredSkillSuffixes)
      : undefined;
    if (!selection.requiresApp) {
      if (skill) {
        addToken(`$${skillSuffix(skill.name)}`);
        addInput({
          type: "skill",
          name: skill.name,
          path: skill.path,
        });
      }
      lines.push(
        skill
          ? `- ${selection.label}：已選用 ${skillSuffix(skill.name)}。`
          : `- ${selection.label}：plugin 已啟用，但找不到相符的 workflow skill。`,
      );
      continue;
    }
    const declaredApp = detail?.apps.find(
      (candidate) => slug(candidate.name) === slug(selection.label),
    );
    const appInfo = declaredApp
      ? apps.find((candidate) => candidate.id === declaredApp.id)
      : apps.find(
          (candidate) =>
            candidate.name !== undefined &&
            slug(candidate.name) === slug(selection.label),
        );
    const appId = declaredApp?.id ?? appInfo?.id;
    if (!appId) {
      lines.push(
        `- ${selection.label} connector：plugin binding 無法解析，連線狀態未知。`,
        `- 目前沒有可信的官方連接頁。不得猜測或捏造工具、Connectors、設定頁的操作路徑；只可請使用者稍後重新檢查 ${selection.label}。`,
      );
      continue;
    }

    addToken(`$${slug(selection.label)}`);
    addInput({
      type: "mention",
      name: selection.label,
      path: `app://${appId}`,
    });
    if (skill) {
      addToken(`$${skillSuffix(skill.name)}`);
      addInput({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    }
    if (!appInfo) {
      lines.push(
        `- ${selection.label} connector：目前無法確認這個 Codex thread 的帳號連線狀態；不得把它誤報成 plugin 未安裝。`,
      );
    } else if (!appInfo.isEnabled) {
      lines.push(
        `- ${selection.label} connector：目前在 Codex app 設定中停用。`,
      );
    } else if (appInfo.isAccessible) {
      accessibleConnectorCount += 1;
      lines.push(
        `- ${selection.label} connector：帳號已連線，可在本回合叫用。`,
      );
    } else {
      lines.push(
        `- ${selection.label} connector：plugin 已安裝，但目前這個 Codex 登入帳號無法存取；可能尚未完成授權，或受帳號、方案、管理政策限制。目前不能聲稱已讀取任何內容。`,
        `- 對使用者請明確說：「${selection.label} plugin 已安裝，但目前這個 Codex 登入帳號無法存取 ${selection.label} connector。」不要把原因斷言成未安裝或未連線。`,
      );
    }

    const installUrl = appInfo?.installUrl ?? declaredApp?.installUrl;
    if (installUrl) {
      lines.push(`- 官方連接頁：${installUrl}`);
      if (appInfo?.isEnabled && !appInfo.isAccessible) {
        connectionActions.push({ label: selection.label, installUrl });
      }
    }
  }

  return {
    context: lines.join("\n"),
    invocationTokens,
    inputs,
    connectionActions,
    accessibleConnectorCount,
  };
}

export function isComputerUseIntent(text: string): boolean {
  return /\bcomputer\s*use\b|目前的?畫面|螢幕|截圖|操作.{0,8}(?:Chrome|瀏覽器|app)|看看我.{0,8}畫面/i.test(
    text,
  );
}
