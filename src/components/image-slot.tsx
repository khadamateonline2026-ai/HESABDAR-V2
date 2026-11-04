import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function readSquare(file: File, size = 512): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.fillStyle = "#f6f3ec";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function ImageSlot({
  src,
  onChange,
  onClear,
  size = 96,
  editable = true,
  alt = "تصویر",
  className,
}: {
  src: string | null | undefined;
  onChange?: (dataUrl: string) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  size?: number;
  editable?: boolean;
  alt?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);

  async function pick(file: File | undefined) {
    if (!file || !onChange) return;
    if (file.size > 2_000_000) {
      toast.error("حجم فایل تصویر بیش از ۲ مگابایت است");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("فقط فایل تصویر مجاز است");
      return;
    }
    try {
      const url = await readSquare(file);
      await onChange(url);
      toast.success("عکس ذخیره شد");
    } catch {
      toast.error("ذخیره عکس ناکام شد");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (src) setPreview(true);
          else if (editable) inputRef.current?.click();
        }}
        style={{ width: size, height: size }}
        className={cn(
          "overflow-hidden rounded-md border border-dashed border-border-strong bg-surface-2",
          src ? "border-solid" : "",
          className,
        )}
        aria-label={src ? "نمایش تصویر" : "آپلود تصویر"}
      >
        {src ? (
          <img src={src} alt={alt} className="size-full object-cover" />
        ) : size < 56 ? (
          <span className="grid size-full place-items-center text-muted">
            <Plus className="size-3.5" />
          </span>
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-xs text-muted">
            کلیک برای عکس
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Modal open={preview} title="تصویر" onClose={() => setPreview(false)}>
        {src ? (
          <img src={src} alt={alt} className="mx-auto max-h-[60vh] w-full rounded-md object-contain" />
        ) : null}
        {editable ? (
          <div className="mt-4 flex justify-start gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(false);
                inputRef.current?.click();
              }}
            >
              تغییر عکس
            </Button>
            {onClear ? (
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await onClear();
                    setPreview(false);
                    toast.success("عکس حذف شد");
                  } catch {
                    toast.error("حذف عکس ناکام شد");
                  }
                }}
              >
                حذف عکس
              </Button>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
