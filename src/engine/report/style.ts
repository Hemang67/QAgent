// Colours and helpers shared by the run sheets and the Guide (same design as the OMS workbook)
export const C = {
  navy: '1F3A5F',
  accent: '2E86AB',
  white: 'FFFFFF',
  ink: '101828',
  muted: '667085',
  line: 'D0D5DD',
  surface: 'F2F4F7',
  band: 'F9FAFB',
  note: 'FFF8E6',
  passed: { fill: 'DCFAE6', font: '067647' },
  failed: { fill: 'FEE4E2', font: 'B42318' },
  skipped: { fill: 'FEF0C7', font: 'B54708' },
  unverified: { fill: 'EAECF0', font: '344054' },
  info: { fill: 'D1E9FF', font: '175CD3' },
};
export const FONT = 'Segoe UI';

export const argb = (hex: string) => `FF${hex}`;
export const solid = (hex: string): any => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
export const font = (o: { bold?: boolean; italic?: boolean; size?: number; color?: string; underline?: boolean } = {}): any => ({
  name: FONT,
  size: 10,
  ...o,
  color: { argb: argb(o.color || C.ink) },
});
export const thin: any = { style: 'thin', color: { argb: argb(C.line) } };

export const resultStyle = (r: string | undefined) => {
  const key = String(r || '').split(' ')[0] as 'passed' | 'failed' | 'skipped' | 'unverified';
  return C[key] && typeof C[key] === 'object' ? (C[key] as { fill: string; font: string }) : C.unverified;
};

export const colLetter = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
