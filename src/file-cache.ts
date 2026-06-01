import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheStats } from "./types.js";

type CacheEnvelope = {
  expiresAt: number;
  createdAt: number;
  value: unknown;
};

export class FileCache {
  private readonly statsValue: CacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    expired: 0,
    errors: 0,
    entries: 0
  };

  constructor(private readonly cacheDir: string) {}

  async get<T>(key: string): Promise<T | undefined> {
    await this.ensureDir();
    const file = this.fileForKey(key);

    try {
      const envelope = JSON.parse(await readFile(file, "utf8")) as CacheEnvelope;
      if (Date.now() >= envelope.expiresAt) {
        this.statsValue.expired += 1;
        this.statsValue.misses += 1;
        await rm(file, { force: true });
        return undefined;
      }

      this.statsValue.hits += 1;
      return envelope.value as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.statsValue.errors += 1;
      }
      this.statsValue.misses += 1;
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.ensureDir();
    const envelope: CacheEnvelope = {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
      value
    };

    await writeFile(this.fileForKey(key), JSON.stringify(envelope), "utf8");
    this.statsValue.writes += 1;
  }

  async stats(): Promise<CacheStats> {
    await this.ensureDir();
    try {
      const entries = await readdir(this.cacheDir);
      this.statsValue.entries = entries.filter((entry) => entry.endsWith(".json")).length;
    } catch {
      this.statsValue.entries = 0;
    }
    return { ...this.statsValue };
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  private fileForKey(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }
}
