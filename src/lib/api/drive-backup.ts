import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ConnectorType, GoogleDriveTools } from "@/lib/app-data";
import {
  SNAPSHOT_TABLES,
  backupStamp,
  buildBackupLog,
  extractPhotos,
  type BackupSnapshot,
} from "@/lib/backup-snapshot";
import { requireWrite, sqlOf } from "./helpers";

export type DriveUploadReport = {
  attempted: boolean;
  ok: boolean;
  loginRequired?: boolean;
  loginUrl?: string;
  message: string;
  rootFolderId: string | null;
  rootFolderUrl: string | null;
  uploaded: string[];
  failed: string[];
  createdFolders: string[];
};

export type CloudBackupKind = "full" | "daily" | "monthly" | "local";

async function readSnapshot(userId: string): Promise<BackupSnapshot> {
  const sql = await sqlOf();
  const tables: Record<string, Record<string, unknown>[]> = {};
  const missingTables: string[] = [];
  const rowCounts: Record<string, number> = {};
  for (const name of SNAPSHOT_TABLES) {
    try {
      const rows = await sql.query(`select * from ${name} where user_id = $1`, [userId]);
      tables[name] = rows;
      rowCounts[name] = rows.length;
    } catch {
      missingTables.push(name);
      rowCounts[name] = 0;
    }
  }
  const photos = extractPhotos(tables);
  const exportedAt = new Date().toISOString();
  const timezone = "Asia/Kabul";
  const stamp = backupStamp(new Date(), timezone);
  const approxBytes = JSON.stringify(tables).length + photos.reduce((s, p) => s + p.dataUrl.length, 0);
  return {
    stamp,
    exportedAt,
    timezone,
    tables,
    missingTables,
    photos,
    rowCounts,
    tableCount: Object.keys(tables).length,
    rowTotal: Object.values(rowCounts).reduce((s, n) => s + n, 0),
    photoCount: photos.length,
    fileCount: 0,
    approxBytes,
    appUntouched: true,
  };
}

export const exportBackupSnapshot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ json: string }> => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const snap = await readSnapshot(context.userId);
    return { json: JSON.stringify(snap) };
  });

function folderUrl(id: string | null): string | null {
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

function pickId(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string" && data.length > 4) return data;
  if (Array.isArray(data)) return pickId(data[0]);
  if (typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const k of ["id", "folderId", "fileId", "folder_id", "file_id"]) {
    if (typeof o[k] === "string" && (o[k] as string).length > 4) return o[k] as string;
  }
  for (const k of ["files", "folders", "documents", "items", "data", "result"]) {
    const nested = pickId(o[k]);
    if (nested) return nested;
  }
  return null;
}

function pickAllIds(data: unknown): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : typeof o.folderId === "string" ? o.folderId : null;
    const name = typeof o.name === "string" ? o.name : typeof o.title === "string" ? o.title : "";
    if (id) out.push({ id, name });
    for (const k of ["files", "folders", "documents", "items", "data"]) walk(o[k]);
  };
  walk(data);
  return out;
}

async function driveCall(toolName: string, args: Record<string, unknown>) {
  const { callTool } = await import("@/lib/app-data/client.server");
  return callTool(toolName, args, { connectorType: ConnectorType.GoogleDrive });
}

async function findNamedFolder(name: string, parentId: string | null): Promise<string | null> {
  const queries = parentId
    ? [
        `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        name,
      ]
    : [
        `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        name,
      ];
  for (const q of queries) {
    const res = await driveCall(GoogleDriveTools.search, { q, query: q, search: q });
    if (!res.ok) continue;
    const hits = pickAllIds(res.data).filter((h) => !h.name || h.name === name);
    if (hits[0]) return hits[0].id;
    const listed = await driveCall(GoogleDriveTools.listFolder, {
      folderId: parentId ?? "root",
      folder_id: parentId ?? "root",
      id: parentId ?? "root",
    });
    if (listed.ok) {
      const match = pickAllIds(listed.data).find((h) => h.name === name);
      if (match) return match.id;
    }
  }
  return null;
}

