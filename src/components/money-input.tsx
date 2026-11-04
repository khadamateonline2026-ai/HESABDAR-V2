import { formatDecimal, parseAmount, stripCommas, toLatinDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MoneyInput({
  value,
  onChange,
  disabled,
  unlimitedDecimals = true,
  className,
}: {
  value: string;
  onChange: (raw: string) => void;
  disabled?: boolean;
  unlimitedDecimals?: boolean;
  className?: string;
}) {

  const display = value === "" ? "" : formatDecimal(value);

  return (
    <input
      dir="ltr"
      inputMode="decimal"
      size={1}
      disabled={disabled}
      value={display}
      onChange={(e) => {
        const latin = toLatinDigits(e.target.value);
        const stripped = stripCommas(latin).replace(/[^\d.-]/g, "");
        if (!unlimitedDecimals) {
          const parts = stripped.split(".");
          if (parts.length > 2) return;
          if (parts[1] && parts[1].length > 4) return;
        }
        onChange(stripped === "-" ? "" : stripped);
      }}
      className={cn("field-input tabular-nums", className)}
    />
  );
}

export function amountNumber(value: string): number {
  return parseAmount(value);
}
