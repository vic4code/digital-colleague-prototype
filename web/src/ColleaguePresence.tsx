import { BookOpen, Calendar, Mail, MonitorCog } from "lucide-react";

export type RuntimeStatus = "checking" | "ready" | "offline";
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
      ? "在線 · 可以開始"
      : runtimeStatus === "offline"
        ? "離線 · 可重新連線"
        : "正在連線…";

  return (
    <aside className={`colleague-stage ${activity.kind}`} aria-labelledby="colleague-name">
      <div className="stage-identity">
        <p className="eyebrow">和你一起工作</p>
        <h1 id="colleague-name">Ada</h1>
        <p className="role-title">法務營運分析師</p>
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
        <div className="scene-grid" aria-hidden="true" />
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
            <source media="(max-width: 600px)" srcSet="/ada-executive-portrait.webp" />
            <img
              src="/ada-executive-three-quarter.webp"
              width="500"
              height="1100"
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
        <div className="character-nameplate" aria-hidden="true">
          <strong>Ada</strong>
          <span>Legal Ops</span>
        </div>
      </div>

      <details className="channel-area">
        <summary>工作管道與工具</summary>
        <div className="channel-strip" aria-label="可設定的工作管道與工具">
          <span><MonitorCog size={14} /> Computer Use</span>
          <span><Mail size={14} /> Gmail</span>
          <span><Calendar size={14} /> Google Calendar</span>
          <span><Mail size={14} /> Outlook Email</span>
          <span><Calendar size={14} /> Outlook Calendar</span>
          <span><span className="slack-mark" aria-hidden="true">#</span> Slack</span>
          <span><BookOpen size={14} /> Notion</span>
        </div>
      </details>
    </aside>
  );
}
