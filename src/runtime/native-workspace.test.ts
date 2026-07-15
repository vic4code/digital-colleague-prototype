import { describe, expect, it } from "vitest";
import {
  buildNativeWorkspaceSnapshot,
  nativeAppIds,
  nativeConnectorIntentKey,
  selectNativeConnectors,
} from "./native-workspace.js";

const pluginInventory = {
  marketplaces: [
    {
      name: "openai-curated",
      path: "/tmp/openai-curated/.agents/plugins/marketplace.json",
      plugins: [
        { name: "gmail", installed: true, enabled: true },
        { name: "google-calendar", installed: true, enabled: true },
      ],
    },
  ],
};

const remotePluginInventory = {
  marketplaces: [
    {
      name: "openai-curated-remote",
      path: null,
      plugins: [{ name: "gmail", installed: true, enabled: true }],
    },
  ],
};

const m365PluginInventory = {
  marketplaces: [
    {
      name: "digital-colleague-prototype",
      path: "/tmp/digital-colleague/.agents/plugins/marketplace.json",
      plugins: [
        {
          name: "digital-colleague-m365",
          installed: true,
          enabled: true,
        },
      ],
    },
    {
      name: "openai-curated",
      path: "/tmp/openai-curated/.agents/plugins/marketplace.json",
      plugins: [
        { name: "outlook-email", installed: true, enabled: true },
        { name: "outlook-calendar", installed: true, enabled: true },
        { name: "teams", installed: true, enabled: true },
        { name: "sharepoint", installed: true, enabled: true },
      ],
    },
  ],
};

const gmailDetail = {
  plugin: {
    apps: [
      {
        id: "connector_gmail",
        name: "Gmail",
        installUrl: "https://chatgpt.com/apps/gmail/connector_gmail",
      },
    ],
    skills: [
      {
        name: "gmail:gmail",
        path: "/tmp/plugins/gmail/skills/gmail/SKILL.md",
        enabled: true,
      },
      {
        name: "gmail:gmail-inbox-triage",
        path: "/tmp/plugins/gmail/skills/gmail-inbox-triage/SKILL.md",
        enabled: true,
      },
    ],
  },
};

