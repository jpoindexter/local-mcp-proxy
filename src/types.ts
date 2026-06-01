export type ProviderName = "mobbin" | "refero";

export type JsonObject = Record<string, unknown>;

export interface ToolCall {
  name: string;
  arguments?: JsonObject;
}

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  expired: number;
  errors: number;
  entries: number;
}

export interface QueueStats {
  active: boolean;
  depth: number;
}

export interface ProviderHealth {
  provider: ProviderName;
  mode: string;
  upstreamUrl: string;
  connected: boolean;
  authStatus: "unknown" | "ok" | "required" | "not_configured" | "oauth_via_mcp_remote";
  lastConnectAt?: string;
  lastError?: string;
  queue: QueueStats;
  inFlight: number;
}
