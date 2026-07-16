import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const SESSION_PREFIX = "hook:gmail:";
const ACTION_TAG = /<ada-email-action>(\{[^\r\n]*\})<\/ada-email-action>\s*$/;
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const REPLY_TEMPLATES = Object.freeze({
  acknowledgement: "收到，謝謝你的來信。",
  clarifying_question:
    "收到。請補充這項任務的預期結果與期限，方便 Ada 確認下一步。",
  status_update:
    "收到。Ada 已記錄這項任務；有可確認的進度時會再更新。",
});
const POLICY_KEYS = new Set([
  "version",
  "enabled",
  "mode",
  "mailbox",
  "allowedSenders",
  "allowedReplyKinds",
  "requireSameThread",
  "allowNewRecipients",
  "allowCc",
  "allowBcc",
  "allowAttachments",
  "maxRepliesPerMessage",
  "maxBodyCharacters",
  "interruptible",
  "escalateOn",
]);
const ACTION_KEYS = new Set(["action", "kind"]);
const TERMINAL_SUMMARIES = {
  triaging: "Ada 正在讀取並判斷這封郵件是否需要回覆。",
  awaiting_approval: "這封信不在自動回覆範圍，請在 Ada 對話中審閱。",
  sending: "Gmail 正在送出受 policy 限制的原信回覆。",
  cancelled: "你已停止這項工作；尚未開始的寄送不會執行。",
  completed: "Gmail 已確認自動回覆送出。",
  failed: "自動處理未完成，沒有把這封信標記為已寄出。",
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizeEmail(value, field) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.includes("\r") || email.includes("\n")) {
    throw new Error(`${field} must be one plain email address.`);
  }
  return email;
}

export function validateEmailAutomationPolicy(value) {
  if (!isRecord(value) || !exactKeys(value, POLICY_KEYS)) {
    throw new Error("Email automation policy contains unsupported fields.");
  }
  if (value.version !== 1 || value.mode !== "owner_only") {
    throw new Error("Email automation policy version or mode is unsupported.");
  }
  if (typeof value.enabled !== "boolean" || value.interruptible !== true) {
    throw new Error("Email automation must be explicitly enabled/disabled and interruptible.");
  }
  for (const key of [
    "requireSameThread",
    "allowNewRecipients",
    "allowCc",
    "allowBcc",
    "allowAttachments",
  ]) {
    if (typeof value[key] !== "boolean") {
      throw new Error(`${key} must be a boolean.`);
    }
  }
  if (
    value.requireSameThread !== true ||
    value.allowNewRecipients ||
    value.allowCc ||
    value.allowBcc ||
    value.allowAttachments
  ) {
    throw new Error("Unsafe email automation capability was requested.");
  }
  if (value.maxRepliesPerMessage !== 1) {
    throw new Error("Only one automatic reply per message is supported.");
  }
  if (
    !Number.isInteger(value.maxBodyCharacters) ||
    value.maxBodyCharacters < 1 ||
    value.maxBodyCharacters > 2_000
  ) {
    throw new Error("maxBodyCharacters must be between 1 and 2000.");
  }
  if (!Array.isArray(value.allowedSenders) || value.allowedSenders.length < 1) {
    throw new Error("At least one owner sender must be allowlisted.");
  }
  const allowedSenders = [
    ...new Set(value.allowedSenders.map((sender) => normalizeEmail(sender, "allowedSenders"))),
  ];
  const supportedKinds = new Set(Object.keys(REPLY_TEMPLATES));
  if (
    !Array.isArray(value.allowedReplyKinds) ||
    value.allowedReplyKinds.length < 1 ||
    value.allowedReplyKinds.some((kind) => !supportedKinds.has(kind))
  ) {
    throw new Error("allowedReplyKinds contains an unsupported reply kind.");
  }
  if (!Array.isArray(value.escalateOn)) {
    throw new Error("escalateOn must be an array.");
  }
  return Object.freeze({
    ...value,
    mailbox: normalizeEmail(value.mailbox, "mailbox"),
    allowedSenders: Object.freeze(allowedSenders),
    allowedReplyKinds: Object.freeze([...new Set(value.allowedReplyKinds)]),
    escalateOn: Object.freeze(
      value.escalateOn.map((reason) => {
        if (typeof reason !== "string" || !reason.trim()) {
          throw new Error("escalateOn values must be non-empty strings.");
        }
        return reason.trim();
      }),
    ),
  });
}

