import { getSql, withReadSnapshot, withTransaction, type Sql } from "@/lib/db";
import { convertAmount, num, text } from "@/lib/format";
import { canManageRoleCodes, canWrite, writeError, type Area } from "@/lib/permissions";
import { isWarehouseBackupPayload } from "@/lib/warehouse-backup";
import { assertRestoreConfirmed, buildManifest, validateWorkspaceBackup, type ValidBackup } from "@/lib/backup-validate";
import { peekSessionRole } from "@/lib/session-role-slot";
import { verifyAccountantPin, verifyRolePin } from "./role-pin";
import {
  DEFAULT_SETTINGS,
  ITEM_KIND_LABEL,
  type Account,
  type AppSettings,
  type BomLine,
  type CalendarMode,
  type Catalogs,
  type ColorPreset,
  type Company,
  type Currency,
  type DocStatus,
  type Item,
  type Named,
  type Party,
  type PartyCategory,
  type Profile,
  type Role,
  type StaffUser,
  type StockCard,
  type ItemOverhead,
  type ProductionStage,
  type ProductionOverheadType,
  type ThemeMode,
  parseEmployment,
  parseAccountKind,
} from "@/lib/types";

/** SEC-02: shown when data is requested before a role PIN was entered in this session. */
export const ROLE_REQUIRED = "نقش این نشست انتخاب نشده است؛ نخست نقش و رمز آن را وارد کنید";

/**
 * SEC-02: database access for workspace data. Nothing is read or written
 * until this session has unlocked a role with its PIN.
 */
export async function sqlOf(): Promise<Sql> {
  if (!peekSessionRole()) throw new Error(ROLE_REQUIRED);
  return getSql();
}

/** Only for the role gate itself (bootstrap, onboarding, choosing a role, PIN reset). */
export async function sqlBeforeRole(): Promise<Sql> {
  return getSql();
}

export function mapProfile(row: {
  user_id: string;
  display_name: string;
  role: string;
}): Profile {
  return { userId: row.user_id, displayName: row.display_name, role: row.role as Role };
}

export async function getProfileRow(sql: Sql, userId: string): Promise<Profile | null> {
  const rows = await sql<{ user_id: string; display_name: string; role: string }>`
    select user_id, display_name, role from profiles where user_id = ${userId}
  `;
  return rows[0] ? mapProfile(rows[0]) : null;
}

export function sessionRoleState(owner: Profile): { profile: Profile; needsSessionRole: boolean } {
  const slot = peekSessionRole();
  if (!slot) return { profile: { ...owner, role: "supervisor" }, needsSessionRole: true };
  return { profile: { ...owner, role: slot.role }, needsSessionRole: false };
}

export async function requireProfile(sql: Sql, userId: string): Promise<Profile> {
  const p = await getProfileRow(sql, userId);
  if (!p) throw new Error("نخست نام و نقش خود را ثبت کنید");
  return sessionRoleState(p).profile;
}

export async function requireWrite(sql: Sql, userId: string, area: Area): Promise<Profile> {
  const p = await getProfileRow(sql, userId);
  if (!p) throw new Error("نخست نام و نقش خود را ثبت کنید");
  if (!peekSessionRole()) throw new Error("نقش این نشست انتخاب نشده است");
  const active = sessionRoleState(p).profile;
  if (!canWrite(active.role, area)) throw new Error(writeError(active.role));
  return active;
}

export async function requireManageRoleCodes(sql: Sql, userId: string): Promise<Profile> {
  const p = await getProfileRow(sql, userId);
  if (!p) throw new Error("نخست نام و نقش خود را ثبت کنید");
  if (!peekSessionRole()) throw new Error("نقش این نشست انتخاب نشده است");
  const active = sessionRoleState(p).profile;
  if (!canManageRoleCodes(active.role)) {
    throw new Error("فقط حسابدار می‌تواند کد نقش را مدیریت کند");
  }
  return active;
}

export function mapCompany(row: Record<string, unknown>): Company {
  return {
    userId: text(row.user_id),
    name: text(row.name) || "شرکت من",
    logo: row.logo ? text(row.logo) : null,
    licenseNo: text(row.license_no),
    tin: text(row.tin),
    address: text(row.address),
    phone1: text(row.phone1),
    phone2: text(row.phone2),
    phone3: text(row.phone3),
    email: text(row.email),
  };
}

export function mapCurrency(row: Record<string, unknown>): Currency {
  return {
    id: num(row.id),
    name: text(row.name),
    symbol: text(row.symbol),
    rateToBase: num(row.rate_to_base),
  };
}

export function mapNamed(row: Record<string, unknown>): Named {
  return { id: num(row.id), name: text(row.name) };
}

export function mapParty(row: Record<string, unknown>): Party {
  return {
    id: num(row.id),
    kind: text(row.kind) as Party["kind"],
    name: text(row.name),
    phone: text(row.phone),
    categoryId: row.category_id == null ? null : num(row.category_id),
    categoryName: text(row.category_name),
    notes: text(row.notes),
    jobTypeId: row.job_type_id == null ? null : num(row.job_type_id),
    jobTypeName: text(row.job_type_name),
    startDate: text(row.start_date),
    address: text(row.address),
    currencyId: row.currency_id == null ? null : num(row.currency_id),
    currencyName: text(row.currency_name),
    stageId: row.stage_id == null ? null : num(row.stage_id),
    stageName: text(row.stage_name),
    employment: parseEmployment(text(row.employment)),
    salary: num(row.salary),
  };
}

export function mapItem(row: Record<string, unknown>): Item {
  return {
    id: num(row.id),
    name: text(row.name),
    typeId: row.type_id == null ? null : num(row.type_id),
    typeName: text(row.type_name),
    categoryId: row.category_id == null ? null : num(row.category_id),
    categoryName: text(row.category_name),
    unitId: row.unit_id == null ? null : num(row.unit_id),
    unitName: text(row.unit_name),
    kind: (text(row.kind) as Item["kind"]) || "product",
    image: row.image ? text(row.image) : null,
    minQty: num(row.min_qty),
    salePrice: num(row.sale_price),
    purchasePrice: num(row.purchase_price),
    notes: text(row.notes),
  };
}

export function emptyCatalogs(): Catalogs {
  return {
    currencies: [],
    units: [],
    jobTypes: [],
    partyCategories: [],
    itemCategories: [],
    itemTypes: [],
    items: [],
    warehouses: [],
    accounts: [],
    parties: [],
    productionStages: [],
    productionOverheads: [],
  };
}

export function isFinalStatus(status: unknown): boolean {
  const s = text(status) || "final";
  return s === "final";
}

export function docStatusOf(value: unknown): DocStatus {
  const s = text(value);
  if (s === "draft" || s === "void") return s;
  return "final";
}

export function itemKindOf(value: unknown): Item["kind"] {
  return text(value) === "raw" ? "raw" : "product";
}

export function itemKindLabel(kind: Item["kind"]): string {
  return ITEM_KIND_LABEL[kind];
}

export function invoiceOf(prefix: string, id: number, stored: unknown): string {
  const v = text(stored).trim();
  return v || `${prefix}-${id}`;
}

/**
 * STR-08: only currencies and account balances (what a cash check needs),
 * instead of the whole catalog.
 */
