import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest
} from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";
import type { ProxyProvider } from "./proxy-provider.js";
import type { JsonObject, ProviderName } from "./types.js";

export class McpHttpEndpoint {
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private readonly providerName: ProviderName,
    private readonly provider: ProxyProvider,
    private readonly logger: Logger
  ) {}

  async handlePost(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    this.logLocalRequest(req, sessionId);

    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId) {
        transport = this.transports.get(sessionId);
        if (!transport) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: ErrorCode.ConnectionClosed, message: "MCP session not found" },
            id: null
          });
          return;
        }
      } else if (isInitializeRequest(req.body)) {
        transport = await this.createSessionTransport();
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: ErrorCode.InvalidRequest, message: "MCP session ID required" },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.handleTransportError(res, error);
    }
  }

  async handleGet(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    this.logLocalRequest(req, sessionId);
    if (!sessionId) {
      res.status(400).send("Missing MCP session ID");
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).send("MCP session not found");
      return;
    }

    await transport.handleRequest(req, res);
  }

  async handleDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    this.logLocalRequest(req, sessionId);
    if (!sessionId) {
      res.status(400).send("Missing MCP session ID");
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).send("MCP session not found");
      return;
    }

    await transport.handleRequest(req, res);
  }

  async close(): Promise<void> {
    await Promise.all([...this.transports.values()].map((transport) => transport.close()));
    this.transports.clear();
  }

  private async createSessionTransport(): Promise<StreamableHTTPServerTransport> {
    let initializedSessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        initializedSessionId = sessionId;
        this.transports.set(sessionId, transport);
        this.logger.info("local_session_initialized", { provider: this.providerName, sessionId });
      },
      onsessionclosed: (sessionId) => {
        this.transports.delete(sessionId);
        this.logger.info("local_session_closed", { provider: this.providerName, sessionId });
      }
    });

    transport.onclose = () => {
      const sessionId = transport.sessionId ?? initializedSessionId;
      if (sessionId) {
        this.transports.delete(sessionId);
      }
    };

    const server = this.createServer();
    await server.connect(transport);
    return transport;
  }

  private createServer(): Server {
    const server = new Server(
      { name: `local-${this.providerName}-proxy`, version: "0.1.0" },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {}
        },
        instructions: `Local proxy for ${this.providerName}. Multiple local clients share one queued upstream ${this.providerName} session.`
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return (await this.provider.listTools()) as never;
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        return (await this.provider.callTool({
          name: request.params.name,
          arguments: (request.params.arguments ?? {}) as JsonObject
        })) as never;
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return (await this.provider.listPrompts()) as never;
    });
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return (await this.provider.listResources()) as never;
    });
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return (await this.provider.listResourceTemplates()) as never;
    });
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return (await this.provider.getPrompt({
        name: request.params.name,
        arguments: request.params.arguments
      })) as never;
    });
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return (await this.provider.readResource({ uri: request.params.uri })) as never;
    });

    return server;
  }

  private logLocalRequest(req: Request, sessionId: string | undefined): void {
    this.logger.info("local_client_request", {
      provider: this.providerName,
      method: req.method,
      path: req.path,
      sessionId,
      mcpMethod: requestMethod(req.body)
    });
  }

  private handleTransportError(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("local_transport_error", { provider: this.providerName, error: message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: ErrorCode.InternalError, message },
        id: null
      });
    }
  }
}

function requestMethod(body: unknown): string | undefined {
  if (Array.isArray(body)) {
    return body.map((item) => requestMethod(item)).filter(Boolean).join(",");
  }
  if (body && typeof body === "object" && "method" in body) {
    return String((body as { method?: unknown }).method);
  }
  return undefined;
}
