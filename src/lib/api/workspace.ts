import { assertPinShape, hashPin, verifyPin } from "@/lib/auth/pin-hash";
import { assertRoleNotLocked, recordRoleFail, recordRoleSuccess } from "@/lib/auth/role-rate-limit";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text } from "@/lib/format";
import { type AppSettings, type ColorPreset, type Role } from "@/lib/types";
import { dumpWorkspace, getRoleCodes, muteActivityLog, requireManageRoleCodes, requireProfile, requireWrite, restoreWorkspace, rethrow, seedDefaults, sqlOf, unmuteActivityLog, WORKSPACE_TABLES, assertAccountantPin, assertRolePin } from "./helpers";

export const saveAppearance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      theme: AppSettings["theme"];
      fontSize: number;
      fontFamily?: string;
      fontColor: string;
      primaryColor: string;
      bgColor: string;
      accentColor: string;
      dangerColor: string;
      listColor?: string;
      cardTint: boolean;
      cardTintStrength: number;
      calendar: AppSettings["calendar"];
      colorPresets?: ColorPreset[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const fontSize = Math.min(22, Math.max(12, Math.round(data.fontSize) || 16));
    const fontFamily = (data.fontFamily || "Vazirmatn").trim() || "Vazirmatn";
    const strength = Math.min(100, Math.max(0, Math.round(data.cardTintStrength) || 40));
    const presetsJson = JSON.stringify(Array.isArray(data.colorPresets) ? data.colorPresets.slice(0, 40) : []);
    const listColor = (data.listColor || "#3a2433").trim();
    await sql.query("alter table app_settings add column if not exists color_presets text not null default '[]'");
    await sql.query("alter table app_settings add column if not exists list_color text not null default '#3a2433'");
    await sql.query("alter table app_settings add column if not exists font_family text not null default 'Vazirmatn'");
    await sql`
      insert into app_settings (
        user_id, theme, font_size, font_family, font_color, primary_color, bg_color,
        accent_color, danger_color, card_tint, card_tint_strength, calendar, color_presets, list_color
      ) values (
        ${context.userId}, ${data.theme}, ${fontSize}, ${fontFamily}, ${data.fontColor}, ${data.primaryColor},
        ${data.bgColor}, ${data.accentColor}, ${data.dangerColor}, ${data.cardTint}, ${strength}, ${data.calendar}, ${presetsJson}, ${listColor}
      )
      on conflict (user_id) do update set
        theme = excluded.theme,
        font_size = excluded.font_size,
        font_family = excluded.font_family,
        font_color = excluded.font_color,
        primary_color = excluded.primary_color,
        bg_color = excluded.bg_color,
        accent_color = excluded.accent_color,
        danger_color = excluded.danger_color,
        card_tint = excluded.card_tint,
        card_tint_strength = excluded.card_tint_strength,
        calendar = excluded.calendar,
        color_presets = excluded.color_presets,
        list_color = excluded.list_color
    `;
    return { ok: true as const };
  });

export const saveRoleCodes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { supervisor: string; accountant: string; seller: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireManageRoleCodes(sql, context.userId);
    const supervisor = data.supervisor.trim();
    const accountant = data.accountant.trim();
    const seller = data.seller.trim();
    if (!supervisor || !accountant || !seller) throw new Error("رمز هر سه نقش لازم است");
    assertPinShape(supervisor);
    assertPinShape(accountant);
    assertPinShape(seller);
    const hs = hashPin(supervisor);
    const ha = hashPin(accountant);
    const hsel = hashPin(seller);
    await sql.query("alter table app_settings add column if not exists role_codes_hashed boolean not null default false");
    await sql`
      insert into app_settings (user_id, role_code_supervisor, role_code_accountant, role_code_seller, role_codes_hashed)
      values (${context.userId}, ${hs}, ${ha}, ${hsel}, ${true})
      on conflict (user_id) do update set
        role_code_supervisor = excluded.role_code_supervisor,
        role_code_accountant = excluded.role_code_accountant,
        role_code_seller = excluded.role_code_seller,
        role_codes_hashed = true
    `;
    return { ok: true as const };
  });

export const addStaffUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { displayName: string; role: Role; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const name = data.displayName.trim();
    if (!name) throw new Error("نام لازم است");
    assertRoleNotLocked(context.userId);
    const codes = await getRoleCodes(sql, context.userId);
    if (!verifyPin(data.code.trim(), codes[data.role])) {
      recordRoleFail(context.userId);
      throw new Error("کد نقش نادرست است");
    }
    recordRoleSuccess(context.userId);
    try {
      const rows = await sql<{ id: number }>`
        insert into staff_users (user_id, display_name, role, is_owner)
        values (${context.userId}, ${name}, ${data.role}, ${false})
        returning id
      `;
      return { id: rows[0].id };
    } catch (e) {
      rethrow(e);
    }
  });

