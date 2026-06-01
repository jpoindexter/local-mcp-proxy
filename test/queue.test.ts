import { describe, expect, it } from "vitest";
import { SerialQueue } from "../src/queue.js";

describe("SerialQueue", () => {
  it("runs work one item at a time in FIFO order", async () => {
    const queue = new SerialQueue();
    const events: string[] = [];

    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first:end");
      return 1;
    });

    const second = queue.run(async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(queue.stats()).toEqual({ active: false, depth: 0 });
  });
});