async function ensureFolder(name: string, parentId: string | null, created: string[]): Promise<string | null> {
  const existing = await findNamedFolder(name, parentId);
  if (existing) return existing;
  const res = await driveCall(GoogleDriveTools.createFolder, {
    name,
    folderName: name,
    folder_name: name,
    title: name,
    parentId: parentId ?? undefined,
    parent_id: parentId ?? undefined,
    parent: parentId ?? undefined,
  });
  if (!res.ok) return null;
  const id = pickId(res.data);
  if (id) created.push(parentId ? `${name} (${parentId})` : name);
  return id;
}

async function uploadText(
  name: string,
  content: string,
  mime: string,
  parentId: string,
  uploaded: string[],
  failed: string[],
  encoding?: "utf8" | "base64",
): Promise<void> {
  const tools = ["google_drive_create_file", "google_drive_upload_file", "google_drive_write_file"];
  const args = {
    name,
    title: name,
    fileName: name,
    file_name: name,
    content,
    data: content,
    text: content,
    mimeType: mime,
    mime_type: mime,
    encoding: encoding ?? "utf8",
    parentId,
    parent_id: parentId,
    folderId: parentId,
    folder_id: parentId,
  };
  for (const tool of tools) {
    const res = await driveCall(tool, args);
    if (res.ok) {
      uploaded.push(name);
      return;
    }
    if (res.loginRequired) {
      failed.push(`${name}: نیاز به ورود`);
      return;
    }
  }
  failed.push(`${name}: ابزار آپلود فایل در Connector درایو موجود نبود`);
}

export const probeGoogleDrive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const probe = await driveCall(GoogleDriveTools.search, { q: "حسابداری شرکت", query: "حسابداری شرکت" });
    return {
      ok: Boolean(probe.ok),
      loginRequired: Boolean(probe.loginRequired),
      loginUrl: probe.loginUrl as string | undefined,
      message: probe.ok
        ? "به گوگل درایو وصل است"
        : probe.errorMessage || "اتصال گوگل درایو برقرار نیست",
    };
  });

