import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ProviderName } from "./types.js";

export type UpstreamMode = "mcp-remote" | "streamable-http" | "stdio";

export interface ProviderConfig {
  name: ProviderName;
  upstreamUrl: string;
  mode: UpstreamMode;
  authorization?: string;
  tokenEnvVar?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ProxyConfig {
  host: string;
  port: number;
  cacheDir: string;
  debug: boolean;
  ttl: {
    searchSeconds: number;
    detailSeconds: number;
  };
  mobbin: ProviderConfig;
  refero: ProviderConfig;
}

type ConfigInput = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  configPath?: string;
};

type PartialProviderConfig = Partial<Omit<ProviderConfig, "name">>;

type PartialConfigFile = Partial<
  Omit<ProxyConfig, "mobbin" | "refero" | "ttl"> & {
    ttl: Partial<ProxyConfig["ttl"]>;
    mobbin: PartialProviderConfig;
    refero: PartialProviderConfig;
  }
>;

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SEARCH_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_DETAIL_TTL_SECONDS = 24 * 60 * 60;

export async function loadConfig(input: ConfigInput = {}): Promise<ProxyConfig> {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const configPath = input.configPath ?? resolve(cwd, "mcp-proxy.config.json");
  const file = await readConfigFile(configPath);

  const referoTokenEnvVar = env.REFERO_TOKEN_ENV_VAR ?? file.refero?.tokenEnvVar ?? "REFERO_MCP_TOKEN";
  const mobbinTokenEnvVar = env.MOBBIN_TOKEN_ENV_VAR ?? file.mobbin?.tokenEnvVar ?? "MOBBIN_MCP_TOKEN";

  const config: ProxyConfig = {
    host: env.MCP_PROXY_HOST ?? file.host ?? DEFAULT_HOST,
    port: numberFromEnv(env.MCP_PROXY_PORT, file.port, DEFAULT_PORT),
    cacheDir: resolvePath(cwd, env.MCP_PROXY_CACHE_DIR ?? file.cacheDir ?? ".mcp-proxy-cache"),
    debug: booleanFromEnv(env.MCP_PROXY_DEBUG, file.debug ?? false),
    ttl: {
      searchSeconds: numberFromEnv(env.MCP_PROXY_SEARCH_TTL_SECONDS, file.ttl?.searchSeconds, DEFAULT_SEARCH_TTL_SECONDS),
      detailSeconds: numberFromEnv(env.MCP_PROXY_DETAIL_TTL_SECONDS, file.ttl?.detailSeconds, DEFAULT_DETAIL_TTL_SECONDS)
    },
    mobbin: {
      name: "mobbin",
      upstreamUrl: env.MOBBIN_MCP_URL ?? file.mobbin?.upstreamUrl ?? "https://api.mobbin.com/mcp",
      mode: (env.MOBBIN_UPSTREAM_MODE ?? file.mobbin?.mode ?? "mcp-remote") as UpstreamMode,
      tokenEnvVar: mobbinTokenEnvVar,
      authorization: resolveAuthorization(env.MOBBIN_AUTHORIZATION, env[mobbinTokenEnvVar], env.MOBBIN_BEARER_TOKEN, file.mobbin?.authorization),
      command: env.MOBBIN_UPSTREAM_COMMAND ?? file.mobbin?.command,
      args: file.mobbin?.args,
      env: file.mobbin?.env
    },
    refero: {
      name: "refero",
      upstreamUrl: env.REFERO_MCP_URL ?? file.refero?.upstreamUrl ?? "https://api.refero.design/mcp",
      mode: (env.REFERO_UPSTREAM_MODE ?? file.refero?.mode ?? "streamable-http") as UpstreamMode,
      tokenEnvVar: referoTokenEnvVar,
      authorization: resolveAuthorization(env.REFERO_AUTHORIZATION, env[referoTokenEnvVar], env.REFERO_BEARER_TOKEN, file.refero?.authorization),
      command: env.REFERO_UPSTREAM_COMMAND ?? file.refero?.command,
      args: file.refero?.args,
      env: file.refero?.env
    }
  };

  assertLocalHost(config.host);
  return config;
}

async function readConfigFile(configPath: string): Promise<PartialConfigFile> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as PartialConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function numberFromEnv(value: string | undefined, fallback: number | undefined, defaultValue: number): number {
  if (value === undefined || value === "") {
    return fallback ?? defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric config value: ${value}`);
  }
  return parsed;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(value);
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function resolveAuthorization(
  explicitAuthorization: string | undefined,
  tokenFromConfiguredEnv: string | undefined,
  tokenFromDefaultEnv: string | undefined,
  fileAuthorization: string | undefined
): string | undefined {
  if (explicitAuthorization) {
    return explicitAuthorization;
  }

  if (tokenFromConfiguredEnv) {
    return tokenFromConfiguredEnv.startsWith("Bearer ") ? tokenFromConfiguredEnv : `Bearer ${tokenFromConfiguredEnv}`;
  }

  if (tokenFromDefaultEnv) {
    return tokenFromDefaultEnv.startsWith("Bearer ") ? tokenFromDefaultEnv : `Bearer ${tokenFromDefaultEnv}`;
  }

  return fileAuthorization;
}

function assertLocalHost(host: string): void {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to bind MCP proxy to non-local host: ${host}`);
  }
}
