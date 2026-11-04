import ExcelJS from "exceljs";
import { cellForSheet } from "@/lib/backup-snapshot";

export async function tableToXlsxBase64(name: string, rows: Record<string, unknown>[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 31) || "sheet", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
  });
  const headers = rows[0] ? Object.keys(rows[0]) : ["empty"];
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(headers.map((h) => cellForSheet(row[h])));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}
