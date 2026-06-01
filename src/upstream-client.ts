import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ProviderConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { JsonObject, ProviderHealth, ProviderName, ToolCall } from "./types.js";

const require = createRequire(import.meta.url);

export class UpstreamClient {
  private client?: Client;
  private transport?: Transport;
  private connected = false;
  private lastConnectAt?: string;
  private lastError?: string;
  private authStatus: ProviderHealth["authStatus"] = "unknown";

  constructor(
    private readonly provider: ProviderConfig,
    private readonly logger: Logger
  ) {}

  async listTools(): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.listTools({}, { timeout: 120_000 });
  }

  async callTool(call: ToolCall): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.callTool(
      {
        name: call.name,
        arguments: call.arguments ?? {}
      },
      undefined,
      { timeout: 120_000 }
    );
  }

  async listResources(): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.listResources({}, { timeout: 120_000 });
  }

  async listResourceTemplates(): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.listResourceTemplates({}, { timeout: 120_000 });
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.readResource(params, { timeout: 120_000 });
  }

  async listPrompts(): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.listPrompts({}, { timeout: 120_000 });
  }

  async getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.getPrompt(
      {
        name: params.name,
        arguments: params.arguments
      },
      { timeout: 120_000 }
    );
  }

  async reconnect(): Promise<void> {
    await this.close();
    await this.ensureConnected();
  }

  health(provider: ProviderName): ProviderHealth {
    return {
      provider,
      mode: this.provider.mode,
      upstreamUrl: this.provider.upstreamUrl,
      connected: this.connected,
      authStatus: this.authStatus,
      lastConnectAt: this.lastConnectAt,
      lastError: this.lastError,
      queue: { active: false, depth: 0 },
      inFlight: 0
    };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    this.connected = false;

    if (client) {
      await client.close();
    }
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client && this.connected) {
      return this.client;
    }

    const client = new Client({
      name: `local-mcp-proxy-${this.provider.name}`,
      version: "0.1.0"
    });

    client.onerror = (error) => {
      this.lastError = error.message;
      this.logger.error("upstream_client_error", {
        provider: this.provider.name,
        error: error.message
      });
    };

    client.onclose = () => {
      this.connected = false;
      this.logger.warn("upstream_client_closed", { provider: this.provider.name });
    };

    const transport = this.createTransport();

    try {
      this.logger.info("upstream_connect", {
        provider: this.provider.name,
        mode: this.provider.mode,
        upstreamUrl: this.provider.upstreamUrl
      });
      await client.connect(transport, { timeout: 120_000 });
      this.client = client;
      this.transport = transport;
      this.connected = true;
      this.lastConnectAt = new Date().toISOString();
      this.lastError = undefined;
      this.authStatus = this.provider.mode === "mcp-remote" ? "oauth_via_mcp_remote" : "ok";
      return client;
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.authStatus = this.isAuthError(error) ? "required" : this.provider.authorization ? "unknown" : "not_configured";
      this.logger.error("upstream_connect_error", {
        provider: this.provider.name,
        mode: this.provider.mode,
        error: this.lastError
      });
      await client.close().catch(() => undefined);
      throw new Error(this.describeConnectionError(error));
    }
  }

  private createTransport(): Transport {
    if (this.provider.mode === "streamable-http") {
      const headers: Record<string, string> = {};
      if (this.provider.authorization) {
        headers.Authorization = this.provider.authorization;
      }

      return new StreamableHTTPClientTransport(new URL(this.provider.upstreamUrl), {
        requestInit: { headers }
      });
    }

    const command = this.provider.command ?? process.execPath;
    const args = this.provider.args ?? this.defaultStdioArgs();
    const transport = new StdioClientTransport({
      command,
      args,
      env: {
        ...getDefaultEnvironment(),
        ...(this.provider.env ?? {})
      },
      stderr: "pipe"
    });

    transport.stderr?.on("data", (chunk) => {
      this.logger.info("upstream_stderr", {
        provider: this.provider.name,
        message: String(chunk).trim()
      });
    });

    return transport;
  }

  private defaultStdioArgs(): string[] {
    if (this.provider.mode === "stdio") {
      return [];
    }

    const args = [require.resolve("mcp-remote/dist/proxy.js"), this.provider.upstreamUrl, "--host", "127.0.0.1"];
    if (this.provider.authorization) {
      args.push("--header", `Authorization:${this.provider.authorization}`);
    }
    return args;
  }

  private isAuthError(error: unknown): boolean {
    if (error instanceof UnauthorizedError) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /unauthorized|authorization|required|401|403/i.test(message);
  }

  private describeConnectionError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (this.isAuthError(error)) {
      return `${this.provider.name} upstream requires authentication. For Mobbin, let the proxy complete the mcp-remote OAuth login. For Refero, set ${this.provider.tokenEnvVar ?? "REFERO_MCP_TOKEN"} or ${this.provider.name.toUpperCase()}_AUTHORIZATION. Upstream said: ${message}`;
    }
    return `${this.provider.name} upstream connection failed: ${message}`;
  }
}
