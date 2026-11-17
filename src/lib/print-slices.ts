/**
 * چاپ = همان عکس ذخیره‌شده. عکس بلند به صفحه‌های A4 بریده می‌شود؛ محل برش
 * تا حد امکان روی یک ردیف پیکسل یکدست (فاصله یا خط جدول) گذاشته می‌شود تا
 * متن نصفه نشود.
 */
export function sliceBreaks(
  totalH: number,
  pageH: number,
  isCleanRow: (y: number) => boolean,
  lookBack = Math.floor(pageH * 0.18),
): number[] {
  const out: number[] = [];
  if (totalH <= 0 || pageH <= 0) return [0];
  let y = 0;
  while (y < totalH) {
    out.push(y);
    const end = y + pageH;
    if (end >= totalH) break;
    let cut = end;
    for (let k = end; k > end - lookBack && k > y + 1; k--) {
      if (isCleanRow(k)) {
        cut = k;
        break;
      }
    }
    y = cut;
  }
  return out;
}
