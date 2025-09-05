export function toCSV(rows: any[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')).join('\n');
  return head + '\n' + body;
}
