// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { CodeMirrorDiff } from "./CodeMirrorDiff";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("代码 Diff", () => {
  test("新增文件使用双行号、增量标记和真实统计", async () => {
    const { getByLabelText } = render(
      <div style={{ height: 400 }}>
        <CodeMirrorDiff mode="diff" source={{ original: "", updated: "const one = 1;\nconst two = 2;" }} />
      </div>
    );

    const diff = getByLabelText("代码 Diff");
    expect(diff.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(diff.textContent).toContain("@@ -0,0 +1,2 @@");
    expect(diff.textContent).toContain("+2");
    expect(diff.textContent).toContain("−0");
    expect(diff.querySelectorAll('[class*="added"]')).toHaveLength(2);
  });

  test("修改内容同时呈现删除行和新增行", async () => {
    const { getByLabelText } = render(
      <div style={{ height: 400 }}>
        <CodeMirrorDiff mode="diff" source={{ original: "const answer = 41;", updated: "const answer = 42;" }} />
      </div>
    );

    const diff = getByLabelText("代码 Diff");
    expect(diff.querySelectorAll('[class*="removed"]')).toHaveLength(1);
    expect(diff.textContent).toContain("+1");
    expect(diff.textContent).toContain("−1");
    expect(diff.querySelector('[class*="removed"]')?.textContent).toContain("const answer = 41;");
    expect(diff.querySelector('[class*="added"]')?.textContent).toContain("const answer = 42;");
  });

  test("删除内容保留旧代码而不会伪造新增行", async () => {
    const { getByLabelText } = render(
      <div style={{ height: 400 }}>
        <CodeMirrorDiff mode="diff" source={{ original: "keep();\nremove();", updated: "keep();" }} />
      </div>
    );

    const diff = getByLabelText("代码 Diff");
    expect(diff.querySelectorAll('[class*="removed"]')).toHaveLength(1);
    expect(diff.textContent).toContain("+0");
    expect(diff.textContent).toContain("−1");
    expect(diff.querySelector('[class*="removed"]')?.textContent).toContain("remove();");
  });

  test("缺少可靠任务快照时明确降级，不把文件伪装成全部新增", async () => {
    const { getByText, queryByLabelText } = render(
      <div style={{ height: 400 }}>
        <CodeMirrorDiff mode="diff" source={{ original: "", updated: "current();" }} diffAvailable={false} />
      </div>
    );

    expect(getByText("本轮旧版本不可用")).toBeTruthy();
    expect(queryByLabelText("代码 Diff")).toBeNull();
  });
});