export const updateStaffUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; displayName: string; role: Role; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const name = data.displayName.trim();
    if (!name) throw new Error("نام لازم است");
    const codes = await getRoleCodes(sql, context.userId);
    assertRolePin(codes, data.role, data.code);
    const row = await sql<{ is_owner: boolean }>`
      select is_owner from staff_users where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!row[0]) throw new Error("کاربر یافت نشد");
    await sql`
      update staff_users set display_name = ${name}, role = ${data.role}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    if (row[0].is_owner) {
      await sql`
        update profiles set display_name = ${name}, role = ${data.role}
        where user_id = ${context.userId}
      `;
    }
    return { ok: true as const };
  });

export const deleteStaffUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const row = await sql<{ is_owner: boolean }>`
      select is_owner from staff_users where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!row[0]) throw new Error("کاربر یافت نشد");
    if (row[0].is_owner) throw new Error("کاربر اصلی حذف نمی‌شود");
    await sql`delete from staff_users where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const exportWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const dump = await dumpWorkspace(sql, context.userId);
    return { json: JSON.stringify(dump) };
  });

export const importWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { payload: string; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    await restoreWorkspace(sql, context.userId, data.payload);
    return { ok: true as const };
  });

export const saveOnlineBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { label?: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const dump = await dumpWorkspace(sql, context.userId);
    const label = (data.label || "").trim() || `پشتیبان ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const payload = JSON.stringify(dump);
    const rows = await sql<{ id: number }>`
      insert into data_backups (user_id, label, payload)
      values (${context.userId}, ${label}, ${payload})
      returning id
    `;
    return { id: rows[0].id };
  });

export const listOnlineBackups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const rows = await sql<Record<string, unknown>>`
      select id, label, created_at, char_length(payload) as bytes
      from data_backups where user_id = ${context.userId}
      order by created_at desc, id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      label: text(r.label),
      createdAt: text(r.created_at),
      bytes: num(r.bytes),
    }));
  });

export const restoreOnlineBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    const rows = await sql<{ payload: string }>`
      select payload from data_backups where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("پشتیبان یافت نشد");
    await restoreWorkspace(sql, context.userId, rows[0].payload);
    return { ok: true as const };
  });

export const deleteOnlineBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await sql`delete from data_backups where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveCloudBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { label?: string; kind?: "manual" | "auto" }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await sql.query(
      "create table if not exists cloud_backups (id serial primary key, user_id text not null, label text not null, kind text not null default 'manual', payload text not null, created_at timestamptz not null default now())",
    );
    const dump = await dumpWorkspace(sql, context.userId);
    const kind = data.kind === "auto" ? "auto" : "manual";
    const label = (data.label || "").trim() || `کلود ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const rows = await sql<{ id: number }>`
      insert into cloud_backups (user_id, label, kind, payload)
      values (${context.userId}, ${label}, ${kind}, ${JSON.stringify(dump)})
      returning id
    `;
    return { id: rows[0].id };
  });

export const listCloudBackups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    await sql.query(
      "create table if not exists cloud_backups (id serial primary key, user_id text not null, label text not null, kind text not null default 'manual', payload text not null, created_at timestamptz not null default now())",
    );
    const rows = await sql<Record<string, unknown>>`
      select id, label, kind, created_at from cloud_backups
      where user_id = ${context.userId}
      order by created_at desc, id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      label: text(r.label),
      kind: text(r.kind) === "auto" ? ("auto" as const) : ("manual" as const),
      createdAt: text(r.created_at),
    }));
  });

export const restoreCloudBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    const rows = await sql<{ payload: string }>`
      select payload from cloud_backups where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("پشتیبان یافت نشد");
    await restoreWorkspace(sql, context.userId, rows[0].payload);
    return { ok: true as const };
  });

export const deleteCloudBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    await sql`delete from cloud_backups where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

const RESET_KEEP = new Set(["companies", "app_settings", "staff_users"]);

export const resetWorkspaceData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    await muteActivityLog(sql, context.userId);
    try {
      for (const name of [...WORKSPACE_TABLES].reverse()) {
        if (RESET_KEEP.has(name)) continue;
        await sql.query(`delete from ${name} where user_id = $1`, [context.userId]);
      }
      await seedDefaults(sql, context.userId);
    } finally {
      await unmuteActivityLog(sql, context.userId);
    }
    return { ok: true as const };
  });
