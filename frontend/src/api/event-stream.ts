import type { AppDispatch } from "../app/store";
import { harnessActions } from "../app/store";
import { bridgeApi } from "./bridge-api";
import type { HarnessEvent } from "./contracts";

export function connectSessionEvents(sessionId: string, after: number, dispatch: AppDispatch): () => void {
  const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream?after=${after}`, { withCredentials: false });
  stream.onopen = () => dispatch(harnessActions.setConnection("connected"));
  stream.onerror = () => dispatch(harnessActions.setConnection("reconnecting"));
  stream.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as HarnessEvent;
      dispatch(harnessActions.receiveEvent(event));
      if (event.kind === "workspace.changed") {
        dispatch(bridgeApi.util.invalidateTags(["Workspace"]));
      }
      if (event.kind === "run.settled") {
        dispatch(bridgeApi.util.invalidateTags(["Workspace", "Sessions", "Diagnostics", "Acceptance"]));
      }
    } catch {
      dispatch(harnessActions.setConnection("error"));
      dispatch(harnessActions.showNotice("收到无法解析的事件，请在诊断页核对连接。"));
    }
  };
  return () => {
    stream.close();
  };
}