describe("native workspace connector selection", () => {
  it("selects Gmail and Google Calendar for the daily-priorities starter", () => {
    const text = "幫我整理今天最重要的三件事";
    expect(nativeConnectorIntentKey(text)).toBe(
      "gmail:gmail-inbox-triage,google-calendar",
    );
    expect(
      selectNativeConnectors(pluginInventory, text).map(
        (selection) => selection.pluginName,
      ),
    ).toEqual(["gmail", "google-calendar"]);
  });

  it("recognizes installed connectors from the remote curated marketplace", () => {
    const [selection] = selectNativeConnectors(
      remotePluginInventory,
      "用 Gmail 找最近的郵件",
    );

    expect(selection).toMatchObject({
      marketplaceName: "openai-curated",
      remoteMarketplaceName: "openai-curated-remote",
      pluginName: "gmail",
      installed: true,
      enabled: true,
    });
  });

  it("keeps generic Gmail and inbox triage workspace caches separate", () => {
    expect(nativeConnectorIntentKey("用 Gmail 找一封來自 Elena 的信")).toBe(
      "gmail",
    );
    expect(nativeConnectorIntentKey("整理 Gmail 收件匣的待回覆信件")).toBe(
      "gmail:gmail-inbox-triage",
    );
  });

  it("selects the complete official M365 connector set for a Microsoft 365 brief", () => {
    const text = "幫我做 Microsoft 365 今日工作摘要";

    expect(nativeConnectorIntentKey(text)).toBe(
      "digital-colleague-m365:m365-daily-brief," +
        "outlook-email:outlook-email-inbox-triage," +
        "outlook-calendar:outlook-calendar-daily-brief," +
        "teams:teams-daily-digest,sharepoint",
    );
    expect(
      selectNativeConnectors(m365PluginInventory, text).map(
        (selection) => selection.pluginName,
      ),
    ).toEqual([
      "digital-colleague-m365",
      "outlook-email",
      "outlook-calendar",
      "teams",
      "sharepoint",
    ]);
  });

  it("routes OneDrive through SharePoint and Planner through Teams", () => {
    expect(nativeConnectorIntentKey("找 OneDrive 最近的專案文件")).toBe(
      "digital-colleague-m365:m365-document-workspace,sharepoint",
    );
    expect(nativeConnectorIntentKey("整理 Teams Planner 的待辦")).toBe(
      "teams:teams-planner-task-management",
    );
  });

  it("uses M365 workflow skills without confusing plugin and account state", () => {
    const selections = selectNativeConnectors(
      m365PluginInventory,
      "整理 Teams 今日訊息和 SharePoint 文件",
    );
    const details = {
      "digital-colleague-m365": {
        plugin: {
          apps: [],
          skills: [
            {
              name: "digital-colleague-m365:m365-daily-brief",
              path:
                "/tmp/plugins/digital-colleague-m365/skills/m365-daily-brief/SKILL.md",
              enabled: true,
            },
          ],
        },
      },
      teams: {
        plugin: {
          apps: [{ id: "connector_teams", name: "Teams" }],
          skills: [
            {
              name: "teams:teams-daily-digest",
              path: "/tmp/plugins/teams/skills/teams-daily-digest/SKILL.md",
              enabled: true,
            },
          ],
        },
      },
      sharepoint: {
        plugin: {
          apps: [{ id: "connector_sharepoint", name: "SharePoint" }],
          skills: [
            {
              name: "sharepoint:sharepoint",
              path: "/tmp/plugins/sharepoint/skills/sharepoint/SKILL.md",
              enabled: true,
            },
          ],
        },
      },
    };
    const resolutions = selections.map((selection) => ({
      selection,
      detail: details[selection.pluginName as keyof typeof details],
    }));

    const snapshot = buildNativeWorkspaceSnapshot(resolutions, {
      data: [
        {
          id: "connector_teams",
          isAccessible: true,
          isEnabled: true,
        },
        {
          id: "connector_sharepoint",
          isAccessible: false,
          isEnabled: true,
        },
      ],
      complete: true,
    });

    expect(nativeAppIds(resolutions)).toEqual([
      "connector_teams",
      "connector_sharepoint",
    ]);
    expect(snapshot.invocationTokens).toEqual([
      "@digital-colleague-m365",
      "$m365-daily-brief",
      "@teams",
      "$teams",
      "$teams-daily-digest",
      "@sharepoint",
      "$sharepoint",
    ]);
    expect(snapshot.context).toContain(
      "Teams connector：帳號已連線，可在本回合叫用",
    );
    expect(snapshot.context).toContain(
      "SharePoint plugin 已安裝，但目前這個 Codex 登入帳號無法存取 SharePoint connector",
    );
  });

  it("does not select workspace connectors for an unrelated screen task", () => {
    expect(
      selectNativeConnectors(
        pluginInventory,
        "用 Computer Use 看看我目前的畫面",
      ),
    ).toEqual([]);
  });

  it("keeps installed and connected state separate", () => {
    const [selection] = selectNativeConnectors(
      pluginInventory,
      "幫我看看最近有哪些信需要處理",
    );
    const resolutions = [{ selection, detail: gmailDetail }];
    expect(nativeAppIds(resolutions)).toEqual(["connector_gmail"]);

    const disconnected = buildNativeWorkspaceSnapshot(resolutions, {
      data: [
        {
          id: "connector_gmail",
          name: "Gmail",
          installUrl: "https://chatgpt.com/apps/gmail/connector_gmail",
          isAccessible: false,
          isEnabled: true,
        },
      ],
      complete: true,
    });
    expect(disconnected.context).toContain(
      "Gmail connector：plugin 已安裝，但目前這個 Codex 登入帳號無法存取",
    );
    expect(disconnected.context).toContain(
      "不得說 Gmail plugin 尚未安裝",
    );
    expect(disconnected.context).toContain(
      "Gmail plugin 已安裝，但目前這個 Codex 登入帳號無法存取 Gmail connector",
    );
    expect(disconnected.invocationTokens).toEqual([
      "@gmail",
      "$gmail",
      "$gmail-inbox-triage",
    ]);
    expect(disconnected.connectionActions).toEqual([
      {
        label: "Gmail",
        installUrl: "https://chatgpt.com/apps/gmail/connector_gmail",
      },
    ]);
    expect(disconnected.accessibleConnectorCount).toBe(0);

    const connected = buildNativeWorkspaceSnapshot(resolutions, {
      data: [
        {
          id: "connector_gmail",
          name: "Gmail",
          installUrl: "https://chatgpt.com/apps/gmail/connector_gmail",
          isAccessible: true,
          isEnabled: true,
        },
      ],
      complete: true,
    });
    expect(connected.context).toContain(
      "Gmail connector：帳號已連線，可在本回合叫用",
    );
    expect(connected.connectionActions).toEqual([]);
    expect(connected.accessibleConnectorCount).toBe(1);
  });

  it("does not inject an unexpected plugin skill from connector metadata", () => {
    const [selection] = selectNativeConnectors(
      pluginInventory,
      "幫我看看最近有哪些信需要處理",
    );
    const snapshot = buildNativeWorkspaceSnapshot(
      [
        {
          selection,
          detail: {
            plugin: {
              apps: [
                {
                  id: "connector_gmail",
                  name: "Gmail",
                  installUrl:
                    "https://chatgpt.com/apps/gmail/connector_gmail",
                },
              ],
              skills: [
                {
                  name: "unexpected:run-anything",
                  path: "/tmp/plugins/unexpected/SKILL.md",
                  enabled: true,
                },
              ],
            },
          },
        },
      ],
      undefined,
    );

    expect(snapshot.inputs.some((input) => input.type === "skill")).toBe(
      false,
    );
    expect(snapshot.invocationTokens).not.toContain("$run-anything");
  });
});
