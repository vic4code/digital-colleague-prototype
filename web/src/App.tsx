import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AudioOutlined,
  BellOutlined,
  CheckCircleOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Input,
  Modal,
  Popover,
  Tooltip,
  notification,
} from "antd";
import type { GetRef } from "antd";
import { useVoiceRecorder } from "./useVoiceRecorder";
import {
  ApiError,
  getHealth,
  getProactiveEvents,
  getRuntimeAccount,
  postTurn,
  startRuntimeLogin,
  subscribeToProactiveEvents,
  type ProactiveEvent,
  type RuntimeAccountStatus,
  type RuntimeLoginStart,
} from "./api";
import {
  ColleaguePresence,
  type ColleagueActivity,
  type RuntimeStatus,
} from "./ColleaguePresence";
import { MessageContent } from "./MessageContent";
import "./styles.css";

interface Message {
  id: number;
  role: "ada" | "human";
  text: string;
  time: string;
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: "ada",
    text: "嗨，我是 Ada。\n今天想一起完成什麼？",
    time: "現在",
  },
];

const starterPrompts = [
  {
    number: "01",
    label: "整理今天重點",
    detail: "從行事曆與待辦開始",
    prompt: "幫我整理今天最重要的三件事",
  },
  {
    number: "02",
    label: "查看待處理信件",
    detail: "找出需要你回覆的內容",
    prompt: "幫我看看最近有哪些信需要處理",
  },
  {
    number: "03",
    label: "看看目前畫面",
    detail: "使用 Computer Use 協助你",
    prompt: "用 Computer Use 看看我目前的畫面",
  },
];

interface AppProps {
  voiceSupported?: boolean;
}

type TextAreaRef = GetRef<typeof Input.TextArea>;

const eventSourceLabels: Record<ProactiveEvent["source"], string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  calendar: "行事曆",
  slack: "Slack",
  notion: "Notion",
  system: "系統",
};

const ACCOUNT_CONFIRMATION_KEY = "digital-colleague-account-confirmed";

function accountIdentity(status: RuntimeAccountStatus): string | undefined {
  if (!status.account) return undefined;
  return status.account.email ?? status.account.type;
}