export async function loadEmailAutomationPolicy(path) {
  return validateEmailAutomationPolicy(JSON.parse(await readFile(path, "utf8")));
}

export function gmailTaskFromSession(sessionKey) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith(SESSION_PREFIX)) {
    return undefined;
  }
  const messageId = sessionKey.slice(SESSION_PREFIX.length);
  if (!MESSAGE_ID.test(messageId)) return undefined;
  return { messageId, taskId: `gmail:${messageId}` };
}

function textParts(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!isRecord(part)) return [];
    return typeof part.text === "string" ? [part.text] : [];
  });
}

export function lastAssistantText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") continue;
    const text = textParts(message.content).join("\n").trim();
    if (text) return text;
  }
  return "";
}

export function parseEmailAction(text, policy) {
  const match = typeof text === "string" ? text.match(ACTION_TAG) : null;
  if (!match) return { action: "ask", reason: "missing_action_contract" };
  let value;
  try {
    value = JSON.parse(match[1]);
  } catch {
    return { action: "ask", reason: "invalid_action_json" };
  }
  if (!isRecord(value) || !exactKeys(value, ACTION_KEYS)) {
    return { action: "ask", reason: "unsupported_action_fields" };
  }
  if (value.action === "none" || value.action === "ask") {
    if (Object.keys(value).length !== 1) {
      return { action: "ask", reason: "unexpected_action_content" };
    }
    return { action: value.action };
  }
  if (
    value.action !== "reply" ||
    !policy.allowedReplyKinds.includes(value.kind) ||
    Object.keys(value).length !== 2
  ) {
    return { action: "ask", reason: "unsupported_reply" };
  }
  return { action: "reply", kind: value.kind };
}

function firstRecord(...values) {
  return values.find(isRecord);
}

function extractEmailAddress(value) {
  if (typeof value !== "string") return "";
  const bracketed = value.match(/<([^<>]+@[^<>]+)>/);
  const candidate = (bracketed?.[1] ?? value).trim().toLowerCase();
  return EMAIL.test(candidate) ? candidate : "";
}

function recipientList(value) {
  if (Array.isArray(value)) return value.flatMap(recipientList);
  if (typeof value !== "string") return [];
  return value.split(",").map(extractEmailAddress).filter(Boolean);
}

function gmailHeaderMap(message, envelope) {
  const flattened = firstRecord(envelope?.headers, message?.headers);
  if (flattened) return flattened;
  const messagePayload = isRecord(message?.payload) ? message.payload : {};
  const rawHeaders = Array.isArray(messagePayload.headers) ? messagePayload.headers : [];
  return Object.fromEntries(
    rawHeaders.flatMap((header) => {
      if (!isRecord(header) || typeof header.name !== "string") return [];
      return [[header.name.trim().toLowerCase(), header.value]];
    }),
  );
}

function gmailMessageHasAttachments(message, envelope) {
  if (Array.isArray(envelope?.attachments) && envelope.attachments.length > 0) {
    return true;
  }
  const visit = (part, depth = 0) => {
    if (!isRecord(part) || depth > 20) return false;
    if (
      (typeof part.filename === "string" && part.filename.trim()) ||
      (isRecord(part.body) && typeof part.body.attachmentId === "string")
    ) {
      return true;
    }
    return Array.isArray(part.parts) && part.parts.some((child) => visit(child, depth + 1));
  };
  return visit(message?.payload);
}

export function normalizeGogMessage(payload) {
  const envelope = firstRecord(payload?.data, payload);
  const message = firstRecord(envelope?.message, payload?.message, payload?.data?.message);
  if (!message) throw new Error("gog did not return a Gmail message object.");
  const headers = gmailHeaderMap(message, envelope);
  return {
    id: typeof message.id === "string" ? message.id : "",
    threadId: typeof message.threadId === "string" ? message.threadId : "",
    from: extractEmailAddress(headers.from),
    to: recipientList(headers.to),
    subject: typeof headers.subject === "string" ? headers.subject : "",
    hasAttachments: gmailMessageHasAttachments(message, envelope),
  };
}

