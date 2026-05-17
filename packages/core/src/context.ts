/** Format current date/time as a readable string for system prompt injection. */
export function formatDate(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return now.toLocaleString('en-US', { timeZone: timezone });
}

/**
 * Wrap a system prompt with current date context.
 * Returns the enriched prompt, or undefined if no system prompt given.
 */
export function withDateContext(systemPrompt: string | undefined): string | undefined {
  if (!systemPrompt) return undefined;
  return `[Current date and time: ${formatDate()}]\n\n${systemPrompt}`;
}