function sourceLabel(source: ProactiveEvent["source"]): string {
  return eventSourceLabels[source];
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function App({ voiceSupported = false }: AppProps) {
  const [notificationApi, notificationContextHolder] = notification.useNotification();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("checking");
  const [proactiveEvents, setProactiveEvents] = useState<ProactiveEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestAnnouncement, setLatestAnnouncement] = useState("");
  const [runtimeAccount, setRuntimeAccount] = useState<RuntimeAccountStatus>();
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [loginStart, setLoginStart] = useState<RuntimeLoginStart>();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [eventStreamGeneration, setEventStreamGeneration] = useState(0);
  const seenEventIdsRef = useRef(new Set<string>());
  const eventStreamReadyRef = useRef(false);
  const healthOnlineRef = useRef<boolean | undefined>(undefined);
  const messageListRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<TextAreaRef>(null);
  const followConversationRef = useRef(true);
  const [threadId, setThreadId] = useState<string | undefined>(() => {
    try {
      return sessionStorage.getItem("digital-colleague-thread") ?? undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    let active = true;
    let checking = false;
    let retryDelay = 3_000;
    let timer: number | undefined;
    const check = () => {
      if (checking) return;
      checking = true;
      let succeeded = false;
      void getHealth().then(
        () => {
          if (!active) return;
          succeeded = true;
          healthOnlineRef.current = true;
          setRuntimeStatus((current) => {
            if (current === "busy" || current === "reconnecting") return current;
            if (current === "offline" && !eventStreamReadyRef.current) {
              return "reconnecting";
            }
            return "ready";
          });
        },
        () => {
          if (!active) return;
          eventStreamReadyRef.current = false;
          if (healthOnlineRef.current !== false) {
            setEventStreamGeneration((current) => current + 1);
          }
          healthOnlineRef.current = false;
          setRuntimeStatus("offline");
        },
      ).finally(() => {
        checking = false;
        if (!active) return;
        const nextDelay = retryDelay;
        retryDelay = succeeded ? 3_000 : Math.min(retryDelay * 2, 30_000);
        timer = window.setTimeout(check, nextDelay);
      });
    };
    check();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getRuntimeAccount().then(
      (status) => {
        if (!active) return;
        setRuntimeAccount(status);
        if (status.available && status.requiresOpenaiAuth) {
          const identity = accountIdentity(status);
          let confirmed: string | null = null;
          try {
            confirmed = sessionStorage.getItem(ACCOUNT_CONFIRMATION_KEY);
          } catch {
            // If session storage is unavailable, show the safe account choice.
          }
          if (!identity || confirmed !== identity) setAccountDialogOpen(true);
        }
      },
      () => {
        // Older/echo deployments can keep using chat without account onboarding.
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loginStart) return;
    const timer = window.setInterval(() => {
      void getRuntimeAccount().then(
        (status) => {
          setRuntimeAccount(status);
          if (status.account) {
            const identity = accountIdentity(status);
            if (identity) {
              try {
                sessionStorage.setItem(ACCOUNT_CONFIRMATION_KEY, identity);
              } catch {
                // Account switching still succeeds without browser storage.
              }
            }
            setAccountDialogOpen(false);
            setLoginStart(undefined);
            setLoginError("");
          }
        },
        () => undefined,
      );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [loginStart]);

  useEffect(() => {
    let active = true;

    const acceptEvent = (event: ProactiveEvent, announce: boolean) => {
      if (!active || seenEventIdsRef.current.has(event.eventId)) return;
      seenEventIdsRef.current.add(event.eventId);
      setProactiveEvents((current) => [event, ...current].slice(0, 100));
      if (!announce) return;
      setUnreadCount((current) => current + 1);
      setLatestAnnouncement(`${event.title}${event.summary ? `：${event.summary}` : ""}`);
      notificationApi.open({
        title: event.title,
        description: event.summary ?? sourceLabel(event.source),
        placement: "topRight",
        duration: 6,
      });
    };

    const unsubscribe = subscribeToProactiveEvents({
      onReady: () => {
        eventStreamReadyRef.current = true;
        setRuntimeStatus((current) =>
          current === "busy" ? current : "ready",
        );
      },
      onEvent: (event) => acceptEvent(event, true),
      onError: () => {
        eventStreamReadyRef.current = false;
        setRuntimeStatus((current) =>
          current === "ready" || current === "checking" ? "reconnecting" : current,
        );
      },
    });

    void getProactiveEvents().then(
      (events) => events.slice().reverse().forEach((event) => acceptEvent(event, false)),
      () => {
        // EventSource reconnects independently; a failed replay must not break chat.
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [eventStreamGeneration, notificationApi]);

  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list || !followConversationRef.current) return;
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top: list.scrollHeight });
    } else {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const keepLatestVisible = () => {
      if (followConversationRef.current) list.scrollTop = list.scrollHeight;
    };
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", keepLatestVisible);
      return () => window.removeEventListener("resize", keepLatestVisible);
    }
    const observer = new ResizeObserver(keepLatestVisible);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const voice = useVoiceRecorder({
    supported: voiceSupported,
    onTranscript: (transcript) => {
      setDraft(transcript);
      setNotice("語音已轉成文字，確認內容後就可以送出。");
    },
    onError: setNotice,
  });

  const canSend = draft.trim().length > 0 && !voice.isBusy && !isSending;

  async function beginRuntimeLogin(type: "chatgpt" | "chatgptDeviceCode") {
    const popup = window.open("about:blank", "_blank");
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await startRuntimeLogin(type);
      const destination = result.type === "chatgpt" ? result.authUrl : result.verificationUrl;
      const url = new URL(destination);
      if (url.protocol !== "https:") throw new Error("登入網址不安全，已停止開啟。");
      if (popup) {
        popup.opener = null;
        popup.location.href = url.toString();
      }
      setLoginStart(result);
    } catch (error) {
      popup?.close();
      setLoginError(error instanceof Error ? error.message : "目前無法開始 Codex 登入。");
    } finally {
      setLoginBusy(false);
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;

    followConversationRef.current = true;
    const humanMessageId = Date.now();
    const adaMessageId = humanMessageId + 1;
    setMessages((current) => [
      ...current,
      { id: humanMessageId, role: "human", text, time: "現在" },
    ]);
    setDraft("");
    setNotice("Ada 正在思考…");
    setIsSending(true);
    let streamedText = "";
    try {
      const result = await postTurn(text, threadId, (delta) => {
        streamedText += delta;
        setMessages((current) => {
          const existing = current.findIndex(
            (message) => message.id === adaMessageId,
          );
          if (existing < 0) {
            return [
              ...current,
              { id: adaMessageId, role: "ada", text: streamedText, time: "現在" },
            ];
          }
          return current.map((message) =>
            message.id === adaMessageId
              ? { ...message, text: streamedText }
              : message,
          );
        });
        setNotice("");
      });
      setThreadId(result.threadId);
      try {
        sessionStorage.setItem("digital-colleague-thread", result.threadId);
      } catch {
        // Conversation still works if browser storage is unavailable.
      }
      setMessages((current) => {
        const finalMessage = {
          id: adaMessageId,
          role: "ada" as const,
          text: result.reply.text,
          time: "現在",
        };
        return current.some((message) => message.id === adaMessageId)
          ? current.map((message) =>
              message.id === adaMessageId ? finalMessage : message,
            )
          : [...current, finalMessage];
      });
      setNotice("");
      setRuntimeStatus("ready");
    } catch (error) {
      if (error instanceof ApiError && error.code === "RUNTIME_BUSY") {
        setNotice("Ada 正在完成上一件事");
        setRuntimeStatus("busy");
        return;
      }
      const message = error instanceof Error ? error.message : "Ada 暫時無法回覆。";
      setNotice(`${message} 訊息仍保留在這裡，請再試一次。`);
      setRuntimeStatus("offline");
    } finally {
      setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) void sendMessage();
    }
  }

  const recordingLabel = voice.isRecording
    ? "停止語音錄製"
    : voiceSupported
      ? "錄製語音訊息"
      : "語音輸入尚未連接";

  let activity: ColleagueActivity;
  if (voice.isRecording) {
    activity = {
      kind: "listening",
      label: "正在聽你說話",
      detail: "我會先把語音轉成文字，讓你確認後再送出。",
    };
  } else if (voice.state === "requesting" || voice.state === "transcribing") {
    activity = {
      kind: "listening",
      label: "正在整理你的語音",
      detail: "我正在把語音轉成可編輯的文字。",
    };
  } else if (isSending) {
    activity = {
      kind: "thinking",
      label: "正在處理你的需求",
      detail: "我正在處理，完成後會直接在這個對話回覆。",
    };
  } else if (runtimeStatus === "busy") {
    activity = {
      kind: "thinking",
      label: "Ada 正忙，但連線正常",
      detail: "上一件工作還在處理，稍後再送出即可。",
    };
  } else if (runtimeStatus === "reconnecting") {
    activity = {
      kind: "attention",
      label: "正在重新連接通知",
      detail: "對話仍可使用，主動通知會自動恢復連線。",
    };
  } else if (runtimeStatus === "offline") {
    activity = {
      kind: "attention",
      label: "需要你確認",
      detail: "本機 Codex runtime 目前離線，對話內容仍會保留。",
    };
  } else if (runtimeStatus === "checking") {
    activity = {
      kind: "thinking",
      label: "正在進入工作狀態",
      detail: "我正在連接本機 Codex runtime。",
    };
  } else {
    activity = {
      kind: "available",
      label: "可以開始",
      detail: "我在這裡，直接告訴我你想推進哪件事。",
    };
  }

  const latestHumanMessage = [...messages].reverse().find((message) => message.role === "human");
  const currentFocus = isSending && latestHumanMessage
    ? latestHumanMessage.text
    : "等你交辦下一件事";

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#176b52",
          colorInfo: "#176b52",
          colorSuccess: "#2f7a5f",
          colorText: "#17221e",
          colorTextSecondary: "#607069",
          colorBgLayout: "#f2f5f3",
          colorBgContainer: "#ffffff",
          colorBorder: "#dfe6e2",
          borderRadius: 12,
          controlHeight: 42,
          fontFamily:
            '"Segoe UI Variable", "Noto Sans TC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: { primaryShadow: "none" },
          Input: { activeShadow: "0 0 0 3px rgba(23, 107, 82, 0.12)" },
        },
      }}
    >
      {notificationContextHolder}
      <div className="sr-only" aria-live="polite">{latestAnnouncement}</div>
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="數位同事首頁">
            <Avatar
              className="brand-mark"
              src="/ada-favicon.svg"
              alt="Ada"
            />
            <span>
              <strong className="brand-name">Ada</strong>
              <small className="brand-descriptor">你的數位同事</small>
            </span>
          </a>
          <div className="topbar-actions">
            <Popover
              trigger="click"
              placement="bottomRight"
              onOpenChange={(open) => {
                if (open) setUnreadCount(0);
              }}
              content={
                <div className="notification-inbox">
                  <div className="notification-inbox-heading">
                    <strong>主動通知</strong>
                    <span>{proactiveEvents.length} 則</span>
                  </div>
                  {proactiveEvents.length === 0 ? (
                    <p className="notification-empty">目前沒有新通知</p>
                  ) : (
                    <ol className="notification-list">
                      {proactiveEvents.map((event) => (
                        <li className="notification-item" key={event.eventId}>
                          <div className="notification-meta">
                            <span>{sourceLabel(event.source)}</span>
                            <time dateTime={event.occurredAt}>{formatEventTime(event.occurredAt)}</time>
                          </div>
                          <strong>{event.title}</strong>
                          {event.summary && <p>{event.summary}</p>}
                          <Button
                            type="link"
                            size="small"
                            onClick={() => {
                              setDraft(
                                `請處理這則${sourceLabel(event.source)}通知：${event.title}${event.summary ? `（${event.summary}）` : ""}`,
                              );
                              requestAnimationFrame(() => composerRef.current?.focus());
                            }}
                          >
                            交給 Ada
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              }
            >
              <Badge count={unreadCount} size="small">
                <Button
                  className="notification-button"
                  type="text"
                  shape="circle"
                  icon={<BellOutlined />}
                  aria-label={unreadCount > 0 ? `通知，${unreadCount} 則未讀` : "通知"}
                />
              </Badge>
            </Popover>
            {runtimeAccount?.available && (
              <Tooltip
                title={runtimeAccount.account?.email ?? "Codex 帳號"}
              >
                <Button
                  className="account-button"
                  type="text"
                  shape="circle"
                  icon={<UserOutlined />}
                  aria-label={
                    runtimeAccount.account
                      ? `Codex 帳號：${runtimeAccount.account.email ?? runtimeAccount.account.type}`
                      : "連接 Codex 帳號"
                  }
                  onClick={() => setAccountDialogOpen(true)}
                />
              </Tooltip>
            )}
            <div className={`runtime-pill ${runtimeStatus}`} role="status">
              <span aria-hidden="true" />
              {runtimeStatus === "ready"
                ? "Ada 已就緒"
                : runtimeStatus === "busy"
                  ? "Ada 正忙"
                  : runtimeStatus === "reconnecting"
                    ? "通知重新連線中"
                    : runtimeStatus === "offline"
                      ? "Ada 暫時離線"
                      : "Ada 正在準備…"}
            </div>
          </div>
        </header>

        <main className="workspace">
          <ColleaguePresence
            runtimeStatus={runtimeStatus}
            activity={activity}
            currentFocus={currentFocus}
          />

          <section className="conversation" aria-label="與 Ada 的對話">
            <header className="conversation-header">
              <div>
                <h2>與 Ada 對話</h2>
                <p>把工作交給她，進度與結果都會留在這裡。</p>
              </div>
              <span className="conversation-context">今天</span>
            </header>

            <ol
              className={`message-list ${messages.length === 1 ? "is-welcome" : ""}`}
              aria-live="polite"
              ref={messageListRef}
              onScroll={(event) => {
                const list = event.currentTarget;
                const distanceFromBottom =
                  list.scrollHeight - list.scrollTop - list.clientHeight;
                followConversationRef.current = distanceFromBottom < 80;
              }}
            >
              {messages.map((message) => (
                <li className={`message-row ${message.role}`} key={message.id}>
                  {message.role === "ada" && (
                    <Avatar className="message-avatar" src="/ada-illustrated-avatar.webp">A</Avatar>
                  )}
                  <article className="message-bubble">
                    <div className="message-meta">
                      <strong>{message.role === "ada" ? "Ada" : "你"}</strong>
                      <time>{message.time}</time>
                    </div>
                    {message.role === "ada" ? (
                      <MessageContent text={message.text} />
                    ) : (
                      <p>{message.text}</p>
                    )}
                  </article>
                </li>
              ))}
              {messages.length === 1 && (
                <li className="starter-actions" aria-label="常用交辦方式">
                  <div className="starter-heading">
                    <span>建議你先從這裡開始</span>
                    <small>也可以直接在下方輸入任何工作</small>
                  </div>
                  <div className="starter-grid">
                    {starterPrompts.map((item) => (
                      <Button
                        type="text"
                        className="starter-card"
                        key={item.number}
                        onClick={() => {
                          setDraft(item.prompt);
                          requestAnimationFrame(() => composerRef.current?.focus());
                        }}
                      >
                        <span className="starter-number">{item.number}</span>
                        <span className="starter-copy">
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </span>
                      </Button>
                    ))}
                  </div>
                </li>
              )}
            </ol>

            <div className="composer-wrap">
              {notice && <div className="notice" role="status" aria-label={notice}>{notice}</div>}
              {voice.isRecording && (
                <div className="recording-banner" role="status">
                  <span className="recording-dot" aria-hidden="true" /> 正在錄音，說完後請按停止
                </div>
              )}
              <form className={`composer ${voiceSupported ? "has-voice" : ""}`} onSubmit={(event) => void sendMessage(event)}>
                {voiceSupported && (
                  <Tooltip title={recordingLabel}>
                    <Button
                      className={`voice-button ${voice.isRecording ? "active" : ""}`}
                      type="text"
                      shape="circle"
                      icon={<AudioOutlined />}
                      aria-label={recordingLabel}
                      aria-pressed={voice.isRecording}
                      disabled={voice.isBusy || isSending}
                      onClick={() => void voice.toggle()}
                    />
                  </Tooltip>
                )}
                <label className="sr-only" htmlFor="message-composer">傳訊息給 Ada</label>
                <Input.TextArea
                  id="message-composer"
                  ref={composerRef}
                  value={draft}
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  style={{
                    boxSizing: "border-box",
                    borderWidth: 0,
                    fontSize: 15,
                    lineHeight: 1.5,
                    paddingTop: 9,
                    paddingBottom: 7,
                  }}
                  variant="borderless"
                  placeholder={voice.state === "transcribing" ? "正在轉成文字…" : "交辦一件工作給 Ada"}
                  aria-label="傳訊息給 Ada"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <Tooltip title="送出訊息">
                  <Button
                    className="send-button"
                    type="primary"
                    shape="circle"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    aria-label="送出訊息"
                    disabled={!canSend}
                  />
                </Tooltip>
              </form>
              <p className="composer-hint">
                {voiceSupported && <><CheckCircleOutlined /> 語音會先轉成文字，確認後再送出</>}
                {!voiceSupported && "Enter 送出，Shift + Enter 換行"}
              </p>
            </div>
          </section>
        </main>
      </div>
      <Modal
        title="連接你的 Codex 帳號"
        open={accountDialogOpen}
        footer={null}
        mask={{ closable: false }}
        onCancel={() => setAccountDialogOpen(false)}
      >
        <div className="account-onboarding">
          {runtimeAccount?.account ? (
            <p>
              目前已連接 <strong>{runtimeAccount.account.email ?? runtimeAccount.account.type}</strong>。
              若這是共用帳號，請切換成你自己的帳號。
            </p>
          ) : (
            <p>
              Ada 會透過本機 Codex app-server 工作。請使用你自己的 ChatGPT / Codex
              帳號登入；Ada 不會取得你的密碼或原始 token。
            </p>
          )}
          {loginStart?.type === "chatgptDeviceCode" && (
            <div className="device-code">
              <span>裝置驗證碼</span>
              <strong>{loginStart.userCode}</strong>
            </div>
          )}
          {loginStart && (
            <p className="login-progress" role="status">
              完成登入後，Ada 會自動確認連線狀態。
            </p>
          )}
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
          <div className="account-actions">
            {runtimeAccount?.account && (
              <Button
                type="primary"
                onClick={() => {
                  const identity = accountIdentity(runtimeAccount);
                  if (identity) {
                    try {
                      sessionStorage.setItem(ACCOUNT_CONFIRMATION_KEY, identity);
                    } catch {
                      // Closing the dialog remains available without storage.
                    }
                  }
                  setAccountDialogOpen(false);
                }}
              >
                使用此帳號
              </Button>
            )}
            <Button
              type={runtimeAccount?.account ? "default" : "primary"}
              loading={loginBusy}
              onClick={() => void beginRuntimeLogin("chatgpt")}
            >
              {runtimeAccount?.account ? "切換 ChatGPT 帳號" : "使用 ChatGPT 登入"}
            </Button>
            <Button
              disabled={loginBusy}
              onClick={() => void beginRuntimeLogin("chatgptDeviceCode")}
            >
              使用裝置驗證碼
            </Button>
            <Button type="text" onClick={() => setAccountDialogOpen(false)}>
              稍後再說
            </Button>
          </div>
        </div>
      </Modal>
    </ConfigProvider>
  );
}