export const runCloudBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: CloudBackupKind }) => d)
  .handler(async ({ context, data }): Promise<DriveUploadReport> => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const snapshot = await readSnapshot(context.userId);
    const empty: DriveUploadReport = {
      attempted: data.kind !== "local",
      ok: false,
      message: "آپلود درایو انجام نشد",
      rootFolderId: null,
      rootFolderUrl: null,
      uploaded: [],
      failed: [],
      createdFolders: [],
    };
    if (data.kind === "local") {
      return { ...empty, attempted: false, message: "فقط دانلود محلی" };
    }

    const probe = await driveCall(GoogleDriveTools.search, { q: "حسابداری شرکت", query: "حسابداری شرکت" });
    if (probe.loginRequired) {
      return {
        ...empty,
        loginRequired: true,
        loginUrl: probe.loginUrl,
        message: "ورود رسمی گوگل لازم است. با حساب گوگل همین دستگاه وارد شوید.",
      };
    }
    if (!probe.ok && /not_connected|missing_connector|cannot resolve gate/i.test(probe.errorMessage ?? "")) {
      return {
        ...empty,
        message: probe.errorMessage || "Connector گوگل درایو در این محیط در دسترس نیست",
      };
    }

    const createdFolders: string[] = [];
    const uploaded: string[] = [];
    const failed: string[] = [];
    const rootId = await ensureFolder("حسابداری شرکت", null, createdFolders);
    if (!rootId) {
      return {
        ...empty,
        message: probe.ok
          ? "پوشه ریشه ساخته نشد"
          : probe.errorMessage || "اتصال گوگل درایو برقرار نشد",
        failed: ["حسابداری شرکت"],
      };
    }
    const guideId = await ensureFolder("00-راهنما", rootId, createdFolders);
    const fullId = await ensureFolder("01-پشتیبان-کامل", rootId, createdFolders);
    const dailyId = await ensureFolder("02-پشتیبان-روزانه", rootId, createdFolders);
    const monthlyId = await ensureFolder("03-پشتیبان-ماهانه", rootId, createdFolders);
    const parent =
      data.kind === "daily" ? dailyId : data.kind === "monthly" ? monthlyId : fullId;
    if (!parent) {
      return {
        attempted: true,
        ok: false,
        message: "پوشه مقصد ساخته نشد",
        rootFolderId: rootId,
        rootFolderUrl: folderUrl(rootId),
        uploaded,
        failed: ["پوشه مقصد"],
        createdFolders,
      };
    }
    const dated = await ensureFolder(snapshot.stamp, parent, createdFolders);
    if (!dated) {
      return {
        attempted: true,
        ok: false,
        message: "پوشه تاریخ ساخته نشد",
        rootFolderId: rootId,
        rootFolderUrl: folderUrl(rootId),
        uploaded,
        failed: [snapshot.stamp],
        createdFolders,
      };
    }
    const excelId = await ensureFolder("excel", dated, createdFolders);
    const csvId = await ensureFolder("csv", dated, createdFolders);
    const jsonId = await ensureFolder("json", dated, createdFolders);
    const photosId = await ensureFolder("photos", dated, createdFolders);
    const filesId = await ensureFolder("files", dated, createdFolders);
    const logId = await ensureFolder("log", dated, createdFolders);

    if (guideId) {
      await uploadText("راهنما.txt", extraGuide(snapshot), "text/plain; charset=utf-8", guideId, uploaded, failed);
    }
    if (logId) {
      const log = buildBackupLog(snapshot, [
        "آپلود از داخل اپ به گوگل درایو همین حساب.",
        "پوشه‌ها عمومی (anyone with the link) نشده‌اند.",
      ]);
      await uploadText("BACKUP-LOG.txt", log, "text/plain; charset=utf-8", logId, uploaded, failed);
    }
    if (jsonId) {
      const jsonName = `full-database-${snapshot.stamp}.json`;
      const json = JSON.stringify(
        {
          version: 1,
          exportedAt: snapshot.exportedAt,
          stamp: snapshot.stamp,
          tables: snapshot.tables,
          missingTables: snapshot.missingTables,
        },
        null,
        2,
      );
      await uploadText(jsonName, json, "application/json; charset=utf-8", jsonId, uploaded, failed);
    }
    if (filesId) {
      await uploadText(
        "README.txt",
        "پیوست جداگانه‌ای غیر از عکس کالا/لوگو در پایگاه نبود.",
        "text/plain; charset=utf-8",
        filesId,
        uploaded,
        failed,
      );
    }
    if (csvId) {
      const { toCsv } = await import("@/lib/backup-snapshot");
      for (const [name, rows] of Object.entries(snapshot.tables)) {
        await uploadText(`${name}.csv`, toCsv(rows), "text/csv; charset=utf-8", csvId, uploaded, failed);
      }
    }
    if (excelId) {
      const { tableToXlsxBase64 } = await import("@/lib/backup-xlsx.server");
      for (const [name, rows] of Object.entries(snapshot.tables)) {
        try {
          const b64 = await tableToXlsxBase64(name, rows);
          await uploadText(`${name}.xlsx`, b64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", excelId, uploaded, failed, "base64");
        } catch {
          failed.push(`${name}.xlsx`);
        }
      }
    }
    if (photosId) {
      for (const photo of snapshot.photos) {
        const comma = photo.dataUrl.indexOf(",");
        const raw = comma >= 0 ? photo.dataUrl.slice(comma + 1) : photo.dataUrl;
        await uploadText(photo.filename, raw, photo.mime, photosId, uploaded, failed, "base64");
      }
    }

    const ok = uploaded.length > 0;
    return {
      attempted: true,
      ok,
      message: ok
        ? `آپلود انجام شد (${uploaded.length} فایل)`
        : failed[0] || "فایل‌ها آپلود نشدند — ابزار آپلود فایل در Connector موجود نبود",
      rootFolderId: rootId,
      rootFolderUrl: folderUrl(rootId),
      uploaded,
      failed,
      createdFolders,
    };
  });

function extraGuide(snap: BackupSnapshot): string {
  return `پشتیبان حسابداری شرکت
آخرین بسته: ${snap.stamp}
تاریخ: ${snap.exportedAt}
جدول: ${snap.tableCount} — ردیف: ${snap.rowTotal} — عکس: ${snap.photoCount}
هیچ داده‌ای از اپ حذف نشده است.
`;
}
