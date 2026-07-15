import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event: MessageEvent) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("digital colleague chat", () => {
  beforeEach(() => {
    sessionStorage.setItem("digital-colleague-account-confirmed", "ada@example.com");
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/v1/health")) {
          return jsonResponse({
            data: {
              status: "ok",
              runtime: "codex-app-server",
              colleague: { id: "ada", name: "Ada" },
            },
          });
        }
        if (String(input).endsWith("/api/v1/events")) {
          return jsonResponse({ data: [] });
        }
        if (String(input).endsWith("/api/v1/runtime/account")) {
          return jsonResponse({
            data: {
              available: true,
              requiresOpenaiAuth: true,
              account: { type: "chatgpt", email: "ada@example.com" },
            },
          });
        }
        const request = JSON.parse(String(init?.body)) as { text: string };
        return jsonResponse({
          data: {
            threadId: "web:0f289a92-7255-49f8-8332-e9f530d8f63c",
            reply: { text: `Ada replied to: ${request.text}` },
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("opens the configured colleague directly and reports the live runtime", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByText("法務營運分析師")).toBeInTheDocument();
    expect(screen.getByText("和你一起工作")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Ada，你的數位同事" }),
    ).toHaveAttribute("src", "/ada-illustrated-full.webp");
    expect(
      screen.getByText(/嗨，我是 Ada。/),
    ).toBeInTheDocument();
    expect(await screen.findByText("可以開始")).toBeInTheDocument();
    expect(await screen.findByText("在線 · 可以開始")).toBeInTheDocument();
    expect(screen.getByText("Ada 已就緒")).toBeInTheDocument();
    expect(screen.queryByText(/app-server/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/select colleague/i)).not.toBeInTheDocument();
  });

  it("shows Google and Microsoft workspace providers as configurable", () => {
    render(<App />);

    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Outlook Email")).toBeInTheDocument();
    expect(screen.getByText("Outlook Calendar")).toBeInTheDocument();
    expect(screen.getByText("Notion")).toBeInTheDocument();
  });

  it("submits a text message, clears the composer, and renders Ada's reply", async () => {
    const user = userEvent.setup();
    render(<App />);

    const composer = screen.getByLabelText("傳訊息給 Ada");
    await user.type(composer, "Please review the latest contract.");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));

    expect(
      screen.getByText("Please review the latest contract."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Ada replied to: Please review the latest contract."),
    ).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });

  it("renders streamed answer text before the turn completes", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (String(input).endsWith("/api/v1/events")) {
        return jsonResponse({ data: [] });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("傳訊息給 Ada"), "hello");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));
    streamController.enqueue(
      encoder.encode(
        'data: {"type":"start","threadId":"web:0f289a92-7255-49f8-8332-e9f530d8f63c"}\n\n',
      ),
    );
    streamController.enqueue(
      encoder.encode('data: {"type":"delta","delta":"收"}\n\n'),
    );

    expect(await screen.findByText("收")).toBeInTheDocument();

    streamController.enqueue(
      encoder.encode('data: {"type":"delta","delta":"到"}\n\n'),
    );
    streamController.enqueue(
      encoder.encode(
        'data: {"type":"done","threadId":"web:0f289a92-7255-49f8-8332-e9f530d8f63c","reply":{"text":"收到"}}\n\n',
      ),
    );
    streamController.close();

    expect(await screen.findByText("收到")).toBeInTheDocument();
  });

  it("renders Ada's connector guidance as a safe, readable link", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (String(input).endsWith("/api/v1/events")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({
        data: {
          threadId: "web:0f289a92-7255-49f8-8332-e9f530d8f63c",
          reply: {
            text:
              "目前尚未連線：\n- Gmail plugin 已安裝。 [連線 Gmail](https://chatgpt.com/apps/gmail/connector_gmail)\n- Google Calendar plugin 已安裝。",
          },
        },
      });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("傳訊息給 Ada"), "整理今天重點");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));

    const connectorLink = await screen.findByRole("link", {
      name: "連線 Gmail",
    });
    expect(connectorLink).toHaveAttribute(
      "href",
      "https://chatgpt.com/apps/gmail/connector_gmail",
    );
    expect(connectorLink).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/\[連線 Gmail\]\(/)).not.toBeInTheDocument();
  });

  it("prevents duplicate turns while Ada is thinking", async () => {
    let resolveTurn!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveTurn = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (String(input).endsWith("/api/v1/events")) {
        return jsonResponse({ data: [] });
      }
      if (String(input).endsWith("/api/v1/runtime/account")) {
        return jsonResponse({
          data: {
            available: true,
            requiresOpenaiAuth: true,
            account: { type: "chatgpt", email: "ada@example.com" },
          },
        });
      }
      return pending;
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("傳訊息給 Ada"), "Hold this turn");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));

    expect(screen.getByText("Ada 正在思考…")).toBeInTheDocument();
    expect(screen.getByText("正在處理你的需求")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出訊息" })).toBeDisabled();
    resolveTurn(
      jsonResponse({
        data: {
          threadId: "web:0f289a92-7255-49f8-8332-e9f530d8f63c",
          reply: { text: "Finished" },
        },
      }),
    );
    expect(await screen.findByText("Finished")).toBeInTheDocument();
  });

  it("keeps a failed message visible and explains that it can be retried", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (String(input).endsWith("/api/v1/events")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse(
        { error: { code: "RUNTIME_UNAVAILABLE", message: "Ada could not answer." } },
        502,
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("傳訊息給 Ada"), "Please answer");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));

    expect(screen.getByText("Please answer")).toBeInTheDocument();
    expect(
      await screen.findByRole("status", {
        name: "Ada could not answer. 訊息仍保留在這裡，請再試一次。",
      }),
    ).toBeInTheDocument();
  });

  it("shows a proactive event without waiting for a user message", async () => {
    const user = userEvent.setup();
    render(<App />);
    const source = FakeEventSource.instances[0];

    source.emit("ready", { connected: true });
    source.emit("notification", {
      eventId: "gmail-event-1",
      source: "gmail",
      type: "message.created",
      title: "新信件需要你確認",
      summary: "客戶詢問合約版本",
      occurredAt: "2026-07-15T13:00:00.000Z",
    });

    expect(await screen.findByText("新信件需要你確認")).toBeInTheDocument();
    const bell = screen.getByRole("button", { name: "通知，1 則未讀" });
    await user.click(bell);
    expect(screen.getAllByText("客戶詢問合約版本")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "交給 Ada" }));
    expect(
      (screen.getByLabelText("傳訊息給 Ada") as HTMLTextAreaElement).value,
    ).toContain("新信件需要你確認");
  });

  it("does not show a duplicate proactive event twice", async () => {
    render(<App />);
    const source = FakeEventSource.instances[0];
    const event = {
      eventId: "gmail-event-1",
      source: "gmail",
      type: "message.created",
      title: "同一封信",
      occurredAt: "2026-07-15T13:00:00.000Z",
    };

    source.emit("notification", event);
    source.emit("notification", event);

    expect(
      await screen.findByRole("button", { name: "通知，1 則未讀" }),
    ).toBeInTheDocument();
  });

  it("recreates the proactive event stream after a connection error", async () => {
    vi.useFakeTimers();
    render(<App />);
    const first = FakeEventSource.instances[0];

    act(() => first.onerror?.(new Event("error")));
    expect(first.close).toHaveBeenCalledOnce();
    expect(screen.getByText("通知重新連線中")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => FakeEventSource.instances[1].emit("ready", { connected: true }));
    expect(screen.getByText("Ada 已就緒")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("reports runtime busy without marking Ada offline", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (String(input).endsWith("/api/v1/events")) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse(
        {
          error: {
            code: "RUNTIME_BUSY",
            message: "Ada is finishing another message. Try again shortly.",
          },
        },
        429,
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("傳訊息給 Ada"), "第二個工作");
    await user.click(screen.getByRole("button", { name: "送出訊息" }));

    expect(await screen.findByText("Ada 正在完成上一件事")).toBeInTheDocument();
    expect(screen.getByText("Ada 正忙，但連線正常")).toBeInTheDocument();
    expect(screen.queryByText("Ada 暫時離線")).not.toBeInTheDocument();
  });

  it("prompts an unauthenticated deployment to use official Codex login", async () => {
    sessionStorage.removeItem("digital-colleague-account-confirmed");
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) {
        return jsonResponse({
          data: {
            status: "ok",
            runtime: "codex-app-server",
            colleague: { id: "ada", name: "Ada" },
          },
        });
      }
      if (url.endsWith("/api/v1/events")) return jsonResponse({ data: [] });
      if (url.endsWith("/api/v1/runtime/account")) {
        return jsonResponse({
          data: { available: true, requiresOpenaiAuth: true, account: null },
        });
      }
      if (url.endsWith("/api/v1/runtime/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({ type: "chatgpt" });
        return jsonResponse({
          data: {
            type: "chatgpt",
            loginId: "login-1",
            authUrl: "https://auth.openai.com/authorize",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const popup = { location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as never);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "連接你的 Codex 帳號" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "使用 ChatGPT 登入" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.location.href).toBe("https://auth.openai.com/authorize");
    expect(screen.getByText("完成登入後，Ada 會自動確認連線狀態。")).toBeInTheDocument();
  });

  it("explains that the Codex runtime account can differ from connector accounts", async () => {
    sessionStorage.removeItem("digital-colleague-account-confirmed");

    render(<App />);

    expect(
      await screen.findByText(/這是 Ada 使用的 Codex runtime 帳號/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Gmail 等服務會在各自的官方 OAuth 頁面選擇另一個帳號/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "使用此 Codex 帳號" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/共用帳號，請切換/)).not.toBeInTheDocument();
  });

  it("does not send an empty message", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("button", { name: "送出訊息" })).toBeDisabled();
    await user.type(screen.getByLabelText("傳訊息給 Ada"), "   ");
    expect(screen.getByRole("button", { name: "送出訊息" })).toBeDisabled();
  });

  it("does not present an unavailable microphone as a broken primary action", () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /語音/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Codex 原生語音/)).not.toBeInTheDocument();
  });

  it("keeps the latest message anchored when the conversation viewport resizes", () => {
    render(<App />);
    const list = screen.getByRole("list");
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    list.scrollTop = 0;

    fireEvent(window, new Event("resize"));

    expect(list.scrollTop).toBe(800);
  });

});
