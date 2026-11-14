/**
 * Browser-side file export: one Blob download, no server round trip. The CSV
 * text itself comes from src/report/export.ts (pure, property tested); this
 * module only moves the bytes into a file and is not covered by Bun tests.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari ignores revoke before the click settles; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
