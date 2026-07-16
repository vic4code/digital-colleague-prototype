import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProactiveEvent } from "./api";
import { EmailTaskCard } from "./EmailTaskCard";

const baseEvent: ProactiveEvent = {
  eventId: "event-1",
  source: "gmail",
  type: "message.created",
  title: "新郵件需要處理",
  summary: "這是一段受限的安全摘要",
  occurredAt: "2026-07-15T13:00:00.000Z",
};

describe("EmailTaskCard", () => {
  it.each([
    ["gmail", "message.created", "Gmail", "已收到"],
    ["outlook", "task.triaging", "Outlook", "Ada 整理中"],
    ["teams", "message.created", "Teams", "已收到"],
    ["system", "teams.awaiting_approval", "Teams", "等待核准"],
    ["notion", "task.completed", "Notion", "已完成"],
    ["system", "task.failed", "系統", "需要處理"],
  ] as const)(
    "shows %s/%s with a source icon and %s state",
    (source, type, sourceLabel, statusLabel) => {
      render(
        <EmailTaskCard
          event={{ ...baseEvent, eventId: `${source}-${type}`, source, type }}
        />,
      );

      const card = screen.getByRole("article", { name: "新郵件需要處理" });
      expect(within(card).getByText(sourceLabel)).toBeInTheDocument();
      expect(within(card).getByText(statusLabel)).toBeInTheDocument();
      expect(card.querySelector(".task-source-icon")).not.toBeNull();
    },
  );

  it("keeps the task card programmatically focusable without making it a fake button", () => {
    render(<EmailTaskCard event={baseEvent} />);

    const card = screen.getByRole("article", { name: "新郵件需要處理" });
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prefers the server-authoritative phase over the event type fallback", () => {
    render(
      <EmailTaskCard
        event={{
          ...baseEvent,
          type: "message.created",
          phase: "completed",
          replyPolicy: "approval_required",
        }}
      />,
    );

    const card = screen.getByRole("article", { name: "新郵件需要處理" });
    expect(within(card).getByText("已完成")).toBeInTheDocument();
    expect(within(card).getByText("每次回覆都要核准")).toBeInTheDocument();
    expect(within(card).queryByText("已收到")).not.toBeInTheDocument();
  });

  it("falls back safely when an older server sends an unknown phase", () => {
    render(
      <EmailTaskCard
        event={{
          ...baseEvent,
          type: "task.failed",
          phase: "unknown" as NonNullable<ProactiveEvent["phase"]>,
        }}
      />,
    );

    expect(screen.getByText("需要處理")).toBeInTheDocument();
  });

  it.each([
    ["sending", "正在寄送"],
    ["cancelling", "停止中"],
    ["cancelled", "已停止"],
  ] as const)("shows the server-authoritative %s phase", (phase, label) => {
    render(
      <EmailTaskCard
        event={{
          ...baseEvent,
          taskId: "gmail-message-1",
          phase: phase as NonNullable<ProactiveEvent["phase"]>,
        }}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(["received", "triaging", "awaiting_approval", "sending"] as const)(
    "lets the user stop an active %s task",
    async (phase) => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const event = {
        ...baseEvent,
        taskId: "gmail-message-1",
        phase: phase as NonNullable<ProactiveEvent["phase"]>,
      };
      render(<EmailTaskCard event={event} onCancel={onCancel} />);

      await user.click(screen.getByRole("button", { name: "停止" }));

      expect(onCancel).toHaveBeenCalledOnce();
      expect(onCancel).toHaveBeenCalledWith(event);
      if (phase === "sending") {
        expect(
          screen.getByText("已開始寄送，停止可能來不及"),
        ).toBeInTheDocument();
      }
    },
  );

  it.each(["completed", "failed", "cancelling", "cancelled"] as const)(
    "does not offer a misleading stop action for a %s task",
    (phase) => {
      render(
        <EmailTaskCard
          event={{
            ...baseEvent,
            taskId: "gmail-message-1",
            phase: phase as NonNullable<ProactiveEvent["phase"]>,
          }}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
    },
  );

  it("shows an honest pending and failure state for a stop request", () => {
    render(
      <EmailTaskCard
        event={{
          ...baseEvent,
          taskId: "gmail-message-1",
          phase: "triaging",
        }}
        cancelBusy
        cancelError="目前無法停止，任務可能仍在進行。"
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "停止中…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "目前無法停止，任務可能仍在進行。",
    );
  });
});
