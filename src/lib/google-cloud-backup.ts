import { toast } from "sonner";
import { exportBackupSnapshot, probeGoogleDrive, runCloudBackup } from "@/lib/api/drive-backup";
import { saveCloudBackup } from "@/lib/api/workspace";
import { redirectToLoginIfRequired } from "@/lib/app-data";
import { type BackupSnapshot } from "@/lib/backup-snapshot";
import { queryClient } from "@/lib/query-client";

const KEY = "hesabdar-google-drive";

export type GoogleCloudPrefs = {
  connected: boolean;
  auto: boolean;
  hour: number;
  minute: number;
  lastAutoDay: string;
};

export type CloudUploadResult = {
  cloud: true;
  driveOk: boolean;
  driveMessage: string;
  folderUrl: string | null;
  loginUrl?: string;
};

export function loadGoogleCloudPrefs(): GoogleCloudPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { connected: false, auto: false, hour: 22, minute: 0, lastAutoDay: "" };
    const p = JSON.parse(raw) as Partial<GoogleCloudPrefs>;
    return {
      connected: Boolean(p.connected),
      auto: Boolean(p.auto),
      hour: Math.min(23, Math.max(0, Number(p.hour) || 22)),
      minute: Math.min(59, Math.max(0, Number(p.minute) || 0)),
      lastAutoDay: typeof p.lastAutoDay === "string" ? p.lastAutoDay : "",
    };
  } catch {
    return { connected: false, auto: false, hour: 22, minute: 0, lastAutoDay: "" };
  }
}

export function saveGoogleCloudPrefs(next: GoogleCloudPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function openOfficialGoogleLogin(loginUrl: string) {
  redirectToLoginIfRequired({
    ok: false,
    data: null,
    loginRequired: true,
    loginUrl,
  });
}

export async function checkGoogleDrive(): Promise<{ ok: boolean; message: string; loginUrl?: string }> {
  const probe = await probeGoogleDrive();
  return {
    ok: Boolean(probe.ok),
    message: probe.message,
    loginUrl: probe.loginUrl,
  };
}

export async function connectGoogleDrive(): Promise<{
  connected: boolean;
  message: string;
  loginUrl?: string;
}> {
  const probe = await probeGoogleDrive();
  if (probe.ok) {
    return { connected: true, message: "به گوگل درایو حساب خودتان وصل شد" };
  }
  if (probe.loginUrl) {
    openOfficialGoogleLogin(probe.loginUrl);
    return {
      connected: false,
      loginUrl: probe.loginUrl,
      message: "صفحه ورود گوگل باز شد. با جیمیل همین گوشی وارد شوید، بعد به همین صفحه برگردید.",
    };
  }
  throw new Error(probe.message || "اتصال گوگل درایو برقرار نشد");
}

export async function uploadToGoogleCloud(kind: "manual" | "auto"): Promise<CloudUploadResult> {
  const packed = await exportBackupSnapshot();
  const snapshot = JSON.parse(packed.json) as BackupSnapshot;
  await saveCloudBackup({
    data: {
      kind,
      label: `${kind === "auto" ? "خودکار" : "دستی"} ${snapshot.stamp}`,
    },
  });
  await queryClient.invalidateQueries({ queryKey: ["cloud-backups"] });
  const drive = await runCloudBackup({ data: { kind: kind === "auto" ? "daily" : "full" } });
  if (drive.loginRequired && drive.loginUrl) {
    openOfficialGoogleLogin(drive.loginUrl);
  }
  return {
    cloud: true,
    driveOk: Boolean(drive.ok),
    driveMessage: drive.message,
    folderUrl: drive.rootFolderUrl,
    loginUrl: drive.loginUrl,
  };
}

export function disconnectGoogleDrive() {
  /* Google session lives with the signed-in Google account */
}

let loopStarted = false;

export function startGoogleCloudAutoLoop() {
  if (typeof window === "undefined" || loopStarted) return;
  loopStarted = true;

  async function tick() {
    const prefs = loadGoogleCloudPrefs();
    if (!prefs.connected || !prefs.auto) return;
    const now = new Date();
    if (now.getHours() !== prefs.hour) return;
    if (now.getMinutes() !== prefs.minute) return;
    const day = localDayKey(now);
    if (prefs.lastAutoDay === day) return;
    saveGoogleCloudPrefs({ ...prefs, lastAutoDay: day });
    try {
      const result = await uploadToGoogleCloud("auto");
      if (result.driveOk) toast.success("پشتیبان خودکار در گوگل درایو ذخیره شد");
      else if (result.loginUrl) toast.error("برای آپلود خودکار دوباره با گوگل وارد شوید");
      else toast.error(result.driveMessage || "آپلود خودکار گوگل درایو ناکام شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "آپلود خودکار ناکام شد");
    }
  }

  void tick();
  window.setInterval(() => {
    void tick();
  }, 20_000);
}
