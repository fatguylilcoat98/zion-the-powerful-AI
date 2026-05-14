/*
  Zion — auto-seed Supabase Auth users from environment.

  Reads two env-configured (email, password) pairs and ensures each
  user exists in Supabase Auth on server boot:
    - ZION_OWNER_EMAIL / ZION_OWNER_PASSWORD  (Tiff)
    - ZION_ADMIN_EMAIL / ZION_ADMIN_PASSWORD  (Chris)

  Behavior per user:
    - if missing email or password   → skip silently
    - if user already exists         → update password to match env
                                       (env is the source of truth)
    - if user does not exist         → create with email_confirm: true
                                       so no verification email is needed

  Requires SUPABASE_SERVICE_KEY (admin scope). Failures are logged but
  never crash the server — the dashboard remains a manual fallback.
*/

const { createClient } = require('@supabase/supabase-js');

let adminClient = null;
function getAdmin() {
  if (adminClient) return adminClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return null;
  }
  adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return adminClient;
}

async function findUserByEmail(supabase, email) {
  const target = email.toLowerCase();
  // listUsers is paginated; walk pages until we find them or run out.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) return null; // last page
  }
  return null;
}

async function ensureUser({ email, password, role }) {
  if (!email || !password) {
    return { role, email: email || null, skipped: true, reason: 'missing email or password' };
  }
  const supabase = getAdmin();
  if (!supabase) {
    return { role, email, skipped: true, reason: 'supabase admin client not configured' };
  }
  try {
    const existing = await findUserByEmail(supabase, email);
    if (existing) {
      // Keep env-as-source-of-truth: re-apply password on every boot so a
      // rotation in Render takes effect on the next deploy.
      const { error: updErr } = await supabase.auth.admin.updateUserById(existing.id, { password });
      if (updErr) {
        console.warn(`[seed-users] could not update password for ${email}:`, updErr.message);
      }
      return { role, email, id: existing.id, existed: true };
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error) throw error;
    return { role, email, id: data?.user?.id, created: true };
  } catch (err) {
    console.error(`[seed-users] failed for ${email} (${role}):`, err.message);
    return { role, email, error: err.message };
  }
}

async function seedConfiguredUsers() {
  const targets = [
    { role: 'owner', email: process.env.ZION_OWNER_EMAIL, password: process.env.ZION_OWNER_PASSWORD },
    { role: 'admin', email: process.env.ZION_ADMIN_EMAIL, password: process.env.ZION_ADMIN_PASSWORD }
  ];
  const results = [];
  for (const t of targets) {
    results.push(await ensureUser(t));
  }
  return results;
}

function summarizeResults(results) {
  return results.map(r => {
    if (r.skipped) return `  ${r.role.padEnd(5)}  skipped (${r.reason})`;
    if (r.error)   return `  ${r.role.padEnd(5)}  ERROR (${r.email}): ${r.error}`;
    if (r.created) return `  ${r.role.padEnd(5)}  created  ${r.email}`;
    if (r.existed) return `  ${r.role.padEnd(5)}  updated  ${r.email} (password resynced from env)`;
    return `  ${r.role.padEnd(5)}  ${JSON.stringify(r)}`;
  }).join('\n');
}

module.exports = { seedConfiguredUsers, ensureUser, summarizeResults };
