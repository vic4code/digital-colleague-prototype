import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  Mic,
  Send,
  Sparkles,
} from "lucide-react";
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

export function App({ voiceSupported = false }: AppProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("checking");
  const messageListRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
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

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    const nextHeight = Math.min(Math.max(composer.scrollHeight, 40), 132);
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = composer.scrollHeight > 132 ? "auto" : "hidden";
  }, [draft]);

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
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "human", text, time: "現在" },
    ]);
    setDraft("");
    setNotice("Ada 正在思考…");
    setIsSending(true);
    try {
      const result = await postTurn(text, threadId);
      setThreadId(result.threadId);
      try {
        sessionStorage.setItem("digital-colleague-thread", result.threadId);
      } catch {
        // Conversation still works if browser storage is unavailable.
      }
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: "ada", text: result.reply.text, time: "現在" },
      ]);
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
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="數位同事首頁">
          <span className="brand-mark" aria-hidden="true"><Sparkles size={18} /></span>
          <span className="brand-name">ADA</span>
          <span className="brand-descriptor">DIGITAL COLLEAGUE</span>
        </a>
        <div className={`runtime-pill ${runtimeStatus}`}>
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

        <section className={`conversation ${messages.length === 1 ? "is-welcome" : ""}`} aria-label="與 Ada 的對話">
          <h2 className="sr-only">與 Ada 的對話</h2>
          <header className="conversation-header" aria-hidden="true">
            <span>CONVERSATION</span>
            <span>01 / ADA</span>
          </header>
          {messages.length > 1 && <div className="date-divider"><span>今天</span></div>}
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
                <span>直接交辦，或從這裡開始</span>
                <div>
                  {starterPrompts.map((item) => (
                    <button
                      type="button"
                      key={item.number}
                      onClick={() => {
                        setDraft(item.prompt);
                        requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    >
                      <span>{item.number}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </button>
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
                <button
                  className={`voice-button ${voice.isRecording ? "active" : ""}`}
                  type="button"
                  aria-label={recordingLabel}
                  aria-pressed={voice.isRecording}
                  disabled={voice.isBusy || isSending}
                  onClick={() => void voice.toggle()}
                >
                  <Mic size={21} />
                </button>
              )}
              <label className="sr-only" htmlFor="message-composer">傳訊息給 Ada</label>
              <textarea
                id="message-composer"
                ref={composerRef}
                value={draft}
                rows={1}
                placeholder={voice.state === "transcribing" ? "正在轉成文字…" : "跟 Ada 說…"}
                aria-label="傳訊息給 Ada"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <button className="send-button" type="submit" aria-label="送出訊息" disabled={!canSend}>
                <Send size={19} />
              </button>
            </form>
            {voiceSupported && (
              <p className="composer-hint">
                <Check size={13} />
                語音會先轉成文字，確認後再送出
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
