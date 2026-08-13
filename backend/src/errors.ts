export class BridgeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function publicError(error: unknown): { status: number; body: { error: { code: string; message: string; retryable: boolean } } } {
  if (error instanceof BridgeError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, retryable: error.retryable } } };
  }
  return { status: 500, body: { error: { code: "internal_error", message: "本地服务处理失败，请查看诊断信息。", retryable: true } } };
}
