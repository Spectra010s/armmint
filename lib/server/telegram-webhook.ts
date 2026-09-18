export function parseTelegramStartToken(
  text: string | undefined,
): string | null {
  if (!text) return null;

  const match = text
    .trim()
    .match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{43})$/);

  return match?.[1] ?? null;
}
