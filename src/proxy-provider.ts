import { createCacheDebugKey, createCacheKey } from "./cache-key.js";
import type { FileCache } from "./file-cache.js";
import type { Logger } from "./logger.js";
import { SerialQueue } from "./queue.js";
import type { JsonObject, ProviderHealth, ProviderName, ToolCall } from "./types.js";

export interface UpstreamClientLike {
  listTools(): Promise<unknown>;
  callTool(call: ToolCall): Promise<unknown>;
  listResources(): Promise<unknown>;
  listResourceTemplates(): Promise<unknown>;
  readResource(params: { uri: string }): Promise<unknown>;
  listPrompts(): Promise<unknown>;
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown>;
  reconnect(): Promise<void>;
  health(provider: ProviderName): ProviderHealth;
}

export interface ProxyProviderOptions {
  provider: ProviderName;
  upstream: UpstreamClientLike;
  cache: FileCache;
  logger: Logger;
  ttl: {
    searchSeconds: number;
    detailSeconds: number;
  };
}

export class ProxyProvider {
  private readonly queue = new SerialQueue();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly options: ProxyProviderOptions) {}

  async listTools(): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("tools/list", () => this.options.upstream.listTools()),
      (waitMs) => this.options.logger.debug("queue_wait", { provider: this.options.provider, operation: "tools/list", waitMs })
    );
  }

  async listResources(): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("resources/list", () => this.options.upstream.listResources()),
      (waitMs) => this.options.logger.debug("queue_wait", { provider: this.options.provider, operation: "resources/list", waitMs })
    );
  }

  async listResourceTemplates(): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("resources/templates/list", () => this.options.upstream.listResourceTemplates()),
      (waitMs) =>
        this.options.logger.debug("queue_wait", {
          provider: this.options.provider,
          operation: "resources/templates/list",
          waitMs
        })
    );
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("resources/read", () => this.options.upstream.readResource(params)),
      (waitMs) =>
        this.options.logger.info("queue_wait", {
          provider: this.options.provider,
          operation: "resources/read",
          uri: params.uri,
          waitMs
        })
    );
  }

  async listPrompts(): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("prompts/list", () => this.options.upstream.listPrompts()),
      (waitMs) => this.options.logger.debug("queue_wait", { provider: this.options.provider, operation: "prompts/list", waitMs })
    );
  }

  async getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown> {
    return this.queue.run(
      () => this.callWithRetry("prompts/get", () => this.options.upstream.getPrompt(params)),
      (waitMs) =>
        this.options.logger.info("queue_wait", {
          provider: this.options.provider,
          operation: "prompts/get",
          promptName: params.name,
          waitMs
        })
    );
  }

  async callTool(call: ToolCall): Promise<unknown> {
    const args = call.arguments ?? {};
    const key = createCacheKey(this.options.provider, call.name, args);
    const debugKey = createCacheDebugKey(this.options.provider, call.name, args);

    const cached = await this.options.cache.get<unknown>(key);
    if (cached !== undefined) {
      this.options.logger.info("cache_hit", { provider: this.options.provider, toolName: call.name });
      return cached;
    }

    this.options.logger.info("cache_miss", { provider: this.options.provider, toolName: call.name });

    const existing = this.inFlight.get(key);
    if (existing) {
      this.options.logger.info("request_deduped", { provider: this.options.provider, toolName: call.name });
      return existing;
    }

    const promise = this.queue
      .run(
        () => this.callToolWithRetry(call),
        (waitMs) =>
          this.options.logger.info("queue_wait", {
            provider: this.options.provider,
            toolName: call.name,
            waitMs
          })
      )
      .then(async (result) => {
        await this.options.cache.set(key, result, this.ttlForTool(call.name));
        this.options.logger.debug("cache_write", {
          provider: this.options.provider,
          toolName: call.name,
          cacheKey: debugKey
        });
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  async health(): Promise<ProviderHealth> {
    const base = this.options.upstream.health(this.options.provider);
    return {
      ...base,
      queue: this.queue.stats(),
      inFlight: this.inFlight.size
    };
  }

  private async callToolWithRetry(call: ToolCall): Promise<unknown> {
    this.options.logger.info("upstream_call", { provider: this.options.provider, toolName: call.name });

    try {
      return await this.options.upstream.callTool(call);
    } catch (error) {
      if (!this.isRetryableDisconnect(error)) {
        this.options.logger.error("upstream_error", {
          provider: this.options.provider,
          toolName: call.name,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      this.options.logger.warn("upstream_reconnect", {
        provider: this.options.provider,
        toolName: call.name,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.options.upstream.reconnect();
      return this.options.upstream.callTool(call);
    }
  }

  private async callWithRetry(operation: string, run: () => Promise<unknown>): Promise<unknown> {
    this.options.logger.info("upstream_call", { provider: this.options.provider, operation });

    try {
      return await run();
    } catch (error) {
      if (!this.isRetryableDisconnect(error)) {
        this.options.logger.error("upstream_error", {
          provider: this.options.provider,
          operation,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      this.options.logger.warn("upstream_reconnect", {
        provider: this.options.provider,
        operation,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.options.upstream.reconnect();
      return run();
    }
  }

  private ttlForTool(toolName: string): number {
    const normalized = toolName.toLowerCase();
    if (normalized.includes("search") || normalized.includes("query")) {
      return this.options.ttl.searchSeconds;
    }
    return this.options.ttl.detailSeconds;
  }

  private isRetryableDisconnect(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /connection.*closed|closed|disconnect|terminated|econnreset|socket|fetch failed/i.test(message);
  }
}
