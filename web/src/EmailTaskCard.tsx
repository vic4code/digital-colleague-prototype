import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  GoogleOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  SyncOutlined,
  TeamOutlined,
  WindowsOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";
import type { ProactiveEvent } from "./api";

type TaskStatus =
  | "received"
  | "triaging"
  | "awaiting-approval"
  | "sending"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

const statusPresentation: Record<
  TaskStatus,
  { label: string; icon: ReactNode }
> = {
  received: {
    label: "已收到",
    icon: <ClockCircleOutlined aria-hidden="true" />,
  },
  triaging: {
    label: "Ada 整理中",
    icon: <SyncOutlined className="task-status-spinner" aria-hidden="true" />,
  },
  "awaiting-approval": {
    label: "等待核准",
    icon: <SafetyCertificateOutlined aria-hidden="true" />,
  },
  sending: {
    label: "正在寄送",
    icon: <SyncOutlined className="task-status-spinner" aria-hidden="true" />,
  },
  cancelling: {
    label: "停止中",
    icon: <SyncOutlined className="task-status-spinner" aria-hidden="true" />,
  },
  cancelled: {
    label: "已停止",
    icon: <StopOutlined aria-hidden="true" />,
  },
  completed: {
    label: "已完成",
    icon: <CheckCircleOutlined aria-hidden="true" />,
  },
  failed: {
    label: "需要處理",
    icon: <ExclamationCircleOutlined aria-hidden="true" />,
  },
};

function taskStatus(event: ProactiveEvent): TaskStatus {
  switch (event.phase) {
    case "received":
    case "triaging":
    case "sending":
    case "cancelling":
    case "cancelled":
    case "completed":
    case "failed":
      return event.phase;
    case "awaiting_approval":
      return "awaiting-approval";
  }
  const type = event.type;
  const normalized = type.toLowerCase().replace(/[.\-/:]+/g, "_");
  if (/(^|_)(failed|failure|error)(_|$)/.test(normalized)) return "failed";
  if (/(^|_)(cancelled|canceled)(_|$)/.test(normalized)) return "cancelled";
  if (/(^|_)(cancelling|canceling)(_|$)/.test(normalized)) return "cancelling";
  if (/(^|_)(completed|complete|succeeded|sent|replied|resolved|done)(_|$)/.test(normalized)) {
    return "completed";
  }
  if (
    normalized.includes("awaiting_approval") ||
    normalized.includes("approval_requested") ||
    normalized.includes("needs_approval") ||
    normalized.includes("review_required") ||
    normalized.includes("draft_ready")
  ) {
    return "awaiting-approval";
  }
  if (/(^|_)(triaging|processing|running|started|working)(_|$)/.test(normalized)) {
    return "triaging";
  }
  if (/(^|_)(sending|delivering)(_|$)/.test(normalized)) return "sending";
  return "received";
}

function taskSafetyNote(event: ProactiveEvent, status: TaskStatus): string {
  if (status === "sending") return "已開始寄送，停止可能來不及";
  if (status === "cancelling") return "已送出停止要求，等待確認";
  if (status === "cancelled") return "任務已停止；先前已寄出的內容無法撤回";
  if (event.replyPolicy === "approval_required") return "每次回覆都要核准";
  return "內容先由 Ada 安全整理";
}

function sourcePresentation(event: ProactiveEvent): {
  key: string;
  label: string;
  icon: ReactNode;
} {
  if (event.source === "teams" || event.type.toLowerCase().includes("teams")) {
    return {
      key: "teams",
      label: "Teams",
      icon: <TeamOutlined className="task-source-icon" aria-hidden="true" />,
    };
  }
  if (event.source === "gmail") {
    return {
      key: "gmail",
      label: "Gmail",
      icon: <GoogleOutlined className="task-source-icon" aria-hidden="true" />,
    };
  }
  if (event.source === "outlook") {
    return {
      key: "outlook",
      label: "Outlook",
      icon: <WindowsOutlined className="task-source-icon" aria-hidden="true" />,
    };
  }
  if (event.source === "notion") {
    return {
      key: "notion",
      label: "Notion",
      icon: <FileTextOutlined className="task-source-icon" aria-hidden="true" />,
    };
  }
  const fallbackLabels: Record<ProactiveEvent["source"], string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    teams: "Teams",
    calendar: "行事曆",
    slack: "Slack",
    notion: "Notion",
    system: "系統",
  };
  return {
    key: "fallback",
    label: fallbackLabels[event.source],
    icon: <BellOutlined className="task-source-icon" aria-hidden="true" />,
  };
}

function formatTaskTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function emailTaskDomId(eventId: string): string {
  return `email-task-${encodeURIComponent(eventId)}`;
}

interface EmailTaskCardProps {
  event: ProactiveEvent;
  cancelBusy?: boolean;
  cancelError?: string;
  onCancel?: (event: ProactiveEvent) => void;
}

export function EmailTaskCard({
  event,
  cancelBusy = false,
  cancelError,
  onCancel,
}: EmailTaskCardProps) {
  const source = sourcePresentation(event);
  const status = taskStatus(event);
  const statusView = statusPresentation[status];
  const taskId = event.taskId ?? event.eventId;
  const titleId = `${emailTaskDomId(taskId)}-title`;
  const canCancel =
    Boolean(event.taskId && onCancel) &&
    (["received", "triaging", "awaiting-approval", "sending"] as TaskStatus[]).includes(
      status,
    );

  return (
    <article
      className={`email-task-card source-${source.key} status-${status}`}
      id={emailTaskDomId(taskId)}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <header className="email-task-header">
        <span className="email-task-source-mark" aria-hidden="true">
          {source.icon}
        </span>
        <span className="email-task-source-copy">
          <strong>{source.label}</strong>
          <small>工作通知</small>
        </span>
        <time dateTime={event.occurredAt}>{formatTaskTime(event.occurredAt)}</time>
      </header>
      <div className="email-task-body">
        <h3 id={titleId}>{event.title}</h3>
        {event.summary && <p>{event.summary}</p>}
      </div>
      <footer className="email-task-footer">
        <div className="email-task-footer-main">
          <span className={`task-status task-status-${status}`}>
            {statusView.icon}
            {statusView.label}
          </span>
          <span className="task-safety-note">{taskSafetyNote(event, status)}</span>
          {canCancel && (
            <Button
              className="task-cancel-button"
              danger
              disabled={cancelBusy}
              loading={cancelBusy}
              size="small"
              icon={cancelBusy ? undefined : <StopOutlined aria-hidden="true" />}
              aria-label={cancelBusy ? "停止中…" : "停止"}
              onClick={() => onCancel?.(event)}
            >
              {cancelBusy ? "停止中…" : "停止"}
            </Button>
          )}
        </div>
        {canCancel && cancelError && (
          <p className="task-cancel-error" role="alert">{cancelError}</p>
        )}
      </footer>
    </article>
  );
}
