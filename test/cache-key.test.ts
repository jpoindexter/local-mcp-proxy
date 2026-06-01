import { describe, expect, it } from "vitest";
import { createCacheKey, stableStringify } from "../src/cache-key.js";

describe("cache keys", () => {
  it("normalizes object property order", () => {
    const left = stableStringify({ b: 2, a: { d: 4, c: 3 } });
    const right = stableStringify({ a: { c: 3, d: 4 }, b: 2 });

    expect(left).toBe(right);
  });

  it("includes provider and tool name in the key", () => {
    const mobbinKey = createCacheKey("mobbin", "search_screens", { q: "pricing" });
    const referoKey = createCacheKey("refero", "search_screens", { q: "pricing" });
    const otherToolKey = createCacheKey("mobbin", "get_screen", { q: "pricing" });

    expect(mobbinKey).not.toBe(referoKey);
    expect(mobbinKey).not.toBe(otherToolKey);
  });
});
