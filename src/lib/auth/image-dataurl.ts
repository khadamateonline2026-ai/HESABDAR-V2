const MAX_BYTES = 400_000; // ~400KB after base64 decode budget
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export function assertSafeImageDataUrl(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new Error("فرمت تصویر نامعتبر است");
  if (!raw.startsWith("data:")) throw new Error("فقط data URL تصویر مجاز است");
  const comma = raw.indexOf(",");
  if (comma < 0) throw new Error("فرمت تصویر نامعتبر است");
  const meta = raw.slice(5, comma); // after "data:"
  const mime = meta.split(";")[0]?.toLowerCase() ?? "";
  if (!ALLOWED.has(mime)) throw new Error("فقط JPEG، PNG یا WebP مجاز است");
  const b64 = raw.slice(comma + 1);
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > MAX_BYTES) throw new Error("حجم تصویر بیش از حد مجاز است");
  if (raw.length > MAX_BYTES * 2) throw new Error("حجم تصویر بیش از حد مجاز است");
  return raw;
}
