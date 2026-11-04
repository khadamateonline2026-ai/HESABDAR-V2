import { createServerFn } from "@tanstack/react-start";
import { createHash, randomInt } from "node:crypto";
import { authMiddleware } from "@/lib/auth/middleware";
import { withTransaction } from "@/lib/db";
import { DEFAULT_SETTINGS, type Role } from "@/lib/types";
import { assertPinShape, hashPin, verifyPin } from "@/lib/auth/pin-hash";
import {
  assertRoleNotLocked,
  recordRoleFail,
  recordRoleSuccess,
} from "@/lib/auth/role-rate-limit";
import { assertSafeImageDataUrl } from "@/lib/auth/image-dataurl";
import {
  emptyCatalogs,
  getProfileRow,
  loadCatalogs,
  loadSettings,
  loadStaff,
  mapCompany,
  requireWrite,
  rethrow,
  seedDefaults,
  sessionRoleState,
  sqlOf,
} from "./helpers";
import { peekSessionRole } from "@/lib/session-role-slot";

async function loadRoleCodeHashes(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
): Promise<Record<Role, string>> {
  const rows = await sql<{
    role_code_supervisor: string | null;
    role_code_accountant: string | null;
    role_code_seller: string | null;
  }>`
    select role_code_supervisor, role_code_accountant, role_code_seller
    from app_settings where user_id = ${userId}
  `;
  const row = rows[0];
  return {
    supervisor: (row?.role_code_supervisor ?? "").trim(),
    accountant: (row?.role_code_accountant ?? "").trim(),
    seller: (row?.role_code_seller ?? "").trim(),
  };
}

export const getBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const owner = await getProfileRow(sql, context.userId);
    if (!owner) {
      return {
        profile: null,
        company: null,
        catalogs: emptyCatalogs(),
        settings: DEFAULT_SETTINGS,
        staff: [],
        needsSessionRole: false,
      };
    }
    const { profile, needsSessionRole } = sessionRoleState(owner);
    const companies = await sql`select * from companies where user_id = ${context.userId}`;
    const [catalogs, settings, staff] = await Promise.all([
      loadCatalogs(sql, context.userId),
      loadSettings(sql, context.userId),
      loadStaff(sql, context.userId, owner),
    ]);
    // Never send role PIN hashes (or legacy codes) to the client.
    const safeSettings = {
      ...settings,
      roleCodes: { supervisor: "", accountant: "", seller: "" },
    };
    return {
      profile,
      company: companies[0] ? mapCompany(companies[0] as Record<string, unknown>) : null,
      catalogs,
      settings: safeSettings,
      staff,
      needsSessionRole,
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      companyName: string;
      companyEmail: string;
      supervisor: string;
      accountant: string;
      seller: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const companyName = data.companyName.trim();
    const companyEmail = data.companyEmail.trim();
    const supervisor = data.supervisor.trim();
    const accountant = data.accountant.trim();
    const seller = data.seller.trim();
    if (!companyName) throw new Error("نام شرکت لازم است");
    if (!companyEmail.includes("@")) throw new Error("ایمیل شرکت لازم است");
    assertPinShape(supervisor);
    assertPinShape(accountant);
    assertPinShape(seller);
    const sql = await sqlOf();
    const existing = await getProfileRow(sql, context.userId);
    if (existing) throw new Error("حساب قبلاً تنظیم شده است");
    const hashedSupervisor = hashPin(supervisor);
    const hashedAccountant = hashPin(accountant);
    const hashedSeller = hashPin(seller);
    try {
      await withTransaction(async (tx) => {
        await tx`
          insert into profiles (user_id, display_name, role)
          values (${context.userId}, ${companyName}, ${"accountant"})
        `;
        await seedDefaults(tx, context.userId);
        await tx`
          insert into companies (user_id, name, email, updated_at)
          values (${context.userId}, ${companyName}, ${companyEmail}, now())
          on conflict (user_id) do update set
            name = excluded.name,
            email = excluded.email,
            updated_at = now()
        `;
        await tx`
          insert into app_settings (user_id, role_code_supervisor, role_code_accountant, role_code_seller, role_codes_hashed)
          values (${context.userId}, ${hashedSupervisor}, ${hashedAccountant}, ${hashedSeller}, ${true})
          on conflict (user_id) do update set
            role_code_supervisor = excluded.role_code_supervisor,
            role_code_accountant = excluded.role_code_accountant,
            role_code_seller = excluded.role_code_seller,
            role_codes_hashed = true
        `;
        await tx`
          insert into staff_users (user_id, display_name, role, is_owner)
          values (${context.userId}, ${companyName}, ${"accountant"}, ${true})
        `;
      });
    } catch (e) {
      rethrow(e);
    }
    const { signRoleToken, setRoleCookie } = await import("@/lib/auth/session-role.server");
    const roleToken = signRoleToken(context.userId, "accountant", companyName);
    await setRoleCookie(roleToken);
    return { ok: true as const, roleToken };
  });

