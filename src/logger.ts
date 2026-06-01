export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SECRET_KEY_PATTERN = /authorization|token|secret|password|api[_-]?key|cookie/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((result, [key, child]) => {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(child);
      return result;
    }, {});
  }

  return value;
}

export function createLogger(debugEnabled: boolean): Logger {
  const emit = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (level === "debug" && !debugEnabled) {
      return;
    }

    const entry = redact({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields
    });

    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields)
  };
}

export function createTestLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}
