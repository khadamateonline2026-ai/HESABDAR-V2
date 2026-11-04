import JSZip from "jszip";
import {
  GUIDE_TEXT,
  buildBackupLog,
  cellForSheet,
  toCsv,
  type BackupSnapshot,
} from "@/lib/backup-snapshot";

async function tableXlsx(name: string, rows: Record<string, unknown>[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 31) || "sheet", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
  });
  const headers = rows[0] ? Object.keys(rows[0]) : ["empty"];
  ws.addRow(headers);
  for (const row of rows) ws.addRow(headers.map((h) => cellForSheet(row[h])));
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function snapshotToZip(snap: BackupSnapshot): Promise<Blob> {
  const zip = new JSZip();
  const root = `${snap.stamp}`;
  zip.file(`${root}/00-راهنما/راهنما.txt`, GUIDE_TEXT);
  zip.file(
    `${root}/log/BACKUP-LOG.txt`,
    buildBackupLog(snap, ["دانلود محلی از داخل اپ. هیچ داده‌ای از اپ حذف نشده است."]),
  );
  zip.file(
    `${root}/json/full-database-${snap.stamp}.json`,
    JSON.stringify(
      {
        version: 1,
        exportedAt: snap.exportedAt,
        stamp: snap.stamp,
        tables: snap.tables,
        missingTables: snap.missingTables,
      },
      null,
      2,
    ),
  );
  zip.file(`${root}/files/README.txt`, "پیوست جداگانه‌ای غیر از عکس کالا/لوگو در پایگاه نبود.");
  for (const [name, rows] of Object.entries(snap.tables)) {
    zip.file(`${root}/csv/${name}.csv`, toCsv(rows));
    zip.file(`${root}/excel/${name}.xlsx`, await tableXlsx(name, rows));
  }
  for (const photo of snap.photos) {
    zip.file(`${root}/photos/${photo.filename}`, dataUrlToBytes(photo.dataUrl));
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function deliverBackupZip(
  blob: Blob,
  filename: string,
): Promise<"shared" | "downloaded" | "aborted"> {
  const file = new File([blob], filename, { type: "application/zip" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: "پشتیبان حسابداری",
        text: "پشتیبان دفتر حساب برای ذخیره در گوگل درایو یا ابر خودتان",
      });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "aborted";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export type LastBackupReport = {
  at: string;
  stamp: string;
  kind: string;
  tableCount: number;
  rowTotal: number;
  photoCount: number;
  driveOk: boolean | null;
  driveMessage: string;
  folderUrl: string | null;
  uploadedCount: number;
  localOk: boolean;
};

const LAST_KEY = "hesabdar-drive-backup-last";

export function saveLastBackup(report: LastBackupReport) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(report));
  } catch {
    /* ignore quota */
  }
}

export function loadLastBackup(): LastBackupReport | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastBackupReport;
  } catch {
    return null;
  }
}