export function evaluateReply(policy, expectedMessageId, message, action) {
  if (!policy.enabled) return { allowed: false, reason: "policy_disabled" };
  if (!isRecord(action) || action.action !== "reply") {
    return { allowed: false, reason: "reply_not_requested" };
  }
  if (
    !exactKeys(action, ACTION_KEYS) ||
    Object.keys(action).length !== 2 ||
    !policy.allowedReplyKinds.includes(action.kind)
  ) {
    return { allowed: false, reason: "unsupported_reply" };
  }
  const body = REPLY_TEMPLATES[action.kind];
  if (typeof body !== "string" || [...body].length > policy.maxBodyCharacters) {
    return { allowed: false, reason: "template_exceeds_policy_limit" };
  }
  if (message.id !== expectedMessageId || !message.threadId) {
    return { allowed: false, reason: "message_or_thread_mismatch" };
  }
  if (!policy.allowedSenders.includes(message.from)) {
    return { allowed: false, reason: "sender_not_allowlisted" };
  }
  if (!message.to.includes(policy.mailbox)) {
    return { allowed: false, reason: "mailbox_not_original_recipient" };
  }
  if (message.hasAttachments) {
    return { allowed: false, reason: "attachment_present" };
  }
  if (/[\r\n]/.test(message.subject)) {
    return { allowed: false, reason: "invalid_subject_headers" };
  }
  const cleanSubject = message.subject.trim().slice(0, 180);
  return {
    allowed: true,
    recipient: message.from,
    subject: /^re:/i.test(cleanSubject) ? cleanSubject : `Re: ${cleanSubject || "訊息"}`,
    body,
  };
}

function eventId(taskId, phase, runId) {
  return `gmail-task:${createHash("sha256")
    .update(`${taskId}\0${phase}\0${runId ?? "unknown"}`)
    .digest("hex")}`;
}

export function taskEvent(task, phase, runId, summary = TERMINAL_SUMMARIES[phase]) {
  return {
    eventId: eventId(task.taskId, phase, runId),
    taskId: task.taskId,
    source: "gmail",
    type: "email.task",
    phase,
    replyPolicy: phase === "awaiting_approval" ? "approval_required" : "none",
    title: phase === "triaging" ? "收到新郵件" : "Ada 郵件工作更新",
    summary,
    occurredAt: new Date().toISOString(),
  };
}

