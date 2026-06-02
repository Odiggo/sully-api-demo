/**
 * With dictation enabled, the API may return literal `<\n>` / `<\n\n>` in transcript text.
 * Expand to UTF-8 newlines before display or persistence.
 */
export function expandDictationLayoutMarkers(text: string): string {
  if (!text.includes("<")) {
    return text;
  }

  return text
    .replaceAll("<\\n\\n>", "\n\n")
    .replaceAll("<\\n>", "\n")
    .replaceAll("&lt;\\n\\n&gt;", "\n\n")
    .replaceAll("&lt;\\n&gt;", "\n");
}

/** Space between streaming segments when the API does not include boundary whitespace. */
export function separatorBetweenTranscriptSegments(prev: string, next: string): string {
  if (!prev || !next) return '';
  if (/\s$/.test(prev) || /^\s/.test(next)) return '';
  return ' ';
}

export function joinTranscriptSegments(segments: readonly { text: string }[]): string {
  let result = '';
  let prevText = '';

  for (const { text } of segments) {
    if (!text) continue;
    if (result) {
      result += separatorBetweenTranscriptSegments(prevText, text);
    }
    result += text;
    prevText = text;
  }

  return result.trim();
}
