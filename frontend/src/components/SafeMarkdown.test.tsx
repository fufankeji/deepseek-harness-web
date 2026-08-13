// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

describe("安全 Markdown", () => {
  it("渲染常用 GFM 内容", () => {
    const { container, getByRole, getByText } = render(<SafeMarkdown content={'**完成**\n\n- 一项\n- 二项\n\n```python\nprint("ok")\n```\n\n| 文件 | 状态 |\n| --- | --- |\n| a.py | 已写入 |'} />);

    expect(getByText("完成").tagName).toBe("STRONG");
    expect(getByRole("list").children).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain('print("ok")');
    expect(getByRole("table")).toBeTruthy();
  });

  it("移除模型输出中的原始 HTML 和不安全链接", () => {
    const { container, getByText } = render(<SafeMarkdown content={'<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))\n\n[安全链接](https://example.com)'} />);

    expect(container.querySelector("script")).toBeNull();
    expect(getByText("危险链接").closest("a")).toBeNull();
    expect(getByText("安全链接").closest("a")).toMatchObject({ target: "_blank" });
  });
});
