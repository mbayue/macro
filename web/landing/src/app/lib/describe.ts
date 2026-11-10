/** Unicode code points of the trimmed text (requirement 1.1). */
export function countCodePoints(text: string): number {
  return [...text.trim()].length;
}
