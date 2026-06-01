#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createProxyRuntime } from "./server.js";

const config = await loadConfig();
const logger = createLogger(config.debug);
const runtime = createProxyRuntime(config, logger);

await runtime.listen();

const shutdown = async (signal: string) => {
  logger.info("proxy_shutdown", { signal });
  await runtime.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
