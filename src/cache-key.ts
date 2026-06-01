import { createHash } from "node:crypto";
import type { JsonObject, ProviderName } from "./types.js";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const child = input[key];
        if (child !== undefined) {
          result[key] = normalize(child);
        }
        return result;
      }, {});
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function createCacheKey(provider: ProviderName, toolName: string, args: JsonObject = {}): string {
  const normalized = stableStringify({ provider, toolName, args });
  return createHash("sha256").update(normalized).digest("hex");
}

export function createCacheDebugKey(provider: ProviderName, toolName: string, args: JsonObject = {}): string {
  return stableStringify({ provider, toolName, args });
}
