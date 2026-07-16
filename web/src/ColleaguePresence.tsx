import {
  CalendarOutlined,
  DesktopOutlined,
  MailOutlined,
  NumberOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { Collapse, Tag } from "antd";

export type RuntimeStatus =
  | "checking"
  | "ready"
  | "busy"
  | "reconnecting"
  | "offline";
export type ActivityKind = "available" | "thinking" | "listening" | "attention";

export interface ColleagueActivity {
  kind: ActivityKind;
  label: string;
  detail: string;
}

interface ColleaguePresenceProps {
  runtimeStatus: RuntimeStatus;
  activity: ColleagueActivity;
  currentFocus: string;
}

export function ColleaguePresence({
  runtimeStatus,
  activity,
  currentFocus,
}: ColleaguePresenceProps) {
  const presenceLabel =
    runtimeStatus === "ready"
      ? activity.kind === "thinking"
        ? "在線 · 正在處理"
        : "在線 · 可以開始"
      : runtimeStatus === "busy"
        ? "在線 · 正在處理其他工作"
        : runtimeStatus === "reconnecting"
          ? "在線 · 通知重新連線中"
      : runtimeStatus === "offline"
        ? "離線 · 可重新連線"
        : "正在連線…";

  return (
    <aside className={`colleague-stage ${activity.kind}`} aria-labelledby="colleague-name">
      <div className="stage-identity">
        <p className="eyebrow">和你一起工作</p>
        <div className="identity-heading">
          <h1 id="colleague-name">Ada</h1>
          <Tag variant="filled" color="green">法務營運分析師</Tag>
        </div>
        <p className={`presence ${runtimeStatus}`}>
          <span aria-hidden="true" />
          {presenceLabel}
        </p>
        <div className={`activity-card ${activity.kind}`}>
          <span className="activity-light" aria-hidden="true" />
          <div>
            <span className="activity-kicker">現在</span>
            <strong>{activity.label}</strong>
            <p>{activity.detail}</p>
          </div>
        </div>
      </div>

      <div className="character-scene" aria-label="Ada 目前的工作狀態">
        <div className="scene-glow" aria-hidden="true" />
        <div className="focus-card">
          <div className="focus-card-header">
            <span>目前處理</span>
            <span className={`focus-state ${activity.kind}`} aria-hidden="true">
              <i />
            </span>
          </div>
          <strong>{currentFocus}</strong>
        </div>
        <div className="character-render">
          <span className="character-aura" aria-hidden="true" />
          <picture className="character-art">
            <img
              src="/ada-illustrated-full.webp"
              width="720"
              height="1280"
              alt="Ada，你的數位同事"
              decoding="async"
            />
          </picture>
          <span className="voice-wave voice-wave-one" aria-hidden="true" />
          <span className="voice-wave voice-wave-two" aria-hidden="true" />
          <span className="character-spark character-spark-one" aria-hidden="true" />
          <span className="character-spark character-spark-two" aria-hidden="true" />
        </div>
        <div className="scene-floor" aria-hidden="true" />
      </div>

      <Collapse
        className="channel-area"
        ghost
        size="small"
        items={[{
          key: "tools",
          label: "工作管道與工具",
          forceRender: true,
          children: (
            <div className="channel-strip" aria-label="可設定的工作管道與工具">
              <Tag icon={<DesktopOutlined />}>Computer Use</Tag>
              <Tag icon={<MailOutlined />}>Gmail</Tag>
              <Tag icon={<CalendarOutlined />}>Google Calendar</Tag>
              <Tag icon={<MailOutlined />}>Outlook Email</Tag>
              <Tag icon={<CalendarOutlined />}>Outlook Calendar</Tag>
              <Tag icon={<NumberOutlined />}>Slack</Tag>
              <Tag icon={<ReadOutlined />}>Notion</Tag>
            </div>
          ),
        }]}
      />
    </aside>
  );
}
