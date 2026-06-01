import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  });

  it("loads JSON config and lets environment override operational values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-proxy-config-"));
    tempDirs.push(dir);
    const configPath = join(dir, "mcp-proxy.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        port: 9000,
        cacheDir: "cache-from-file",
        refero: { tokenEnvVar: "CUSTOM_REFERO_TOKEN" }
      }),
      "utf8"
    );

    const config = await loadConfig({
      cwd: dir,
      env: {
        MCP_PROXY_PORT: "8788",
        REFERO_MCP_TOKEN: "ignored",
        CUSTOM_REFERO_TOKEN: "refero-token"
      },
      configPath
    });

    expect(config.port).toBe(8788);
    expect(config.cacheDir).toBe(join(dir, "cache-from-file"));
    expect(config.refero.authorization).toBe("Bearer refero-token");
  });
});
