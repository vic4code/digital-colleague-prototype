import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageContent } from "./MessageContent";

describe("MessageContent", () => {
  it("renders a fenced Gmail approval envelope as a readable code block", () => {
    const { container } = render(
      <MessageContent
        text={'草稿：\n\n```json\n{\n  "mailbox": "cathayaids@gmail.com"\n}\n```\n\n請核准。'}
      />,
    );

    const code = container.querySelector("pre code");
    expect(code).toHaveAttribute("data-language", "json");
    expect(code).toHaveTextContent('"mailbox": "cathayaids@gmail.com"');
    expect(container).not.toHaveTextContent("```json");
    expect(screen.getByText("請核准。")).toBeInTheDocument();
  });

  it("does not turn a phishing connector action into a clickable link", () => {
    render(
      <MessageContent text="[連線 Gmail](https://phishing.example/connect)" />,
    );

    expect(
      screen.queryByRole("link", { name: /連線 Gmail/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("[連線 Gmail](https://phishing.example/connect)"),
    ).toBeInTheDocument();
  });

  it("shows the destination host for a general external link", () => {
    render(
      <MessageContent text="請參考 [官方文件](https://docs.example.com/guide)" />,
    );

    expect(screen.getByRole("link", { name: /官方文件/ })).toHaveAttribute(
      "href",
      "https://docs.example.com/guide",
    );
    expect(screen.getByText("(docs.example.com)")).toBeInTheDocument();
  });
});
