import {
  FileTextOutlined,
  GoogleOutlined,
  TeamOutlined,
  WindowsOutlined,
} from "@ant-design/icons";
import { Button } from "antd";

const connectorTests = [
  {
    key: "gmail",
    name: "Gmail",
    scope: "最新 3 封郵件",
    icon: <GoogleOutlined className="connector-test-icon" aria-hidden="true" />,
    prompt:
      "使用官方 Gmail connector 做唯讀連線測試：最多查看最新 3 封郵件；不要變更已讀狀態、標籤、封存、草稿或寄送，也不要顯示寄件者、主旨或內文。只回覆 connector 可用／不可用、查到的筆數，以及 metadata 是否提供已連接帳號；沒有就寫 unknown。",
  },
  {
    key: "notion",
    name: "Notion",
    scope: "小範圍知識搜尋",
    icon: <FileTextOutlined className="connector-test-icon" aria-hidden="true" />,
    prompt:
      "使用官方 Notion connector 做唯讀連線測試：只做小範圍搜尋，最多查看 3 筆結果；不要建立、修改、移動、留言或刪除，也不要顯示頁面標題或內容。只回覆 connector 可用／不可用、查到的筆數，以及 metadata 是否提供已連接帳號；沒有就寫 unknown。",
  },
  {
    key: "outlook",
    name: "Outlook",
    scope: "最新 3 封郵件",
    icon: <WindowsOutlined className="connector-test-icon" aria-hidden="true" />,
    prompt:
      "使用官方 Outlook Email connector 做唯讀連線測試：最多查看最新 3 封郵件；不要變更已讀狀態、分類、封存、草稿或寄送，也不要顯示寄件者、主旨或內文。只回覆 connector 可用／不可用、查到的筆數，以及 metadata 是否提供已連接帳號；沒有就寫 unknown。",
  },
  {
    key: "teams",
    name: "Teams",
    scope: "小範圍訊息搜尋",
    icon: <TeamOutlined className="connector-test-icon" aria-hidden="true" />,
    prompt:
      "使用官方 Microsoft Teams connector 做唯讀連線測試：只做小範圍搜尋，最多查看 3 筆結果；不要傳送訊息、回覆、反應或修改，也不要顯示訊息內容。只回覆 connector 可用／不可用、查到的筆數，以及 metadata 是否提供已連接帳號；沒有就寫 unknown。",
  },
] as const;

interface ConnectorQuickTestsProps {
  disabled: boolean;
  onRun(prompt: string): void;
}

export function ConnectorQuickTests({
  disabled,
  onRun,
}: ConnectorQuickTestsProps) {
  return (
    <section className="connector-tests" aria-labelledby="connector-tests-title">
      <div className="connector-tests-heading">
        <strong id="connector-tests-title">連接器快速測試</strong>
        <span>由目前 Codex 帳號執行 · 需要 OAuth 時再選服務帳號</span>
      </div>
      <div className="connector-test-grid">
        {connectorTests.map((test) => (
          <Button
            block
            className={`connector-test-button ${test.key}`}
            disabled={disabled}
            icon={test.icon}
            key={test.key}
            aria-label={`測試 ${test.name}`}
            onClick={() => onRun(test.prompt)}
          >
            <span className="connector-test-copy">
              <strong>{test.name}</strong>
              <small>{test.scope}</small>
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}