export const saveCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      name: string;
      logo: string | null;
      licenseNo: string;
      tin: string;
      address: string;
      phone1: string;
      phone2: string;
      phone3: string;
      email: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "company");
    const name = data.name.trim() || "شرکت من";
    const logo = assertSafeImageDataUrl(data.logo);
    await sql`
      insert into companies (user_id, name, logo, license_no, tin, address, phone1, phone2, phone3, email, updated_at)
      values (
        ${context.userId}, ${name}, ${logo}, ${data.licenseNo}, ${data.tin},
        ${data.address}, ${data.phone1}, ${data.phone2}, ${data.phone3}, ${data.email}, now()
      )
      on conflict (user_id) do update set
        name = excluded.name,
        logo = excluded.logo,
        license_no = excluded.license_no,
        tin = excluded.tin,
        address = excluded.address,
        phone1 = excluded.phone1,
        phone2 = excluded.phone2,
        phone3 = excluded.phone3,
        email = excluded.email,
        updated_at = now()
    `;
    return { ok: true as const };
  });

export const updateProfileName = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { displayName: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWrite(sql, context.userId, "settings");
    const name = data.displayName.trim();
    if (!name) throw new Error("نام لازم است");
    await sql`update profiles set display_name = ${name} where user_id = ${context.userId}`;
    await sql`
      update staff_users set display_name = ${name}
      where user_id = ${context.userId} and is_owner = true
    `;
    return { ok: true as const };
  });

export const changeRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { role: Role; code: string; displayName?: string }) => d)
  .handler(async ({ context, data }) => {
    assertRoleNotLocked(context.userId);
    const sql = await sqlOf();
    const owner = await getProfileRow(sql, context.userId);
    if (!owner) throw new Error("نخست نام و نقش خود را ثبت کنید");
    if (data.role !== "supervisor" && data.role !== "accountant" && data.role !== "seller") {
      throw new Error("نقش نادرست است");
    }
    const codes = await loadRoleCodeHashes(sql, context.userId);
    const expected = codes[data.role];
    const ok = verifyPin(data.code.trim(), expected);
    if (!ok) {
      recordRoleFail(context.userId); // may throw lockout error
      throw new Error("کد نقش نادرست است");
    }
    recordRoleSuccess(context.userId);
    const typedName = (data.displayName ?? "").trim();
    if (typedName) {
      const existing = await sql<{ id: number }>`
        select id from staff_users
        where user_id = ${context.userId} and display_name = ${typedName}
        limit 1
      `;
      if (!existing[0]) {
        await sql`
          insert into staff_users (user_id, display_name, role, is_owner)
          values (${context.userId}, ${typedName}, ${data.role}, ${false})
        `;
      }
    }
    const slot = peekSessionRole();
    const name = typedName || slot?.displayName || owner.displayName;
    const { signRoleToken, setRoleCookie } = await import("@/lib/auth/session-role.server");
    const roleToken = signRoleToken(context.userId, data.role, name);
    await setRoleCookie(roleToken);
    return { ok: true as const, roleToken };
  });

