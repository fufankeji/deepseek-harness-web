import { useEffect, useMemo, useRef } from "react";
import { EditorState, Text } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { Chunk } from "@codemirror/merge";
import styles from "./CodeMirrorDiff.module.css";

type DiffRow = {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

type DiffHunk = {
  header: string;
  rows: DiffRow[];
};

type DiffModel = {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

function normalizeDocument(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return normalized && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
}

function contentLines(value: string): string[] {
  if (!value) return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function changedLineCount(text: Text, from: number, to: number): number {
  if (from === to) return 0;
  const startLine = text.lineAt(Math.min(from, text.length)).number;
  const endLine = text.lineAt(Math.min(to, text.length)).number;
  return startLine === endLine ? 1 : endLine - startLine;
}

function rangeLabel(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function hunkHeader(rows: DiffRow[]): string {
  const oldLines = rows.flatMap((row) => row.oldLine === null ? [] : [row.oldLine]);
  const newLines = rows.flatMap((row) => row.newLine === null ? [] : [row.newLine]);
  const oldStart = oldLines[0] ?? 0;
  const newStart = newLines[0] ?? 0;
  return `@@ -${rangeLabel(oldStart, oldLines.length)} +${rangeLabel(newStart, newLines.length)} @@`;
}

function buildDiffModel(originalValue: string, updatedValue: string): DiffModel {
  const original = normalizeDocument(originalValue);
  const updated = normalizeDocument(updatedValue);
  const originalDoc = Text.of(original.split("\n"));
  const updatedDoc = Text.of(updated.split("\n"));
  const originalLines = contentLines(original);
  const updatedLines = contentLines(updated);
  const chunks = Chunk.build(originalDoc, updatedDoc, { scanLimit: 500 });
  const rows: DiffRow[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  let additions = 0;
  let deletions = 0;

  for (const chunk of chunks) {
    const oldStart = originalDoc.lineAt(Math.min(chunk.fromA, originalDoc.length)).number;
    const newStart = updatedDoc.lineAt(Math.min(chunk.fromB, updatedDoc.length)).number;
    const oldCount = changedLineCount(originalDoc, chunk.fromA, chunk.toA);
    const newCount = changedLineCount(updatedDoc, chunk.fromB, chunk.toB);

    while (oldCursor < oldStart && newCursor < newStart) {
      rows.push({ kind: "context", oldLine: oldCursor, newLine: newCursor, content: updatedLines[newCursor - 1] ?? "" });
      oldCursor += 1;
      newCursor += 1;
    }

    for (let offset = 0; offset < oldCount; offset += 1) {
      rows.push({ kind: "removed", oldLine: oldStart + offset, newLine: null, content: originalLines[oldStart + offset - 1] ?? "" });
    }
    for (let offset = 0; offset < newCount; offset += 1) {
      rows.push({ kind: "added", oldLine: null, newLine: newStart + offset, content: updatedLines[newStart + offset - 1] ?? "" });
    }

    additions += newCount;
    deletions += oldCount;
    oldCursor = oldStart + oldCount;
    newCursor = newStart + newCount;
  }

  while (oldCursor <= originalLines.length && newCursor <= updatedLines.length) {
    rows.push({ kind: "context", oldLine: oldCursor, newLine: newCursor, content: updatedLines[newCursor - 1] ?? "" });
    oldCursor += 1;
    newCursor += 1;
  }

  const changedIndexes = rows.flatMap((row, index) => row.kind === "context" ? [] : [index]);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const next = { start: Math.max(0, index - 3), end: Math.min(rows.length - 1, index + 3) };
    const current = ranges.at(-1);
    if (current && next.start <= current.end + 1) current.end = Math.max(current.end, next.end);
    else ranges.push(next);
  }

  return {
    additions,
    deletions,
    hunks: ranges.map(({ start, end }) => {
      const hunkRows = rows.slice(start, end + 1);
      return { header: hunkHeader(hunkRows), rows: hunkRows };
    })
  };
}

function UnifiedDiff({ source }: { source: { original: string; updated: string } }) {
  const model = useMemo(() => buildDiffModel(source.original, source.updated), [source.original, source.updated]);
  return <div className={styles.diffShell} aria-label="代码 Diff">
    <div className={styles.diffToolbar}>
      <span>统一视图</span>
      <div><strong className={styles.additions}>+{model.additions}</strong><strong className={styles.deletions}>−{model.deletions}</strong><em>只读</em></div>
    </div>
    {model.hunks.length === 0
      ? <div className={styles.emptyDiff}><strong>没有代码变化</strong><span>当前文件内容与任务基线一致。</span></div>
      : <div className={styles.diffViewport} role="table" aria-label="代码变更行">
        {model.hunks.map((hunk, hunkIndex) => <section className={styles.hunk} key={`${hunk.header}-${hunkIndex}`}>
          <div className={styles.hunkHeader} role="row"><span /><span /><span /><code>{hunk.header}</code></div>
          {hunk.rows.map((row, rowIndex) => <div className={`${styles.diffRow} ${styles[row.kind]}`} role="row" key={`${hunkIndex}-${rowIndex}`}>
            <span className={styles.lineNumber} aria-label={row.oldLine === null ? "旧文件无对应行" : `旧文件第 ${row.oldLine} 行`}>{row.oldLine ?? ""}</span>
            <span className={styles.lineNumber} aria-label={row.newLine === null ? "新文件无对应行" : `新文件第 ${row.newLine} 行`}>{row.newLine ?? ""}</span>
            <span className={styles.changeMark} aria-hidden="true">{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : ""}</span>
            <code>{row.content || "\u00a0"}</code>
          </div>)}
        </section>)}
      </div>}
  </div>;
}

function SourceViewer({ source }: { source: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          javascript({ typescript: true }),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "#ffffff", color: "#24292f", fontSize: "12.5px" },
            ".cm-scroller": { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: "1.68" },
            ".cm-gutters": { backgroundColor: "#f6f8fa", color: "#8c959f", borderRight: "1px solid #d8dee4" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#f6f8fa" },
            ".cm-content": { padding: "12px 0" },
            ".cm-line": { padding: "0 16px" },
            ".cm-selectionBackground": { backgroundColor: "#b6d7ff !important" }
          })
        ]
      }),
      parent: hostRef.current
    });
    return () => view.destroy();
  }, [source]);

  return <div className={styles.editor} ref={hostRef} aria-label="源码预览" />;
}

export function CodeMirrorDiff({
  mode,
  source,
  diffAvailable = true
}: {
  mode: "source" | "diff";
  source?: { original: string; updated: string } | undefined;
  diffAvailable?: boolean;
}) {
  const resolved = source ?? { original: "", updated: "// 选择一个文件以查看只读源码。" };
  if (mode === "diff" && !diffAvailable) {
    return <div className={styles.diffShell}><div className={styles.emptyDiff}><strong>本轮旧版本不可用</strong><span>这次任务发生在快照功能启用前，无法可靠还原修改前代码。</span></div></div>;
  }
  return mode === "diff" ? <UnifiedDiff source={resolved} /> : <SourceViewer source={resolved.updated} />;
}