export async function loadAccountBalances(
  sql: Sql,
  userId: string,
): Promise<{ currencies: Catalogs["currencies"]; accounts: Catalogs["accounts"] }> {
  const [currencies, accountRows] = await Promise.all([
    sql<Record<string, unknown>>`select * from currencies where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`
      select a.*, c.name as currency_name, c.symbol as currency_symbol, c.rate_to_base
      from accounts a
      join currencies c on c.id = a.currency_id and c.user_id = a.user_id
      where a.user_id = ${userId}
      order by a.id
    `,
  ]);
  const currencyList = currencies.map(mapCurrency);
  return { currencies: currencyList, accounts: await withBalances(sql, userId, accountRows, currencyList) };
}

export async function loadCatalogs(sql: Sql, userId: string): Promise<Catalogs> {
  const [
    currencies,
    units,
    jobTypes,
    partyCategories,
    itemCategories,
    itemTypes,
    items,
    warehouses,
    accountRows,
    parties,
    stages,
    overheadTypes,
  ] = await Promise.all([
    sql<Record<string, unknown>>`select * from currencies where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`select * from units where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`select * from job_types where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`select * from party_categories where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`select * from item_categories where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`select * from item_types where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`
      select i.*, t.name as type_name, c.name as category_name, u.name as unit_name
      from items i
      left join item_types t on t.id = i.type_id and t.user_id = i.user_id
      left join item_categories c on c.id = i.category_id and c.user_id = i.user_id
      left join units u on u.id = i.unit_id and u.user_id = i.user_id
      where i.user_id = ${userId}
      order by i.id
    `,
    sql<Record<string, unknown>>`select * from warehouses where user_id = ${userId} order by id`,
    sql<Record<string, unknown>>`
      select a.*, c.name as currency_name, c.symbol as currency_symbol, c.rate_to_base
      from accounts a
      join currencies c on c.id = a.currency_id and c.user_id = a.user_id
      where a.user_id = ${userId}
      order by a.id
    `,
    sql<Record<string, unknown>>`
      select p.*,
        pc.name as category_name,
        jt.name as job_type_name,
        cur.name as currency_name,
        st.name as stage_name
      from parties p
      left join party_categories pc on pc.id = p.category_id and pc.user_id = p.user_id
      left join job_types jt on jt.id = p.job_type_id and jt.user_id = p.user_id
      left join currencies cur on cur.id = p.currency_id and cur.user_id = p.user_id
      left join production_stages st on st.id = p.stage_id and st.user_id = p.user_id
      where p.user_id = ${userId}
      order by p.id
    `,
    sql<Record<string, unknown>>`
      select * from production_stages where user_id = ${userId} order by sort_order, id
    `,
    sql<Record<string, unknown>>`
      select * from production_overhead_types where user_id = ${userId} order by id
    `,
  ]);

  const currencyList = currencies.map(mapCurrency);
  const accounts = await withBalances(sql, userId, accountRows, currencyList);

  return {
    currencies: currencyList,
    units: units.map(mapNamed),
    jobTypes: jobTypes.map(mapNamed),
    partyCategories: partyCategories.map((r) => ({
      id: num(r.id),
      kind: text(r.kind),
      name: text(r.name),
    })) as PartyCategory[],
    itemCategories: itemCategories.map((r) => ({
      id: num(r.id),
      name: text(r.name),
      kind: text(r.kind) === "raw" ? ("raw" as const) : ("product" as const),
    })),
    itemTypes: itemTypes.map(mapNamed),
    items: items.map(mapItem),
    warehouses: warehouses.map((r) => {
      const shop = r.shop_only;
      return {
        ...mapNamed(r),
        shopOnly: shop === true || shop === 1 || shop === "t" || shop === "true" || shop === "1",
      };
    }),
    accounts,
    parties: parties.map(mapParty),
    productionStages: stages.map((r) => ({
      id: num(r.id),
      name: text(r.name),
      sortOrder: num(r.sort_order),
    })) as ProductionStage[],
    productionOverheads: overheadTypes.map((r) => ({
      id: num(r.id),
      title: text(r.title),
      amount: num(r.amount),
    })) as ProductionOverheadType[],
  };
}

export async function withBalances(
  sql: Sql,
  userId: string,
  accountRows: Record<string, unknown>[],
  currencies: Currency[],
): Promise<Account[]> {
  // ACC-01: every row carries the rates frozen when it was posted (migration
  // 0029). Converting with them keeps past balances fixed when a currency rate
  // is edited later; the current rate is only a fallback for rows saved before
  // the snapshot columns existed (the migration backfills those).
  const [transfers, capital, openingCash, expenses, payments, workerPays] = await Promise.all([
    sql<{ from_account_id: number; to_account_id: number; amount: unknown; from_rate: unknown; to_rate: unknown }>`
      select from_account_id, to_account_id, amount, from_rate, to_rate from transfers where user_id = ${userId}
    `,
    sql<{ account_id: number; kind: string; amount: unknown; currency_id: number; fx_rate: unknown; account_rate: unknown }>`
      select account_id, kind, amount, currency_id, fx_rate, account_rate from capital_moves where user_id = ${userId}
    `,
    sql<{ account_id: number; amount: unknown; currency_id: number; fx_rate: unknown; account_rate: unknown }>`
      select account_id, amount, currency_id, fx_rate, account_rate from opening_cash where user_id = ${userId}
    `,
    sql<{
      account_id: number | null;
      amount: unknown;
      currency_id: number;
      as_debt?: unknown;
      fx_rate: unknown;
      account_rate: unknown;
    }>`
      select account_id, amount, currency_id, as_debt, fx_rate, account_rate from expenses where user_id = ${userId}
    `,
    sql<{
      account_id: number | null;
      kind: string;
      amount: unknown;
      currency_id: number;
      from_rate: unknown;
      account_rate: unknown;
    }>`
      select pp.account_id, pp.kind, pp.amount, pp.currency_id, pp.account_rate,
        coalesce(
          nullif(pp.fx_rate, 0),
          nullif(pi.fx_rate, 0),
          nullif(si.fx_rate, 0),
          c.rate_to_base,
          1
        ) as from_rate
      from party_payments pp
      left join purchase_invoices pi on pi.id = pp.purchase_invoice_id and pi.user_id = pp.user_id
      left join sale_invoices si on si.id = pp.sale_invoice_id and si.user_id = pp.user_id
      left join currencies c on c.id = pp.currency_id and c.user_id = pp.user_id
      where pp.user_id = ${userId}
    `,
    sql<{ account_id: number | null; amount: unknown; account_rate: unknown; from_rate: unknown }>`
      select wp.account_id, wp.amount, wp.account_rate,
        case when wp.currency_id is null then 1 else coalesce(nullif(wp.fx_rate, 0), wc.rate_to_base, 1) end as from_rate
      from worker_payments wp
      left join currencies wc on wc.id = wp.currency_id and wc.user_id = wp.user_id
      where wp.user_id = ${userId}
    `,
  ]);

  const rateOf = (currencyId: number) =>
    currencies.find((c) => c.id === currencyId)?.rateToBase ?? 1;
  /** Stored snapshot when present (> 0), else today's rate. */
  const frozen = (stored: unknown, fallback: number) => (num(stored) > 0 ? num(stored) : fallback);

  const byId = new Map<number, number>();
  const accCurrency = new Map<number, number>();
  for (const a of accountRows) {
    byId.set(num(a.id), num(a.opening_balance));
    accCurrency.set(num(a.id), num(a.currency_id));
  }
  const accRateNow = (accountId: number) => rateOf(accCurrency.get(accountId) ?? 0);
  for (const r of openingCash) {
    const converted = convertAmount(
      num(r.amount),
      frozen(r.fx_rate, rateOf(num(r.currency_id))),
      frozen(r.account_rate, accRateNow(r.account_id)),
    );
    byId.set(r.account_id, (byId.get(r.account_id) ?? 0) + converted);
  }
  for (const r of capital) {
    const signed = r.kind === "add" ? num(r.amount) : -num(r.amount);
    const converted = convertAmount(
      signed,
      frozen(r.fx_rate, rateOf(num(r.currency_id))),
      frozen(r.account_rate, accRateNow(r.account_id)),
    );
    byId.set(r.account_id, (byId.get(r.account_id) ?? 0) + converted);
  }

  for (const t of transfers) {
    const amt = num(t.amount);
    byId.set(t.from_account_id, (byId.get(t.from_account_id) ?? 0) - amt);
    const fromC = accCurrency.get(t.from_account_id) ?? 0;
    const toC = accCurrency.get(t.to_account_id) ?? 0;
    const converted =
      toC && fromC ? (amt * frozen(t.from_rate, rateOf(fromC))) / frozen(t.to_rate, rateOf(toC)) : amt;
    byId.set(t.to_account_id, (byId.get(t.to_account_id) ?? 0) + converted);
  }
  for (const r of expenses) {
    if (r.account_id == null || Boolean(r.as_debt)) continue;
    const converted = convertAmount(
      num(r.amount),
      frozen(r.fx_rate, rateOf(num(r.currency_id))),
      frozen(r.account_rate, accRateNow(r.account_id)),
    );
    byId.set(r.account_id, (byId.get(r.account_id) ?? 0) - converted);
  }
  for (const r of payments) {
    if (r.account_id == null) continue;
    const converted = convertAmount(num(r.amount), num(r.from_rate) || 1, frozen(r.account_rate, accRateNow(r.account_id)));
    const signed = r.kind === "receipt" ? converted : -converted;
    byId.set(r.account_id, (byId.get(r.account_id) ?? 0) + signed);
  }
  for (const r of workerPays) {
    if (r.account_id == null) continue;
    // ACC-06: a payment in another currency leaves the account at its frozen rate.
    const converted = convertAmount(num(r.amount), num(r.from_rate) || 1, frozen(r.account_rate, accRateNow(r.account_id)));
    byId.set(r.account_id, (byId.get(r.account_id) ?? 0) - converted);
  }

  return accountRows.map((a) => ({
    id: num(a.id),
    name: text(a.name),
    currencyId: num(a.currency_id),
    currencyName: text(a.currency_name),
    currencySymbol: text(a.currency_symbol) || "؋",
    openingBalance: num(a.opening_balance),
    balance: byId.get(num(a.id)) ?? 0,
    kind: parseAccountKind(text(a.kind)),
  }));
}

export function mapSettings(row: Record<string, unknown> | undefined): AppSettings {
  if (!row) return { ...DEFAULT_SETTINGS, roleCodes: { supervisor: "", accountant: "", seller: "" }, colorPresets: [] };
  const theme = text(row.theme) === "dark" ? "dark" : "light";
  const calendar = text(row.calendar) === "gregorian" ? "gregorian" : "jalali";
  return {
    theme: theme as ThemeMode,
    fontSize: Math.min(22, Math.max(12, num(row.font_size) || 16)),
    fontFamily: text(row.font_family) || DEFAULT_SETTINGS.fontFamily,
    fontColor: text(row.font_color) || DEFAULT_SETTINGS.fontColor,
    primaryColor: text(row.primary_color) || DEFAULT_SETTINGS.primaryColor,
    bgColor: text(row.bg_color) || DEFAULT_SETTINGS.bgColor,
    accentColor: text(row.accent_color) || DEFAULT_SETTINGS.accentColor,
    dangerColor: text(row.danger_color) || DEFAULT_SETTINGS.dangerColor,
    listColor: text(row.list_color) || DEFAULT_SETTINGS.listColor,
    cardTint: row.card_tint == null ? true : Boolean(row.card_tint),
    cardTintStrength: Math.min(100, Math.max(0, num(row.card_tint_strength) || 40)),
    calendar: calendar as CalendarMode,
    roleCodes: {
      supervisor: text(row.role_code_supervisor),
      accountant: text(row.role_code_accountant),
      seller: text(row.role_code_seller),
    },
    colorPresets: parseColorPresets(row.color_presets),
    productionEnabled: row.production_enabled == null
      ? true
      : row.production_enabled !== false &&
        row.production_enabled !== 0 &&
        row.production_enabled !== "f" &&
        row.production_enabled !== "false",
  };
}

function parseColorPresets(raw: unknown): ColorPreset[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return [];
    const out: ColorPreset[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const label = text(o.label).trim();
      const id = text(o.id).trim() || `custom-${out.length + 1}`;
      const fontColor = text(o.fontColor);
      const primaryColor = text(o.primaryColor);
      const bgColor = text(o.bgColor);
      if (!label || !fontColor || !primaryColor || !bgColor) continue;
      out.push({
        id,
        label,
        theme: text(o.theme) === "dark" ? "dark" : "light",
        fontColor,
        primaryColor,
        bgColor,
        accentColor: text(o.accentColor) || DEFAULT_SETTINGS.accentColor,
        dangerColor: text(o.dangerColor) || DEFAULT_SETTINGS.dangerColor,
      });
      if (out.length >= 40) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadSettings(sql: Sql, userId: string): Promise<AppSettings> {
  const rows = await sql<Record<string, unknown>>`select * from app_settings where user_id = ${userId}`;
  if (rows[0]) return mapSettings(rows[0]);
  await sql`insert into app_settings (user_id) values (${userId}) on conflict (user_id) do nothing`;
  const again = await sql<Record<string, unknown>>`select * from app_settings where user_id = ${userId}`;
  return mapSettings(again[0]);
}

export async function loadStaff(sql: Sql, userId: string, profile: Profile | null): Promise<StaffUser[]> {
  let rows = await sql<Record<string, unknown>>`
    select * from staff_users where user_id = ${userId} order by is_owner desc, id
  `;
  if (!rows.length && profile) {
    await sql`
      insert into staff_users (user_id, display_name, role, is_owner)
      values (${userId}, ${profile.displayName}, ${profile.role}, ${true})
    `;
    rows = await sql<Record<string, unknown>>`
      select * from staff_users where user_id = ${userId} order by is_owner desc, id
    `;
  }
  return rows.map((r) => ({
    id: num(r.id),
    displayName: text(r.display_name),
    role: text(r.role) as Role,
    isOwner: Boolean(r.is_owner),
  }));
}

export async function getRoleCodes(sql: Sql, userId: string): Promise<Record<Role, string>> {
  const settings = await loadSettings(sql, userId);
  return settings.roleCodes;
}

/**
 * SEC-03: role PIN check with the persistent DB limiter (see role-pin.ts).
 * Call it outside any transaction so a failed attempt is always counted.
 */
export async function assertRolePin(
  sql: Sql,
  userId: string,
  role: Role,
  code: string,
  message = "کد نقش نادرست است",
): Promise<void> {
  await verifyRolePin(sql, userId, role, code, message);
}

/** Accountant PIN gate used by destructive/settings toggles (e.g. production module). */
export async function assertAccountantPin(sql: Sql, userId: string, code: string): Promise<void> {
  await verifyAccountantPin(sql, userId, code);
}


export async function seedDefaults(sql: Sql, userId: string): Promise<void> {
  await sql`
    insert into companies (user_id, name) values (${userId}, ${"شرکت من"})
    on conflict (user_id) do nothing
  `;
  await sql`insert into app_settings (user_id) values (${userId}) on conflict (user_id) do nothing`;
  const existing = await sql<{ n: number }>`select count(*)::int as n from currencies where user_id = ${userId}`;
  if (num(existing[0]?.n) > 0) return;

  await sql`
    insert into currencies (user_id, name, symbol, rate_to_base) values
      (${userId}, ${"افغانی"}, ${"؋"}, ${1}),
      (${userId}, ${"دالر"}, ${"$"}, ${70}),
      (${userId}, ${"تومان"}, ${"تومان"}, ${0.0014})
  `;
  await sql`
    insert into units (user_id, name) values
      (${userId}, ${"عدد"}),
      (${userId}, ${"کیلو"}),
      (${userId}, ${"متر"}),
      (${userId}, ${"لیتر"}),
      (${userId}, ${"بسته"})
  `;
  await sql`insert into warehouses (user_id, name) values (${userId}, ${"گدام اصلی"})`;
  await sql`insert into item_types (user_id, name) values (${userId}, ${"عمومی"})`;
  await sql`
    insert into item_categories (user_id, name, kind) values
      (${userId}, ${"عمومی"}, ${"product"}),
      (${userId}, ${"عمومی"}, ${"raw"})
  `;
  await sql`
    insert into party_categories (user_id, kind, name) values
      (${userId}, ${"customer"}, ${"عمومی"}),
      (${userId}, ${"vendor"}, ${"عمومی"}),
      (${userId}, ${"other"}, ${"عمومی"})
  `;
  await sql`
    insert into expense_categories (user_id, name, kind) values
      (${userId}, ${"عمومی"}, ${"misc"}),
      (${userId}, ${"عمومی"}, ${"recurring"})
  `;
  const afn = await sql<{ id: number }>`
    select id from currencies where user_id = ${userId} and name = ${"افغانی"} limit 1
  `;
  if (afn[0]) {
    await sql`
      insert into accounts (user_id, name, currency_id, opening_balance)
      values (${userId}, ${"صندوق اصلی"}, ${afn[0].id}, ${0})
    `;
  }
}

export const WORKSPACE_TABLES = [
  "companies",
  "app_settings",
  "currencies",
  "units",
  "job_types",
  "production_stages",
  "wage_rates",
  "party_categories",
  "parties",
  "item_categories",
  "item_types",
  "items",
  "bom_lines",
  "item_overheads",
  "production_overhead_types",
  "warehouses",
  "accounts",
  "transfers",
  "capital_moves",
  "opening_cash",
  "opening_stock",
  "purchase_invoices",
  "purchases",
  "purchase_receipts",
  "sale_invoices",
  "sales",
  "expenses",
  "expense_categories",
  "recurring_expenses",
  "recurring_periods",
  "party_payments",
  "worker_payments",
  "work_orders",
  "work_order_alloc",
  "work_deliveries",
  "staff_users",
  "important_notes",
] as const;

export async function dumpWorkspace(sql: Sql, userId: string) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const name of WORKSPACE_TABLES) {
    tables[name] = await sql.query(`select * from ${name} where user_id = $1`, [userId]);
  }
  const profile = await sql<Record<string, unknown>>`
    select display_name, role from profiles where user_id = ${userId}
  `;
  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    profile: profile[0] ?? null,
    // STR-02: row counts per table so a truncated/partial file is detected on restore.
    manifest: buildManifest(tables),
    tables,
  };
}

/** STR-06: the whole workspace as of one moment (single read-only snapshot). */
export async function dumpWorkspaceConsistent(userId: string) {
  return withReadSnapshot((tx) => dumpWorkspace(tx, userId));
}

/**
 * STR-05: mutes the activity log for the CURRENT TRANSACTION only. Outside a
 * transaction it has no lasting effect, so a crash can never leave it muted.
 */
export async function muteActivityLog(sql: Sql, userId: string) {
  await sql`select set_config('hesabdar.mute_log', ${userId}, true)`;
}

export async function unmuteActivityLog(sql: Sql, _userId: string) {
  await sql`select set_config('hesabdar.mute_log', '', true)`;
}

export type RestoreOptions = {
  /** Must be RESTORE_CONFIRM ("replace-all"): a restore replaces ALL workspace data. */
  confirm?: string;
  /** Label of the automatic safety snapshot taken before replacing data. */
  snapshotLabel?: string;
};

/**
 * STR-02 — full-workspace restore.
 * 1. Requires an explicit full-replace confirmation.
 * 2. Validates the WHOLE file (version, all tables, rows, manifest counts)
 *    before anything is touched; an empty or partial file is refused.
 * 3. In ONE transaction: saves an automatic snapshot of the current data to
 *    `data_backups` (visible under online backups), deletes, re-inserts, and
 *    moves id sequences past the restored ids. Any failure rolls back all of it.
 */
export async function restoreWorkspace(
  sql: Sql,
  userId: string,
  payload: string,
  opts: RestoreOptions = {},
): Promise<{ snapshotId: number; rows: number }> {
  assertRestoreConfirmed(opts.confirm);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("فایل پشتیبان معتبر نیست");
  }
  if (isWarehouseBackupPayload(parsed as Record<string, unknown>)) {
    throw new Error("این فایل بک‌آپ گدام است؛ از صفحه گدام‌ها → بک آپ → آپلود وارد کنید");
  }
  const backup = validateWorkspaceBackup(parsed, WORKSPACE_TABLES);
  try {
    return await withTransaction(async (tx) => {
      // STR-05: muted inside the restore's own transaction only.
      await muteActivityLog(tx, userId);
      return restoreWorkspaceTx(tx, userId, backup, opts.snapshotLabel);
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      throw new Error(
        "این پشتیبان شناسه‌هایی دارد که در این پایگاه داده برای حساب دیگری استفاده شده‌اند؛ بازیابی انجام نشد و هیچ داده‌ای تغییر نکرد",
      );
    }
    throw e;
  }
}

/** The transactional part of a restore; `tx` must be a transaction. Exported for tests. */
export async function restoreWorkspaceTx(
  tx: Sql,
  userId: string,
  backup: ValidBackup,
  snapshotLabel?: string,
): Promise<{ snapshotId: number; rows: number }> {
  const allowed = await backupColumns(tx);
  assertBackupRows(backup.tables, allowed);
  const before = await dumpWorkspace(tx, userId);
  const label =
    snapshotLabel || `خودکار پیش از بازیابی ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const snap = await tx<{ id: number }>`
    insert into data_backups (user_id, label, payload)
    values (${userId}, ${label}, ${JSON.stringify(before)})
    returning id
  `;
  for (const name of [...WORKSPACE_TABLES].reverse()) {
    await tx.query(`delete from ${name} where user_id = $1`, [userId]);
  }
  let rows = 0;
  for (const name of restoreInsertOrder()) {
    const list = backup.tables[name] ?? [];
    const cols = allowed.get(name)!;
    for (const row of list) {
      const copy: Record<string, unknown> = { ...row, user_id: userId };
      const keys = Object.keys(copy).filter((key) => cols.has(key));
      if (!keys.length) continue;
      const columns = keys.map((key) => `"${key}"`).join(", ");
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      await tx.query(
        `insert into ${name} (${columns}) values (${placeholders})`,
        keys.map((key) => copy[key]),
      );
      rows += 1;
    }
  }
  await advanceIdSequences(tx, allowed);
  // ACC-09: backups made before purchase_receipts existed carry only the
  // received total per line — rebuild one receipt per received line.
  await tx`
    insert into purchase_receipts (user_id, purchase_id, quantity, warehouse_name, occurred_on)
    select p.user_id, p.id, p.received_qty, coalesce(p.warehouse_name, ''), p.occurred_on
    from purchases p
    where p.user_id = ${userId} and p.received_qty > 0
      and not exists (select 1 from purchase_receipts r where r.purchase_id = p.id and r.user_id = p.user_id)
  `;
  if (backup.profile?.display_name) {
    const role = ["supervisor", "accountant", "seller"].includes(String(backup.profile.role))
      ? String(backup.profile.role)
      : "accountant";
    await tx`
      update profiles set display_name = ${text(backup.profile.display_name)}, role = ${role}
      where user_id = ${userId}
    `;
  }
  return { snapshotId: num(snap[0].id), rows };
}

/**
 * Restored rows keep their original ids; move each serial sequence past the
 * highest id so the next insert can't collide (needed when restoring into a
 * fresh database). Never moves a sequence backwards.
 */
async function advanceIdSequences(tx: Sql, columns: Map<string, Set<string>>): Promise<void> {
  for (const name of WORKSPACE_TABLES) {
    if (!columns.get(name)?.has("id")) continue;
    const seq = await tx.query<{ seq: string | null }>("select pg_get_serial_sequence($1, 'id') as seq", [name]);
    const seqName = seq[0]?.seq;
    if (!seqName) continue;
    const max = await tx.query<{ m: number | string | null }>(`select max(id) as m from ${name}`);
    const maxId = num(max[0]?.m);
    if (maxId <= 0) continue;
    await tx.query(
      "select setval($1::regclass, greatest($2::bigint, (select last_value from pg_sequences where (schemaname || '.' || sequencename)::regclass = $1::regclass)), true)",
      [seqName, maxId],
    );
  }
}

const SAFE_COLUMN = /^[a-z_][a-z0-9_]*$/;

function restoreInsertOrder(): readonly string[] {
  const names = [...WORKSPACE_TABLES];
  const expensesAt = names.indexOf("expenses");
  const categoriesAt = names.indexOf("expense_categories");
  if (expensesAt >= 0 && categoriesAt > expensesAt) {
    names.splice(categoriesAt, 1);
    names.splice(expensesAt, 0, "expense_categories");
  }
  return names;
}

async function backupColumns(sql: Sql): Promise<Map<string, Set<string>>> {
  const known = new Set<string>(WORKSPACE_TABLES);
  const rows = await sql.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  const map = new Map<string, Set<string>>();
  for (const name of WORKSPACE_TABLES) map.set(name, new Set());
  for (const row of rows) {
    if (!known.has(row.table_name) || !SAFE_COLUMN.test(row.column_name)) continue;
    map.get(row.table_name)?.add(row.column_name);
  }
  return map;
}

function assertBackupRows(tables: Record<string, unknown>, allowed: Map<string, Set<string>>) {
  for (const name of WORKSPACE_TABLES) {
    const rows = tables[name] ?? [];
    const cols = allowed.get(name);
    if (!Array.isArray(rows) || !cols || !cols.has("user_id")) throw new Error("فایل پشتیبان معتبر نیست");
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("فایل پشتیبان معتبر نیست");
      for (const key of Object.keys(row as Record<string, unknown>)) {
        if (!cols.has(key)) throw new Error("فایل پشتیبان ستون نامعتبر دارد");
      }
    }
  }
}

export async function requireWriteAny(
  sql: Sql,
  userId: string,
  areas: Area[],
): Promise<Profile> {
  const p = await getProfileRow(sql, userId);
  if (!p) throw new Error("نخست نام و نقش خود را ثبت کنید");
  if (!peekSessionRole()) throw new Error("نقش این نشست انتخاب نشده است");
  const active = sessionRoleState(p).profile;
  if (areas.some((a) => canWrite(active.role, a))) return active;
  throw new Error(writeError(active.role));
}

export async function guard(userId: string, area: Area) {
  const sql = await sqlOf();
  const profile = await requireWrite(sql, userId, area);
  return { sql, profile };
}

export function rethrow(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/unique|duplicate/i.test(msg)) throw new Error("این مورد از قبل ثبت شده است");
  throw e instanceof Error ? e : new Error(msg);
}