function resetHash(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

async function ensureResetColumns(sql: Awaited<ReturnType<typeof sqlOf>>) {
  await sql.query("alter table app_settings add column if not exists role_reset_hash text");
  await sql.query("alter table app_settings add column if not exists role_reset_exp timestamptz");
  await sql.query("alter table app_settings add column if not exists role_codes_hashed boolean not null default false");
}

async function sendRoleCode(to: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ROLE_MAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new Error("ارسال ایمیل روی این سرور فعال نیست");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "کد بازنشانی رمز نقش",
      text: `کد بازنشانی رمز نقش‌ها: ${code}\nاین کد فقط رمز نقش‌ها را عوض می‌کند، نه رمز ورود.\nتا ۱۵ دقیقه معتبر است.`,
    }),
  });
  if (!res.ok) throw new Error("ارسال ایمیل ناکام شد");
}

export const requestRoleReset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertRoleNotLocked(context.userId);
    const sql = await sqlOf();
    const owner = await getProfileRow(sql, context.userId);
    if (!owner) throw new Error("نخست شرکت را تنظیم کنید");
    const companies = await sql<{ email: string | null }>`
      select email from companies where user_id = ${context.userId}
    `;
    const email = (companies[0]?.email ?? "").trim();
    if (!email.includes("@")) throw new Error("ایمیل شرکت ثبت نشده است");
    await ensureResetColumns(sql);
    const code = String(randomInt(100000, 1000000));
    const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await sql`
      insert into app_settings (user_id, role_reset_hash, role_reset_exp)
      values (${context.userId}, ${resetHash(context.userId, code)}, ${exp})
      on conflict (user_id) do update set
        role_reset_hash = excluded.role_reset_hash,
        role_reset_exp = excluded.role_reset_exp
    `;
    try {
      await sendRoleCode(email, code);
    } catch (e) {
      await sql`
        update app_settings set role_reset_hash = null, role_reset_exp = null
        where user_id = ${context.userId}
      `;
      throw e instanceof Error ? e : new Error("ارسال ایمیل ناکام شد");
    }
    return { ok: true as const, email };
  });

export const applyRoleReset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { emailCode: string; supervisor: string; accountant: string; seller: string }) => d)
  .handler(async ({ context, data }) => {
    assertRoleNotLocked(context.userId);
    const supervisor = data.supervisor.trim();
    const accountant = data.accountant.trim();
    const seller = data.seller.trim();
    const emailCode = data.emailCode.trim();
    if (!emailCode) throw new Error("کد ایمیل لازم است");
    assertPinShape(supervisor);
    assertPinShape(accountant);
    assertPinShape(seller);
    const sql = await sqlOf();
    await ensureResetColumns(sql);
    const rows = await sql<{ role_reset_hash: string | null; role_reset_exp: string | null }>`
      select role_reset_hash, role_reset_exp from app_settings where user_id = ${context.userId}
    `;
    const row = rows[0];
    const exp = row?.role_reset_exp ? new Date(row.role_reset_exp).getTime() : 0;
    if (!row?.role_reset_hash || exp < Date.now() || row.role_reset_hash !== resetHash(context.userId, emailCode)) {
      recordRoleFail(context.userId);
      throw new Error("کد ایمیل نادرست یا منقضی است");
    }
    const hashedSupervisor = hashPin(supervisor);
    const hashedAccountant = hashPin(accountant);
    const hashedSeller = hashPin(seller);
    await sql`
      update app_settings set
        role_code_supervisor = ${hashedSupervisor},
        role_code_accountant = ${hashedAccountant},
        role_code_seller = ${hashedSeller},
        role_codes_hashed = true,
        role_reset_hash = null,
        role_reset_exp = null,
        role_fail_count = 0,
        role_lock_until = null
      where user_id = ${context.userId}
    `;
    recordRoleSuccess(context.userId);
    return { ok: true as const };
  });
