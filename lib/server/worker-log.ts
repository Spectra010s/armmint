import "server-only";

const REDACTED_KEYS = new Set([
  "privateKey",
  "encryptedPrivateKey",
  "encryptionIv",
  "encryptionAuthTag",
  "signature",
  "rawTransaction",
]);

export function sanitizeWorkerLogContext(
  value: unknown,
): unknown {
  if (Array.isArray(value)) return value.map(sanitizeWorkerLogContext);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      REDACTED_KEYS.has(key) ? "[REDACTED]" : sanitizeWorkerLogContext(entry),
    ]),
  );
}

export function workerLog(
  level: "info" | "warn" | "error",
  event: string,
  context: Record<string, unknown> = {},
) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeWorkerLogContext(context) as Record<string, unknown>,
  };

  console[level](JSON.stringify(entry));
}