function taskApiUrl(eventApiUrl, taskId) {
  const url = new URL(eventApiUrl);
  if (!url.pathname.endsWith("/events")) {
    throw new Error("eventApiUrl must end in /events.");
  }
  url.pathname = `${url.pathname.slice(0, -"/events".length)}/tasks/${encodeURIComponent(taskId)}/authorization`;
  return url.toString();
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function publishTaskEvent(fetchImpl, eventApiUrl, token, event) {
  if (!eventApiUrl || !token) throw new Error("Ada event ingress is not configured.");
  const response = await fetchWithTimeout(fetchImpl, eventApiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Ada event ingress returned ${response.status}.`);
}

export async function readTaskAuthorization(fetchImpl, eventApiUrl, token, taskId) {
  const response = await fetchWithTimeout(fetchImpl, taskApiUrl(eventApiUrl, taskId), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { allowed: false, cancelled: false };
  const payload = await response.json();
  return isRecord(payload?.data)
    ? {
        allowed: payload.data.allowed === true,
        cancelled: payload.data.cancelled === true,
      }
    : { allowed: false, cancelled: false };
}

export async function reserveMessage(stateDir, messageId) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const digest = createHash("sha256").update(messageId).digest("hex");
  const reservation = resolve(stateDir, `${digest}.reserved`);
  try {
    const file = await open(reservation, "wx", 0o600);
    await file.writeFile(`${new Date().toISOString()}\n`);
    await file.close();
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

export function runGog(binary, args, stdin = "", timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error(`gog timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();
    const collect = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (next.length > 1_000_000) throw new Error("gog output exceeded 1 MB.");
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try { stdout = collect(stdout, chunk); } catch (error) {
        child.kill("SIGKILL");
        finish(reject, error);
      }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = collect(stderr, chunk); } catch (error) {
        child.kill("SIGKILL");
        finish(reject, error);
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(reject, new Error(`gog exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      finish(resolvePromise, { stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

export function createEmailAutomationRuntime(options) {
  const {
    policyPath,
    eventApiUrl,
    eventToken,
    stateDir,
    gogBinary = "gog",
    fetchImpl = globalThis.fetch,
    runGogImpl = runGog,
    reserveImpl = reserveMessage,
    logger = console,
  } = options;

  const publish = async (task, phase, runId, summary) =>
    publishTaskEvent(
      fetchImpl,
      eventApiUrl,
      eventToken,
      taskEvent(task, phase, runId, summary),
    );

  return {
    async beforePrompt(ctx) {
      const task = gmailTaskFromSession(ctx?.sessionKey);
      if (!task) return;
      await publish(task, "triaging", ctx?.runId);
    },

    async agentEnd(event, ctx) {
      const task = gmailTaskFromSession(ctx?.sessionKey);
      if (!task) return;
      try {
        const policy = await loadEmailAutomationPolicy(policyPath);
        if (!event?.success) {
          await publish(task, "failed", ctx?.runId);
          return;
        }
        const action = parseEmailAction(lastAssistantText(event.messages), policy);
        if (action.action === "none") {
          await publish(
            task,
            "completed",
            ctx?.runId,
            "Ada 已完成判斷；這封信不需要回覆。",
          );
          return;
        }
        if (action.action !== "reply") {
          await publish(task, "awaiting_approval", ctx?.runId);
          return;
        }

        const read = await runGogImpl(gogBinary, [
          "--account", policy.mailbox,
          "--no-input", "--json",
          "gmail", "get", task.messageId,
          "--format", "metadata",
        ]);
        const message = normalizeGogMessage(JSON.parse(read.stdout));
        const decision = evaluateReply(policy, task.messageId, message, action);
        if (!decision.allowed) {
          await publish(task, "awaiting_approval", ctx?.runId);
          return;
        }

        const firstGate = await readTaskAuthorization(
          fetchImpl,
          eventApiUrl,
          eventToken,
          task.taskId,
        );
        if (!firstGate.allowed) {
          await publish(task, firstGate.cancelled ? "cancelled" : "failed", ctx?.runId);
          return;
        }
        if (!(await reserveImpl(stateDir, task.messageId))) {
          await publish(
            task,
            "failed",
            ctx?.runId,
            "已存在 at-most-once reservation；為避免重複寄送，本次沒有寄送。請先核對 Gmail Sent，再人工 reconciliation。",
          );
          return;
        }

        await publish(task, "sending", ctx?.runId);
        const finalGate = await readTaskAuthorization(
          fetchImpl,
          eventApiUrl,
          eventToken,
          task.taskId,
        );
        if (!finalGate.allowed) {
          await publish(task, finalGate.cancelled ? "cancelled" : "failed", ctx?.runId);
          return;
        }
        await runGogImpl(
          gogBinary,
          [
            "--account", policy.mailbox,
            "--no-input", "--json", "--force",
            "gmail", "send",
            "--to", decision.recipient,
            "--subject", decision.subject,
            "--body-file", "-",
            "--reply-to-message-id", task.messageId,
          ],
          `${decision.body}\n`,
        );
        await publish(task, "completed", ctx?.runId);
      } catch (error) {
        logger.warn?.(`ada-email-automation: ${error instanceof Error ? error.message : String(error)}`);
        try { await publish(task, "failed", ctx?.runId); } catch {}
      }
    },
  };
}

export default {
  id: "ada-email-automation",
  name: "Ada Email Automation Guard",
  description: "Owner-only Gmail automation and frontend task projection.",
  register(api) {
    const config = isRecord(api.pluginConfig) ? api.pluginConfig : {};
    const workspace = process.env.OPENCLAW_ADA_WORKSPACE || process.cwd();
    const runtime = createEmailAutomationRuntime({
      policyPath:
        config.policyPath || resolve(workspace, "policies/email-automation.json"),
      eventApiUrl:
        config.eventApiUrl || process.env.ADA_EVENT_API_URL || "http://127.0.0.1:8787/api/v1/events",
      eventToken: process.env.DC_EVENT_INGRESS_TOKEN || "",
      stateDir:
        config.stateDir || resolve(process.env.OPENCLAW_STATE_DIR || process.cwd(), "ada-email-automation"),
      gogBinary: config.gogBinary || "gog",
      logger: api.logger,
    });
    api.on("before_prompt_build", async (_event, ctx) => runtime.beforePrompt(ctx));
    api.on("agent_end", async (event, ctx) => runtime.agentEnd(event, ctx));
  },
};
