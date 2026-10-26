export function cx(...parts: readonly (string | undefined)[]): string {
  let result = '';
  for (const part of parts) {
    if (part === undefined || part.length === 0) continue;
    result = result.length === 0 ? part : `${result} ${part}`;
  }
  return result;
}
