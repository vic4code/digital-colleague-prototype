import { Fragment, type ReactNode } from "react";

interface MessageContentProps {
  text: string;
}

type MessageBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "code"; language: string; lines: string[] };

const INLINE_TOKEN = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|https?:\/\/[^\s<]+)/g;
const MARKDOWN_LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;
const CONNECTOR_ACTION = /^(?:連線|連接|授權|connect(?: to)?|authorize)\s*/iu;

function safeHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function inlineContent(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push(text.slice(offset, index));
    const token = match[0];
    const markdownLink = token.match(MARKDOWN_LINK);
    const label = markdownLink?.[1] ?? token;
    const url = safeHttpsUrl(markdownLink?.[2] ?? token);
    const isConnectorAction = Boolean(
      markdownLink && CONNECTOR_ACTION.test(label.trim()),
    );
    const isAllowedConnectorAction =
      !isConnectorAction || url?.hostname === "chatgpt.com";

    if (url && isAllowedConnectorAction) {
      nodes.push(
        <Fragment key={`link-${tokenIndex}`}>
          <a
            className="message-link"
            href={url.toString()}
            rel="noreferrer noopener"
            target="_blank"
          >
            {label}
          </a>
          {markdownLink && !isConnectorAction && (
            <span className="message-link-host">({url.hostname})</span>
          )}
        </Fragment>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`strong-${tokenIndex}`}>{token.slice(2, -2)}</strong>,
      );
    } else {
      nodes.push(token);
    }
    tokenIndex += 1;
    offset = index + token.length;
  }

  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes;
}

function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  let code: Extract<MessageBlock, { type: "code" }> | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (items.length === 0) return;
    blocks.push({ type: "list", items });
    items = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (code) {
      if (rawLine.trim() === "```") {
        blocks.push(code);
        code = undefined;
      } else {
        code.lines.push(rawLine);
      }
      continue;
    }
    const fence = rawLine.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      code = { type: "code", language: fence[1] ?? "", lines: [] };
      continue;
    }
    const line = rawLine.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      items.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (code) {
    blocks.push({
      type: "paragraph",
      lines: [`\`\`\`${code.language}`, ...code.lines],
    });
  }
  return blocks;
}

export function MessageContent({ text }: MessageContentProps) {
  return (
    <div className="message-content">
      {messageBlocks(text).map((block, blockIndex) =>
        block.type === "code" ? (
          <pre key={`code-${blockIndex}`}>
            <code data-language={block.language || undefined}>
              {block.lines.join("\n")}
            </code>
          </pre>
        ) : block.type === "list" ? (
          <ul key={`list-${blockIndex}`}>
            {block.items.map((item, itemIndex) => (
              <li key={`item-${itemIndex}`}>{inlineContent(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={`paragraph-${blockIndex}`}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`line-${lineIndex}`}>
                {lineIndex > 0 && <br />}
                {inlineContent(line)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
