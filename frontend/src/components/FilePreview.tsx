import { Download, FileWarning, LoaderCircle } from "lucide-react";
import { useGetFilePreviewQuery } from "../api/bridge-api";
import { CodeMirrorDiff } from "./CodeMirrorDiff";
import { SafeMarkdown } from "./SafeMarkdown";
import styles from "./FilePreview.module.css";

export function FilePreview({ path }: { path: string | null }) {
  const preview = useGetFilePreviewQuery(path ?? "", { skip: !path });
  if (!path) return <Empty text="选择一个文件以查看预览。" />;
  if (preview.isFetching) return <Empty icon={<LoaderCircle className={styles.spinner} />} text="正在读取文件…" />;
  if (preview.isError || !preview.data) return <Empty text="无法读取该文件，请刷新工作区后重试。" />;

  const data = preview.data;
  const download = <a className={styles.download} href={`/api/workspaces/download?path=${encodeURIComponent(data.path)}`} download><Download size={14} />下载文件</a>;
  if (data.kind === "image" && data.dataUrl) {
    return <div className={styles.imageStage}><img src={data.dataUrl} alt={data.path} /><span>{data.mime} · {formatBytes(data.size)}</span>{download}</div>;
  }
  if (data.kind === "html" && data.content !== undefined) {
    return <div className={styles.htmlStage}><iframe title={`${data.path} 隔离预览`} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreviewDocument(data.content)} /><span>隔离 HTML / SVG 预览 · 脚本、表单与外部资源均不可用</span>{download}</div>;
  }
  if (data.kind === "text" && data.content !== undefined) {
    if (data.mime === "text/markdown") return <div className={styles.markdownStage}><SafeMarkdown className={styles.markdownDocument} content={data.content} />{download}</div>;
    return <CodeMirrorDiff mode="source" source={{ original: data.content, updated: data.content }} />;
  }
  return <div className={styles.unsupported}><Empty text={`${data.reason ?? "该文件无法在线预览"} · ${data.mime} · ${formatBytes(data.size)}`} />{download}</div>;
}

function Empty({ text, icon = <FileWarning /> }: { text: string; icon?: React.ReactNode }) {
  return <div className={styles.empty}>{icon}<span>{text}</span></div>;
}

function htmlPreviewDocument(content: string): string {
  const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; frame-ancestors 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
  return /<head(?:\s[^>]*)?>/i.test(content) ? content.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${meta}`) : `<!doctype html><html><head>${meta}</head><body>${content}</body></html>`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