export async function assertUniqueItemName(
  sql: Sql,
  userId: string,
  name: string,
  kind: string,
  excludeId?: number,
) {
  const rows = excludeId
    ? await sql<{ id: number }>`
        select id from items
        where user_id = ${userId} and kind = ${kind} and name = ${name} and id <> ${excludeId}
        limit 1
      `
    : await sql<{ id: number }>`
        select id from items
        where user_id = ${userId} and kind = ${kind} and name = ${name}
        limit 1
      `;
  if (rows[0]) throw new Error("این نام از قبل ثبت شده است");
}

export function nextDocNo(existing: string[], prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const raw of existing) {
    const m = raw.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}-${max + 1}`;
}

export function rateOf(currencies: { id: number; rateToBase: number }[], id: number): number {
  return currencies.find((c) => c.id === id)?.rateToBase || 1;
}

export function fxToBase(fxEnabled: unknown, fxRate: unknown, currencyRate: number): number {
  const stored = num(fxRate);
  if (stored > 0) return stored;
  if (fxEnabled) return currencyRate || 1;
  return 1;
}

/**
 * ACC-02: stock is valued at weighted average cost (WAC). Each lot holds the
 * quantity on hand and its total cost in base currency; receipts add their
 * actual cost, issues (sales, production, negative adjustments) leave at the
 * current average. `unvalued` is the part of `qty` that came in without any
 * cost (opening stock with no value and no purchase price on the item).
 */
type Lot = { qty: number; value: number; unvalued: number };

function lotOf(map: Map<string, Lot>, key: string): Lot {
  const cur = map.get(key) ?? { qty: 0, value: 0, unvalued: 0 };
  map.set(key, cur);
  return cur;
}

function addLot(map: Map<string, Lot>, key: string, qty: number, value: number, unvalued = 0) {
  if (Math.abs(qty) <= 1e-12 && Math.abs(value) <= 1e-12) return;
  const l = lotOf(map, key);
  l.qty += qty;
  l.value += value;
  l.unvalued += unvalued;
}

function takeLot(map: Map<string, Lot>, key: string, qty: number): number {
  const l = lotOf(map, key);
  if (qty <= 0 || l.qty <= 0) return 0;
  const cost = l.value / l.qty;
  const actual = Math.min(l.qty, qty);
  l.unvalued -= actual * (l.unvalued / l.qty);
  l.qty -= actual;
  const val = actual * cost;
  l.value -= val;
  if (l.qty <= 1e-9) {
    l.qty = 0;
    l.value = 0;
    l.unvalued = 0;
  }
  return val;
}

type InventoryState = {
  products: StockCard[];
  raw: StockCard[];
  workerRaw: StockCard[];
  bomByProduct: Record<number, BomLine[]>;
  overheadsByProduct: Record<number, ItemOverhead[]>;
};

/**
 * ACC-08: serialize stock postings of one workspace. Call it as the FIRST
 * statement of any transaction that checks or moves stock, before reading
 * the stock it checks. Lock order everywhere: this stock lock, then the
 * document-number lock (allocInvoiceNo), then row locks (accounts, orders).
 */
export async function lockStock(sql: Sql, userId: string): Promise<void> {
  await sql.query("select pg_advisory_xact_lock(hashtext($1))", [`${userId}:stock`]);
}

export async function loadInventoryState(sql: Sql, userId: string): Promise<InventoryState> {
  const { saleCosts: _costs, ...state } = await loadInventoryValuation(sql, userId);
  return state;
}

/**
 * ACC-02: stock cards valued at weighted average cost, plus the cost of goods
 * sold of every sale line (base currency, at the average cost when it was sold).
 */
export async function loadInventoryValuation(
  sql: Sql,
  userId: string,
): Promise<InventoryState & { saleCosts: Record<number, number> }> {
  const [itemRows, opening, purchases, sales, currencies, bomRows, orders, deliveries, overheadRows, allocRows] =
    await Promise.all([
      sql<Record<string, unknown>>`
        select i.*, c.name as category_name, u.name as unit_name
        from items i
        left join item_categories c on c.id = i.category_id and c.user_id = i.user_id
        left join units u on u.id = i.unit_id and u.user_id = i.user_id
        where i.user_id = ${userId}
        order by i.id
      `,
      sql<Record<string, unknown>>`select * from opening_stock where user_id = ${userId}`,
      sql<Record<string, unknown>>`
        select p.*, i.fx_enabled as inv_fx, i.fx_rate as inv_rate
        from purchases p
        left join purchase_invoices i on i.id = p.invoice_id and i.user_id = p.user_id
        where p.user_id = ${userId}
      `,
      sql<Record<string, unknown>>`select * from sales where user_id = ${userId}`,
      sql<{ id: number; rate_to_base: unknown }>`
        select id, rate_to_base from currencies where user_id = ${userId}
      `,
      sql<Record<string, unknown>>`
        select b.*, r.name as raw_name, r.unit_id as raw_unit_id, u.name as unit_name
        from bom_lines b
        join items r on r.id = b.raw_item_id and r.user_id = b.user_id
        left join units u on u.id = r.unit_id and u.user_id = r.user_id
        where b.user_id = ${userId}
        order by b.id
      `,
      sql<Record<string, unknown>>`select * from work_orders where user_id = ${userId}`,
      sql<Record<string, unknown>>`select * from work_deliveries where user_id = ${userId}`,
      sql<Record<string, unknown>>`select * from item_overheads where user_id = ${userId} order by id`,
      sql<Record<string, unknown>>`
        select work_order_id, raw_item_id, raw_item_name, qty_per_unit
        from work_order_alloc where user_id = ${userId}
        order by id
      `,
    ]);

  const items = itemRows.map(mapItem);
  const byId = new Map(items.map((i) => [i.id, i]));
  const byName = new Map(items.map((i) => [i.name, i]));
  const rates = new Map(currencies.map((c) => [num(c.id), num(c.rate_to_base) || 1]));
  const overheadsByProduct: Record<number, ItemOverhead[]> = {};
  for (const r of overheadRows) {
    const pid = num(r.item_id);
    const arr = overheadsByProduct[pid] ?? [];
    arr.push({
      id: num(r.id),
      itemId: pid,
      title: text(r.title),
      amount: num(r.amount),
    });
    overheadsByProduct[pid] = arr;
  }
  const bomByProduct: Record<number, BomLine[]> = {};
  for (const b of bomRows) {
    const pid = num(b.product_id);
    const arr = bomByProduct[pid] ?? [];
    arr.push({
      rawItemId: num(b.raw_item_id),
      rawItemName: text(b.raw_name),
      quantity: num(b.quantity),
      unitId: b.raw_unit_id == null ? null : num(b.raw_unit_id),
      unitName: text(b.unit_name),
    });
    bomByProduct[pid] = arr;
  }
  const allocByOrder = new Map<number, { rawItemId: number; rawItemName: string; quantity: number }[]>();
  for (const row of allocRows) {
    const oid = num(row.work_order_id);
    const arr = allocByOrder.get(oid) ?? [];
    arr.push({
      rawItemId: num(row.raw_item_id),
      rawItemName: text(row.raw_item_name),
      quantity: num(row.qty_per_unit),
    });
    allocByOrder.set(oid, arr);
  }

  function recipeLines(orderId: number, productId: number) {
    const snap = allocByOrder.get(orderId);
    if (snap && snap.length) return snap;
    return (bomByProduct[productId] ?? []).map((line) => ({
      rawItemId: line.rawItemId,
      rawItemName: line.rawItemName,
      quantity: line.quantity,
    }));
  }

  function keyOf(itemId: number | null, name: string): string {
    if (itemId != null && byId.has(itemId)) return `id:${itemId}`;
    const found = byName.get(name);
    if (found) return `id:${found.id}`;
    return `name:${name}`;
  }

  function kindOf(itemId: number | null, name: string): Item["kind"] {
    if (itemId != null && byId.has(itemId)) return byId.get(itemId)!.kind;
    const found = byName.get(name);
    return found?.kind ?? "product";
  }

  const raw = new Map<string, Lot>();
  const worker = new Map<string, Lot>();
  const product = new Map<string, Lot>();

  type Ev = { date: string; rank: number; id: number; run: () => void };
  const events: Ev[] = [];

  for (const o of opening) {
    const name = text(o.item_name);
    const k = keyOf(null, name);
    const qty = num(o.quantity);
    const stored = num(o.value_base);
    const finished = text(o.kind) !== "raw";
    const lots = finished ? product : raw;
    // ACC-02: opening stock saved without a value uses the item's purchase
    // price; with no purchase price it stays at 0 and the card is flagged.
    const price = byName.get(name)?.purchasePrice ?? 0;
    const value = Math.abs(stored) > 1e-9 ? stored : price > 1e-9 ? qty * price : 0;
    const unvalued = qty > 0 && Math.abs(value) <= 1e-9 ? qty : 0;
    events.push({
      date: text(o.occurred_on),
      rank: 0,
      id: num(o.id),
      run: () => (qty < 0 ? void takeLot(lots, k, -qty) : addLot(lots, k, qty, value, unvalued)),
    });
  }
  for (const p of purchases) {
    const rec = p.received_qty == null ? 0 : num(p.received_qty);
    if (rec <= 0) continue;
    const k = keyOf(p.item_id == null ? null : num(p.item_id), text(p.item_name));
    const rate = fxToBase(p.inv_fx, p.inv_rate, rates.get(num(p.currency_id)) ?? 1);
    const value = rec * num(p.unit_price) * rate;
    events.push({
      date: text(p.occurred_on),
      rank: 1,
      id: num(p.id),
      run: () => addLot(raw, k, rec, value),
    });
  }
  for (const o of orders) {
    const oid = num(o.id);
    const rootId = o.root_id == null ? oid : num(o.root_id);
    if (rootId !== oid) continue;
    const pid = num(o.product_id);
    const lines = recipeLines(oid, pid);
    const qty = num(o.quantity);
    events.push({
      date: text(o.occurred_on),
      rank: 2,
      id: oid,
      run: () => {
        for (const line of lines) {
          const k = keyOf(line.rawItemId, line.rawItemName);
          const need = line.quantity * qty;
          const val = takeLot(raw, k, need);
          addLot(worker, k, need, val);
        }
      },
    });
  }
  for (const d of deliveries) {
    const oid = num(d.work_order_id);
    const order = orders.find((o) => num(o.id) === oid);
    if (!order) continue;
    const qty = num(d.quantity);
    const toWorker = d.to_worker_id == null ? null : num(d.to_worker_id);
    if (toWorker) continue;
    const pk = keyOf(num(order.product_id), text(order.product_name));
    const productId = num(order.product_id);
    const rootId = order.root_id == null ? oid : num(order.root_id);
    const lines = recipeLines(rootId, productId);
    events.push({
      date: text(d.occurred_on),
      rank: 3,
      id: num(d.id),
      run: () => {
        let cost = 0;
        for (const line of lines) {
          const k = keyOf(line.rawItemId, line.rawItemName);
          const need = line.quantity * qty;
          cost += takeLot(worker, k, need);
        }
        for (const extra of overheadsByProduct[productId] ?? []) cost += extra.amount * qty;
        addLot(product, pk, qty, cost);
      },
    });
  }
  const saleCosts: Record<number, number> = {};
  const shortfalls: { saleId: number; key: string; isRaw: boolean; qty: number }[] = [];
  for (const s of sales) {
    const name = text(s.item_name);
    const id = s.item_id == null ? null : num(s.item_id);
    const k = keyOf(id, name);
    const qty = num(s.quantity);
    const isRaw = kindOf(id, name) === "raw";
    const saleId = num(s.id);
    events.push({
      date: text(s.occurred_on),
      rank: 4,
      id: saleId,
      run: () => {
        const lots = isRaw ? raw : product;
        const onHand = Math.max(0, lots.get(k)?.qty ?? 0);
        saleCosts[saleId] = takeLot(lots, k, qty);
        if (qty > onHand + 1e-9) shortfalls.push({ saleId, key: k, isRaw, qty: qty - onHand });
      },
    });
  }
  events.sort((a, b) =>
    a.date === b.date ? (a.rank === b.rank ? a.id - b.id : a.rank - b.rank) : a.date < b.date ? -1 : 1,
  );
  for (const e of events) e.run();
  const lastBuy = new Map<number, { date: string; id: number; price: number }>();
  for (const p of purchases) {
    const item = p.item_id == null ? byName.get(text(p.item_name)) : byId.get(num(p.item_id));
    if (!item) continue;
    const rate = fxToBase(p.inv_fx, p.inv_rate, rates.get(num(p.currency_id)) ?? 1);
    const price = num(p.unit_price) * rate;
    if (price <= 1e-9) continue;
    const prev = lastBuy.get(item.id);
    const date = text(p.occurred_on);
    const id = num(p.id);
    if (!prev || date > prev.date || (date === prev.date && id > prev.id)) {
      lastBuy.set(item.id, { date, id, price });
    }
  }
  /** Unit cost shown when nothing is on hand (forms use it as an estimate). */
  function referenceCost(it: Item, fallbackCost: number): number {
    const bought = lastBuy.get(it.id)?.price ?? 0;
    return it.purchasePrice > 1e-9 ? it.purchasePrice : bought > 1e-9 ? bought : fallbackCost;
  }
  function card(it: Item, lot: Lot | undefined, fallbackCost: number): StockCard {
    // ACC-02: on-hand stock is valued at its weighted average cost.
    const qty = lot?.qty ?? 0;
    const onHand = qty > 1e-9;
    const unitCost = onHand ? (lot?.value ?? 0) / qty : referenceCost(it, fallbackCost);
    const costMissing = onHand && (lot?.unvalued ?? 0) > 1e-9;
    return {
      itemId: it.id,
      name: it.name,
      categoryId: it.categoryId,
      categoryName: it.categoryName,
      unitId: it.unitId,
      unitName: it.unitName,
      image: it.image,
      minQty: it.minQty,
      qty,
      unitCost,
      valueBase: onHand ? (lot?.value ?? 0) : 0,
      ...(costMissing ? { costMissing: true } : {}),
      kind: it.kind,
      salePrice: it.salePrice,
      purchasePrice: it.purchasePrice,
    };
  }
  function bomCost(productId: number): number {
    const lines = bomByProduct[productId] ?? [];
    let sum = 0;
    for (const line of lines) {
      const rawItem = byId.get(line.rawItemId);
      let unit = rawItem?.purchasePrice ?? 0;
      if (unit <= 1e-9) {
        const k = keyOf(line.rawItemId, line.rawItemName);
        const l = raw.get(k);
        unit = l && l.qty > 1e-9 ? l.value / l.qty : 0;
      }
      sum += line.quantity * unit;
    }
    for (const extra of overheadsByProduct[productId] ?? []) sum += extra.amount;
    return sum;
  }
  // Sold more than was on hand: the missing part is costed at the item's
  // current/reference cost instead of 0.
  for (const sf of shortfalls) {
    const it = sf.key.startsWith("id:") ? byId.get(Number(sf.key.slice(3))) : undefined;
    if (!it) continue;
    const lot = (sf.isRaw ? raw : product).get(sf.key);
    const unit = lot && lot.qty > 1e-9 ? lot.value / lot.qty : referenceCost(it, sf.isRaw ? 0 : bomCost(it.id));
    saleCosts[sf.saleId] = (saleCosts[sf.saleId] ?? 0) + sf.qty * unit;
  }
  return {
    saleCosts,
    products: items.filter((i) => i.kind === "product").map((i) => card(i, product.get(`id:${i.id}`), bomCost(i.id))),
    raw: items.filter((i) => i.kind === "raw").map((i) => card(i, raw.get(`id:${i.id}`), 0)),
    workerRaw: items
      .filter((i) => i.kind === "raw")
      .map((i) => card(i, worker.get(`id:${i.id}`), 0))
      .filter((c) => c.qty > 1e-9),
    bomByProduct,
    overheadsByProduct,
  };
}

export type WarehouseStockRow = {
  warehouseName: string;
  items: { name: string; qty: number; valueBase: number; kind: Item["kind"] }[];
};

/**
 * ACC-06: what each worker was paid, in the base currency. A payment without a
 * currency is in the base currency; otherwise its frozen rate (or today's).
 */
export async function loadWorkerPaidBase(sql: Sql, userId: string): Promise<Map<number, number>> {
  const rows = await sql<{ worker_id: number; amount_base: unknown }>`
    select wp.worker_id, wp.amount * case when wp.currency_id is null then 1 else coalesce(nullif(wp.fx_rate, 0), wc.rate_to_base, 1) end as amount_base
    from worker_payments wp
    left join currencies wc on wc.id = wp.currency_id and wc.user_id = wp.user_id
    where wp.user_id = ${userId}
  `;
  const out = new Map<number, number>();
  for (const r of rows) out.set(num(r.worker_id), (out.get(num(r.worker_id)) ?? 0) + num(r.amount_base));
  return out;
}

export const MAIN_WAREHOUSE = "گدام اصلی";

/**
 * ACC-10: one per-warehouse breakdown for the warehouse page and the
 * dashboard. On-hand quantity and value come from the stock cards (so sales,
 * production use and the frozen exchange rate are all included); each item is
 * split over warehouses in proportion to what came into each one (opening
 * stock and purchase receipts). Sales carry no warehouse yet, so they reduce
 * every warehouse of that item proportionally.
 */
export async function loadWarehouseStock(
  sql: Sql,
  userId: string,
  inventory?: InventoryState,
): Promise<WarehouseStockRow[]> {
  const [inv, warehouses, opening, purchases, receipts] = await Promise.all([
    inventory ?? loadInventoryState(sql, userId),
    sql<{ name: string }>`select name from warehouses where user_id = ${userId} order by id`,
    sql<{ item_name: string; warehouse_name: string; quantity: unknown }>`
      select item_name, warehouse_name, quantity from opening_stock where user_id = ${userId}
    `,
    sql<{ id: number; item_id: number | null; item_name: string; received_qty: unknown; warehouse_name: string | null }>`
      select id, item_id, item_name, received_qty, warehouse_name from purchases
      where user_id = ${userId} and received_qty > 0
    `,
    sql<{ purchase_id: number; quantity: unknown; warehouse_name: string }>`
      select purchase_id, quantity, warehouse_name from purchase_receipts where user_id = ${userId}
    `,
  ]);
  const names = warehouses.map((w) => text(w.name));
  if (!names.includes(MAIN_WAREHOUSE)) names.unshift(MAIN_WAREHOUSE);
  const whOf = (n: unknown) => text(n).trim() || MAIN_WAREHOUSE;
  const cards = [...inv.raw, ...inv.products];
  const nameById = new Map(cards.map((c) => [c.itemId, c.name]));
  const inflow = new Map<string, Map<string, number>>();
  const add = (item: string, wh: string, qty: number) => {
    const m = inflow.get(item) ?? new Map<string, number>();
    inflow.set(item, m);
    m.set(wh, (m.get(wh) ?? 0) + qty);
  };
  for (const o of opening) add(text(o.item_name), whOf(o.warehouse_name), num(o.quantity));
  const byPurchase = new Map<number, { wh: string; qty: number }[]>();
  for (const r of receipts) {
    const arr = byPurchase.get(num(r.purchase_id)) ?? [];
    arr.push({ wh: whOf(r.warehouse_name), qty: num(r.quantity) });
    byPurchase.set(num(r.purchase_id), arr);
  }
  for (const p of purchases) {
    const name = (p.item_id != null && nameById.get(num(p.item_id))) || text(p.item_name);
    let left = num(p.received_qty);
    for (const r of byPurchase.get(num(p.id)) ?? []) {
      add(name, r.wh, r.qty);
      left -= r.qty;
    }
    // Receipts that do not add up (older data) go to the line's warehouse.
    if (left > 1e-9) add(name, whOf(p.warehouse_name), left);
  }
  const out = new Map<string, WarehouseStockRow["items"]>();
  const put = (wh: string, row: WarehouseStockRow["items"][number]) => {
    if (!names.includes(wh)) names.push(wh);
    const arr = out.get(wh) ?? [];
    arr.push(row);
    out.set(wh, arr);
  };
  for (const c of cards) {
    if (c.qty <= 1e-9) continue;
    const flows = [...(inflow.get(c.name)?.entries() ?? [])].filter(([, q]) => q > 1e-9);
    const total = flows.reduce((s, [, q]) => s + q, 0);
    if (total <= 1e-9) {
      put(MAIN_WAREHOUSE, { name: c.name, qty: c.qty, valueBase: c.valueBase, kind: c.kind });
      continue;
    }
    for (const [wh, q] of flows) {
      const share = q / total;
      put(wh, { name: c.name, qty: c.qty * share, valueBase: c.valueBase * share, kind: c.kind });
    }
  }
  return names.map((warehouseName) => ({ warehouseName, items: out.get(warehouseName) ?? [] }));
}

export function wageForProduct(
  productName: string,
  jobTypeId: number | null,
  rates: { jobTypeId: number; productModel: string; wagePerUnit: number }[],
): number {
  const model = productName.trim();
  const exactJob = rates.find((r) => r.productModel.trim() === model && r.jobTypeId === jobTypeId);
  if (exactJob) return exactJob.wagePerUnit;
  const exact = rates.find((r) => r.productModel.trim() === model);
  if (exact) return exact.wagePerUnit;
  const byJob = rates.find((r) => r.jobTypeId === jobTypeId && !r.productModel.trim());
  return byJob?.wagePerUnit ?? 0;
}

export const INSUFFICIENT_CASH = "موجودی ناکافی هست";

export async function assertCashAvailable(
  sql: Sql,
  userId: string,
  args: {
    accountId: number | null;
    amount: number;
    amountRate: number;
    creditBack?: number;
  },
): Promise<void> {
  if (args.amount <= 1e-9) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
  if (args.accountId == null) throw new Error(INSUFFICIENT_CASH);
  const catalogs = await loadAccountBalances(sql, userId);
  const acc = catalogs.accounts.find((a) => a.id === args.accountId);
  if (!acc) throw new Error(INSUFFICIENT_CASH);
  if (acc.kind === "counterparty") return;
  const accRate = catalogs.currencies.find((c) => c.id === acc.currencyId)?.rateToBase || 1;
  const need = convertAmount(args.amount, args.amountRate || 1, accRate);
  const available = acc.balance + (args.creditBack ?? 0);
  if (need > available + 1e-9) throw new Error(INSUFFICIENT_CASH);
}

export async function syncSalariedWorker(sql: Sql, userId: string, workerId: number): Promise<void> {
  const row = await sql<Record<string, unknown>>`
    select * from parties where id = ${workerId} and user_id = ${userId} and kind = ${"worker"}
  `;
  if (!row[0]) return;
  const employment = parseEmployment(text(row[0].employment));
  const salary = num(row[0].salary);
  const name = text(row[0].name);
  const startOn = text(row[0].start_date);
  const existing = await sql<{ id: number }>`
    select id from recurring_expenses where user_id = ${userId} and worker_id = ${workerId}
  `;
  if (employment !== "salaried" || salary <= 0) {
    if (existing[0]) {
      await sql`delete from recurring_expenses where id = ${existing[0].id} and user_id = ${userId}`;
    }
    return;
  }
  const currencies = await sql<{ id: number }>`
    select id from currencies where user_id = ${userId} order by id
  `;
  const currencyId = row[0].currency_id == null ? (currencies[0]?.id ?? null) : num(row[0].currency_id);
  if (currencyId == null) return;
  const title = `معاش ${name}`;
  const start = startOn || new Date().toISOString().slice(0, 10);
  if (existing[0]) {
    await sql`
      update recurring_expenses set
        title = ${title}, amount = ${salary}, currency_id = ${currencyId},
        start_on = ${start}, cadence = ${"monthly"}, due_anchor = ${"end"}, party_id = ${workerId}
      where id = ${existing[0].id} and user_id = ${userId}
    `;
    return;
  }
  await sql`
    insert into recurring_expenses (
      user_id, title, amount, currency_id, category_id, start_on, cadence, due_anchor, notes, account_id, party_id, worker_id
    ) values (
      ${userId}, ${title}, ${salary}, ${currencyId}, ${null}, ${start}, ${"monthly"}, ${"end"},
      ${"معاش کارگر ثابت"}, ${null}, ${workerId}, ${workerId}
    )
  `;
}

