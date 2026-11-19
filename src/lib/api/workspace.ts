import { assertPinShape, hashPin } from "@/lib/auth/pin-hash";
import { peekSessionRole } from "@/lib/session-role-slot";
import { forgetCachedRolePinVersion, getRolePinVersion } from "./role-pin";
import { createServerFn } from "@tanstack/react-start";
import { withTransaction, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text } from "@/lib/format";
import { type AppSettings, type ColorPreset, type Role } from "@/lib/types";
import { dumpWorkspace, dumpWorkspaceConsistent, muteActivityLog, requireManageRoleCodes, requireProfile, requireWrite, restoreWorkspace, rethrow, seedDefaults, sqlOf, unmuteActivityLog, WORKSPACE_TABLES, assertAccountantPin, assertRolePin } from "./helpers";
import { validInput } from "./validate";

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
    }) => validInput(d),
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const fontSize = Math.min(22, Math.max(12, Math.round(data.fontSize) || 16));
    const fontFamily = (data.fontFamily || "Vazirmatn").trim() || "Vazirmatn";
    const strength = Math.min(100, Math.max(0, Math.round(data.cardTintStrength) || 40));
    const presetsJson = JSON.stringify(Array.isArray(data.colorPresets) ? data.colorPresets.slice(0, 40) : []);
    const listColor = (data.listColor || "#3a2433").trim();
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
  .validator((d: { supervisor?: string; accountant: string; seller: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireManageRoleCodes(sql, context.userId);
    // ناظر کد ندارد: کد قبلی ناظر (اگر هست) دست نمی‌خورد؛ فقط حسابدار و فروشنده.
    const supervisor = (data.supervisor ?? "").trim();
    const accountant = data.accountant.trim();
    const seller = data.seller.trim();
    if (!accountant || !seller) throw new Error("کد حسابدار و فروشنده لازم است");
    if (supervisor) assertPinShape(supervisor);
    assertPinShape(accountant);
    assertPinShape(seller);
    const hs = supervisor ? hashPin(supervisor) : null;
    const ha = hashPin(accountant);
    const hsel = hashPin(seller);
    await sql`
      insert into app_settings (user_id, role_code_supervisor, role_code_accountant, role_code_seller, role_codes_hashed)
      values (${context.userId}, ${hs}, ${ha}, ${hsel}, ${true})
      on conflict (user_id) do update set
        role_code_supervisor = coalesce(excluded.role_code_supervisor, app_settings.role_code_supervisor),
        role_code_accountant = excluded.role_code_accountant,
        role_code_seller = excluded.role_code_seller,
        role_codes_hashed = true,
        role_pin_version = app_settings.role_pin_version + 1
    `;
    // SEC-04: all role sessions issued with the old PINs stop working. The
    // person who made the change keeps their role with a fresh token.
    await forgetCachedRolePinVersion(context.userId);
    const slot = peekSessionRole();
    if (!slot) return { ok: true as const, roleToken: null };
    const { signRoleToken, setRoleCookie } = await import("@/lib/auth/session-role.server");
    const roleToken = signRoleToken(context.userId, slot.role, slot.displayName, await getRolePinVersion(sql, context.userId));
    await setRoleCookie(roleToken);
    return { ok: true as const, roleToken };
  });

export const addStaffUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { displayName: string; role: Role; code: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const name = data.displayName.trim();
    if (!name) throw new Error("نام لازم است");
    await assertRolePin(sql, context.userId, data.role, data.code);
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
  .validator((d: { id: number; displayName: string; role: Role; code: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const name = data.displayName.trim();
    if (!name) throw new Error("نام لازم است");
    await assertRolePin(sql, context.userId, data.role, data.code);
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
  .validator((d: { id: number }) => validInput(d))
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
    const dump = await dumpWorkspaceConsistent(context.userId);
    return { json: JSON.stringify(dump) };
  });

export const importWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { payload: string; code: string; confirm?: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await assertAccountantPin(sql, context.userId, data.code);
    await restoreWorkspace(sql, context.userId, data.payload, { confirm: data.confirm });
    return { ok: true as const };
  });

export const saveOnlineBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { label?: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const dump = await dumpWorkspaceConsistent(context.userId);
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
  .validator((d: { id: number; code: string; confirm?: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await assertAccountantPin(sql, context.userId, data.code);
    const rows = await sql<{ payload: string }>`
      select payload from data_backups where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("پشتیبان یافت نشد");
    await restoreWorkspace(sql, context.userId, rows[0].payload, { confirm: data.confirm });
    return { ok: true as const };
  });

export const deleteOnlineBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await sql`delete from data_backups where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

const RESET_KEEP = new Set(["companies", "app_settings", "staff_users"]);

export const RESET_SNAPSHOT_PREFIX = "خودکار پیش از ریست";

/**
 * STR-03: empties the workspace and re-seeds defaults; call inside a transaction.
 * First saves a full copy to the online backups (data_backups, kept by the
 * reset) so the reset can be undone from Settings → Restore.
 */
export async function resetWorkspaceTx(tx: Sql, userId: string): Promise<{ snapshotId: number }> {
  const before = await dumpWorkspace(tx, userId);
  const label = `${RESET_SNAPSHOT_PREFIX} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const snap = await tx<{ id: number }>`
    insert into data_backups (user_id, label, payload)
    values (${userId}, ${label}, ${JSON.stringify(before)})
    returning id
  `;
  await muteActivityLog(tx, userId);
  for (const name of [...WORKSPACE_TABLES].reverse()) {
    if (RESET_KEEP.has(name)) continue;
    await tx.query(`delete from ${name} where user_id = $1`, [userId]);
  }
  await seedDefaults(tx, userId);
  await unmuteActivityLog(tx, userId);
  return { snapshotId: snap[0].id };
}

export const resetWorkspaceData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    await assertAccountantPin(sql, context.userId, data.code);
    // STR-03: all-or-nothing — a failure half way must not leave a partly
    // emptied workspace (or a muted activity log).
    const { snapshotId } = await withTransaction((tx) => resetWorkspaceTx(tx, context.userId));
    return { ok: true as const, snapshotId };
  });
