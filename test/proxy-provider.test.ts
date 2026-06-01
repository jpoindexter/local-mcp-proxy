import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCache } from "../src/file-cache.js";
import { createTestLogger } from "../src/logger.js";
import { ProxyProvider } from "../src/proxy-provider.js";
import type { JsonObject, ProviderName } from "../src/types.js";

class FakeUpstream {
  calls = 0;
  failOnce = false;
  reconnects = 0;

  async listTools() {
    return { tools: [] };
  }

  async callTool(call: { name: string; arguments?: JsonObject }) {
    this.calls += 1;
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("Connection closed");
    }
    return { content: [{ type: "text", text: JSON.stringify(call.arguments ?? {}) }] };
  }

  async listResources() {
    return { resources: [{ uri: "ui://mobbin/search-screens.html", name: "Search screens" }] };
  }

  async listResourceTemplates() {
    return { resourceTemplates: [] };
  }

  async readResource(params: { uri: string }) {
    return {
      contents: [
        {
          uri: params.uri,
          mimeType: "text/html",
          text: "<html>Mobbin UI</html>"
        }
      ]
    };
  }

  async listPrompts() {
    return { prompts: [] };
  }

  async getPrompt(params: { name: string }) {
    return { messages: [{ role: "user", content: { type: "text", text: params.name } }] };
  }

  async reconnect() {
    this.reconnects += 1;
  }

  health(provider: ProviderName) {
    return {
      provider,
      mode: "fake",
      upstreamUrl: "memory://fake",
      connected: true,
      authStatus: "ok" as const,
      queue: { active: false, depth: 0 },
      inFlight: 0
    };
  }
}

describe("ProxyProvider", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  });

  async function createSubject() {
    const cacheDir = await mkdtemp(join(tmpdir(), "mcp-proxy-test-"));
    tempDirs.push(cacheDir);
    const cache = new FileCache(cacheDir);
    const upstream = new FakeUpstream();
    const provider = new ProxyProvider({
      provider: "mobbin",
      upstream,
      cache,
      logger: createTestLogger(),
      ttl: { searchSeconds: 60, detailSeconds: 120 }
    });

    return { provider, upstream };
  }

  it("deduplicates simultaneous identical tool calls", async () => {
    const { provider, upstream } = await createSubject();

    const [first, second] = await Promise.all([
      provider.callTool({ name: "search_screens", arguments: { q: "pricing" } }),
      provider.callTool({ name: "search_screens", arguments: { q: "pricing" } })
    ]);

    expect(first).toEqual(second);
    expect(upstream.calls).toBe(1);
  });

  it("serves later identical calls from file cache", async () => {
    const { provider, upstream } = await createSubject();

    await provider.callTool({ name: "search_screens", arguments: { q: "pricing" } });
    await provider.callTool({ name: "search_screens", arguments: { q: "pricing" } });

    expect(upstream.calls).toBe(1);
  });

  it("reconnects and retries once after an upstream disconnect", async () => {
    const { provider, upstream } = await createSubject();
    upstream.failOnce = true;

    const result = await provider.callTool({ name: "get_screen", arguments: { id: "screen-1" } });

    expect(result).toEqual({ content: [{ type: "text", text: "{\"id\":\"screen-1\"}" }] });
    expect(upstream.reconnects).toBe(1);
    expect(upstream.calls).toBe(2);
  });

  it("forwards resource reads through the queued upstream provider", async () => {
    const { provider } = await createSubject();

    const result = await provider.readResource({ uri: "ui://mobbin/search-screens.html" });

    expect(result).toEqual({
      contents: [
        {
          uri: "ui://mobbin/search-screens.html",
          mimeType: "text/html",
          text: "<html>Mobbin UI</html>"
        }
      ]
    });
  });
});
