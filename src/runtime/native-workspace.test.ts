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

  it("keeps generic Gmail and inbox triage workspace caches separate", () => {
    expect(nativeConnectorIntentKey("用 Gmail 找一封來自 Elena 的信")).toBe(
      "gmail",
    );
    expect(nativeConnectorIntentKey("整理 Gmail 收件匣的待回覆信件")).toBe(
      "gmail:gmail-inbox-triage",
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
