import { BridgeApp, isDirectExecution } from "./app.js";

const app = new BridgeApp();

if (isDirectExecution(import.meta.url)) {
  const address = await app.start();
  process.stdout.write(`FF Bridge ready at ${address.url}\n`);

  const stop = async () => {
    await app.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
}

export { app };
