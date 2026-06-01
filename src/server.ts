import express from "express";
import type { Server as HttpServer } from "node:http";
import type { ProxyConfig } from "./config.js";
import { FileCache } from "./file-cache.js";
import type { Logger } from "./logger.js";
import { McpHttpEndpoint } from "./mcp-http.js";
import { ProxyProvider } from "./proxy-provider.js";
import { UpstreamClient } from "./upstream-client.js";

export interface ProxyRuntime {
  app: express.Express;
  listen(): Promise<HttpServer>;
  close(): Promise<void>;
}

export function createProxyRuntime(config: ProxyConfig, logger: Logger): ProxyRuntime {
  const app = express();
  app.use(express.json({ limit: "10mb", type: ["application/json", "application/*+json"] }));

  const cache = new FileCache(config.cacheDir);
  const mobbin = new ProxyProvider({
    provider: "mobbin",
    upstream: new UpstreamClient(config.mobbin, logger),
    cache,
    logger,
    ttl: config.ttl
  });
  const refero = new ProxyProvider({
    provider: "refero",
    upstream: new UpstreamClient(config.refero, logger),
    cache,
    logger,
    ttl: config.ttl
  });

  const mobbinEndpoint = new McpHttpEndpoint("mobbin", mobbin, logger);
  const referoEndpoint = new McpHttpEndpoint("refero", refero, logger);

  mountEndpoint(app, "/mobbin/mcp", mobbinEndpoint);
  mountEndpoint(app, "/refero/mcp", referoEndpoint);

  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      localOnly: true,
      bind: `${config.host}:${config.port}`,
      providers: {
        mobbin: await mobbin.health(),
        refero: await refero.health()
      },
      cache: await cache.stats()
    });
  });

  let server: HttpServer | undefined;

  return {
    app,
    listen() {
      return new Promise((resolve, reject) => {
        server = app.listen(config.port, config.host, () => {
          logger.info("proxy_listening", {
            host: config.host,
            port: config.port,
            mobbinEndpoint: `http://${config.host}:${config.port}/mobbin/mcp`,
            referoEndpoint: `http://${config.host}:${config.port}/refero/mcp`
          });
          resolve(server!);
        });
        server.on("error", reject);
      });
    },
    async close() {
      await Promise.all([mobbinEndpoint.close(), referoEndpoint.close()]);
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  };
}

function mountEndpoint(app: express.Express, path: string, endpoint: McpHttpEndpoint): void {
  app.post(path, (req, res) => {
    void endpoint.handlePost(req, res);
  });
  app.get(path, (req, res) => {
    void endpoint.handleGet(req, res);
  });
  app.delete(path, (req, res) => {
    void endpoint.handleDelete(req, res);
  });
}
