export function bridgeErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data !== null && "error" in data) {
      const detail = (data as { error?: unknown }).error;
      if (typeof detail === "object" && detail !== null && "message" in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === "string") return message;
      }
    }
  }
  return "本地 Bridge 请求失败，请查看运行诊断。";
}
