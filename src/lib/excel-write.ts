import ExcelJS from "exceljs";
import type { ExcelSheet, ExcelValue } from "@/lib/excel";

function sanitizeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim() || "برگ";
  const base = cleaned.slice(0, 31);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (true) {
    const suffix = ` ${i}`;
    const next = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
    i += 1;
  }
}

function colWidth(headers: string[], rows: ExcelValue[][]): { width: number }[] {
  return headers.map((h, i) => {
    let max = [...h].length;
    for (const row of rows) {
      const v = row[i];
      if (v == null || v === "") continue;
      const len = [...String(v)].length;
      if (len > max) max = len;
    }
    return { width: Math.min(42, Math.max(10, max + 2)) };
  });
}

export async function downloadExcel(filename: string, sheets: ExcelSheet[]) {
  const usable = sheets.filter((s) => s.headers.length);
  if (!usable.length) throw new Error("empty");
  const wb = new ExcelJS.Workbook();
  wb.creator = "HESABDAR-V2";
  wb.created = new Date();
  const used = new Set<string>();

  for (const sheet of usable) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name, used), {
      views: [{ state: "frozen", ySplit: sheet.title ? 3 : 1, rightToLeft: true }],
    });
    let headerRow = 1;
    if (sheet.title) {
      ws.addRow([sheet.title]);
      if (sheet.headers.length > 1) {
        ws.mergeCells(1, 1, 1, sheet.headers.length);
      }
      ws.addRow([]);
      headerRow = 3;
    }
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) {
      ws.addRow(sheet.headers.map((_, i) => (row[i] == null ? "" : row[i])));
    }
    ws.columns = colWidth(sheet.headers, sheet.rows);
    void headerRow;
  }

  const safe = filename.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "export";
  const outName = safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`;
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = outName;
  a.click();
  URL.revokeObjectURL(a.href);
}
