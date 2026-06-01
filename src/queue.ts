import type { QueueStats } from "./types.js";

type QueueItem<T> = {
  createdAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  onStart?: (waitMs: number) => void;
};

export class SerialQueue {
  private readonly items: QueueItem<unknown>[] = [];
  private running = false;

  run<T>(work: () => Promise<T>, onStart?: (waitMs: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.items.push({
        createdAt: Date.now(),
        run: work,
        resolve: resolve as (value: unknown) => void,
        reject,
        onStart
      });
      void this.drain();
    });
  }

  stats(): QueueStats {
    return {
      active: this.running,
      depth: this.items.length
    };
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift();
        if (!item) {
          continue;
        }

        item.onStart?.(Date.now() - item.createdAt);
        try {
          item.resolve(await item.run());
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
