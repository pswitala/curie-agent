export function getTzOffsetString(timeZone: string, date: Date = new Date()): string {
  if (timeZone === 'UTC') return 'Z';
  try {
    const tzString = date.toLocaleString('en-US', { timeZone, timeStyle: 'long' });
    const match = tzString.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (match && match[1]) {
      const sign = match[1][0];
      const hours = match[1].slice(1).padStart(2, '0');
      const minutes = (match[2] || '00').padStart(2, '0');
      return `${sign}${hours}:${minutes}`;
    }
  } catch (e) {}

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzNamePart = parts.find(p => p.type === 'timeZoneName');
    if (tzNamePart) {
      const match = tzNamePart.value.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (match && match[1]) {
        const sign = match[1][0];
        const hours = match[1].slice(1).padStart(2, '0');
        const minutes = (match[2] || '00').padStart(2, '0');
        return `${sign}${hours}:${minutes}`;
      }
    }
  } catch (e) {}

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const mins = String(absMinutes % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}`;
}

/** Format current date/time as a readable string for system prompt injection. */
export function formatDate(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localStr = now.toLocaleString('en-US', { timeZone: timezone });
  const offset = getTzOffsetString(timezone, now);
  return `${localStr} (Timezone: ${timezone}, Offset: ${offset})`;
}

/**
 * Wrap a system prompt with current date context.
 * Returns the enriched prompt, or undefined if no system prompt given.
 */
export function withDateContext(systemPrompt: string | undefined): string | undefined {
  if (!systemPrompt) return undefined;
  return `[Current date and time: ${formatDate()}]\n\n${systemPrompt}`;
}
