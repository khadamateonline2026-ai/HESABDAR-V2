import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-micro", "text-2xs"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FA_LETTERS = "ءآاأإابپتثجچحخدذرزژسشصضطظعغفقکكگلمنوههیيئ";

function nameBucket(name: string): [number, string] {
  const trimmed = name.trim();
  const c = trimmed.charAt(0);
  if (!c) return [3, trimmed];
  const fa = FA_LETTERS.indexOf(c);
  if (fa >= 0) return [1, `${String(fa).padStart(3, "0")}${trimmed}`];
  if (/[A-Za-z]/.test(c)) return [0, c.toLowerCase() + trimmed.slice(1)];
  if (/[0-9]/.test(c)) return [2, trimmed];
  return [3, trimmed];
}

export function compareFaName(a: string, b: string): number {
  const ka = nameBucket(a);
  const kb = nameBucket(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  return ka[1].localeCompare(kb[1], "fa");
}
