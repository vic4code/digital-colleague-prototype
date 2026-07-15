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
  CheckCircleOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Avatar, Button, ConfigProvider, Input, Tooltip } from "antd";
import type { GetRef } from "antd";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { getHealth, postTurn } from "./api";
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

export function App({ voiceSupported = false }: AppProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("checking");
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
    void getHealth().then(
      () => {
        if (active) setRuntimeStatus("ready");
      },
      () => {
        if (active) setRuntimeStatus("offline");
      },
    );
    return () => {
      active = false;
    };
  }, []);

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
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="數位同事首頁">
            <Avatar
              className="brand-mark"
              src="/favicon.svg"
              alt="Ada"
            />
            <span>
              <strong className="brand-name">Ada</strong>
              <small className="brand-descriptor">你的數位同事</small>
            </span>
          </a>
          <div className={`runtime-pill ${runtimeStatus}`} role="status">
            <span aria-hidden="true" />
            {runtimeStatus === "ready"
              ? "Ada 已就緒"
              : runtimeStatus === "offline"
                ? "Ada 暫時離線"
                : "Ada 正在準備…"}
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
    </ConfigProvider>
  );
}
