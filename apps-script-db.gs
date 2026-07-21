// ── I CAN School · Safeguarding Platform — Apps Script backend ──────────────
// This is the ONLY backend for this app. There is no Node/Express server —
// the frontend (index.html) talks exclusively to this Web App over doPost.
//
// One-time setup (see README.md "Deployment" for full steps):
//   1. Deploy as a Web App (execute as: Me, access: Anyone).
//   2. Set the ADMIN_CODE script property (Project Settings > Script Properties)
//      OR just log in once with any code on a fresh sheet — see loginByCode().
//   3. Restrict the underlying Google Sheet's sharing to yourself only; the
//      Web App deployment is the only thing that needs to read/write it.

const SHEET_USERS = 'users';
const SHEET_CASES = 'cases';
const SHEET_SEND_REPORTS = 'send_reports';
const SHEET_SEND_CASES = 'send_cases';
const SHEET_STUDENTS = 'students';
const SHEET_FAMILIES = 'families';

// Roles that may edit the whole-school SEND report figures / whole-school
// dashboard. Kept in sync with index.html's IS_DSL_OR_PRINCIPAL.
const REPORT_ROLES = ['Lead DSL', 'Deputy DSL', 'Principal'];
// Roles that may log/edit individual SEND register entries. Broader than
// REPORT_ROLES — SENDCO can add students to the register without seeing the
// full whole-school report.
const SEND_CASE_ROLES = ['Lead DSL', 'Deputy DSL', 'Principal', 'SENDCO'];
// Roles with User Management / admin rights. 'Senior Leadership' is a legacy
// role kept for backward compatibility with older rows — it's no longer an
// option in the "create user" form (see index.html role <select>), but an
// existing user saved under it must keep working.
const ADMIN_ROLES = ['Lead DSL', 'Principal', 'Senior Leadership'];
// Roles assignable from the "create/edit user" form today.
const VALID_ROLES = ['Teacher', 'SENDCO', 'Pastoral Lead', 'Deputy DSL', 'Head of Primary', 'Head of Secondary', 'Lead DSL', 'Principal'];

const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 24;
const NAME_MAX_LENGTH = 100;
const NOTES_MAX_LENGTH = 5000;
// Each iteration is a real Utilities.computeHmacSha256Signature call, and
// that bridge crossing (not the crypto itself) dominates cost in Apps
// Script — 12,000 of them made every single login noticeably slow. Lowered
// for interactive login latency; the iteration count travels inside each
// stored hash (see hashCodeStrong's "pbkdf2$<iter>$..." format), so this
// only affects newly-created hashes — existing ones keep verifying with
// whatever count they were created under.
const PBKDF2_ITERATIONS = 2000;
const SESSION_TTL_SECONDS = 1200; // 20 min sliding idle timeout
const SESSION_MAX_AGE_MS = 8 * 3600000; // 8h absolute cap, matches prior client-side session length
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 900; // 15 min

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowIso(){ return new Date().toISOString(); }
function norm(s){ return String(s || '').trim(); }
function normUpper(s){ return norm(s).toUpperCase(); }
function normLower(s){ return norm(s).toLowerCase(); }

// ── Validation (ported from the retired Node server's validators) ──────────
function validateString(value, min, max){
  min = min || 1; max = max || NAME_MAX_LENGTH;
  if(typeof value !== 'string') return { valid:false, error:'Must be a string' };
  const trimmed = value.trim();
  if(trimmed.length < min || trimmed.length > max) return { valid:false, error:'Must be ' + min + '-' + max + ' characters' };
  return { valid:true, value:trimmed };
}
function validateCode(value){
  if(typeof value !== 'string') return { valid:false, error:'Access code must be a string' };
  const trimmed = value.trim();
  if(trimmed.length < CODE_MIN_LENGTH || trimmed.length > CODE_MAX_LENGTH) return { valid:false, error:'Access code must be ' + CODE_MIN_LENGTH + '-' + CODE_MAX_LENGTH + ' characters' };
  if(/\s/.test(trimmed)) return { valid:false, error:'Access code cannot contain spaces' };
  if(!/^[\x21-\x7E]+$/.test(trimmed)) return { valid:false, error:'Access code contains invalid characters' };
  return { valid:true, value:trimmed };
}
function validateRole(value){
  if(VALID_ROLES.indexOf(value) < 0) return { valid:false, error:'Role must be one of: ' + VALID_ROLES.join(', ') };
  return { valid:true, value:value };
}

// ── Hashing / crypto helpers ────────────────────────────────────────────────
function bytesToHex(bytes){
  return bytes.map(function(b){ const v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}
function sha256Hex(s){
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)));
}
function timingSafeEqual(a, b){
  if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for(let i=0;i<a.length;i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}
function secureByteHex(numBytes){
  let hex = '';
  while(hex.length < numBytes*2) hex += Utilities.getUuid().replace(/-/g,'');
  return hex.slice(0, numBytes*2);
}
function secureBytes(numBytes){
  const hex = secureByteHex(numBytes);
  const bytes = [];
  for(let i=0;i<hex.length;i+=2) bytes.push(parseInt(hex.substr(i,2),16));
  return bytes;
}
function secureToken(){
  return secureByteHex(32); // 256 bits, hex-encoded
}

// Legacy (pre-security-overhaul) hashing kept only so existing users can be
// verified once and transparently migrated — see verifyUserCode().
function hashCode(code){ return sha256Hex(norm(code)); }
function hashCodeLegacy(code){ return sha256Hex(normUpper(code)); }

// PBKDF2 (RFC 8018-flavoured) built from HMAC-SHA256, since Apps Script's V8
// runtime has no native PBKDF2/bcrypt/WebCrypto. Iterated stretching makes
// brute-forcing a stolen hash meaningfully slower than the old single-round
// SHA-256.
//
// Deliberately works entirely in hex-string space rather than passing a
// hand-built byte array to Utilities.computeHmacSha256Signature: Apps
// Script's JS<->Java bridge only reliably recognizes a Byte[] parameter when
// the array is one it returned itself (e.g. from computeDigest/
// base64Decode), not one built with push()/concat() — regardless of whether
// the values are in a signed or unsigned range. Every call below uses only
// the plain (String, String) overload, the least ambiguous one available,
// so there's no array-vs-Byte[] type-matching to get wrong. This is an
// internal, self-consistent scheme (hash and verify always go through the
// same functions) — it doesn't need to match an external PBKDF2 test vector.
function hmacHex(hexMessage, keyString){
  return bytesToHex(Utilities.computeHmacSha256Signature(hexMessage, keyString));
}
function xorHex(aHex, bHex){
  let out = '';
  for(let i=0;i<aHex.length;i+=2){
    const v = (parseInt(aHex.substr(i,2),16) ^ parseInt(bHex.substr(i,2),16)) & 0xFF;
    out += (v<16?'0':'') + v.toString(16);
  }
  return out;
}
function pbkdf2Hex(password, saltHex, iterations){
  let U = hmacHex(saltHex + '00000001', password);
  let T = U;
  for(let c=1;c<iterations;c++){
    U = hmacHex(U, password);
    T = xorHex(T, U);
  }
  return T;
}
function hashCodeStrong(code, saltHex, iterations){
  const iter = iterations || PBKDF2_ITERATIONS;
  const salt = saltHex || secureByteHex(16);
  const hashHex = pbkdf2Hex(norm(code), salt, iter);
  return 'pbkdf2$' + iter + '$' + salt + '$' + hashHex;
}
function verifyStrongHash(code, stored){
  const parts = String(stored).split('$');
  if(parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  const saltHex = parts[2];
  const actualHex = pbkdf2Hex(norm(code), saltHex, iter);
  return timingSafeEqual(actualHex, parts[3]);
}
// Verifies against whichever scheme the stored hash is in; the caller is
// responsible for re-hashing+saving on a successful legacy match (see
// loginByCode) so every account silently upgrades to PBKDF2 on next login.
function verifyUserCode(code, storedHash){
  if(!storedHash) return false;
  if(String(storedHash).indexOf('pbkdf2$') === 0) return verifyStrongHash(code, storedHash);
  return storedHash === hashCode(code) || storedHash === hashCodeLegacy(code);
}
function isLegacyHash(storedHash){
  return !!storedHash && String(storedHash).indexOf('pbkdf2$') !== 0;
}

function genCode(len){
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*_-+=';
  const all = upper + lower + digits + symbols;
  const size = Math.max(12, len || 14);
  const pool = secureBytes(size + 24); // extra bytes for the shuffle pass
  let pi = 0;
  const nextByte = function(){ const b = pool[pi++]; return b<0?b+256:b; };
  const pick = function(chars){ return chars.charAt(nextByte() % chars.length); };
  const out = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while(out.length < size) out.push(pick(all));
  for(let i=out.length-1;i>0;i--){
    const j = nextByte() % (i+1);
    const t = out[i]; out[i]=out[j]; out[j]=t;
  }
  return out.join('');
}

// ── Generic global rate limit (used by the unauthenticated public report
// path below — no per-caller identity is available to key on, so this caps
// total volume rather than per-caller attempts) ─────────────────────────────
function checkGlobalRateLimit(key, maxCount, windowSeconds){
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || '0');
  if(count >= maxCount) return false;
  cache.put(key, String(count+1), windowSeconds);
  return true;
}

// ── Rate limiting (per submitted code, so brute-forcing one code is capped
// without locking out other users) ──────────────────────────────────────────
function rateLimited(code, fn){
  const cache = CacheService.getScriptCache();
  const key = 'fail_' + sha256Hex(normUpper(norm(code)));
  const attempts = Number(cache.get(key) || '0');
  if(attempts >= LOGIN_MAX_ATTEMPTS){
    return { ok:false, error:'Too many attempts with this code. Please wait 15 minutes and try again.' };
  }
  const result = fn();
  if(result && result.ok){
    cache.remove(key);
  } else {
    cache.put(key, String(attempts+1), LOGIN_LOCKOUT_SECONDS);
  }
  return result;
}

// ── Sessions (CacheService — opaque token never logged or stored raw) ──────
function createSession(user){
  const token = secureToken();
  const cache = CacheService.getScriptCache();
  const key = 'sess_' + sha256Hex(token);
  cache.put(key, JSON.stringify({
    userId: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName,
    loginAt: Date.now()
  }), SESSION_TTL_SECONDS);
  return token;
}
function requireSession(token){
  const t = norm(token);
  if(!t) return { ok:false, error:'Session expired. Please sign in again.', code:'AUTH' };
  const cache = CacheService.getScriptCache();
  const key = 'sess_' + sha256Hex(t);
  const raw = cache.get(key);
  if(!raw) return { ok:false, error:'Session expired. Please sign in again.', code:'AUTH' };
  let sess;
  try { sess = JSON.parse(raw); } catch(e){ return { ok:false, error:'Session expired. Please sign in again.', code:'AUTH' }; }
  if(!sess.loginAt || (Date.now() - sess.loginAt) > SESSION_MAX_AGE_MS){
    cache.remove(key);
    return { ok:false, error:'Session expired. Please sign in again.', code:'AUTH' };
  }
  // Sliding expiry: any authenticated call extends the idle window.
  cache.put(key, raw, SESSION_TTL_SECONDS);
  return { ok:true, user:{ id:sess.userId, firstName:sess.firstName, lastName:sess.lastName, role:sess.role }, cacheKey:key };
}
function logoutAction(token){
  const t = norm(token);
  if(t) CacheService.getScriptCache().remove('sess_' + sha256Hex(t));
  return { ok:true };
}

// ── Concurrency: short-held lock around every sheet write ──────────────────
function withLock(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

// ── Data version + cache (avoids re-reading whole sheets on every request) ─
function getDataVersion(){
  return Number(PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0');
}
function bumpDataVersion(){
  const props = PropertiesService.getScriptProperties();
  const v = getDataVersion() + 1;
  props.setProperty('DATA_VERSION', String(v));
  return v;
}
function cacheGetJson(metaKey, chunkPrefix){
  try{
    const cache = CacheService.getScriptCache();
    const metaRaw = cache.get(metaKey);
    if(!metaRaw) return undefined;
    const meta = JSON.parse(metaRaw);
    if(meta.version !== getDataVersion()) return undefined;
    const parts = [];
    for(let i=0;i<meta.chunks;i++){
      const part = cache.get(chunkPrefix + i);
      if(part === null) return undefined;
      parts.push(part);
    }
    return JSON.parse(parts.join(''));
  }catch(e){ return undefined; }
}
function cachePutJson(metaKey, chunkPrefix, value){
  try{
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(value);
    const chunkSize = 90000;
    const chunks = [];
    for(let i=0;i<json.length;i+=chunkSize) chunks.push(json.slice(i, i+chunkSize));
    const puts = {};
    chunks.forEach(function(c,i){ puts[chunkPrefix+i] = c; });
    puts[metaKey] = JSON.stringify({ version:getDataVersion(), chunks:chunks.length });
    CacheService.getScriptCache().putAll(puts, 1500);
  }catch(e){ /* caching is best-effort only; ignore (e.g. payload too large) */ }
}

function getOrCreateSheet(name, headers){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);
  if(sh.getLastRow()===0 && headers && headers.length){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

// ── Users ────────────────────────────────────────────────────────────────
function userHeaders(){
  return ['id','firstName','lastName','role','email','codeHash','active','createdAt','updatedAt','lastLogin'];
}
function loadUsers(){
  const sh = getOrCreateSheet(SHEET_USERS, userHeaders());
  const vals = sh.getDataRange().getValues();
  const users = [];
  for(let i=1;i<vals.length;i++){
    const r = vals[i];
    if(String(r.join('')).trim()==='') continue;
    users.push({
      id: r[0], rowId: i+1, firstName: r[1], lastName: r[2], role: r[3] || 'Teacher', email: r[4] || '',
      codeHash: r[5] || '', active: String(r[6]).toLowerCase() !== 'false',
      createdAt: r[7] || '', updatedAt: r[8] || '', lastLogin: r[9] || ''
    });
  }
  return users;
}
function userRow(u){
  return [u.id,u.firstName,u.lastName,u.role,u.email,u.codeHash,Boolean(u.active),u.createdAt,u.updatedAt,u.lastLogin];
}
// Targeted single-row write, used on the login hot path (see loginByCode) so
// a routine lastLogin timestamp update doesn't clear+rewrite the whole
// sheet — that used to happen on every single sign-in, holding the lock for
// the full rewrite and queueing up concurrent logins behind it.
function updateUserRow(u){
  const sh = getOrCreateSheet(SHEET_USERS, userHeaders());
  sh.getRange(u.rowId, 1, 1, userHeaders().length).setValues([userRow(u)]);
  bumpDataVersion();
}
function saveUsers(users){
  const sh = getOrCreateSheet(SHEET_USERS, userHeaders());
  const headers = userHeaders();
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(users && users.length){
    const rows = users.map(userRow);
    sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  }
  bumpDataVersion();
}
function publicUser(u){
  return { id:u.id, firstName:u.firstName, lastName:u.lastName, role:u.role, email:u.email,
    active:Boolean(u.active), createdAt:u.createdAt, updatedAt:u.updatedAt, lastLogin:u.lastLogin };
}

function bootstrapAdminCode(){
  const scriptProp = normUpper(PropertiesService.getScriptProperties().getProperty('ADMIN_CODE'));
  return scriptProp || null;
}
function isAdminCode(code){
  const admin = bootstrapAdminCode();
  return !!admin && normUpper(code) === admin;
}
// The bootstrap admin has no row in the users sheet, so its display name is
// stored separately in Script Properties — this is what lets a rename via
// Settings survive a fresh login instead of reverting to "System Admin".
function adminIdentity(){
  const props = PropertiesService.getScriptProperties();
  return { id:'__admin__', firstName: props.getProperty('ADMIN_FIRST_NAME') || 'System',
    lastName: props.getProperty('ADMIN_LAST_NAME') || 'Admin', role:'Lead DSL' };
}
function isAdminRole(role){ return ADMIN_ROLES.indexOf(role) >= 0; }
function isReportRole(role){ return REPORT_ROLES.indexOf(role) >= 0; }
function isSendCaseRole(role){ return SEND_CASE_ROLES.indexOf(role) >= 0; }
// Phase heads need read access to the user list so they can assign cases to
// SENDCO/Pastoral Lead/etc. school-wide (see index.html's loadAppUsers /
// IS_USER_MANAGER) — but not full User Management (create/edit/delete
// accounts, regenerate codes), which stays admin-only via isAdminRole.
function canListUsersRole(role){ return isAdminRole(role) || role==='Head of Primary' || role==='Head of Secondary'; }

function findUserByName(name){
  const n = norm(name).toLowerCase();
  return loadUsers().find(function(u){ return (normLower(u.firstName)+' '+normLower(u.lastName)).trim()===n; });
}

// ── Auth: login / logout / session-bound self-service ──────────────────────
// On a completely fresh deployment (no ADMIN_CODE property, no active
// admin-role users yet), the first code anyone logs in with becomes the
// admin code — this is the one-time self-provisioning step for a new sheet.
// Once any admin-role user or ADMIN_CODE exists, this path never triggers.
function loginByCode(code){
  const c = norm(code);
  const validation = validateCode(c);
  if(!validation.valid) return { ok:false, error:validation.error };

  if(isAdminCode(c)){
    const admin = adminIdentity();
    return { ok:true, user:admin, token:createSession(admin) };
  }

  const users = loadUsers();
  const idx = users.findIndex(function(u){ return verifyUserCode(c, u.codeHash); });

  if(idx < 0){
    const activeAdmins = users.filter(function(u){ return u.active && isAdminRole(u.role); });
    if(!bootstrapAdminCode() && activeAdmins.length===0){
      try { PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', normUpper(c)); } catch(e) {}
      const admin = adminIdentity();
      return { ok:true, user:admin, token:createSession(admin) };
    }
    return { ok:false, error:'Access code not recognized' };
  }
  if(!users[idx].active) return { ok:false, error:'This access code has been deactivated.' };

  if(isLegacyHash(users[idx].codeHash)){
    users[idx].codeHash = hashCodeStrong(c); // transparent upgrade, zero lockouts
  }
  users[idx].lastLogin = nowIso();
  users[idx].updatedAt = nowIso();
  withLock(function(){ updateUserRow(users[idx]); });

  const pub = publicUser(users[idx]);
  return { ok:true, user:pub, token:createSession({ id:users[idx].id, role:users[idx].role, firstName:users[idx].firstName, lastName:users[idx].lastName }) };
}

function changeOwnCode(sessionUser, currentCode, newCode){
  const cur = norm(currentCode), nxt = norm(newCode);
  if(!cur || !nxt) return { ok:false, error:'Current and new password are required' };
  if(cur===nxt) return { ok:false, error:'New password must be different' };
  if(!isStrongPassword(nxt)) return { ok:false, error:'New password does not meet security requirements' };

  if(sessionUser.id === '__admin__'){
    if(!isAdminCode(cur)) return { ok:false, error:'Current password is incorrect' };
    try { PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', normUpper(nxt)); return { ok:true }; }
    catch(e){ return { ok:false, error:'Could not update admin password' }; }
  }

  return withLock(function(){
    const users = loadUsers();
    const idx = users.findIndex(function(u){ return u.id===sessionUser.id; });
    if(idx<0) return { ok:false, error:'Account not found' };
    if(!users[idx].active) return { ok:false, error:'This account is deactivated' };
    if(!verifyUserCode(cur, users[idx].codeHash)) return { ok:false, error:'Current password is incorrect' };
    users[idx].codeHash = hashCodeStrong(nxt);
    users[idx].updatedAt = nowIso();
    saveUsers(users);
    return { ok:true };
  });
}
function isStrongPassword(code){
  const s = norm(code);
  return s.length>=12 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s) && !/\s/.test(s);
}

function updateOwnProfile(sessionUser, firstName, lastName){
  const fnV = validateString(firstName, 1, NAME_MAX_LENGTH);
  const lnV = validateString(lastName, 1, NAME_MAX_LENGTH);
  if(!fnV.valid) return { ok:false, error:'First name: ' + fnV.error };
  if(!lnV.valid) return { ok:false, error:'Last name: ' + lnV.error };

  if(sessionUser.id === '__admin__'){
    try {
      PropertiesService.getScriptProperties().setProperty('ADMIN_FIRST_NAME', fnV.value);
      PropertiesService.getScriptProperties().setProperty('ADMIN_LAST_NAME', lnV.value);
      return { ok:true, user:adminIdentity() };
    } catch(e){ return { ok:false, error:'Could not update admin profile' }; }
  }

  return withLock(function(){
    const users = loadUsers();
    const idx = users.findIndex(function(u){ return u.id===sessionUser.id; });
    if(idx<0) return { ok:false, error:'Account not found' };
    if(!users[idx].active) return { ok:false, error:'This account is deactivated' };
    users[idx].firstName = fnV.value; users[idx].lastName = lnV.value; users[idx].updatedAt = nowIso();
    saveUsers(users);
    return { ok:true, user:publicUser(users[idx]) };
  });
}

// ── Admin: user management (role re-checked server-side every call) ────────
function listUsers(sessionUser){
  if(!canListUsersRole(sessionUser.role)) return { ok:false, error:'You do not have permission to manage users' };
  const users = loadUsers();
  if(isAdminRole(sessionUser.role)) return { ok:true, users: users.map(publicUser) };
  // Phase heads only get enough to populate the case-assignee picker (name +
  // role, active accounts only) — active/inactive status, email and login
  // activity stay visible to true admins only.
  return { ok:true, users: users.filter(function(u){ return u.active; }).map(function(u){
    return { id:u.id, firstName:u.firstName, lastName:u.lastName, role:u.role };
  }) };
}
function saveUserAction(sessionUser, id, firstName, lastName, role){
  if(!isAdminRole(sessionUser.role)) return { ok:false, error:'You do not have permission to manage users' };
  const fnV = validateString(firstName, 1, NAME_MAX_LENGTH);
  const lnV = validateString(lastName, 1, NAME_MAX_LENGTH);
  if(!fnV.valid) return { ok:false, error:'First name: ' + fnV.error };
  if(!lnV.valid) return { ok:false, error:'Last name: ' + lnV.error };
  const roleV = validateRole(norm(role) || 'Teacher');
  if(!roleV.valid) return { ok:false, error:roleV.error };

  return withLock(function(){
    const users = loadUsers();
    let u = users.find(function(x){ return x.id === id; });
    if(u){
      u.firstName = fnV.value; u.lastName = lnV.value; u.role = roleV.value; u.updatedAt = nowIso();
      saveUsers(users);
      return { ok:true, user:publicUser(u) };
    }
    const code = genCode(14);
    u = { id:'u_'+Utilities.getUuid().replace(/-/g,'').slice(0,12), firstName:fnV.value, lastName:lnV.value,
      role:roleV.value, email:'', codeHash:hashCodeStrong(code), active:true, createdAt:nowIso(), updatedAt:nowIso(), lastLogin:'' };
    users.push(u);
    saveUsers(users);
    const out = publicUser(u); out.code = code;
    return { ok:true, user:out };
  });
}
function regenUserCode(sessionUser, id){
  if(!isAdminRole(sessionUser.role)) return { ok:false, error:'You do not have permission to manage users' };
  return withLock(function(){
    const users = loadUsers();
    const u = users.find(function(x){ return x.id===id; });
    if(!u) return { ok:false, error:'User not found' };
    const code = genCode(14);
    u.codeHash = hashCodeStrong(code); u.updatedAt = nowIso();
    saveUsers(users);
    return { ok:true, code:code };
  });
}
function toggleUser(sessionUser, id){
  if(!isAdminRole(sessionUser.role)) return { ok:false, error:'You do not have permission to manage users' };
  return withLock(function(){
    const users = loadUsers();
    const u = users.find(function(x){ return x.id===id; });
    if(!u) return { ok:false, error:'User not found' };
    u.active = !Boolean(u.active); u.updatedAt = nowIso();
    saveUsers(users);
    return { ok:true, active:Boolean(u.active) };
  });
}
function deleteUser(sessionUser, id){
  if(!isAdminRole(sessionUser.role)) return { ok:false, error:'You do not have permission to manage users' };
  return withLock(function(){
    const users = loadUsers();
    saveUsers(users.filter(function(u){ return u.id!==id; }));
    return { ok:true };
  });
}

// ── Email notifications ─────────────────────────────────────────────────────
function notifyAssignee(assignee, caseId, studentName, category, notifier){
  const names = String(assignee).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  names.forEach(function(name){
    const u = findUserByName(name);
    if(!u || !u.email) return;
    try {
      MailApp.sendEmail({ to:u.email, subject:'[Safeguarding] You have been assigned a case: ' + studentName,
        body:'You have been assigned to a safeguarding case by ' + (notifier||'the system') + '.\n\n'
          + 'Student: ' + studentName + '\nCategory: ' + category + '\nCase reference: ' + caseId + '\n\n'
          + 'Please log in to review the full case record, chronology and any outstanding actions.\n\n'
          + 'This is an automated notification. Do not reply to this email.' });
    } catch(err) { /* best-effort notification */ }
  });
  return { ok:true };
}
function notifyActionOwner(owner, caseId, studentName, actionText, notifier){
  const u = findUserByName(owner);
  if(!u || !u.email) return { ok:true };
  try {
    MailApp.sendEmail({ to:u.email, subject:'[Safeguarding] New action assigned to you – ' + studentName,
      body:'A new action has been assigned to you by ' + (notifier||'the system') + '.\n\n'
        + 'Student: ' + studentName + '\nAction: ' + actionText + '\nCase reference: ' + caseId + '\n\n'
        + 'Please log in to review and complete this action.\n\nThis is an automated notification. Do not reply to this email.' });
  } catch(err) { /* best-effort notification */ }
  return { ok:true };
}

// ── SEND case log (SENDCO / DSL / Principal) ────────────────────────────────
function sendCaseHeaders(){
  return ['id','studentId','studentName','department','status','needArea','notes','loggedBy','loggedAt','updatedAt'];
}
function ensureSendCasesSheet(){ return getOrCreateSheet(SHEET_SEND_CASES, sendCaseHeaders()); }
function getSendCasesFresh(){
  const sh = ensureSendCasesSheet();
  const rows = sh.getDataRange().getValues();
  const list = [];
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    if(String(row.join('')).trim()==='') continue;
    list.push({ id:row[0], rowId:i+1, studentId:row[1]||'', studentName:row[2]||'', department:row[3]||'',
      status:row[4]||'', needArea:row[5]||'', notes:row[6]||'', loggedBy:row[7]||'', loggedAt:row[8]||'', updatedAt:row[9]||'' });
  }
  return { ok:true, data:list };
}
function getSendCases(sessionUser){
  if(!isSendCaseRole(sessionUser.role)) return { ok:false, error:'You do not have permission to log SEND cases' };
  return getSendCasesFresh();
}
function saveSendCase(sessionUser, payloadJson){
  if(!isSendCaseRole(sessionUser.role)) return { ok:false, error:'You do not have permission to log SEND cases' };
  let p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch(e) {}
  const studentName = norm(p.studentName), status = norm(p.status);
  if(!studentName) return { ok:false, error:'Student name is required' };
  if(!status) return { ok:false, error:'SEND status is required' };

  return withLock(function(){
    const sh = ensureSendCasesSheet();
    const list = getSendCasesFresh().data;
    const id = norm(p.id) || ('sc_' + Utilities.getUuid().replace(/-/g,'').slice(0,12));
    const idx = list.findIndex(function(x){ return x.id === id; });
    const loggedByName = norm((sessionUser.firstName||'') + ' ' + (sessionUser.lastName||'')) || 'Unknown';
    const now = nowIso();
    const row = [id, norm(p.studentId) || ('sid_' + studentName.replace(/\W/g,'')), studentName, norm(p.department), status,
      norm(p.needArea) || (idx>=0 ? (list[idx].needArea||'') : ''), norm(p.notes),
      idx>=0 ? (list[idx].loggedBy||loggedByName) : loggedByName, idx>=0 ? (list[idx].loggedAt||now) : now, now];
    if(idx >= 0) sh.getRange(list[idx].rowId, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    bumpDataVersion();
    return { ok:true, id:id };
  });
}
function deleteSendCase(sessionUser, id){
  if(!isSendCaseRole(sessionUser.role)) return { ok:false, error:'You do not have permission to log SEND cases' };
  return withLock(function(){
    const sh = ensureSendCasesSheet();
    const list = getSendCasesFresh().data;
    const idx = list.findIndex(function(x){ return x.id === id; });
    if(idx<0) return { ok:false, error:'SEND case not found' };
    sh.deleteRow(list[idx].rowId);
    bumpDataVersion();
    return { ok:true };
  });
}

// ── SEND whole-school report (Lead DSL / Deputy DSL / Principal) ───────────
function sendReportHeaders(){
  return ['period','month','overview','referrals','needs','stats','summary','updatedAt','updatedBy'];
}
function ensureSendReportsSheet(){ return getOrCreateSheet(SHEET_SEND_REPORTS, sendReportHeaders()); }
function getSendReport(sessionUser, period){
  if(!isReportRole(sessionUser.role)) return { ok:false, error:'You do not have permission to access the whole-school report' };
  const p = norm(period);
  if(!p) return { ok:false, error:'Period is required' };
  const sh = ensureSendReportsSheet();
  const rows = sh.getDataRange().getValues();
  for(let i=1;i<rows.length;i++){
    if(String(rows[i][0])===p){
      const row = rows[i];
      return { ok:true, data:{ period:p, month:row[1]||'', overview:parseJsonCell(row[2],{}), referrals:parseJsonCell(row[3],{}),
        needs:parseJsonCell(row[4],{}), stats:parseJsonCell(row[5],{}), summary:parseJsonCell(row[6],{}) } };
    }
  }
  return { ok:true, data:{ period:p, month:'', overview:{}, referrals:{}, needs:{}, stats:{}, summary:{} } };
}
function saveSendReport(sessionUser, period, month, payloadJson){
  if(!isReportRole(sessionUser.role)) return { ok:false, error:'You do not have permission to access the whole-school report' };
  const p = norm(period);
  if(!p) return { ok:false, error:'Period is required' };
  let payload = {}; try { payload = JSON.parse(payloadJson || '{}'); } catch(e) {}

  return withLock(function(){
    const sh = ensureSendReportsSheet();
    const rows = sh.getDataRange().getValues();
    const row = [p, norm(month), JSON.stringify(payload.overview||{}), JSON.stringify(payload.referrals||{}),
      JSON.stringify(payload.needs||{}), JSON.stringify(payload.stats||{}), JSON.stringify(payload.summary||{}),
      nowIso(), norm((sessionUser.firstName||'')+' '+(sessionUser.lastName||''))];
    for(let i=1;i<rows.length;i++){
      if(String(rows[i][0])===p){ sh.getRange(i+1,1,1,row.length).setValues([row]); bumpDataVersion(); return { ok:true }; }
    }
    sh.appendRow(row);
    bumpDataVersion();
    return { ok:true };
  });
}

// ── Cases ────────────────────────────────────────────────────────────────
function caseHeaders(){
  return ['id','timestamp','reporter','studentId','studentName','year','category','subcategory','risk','status',
    'description','location','assignee','department','strategies','agencies','bodyMap','timeline','actions',
    'strategyImpactPositive','strategyImpactNone','sendcoReason','strategyDuration','linkedCaseIds','studentClass'];
}
function ensureCasesSheet(){ return getOrCreateSheet(SHEET_CASES, caseHeaders()); }
function parseJsonCell(value, fallback){
  if(value===undefined || value===null || value==='') return fallback;
  if(typeof value === 'object') return value;
  try { return JSON.parse(value); } catch(e) { return fallback; }
}
function isModernCaseRow(row){
  if(!row || row.length < 19) return false;
  const id = String(row[0] || '');
  const studentId = String(row[3] || '');
  const hasJsonColumns = Array.isArray(parseJsonCell(row[15],null)) || Array.isArray(parseJsonCell(row[16],null)) ||
    Array.isArray(parseJsonCell(row[17],null)) || Array.isArray(parseJsonCell(row[18],null));
  return id.indexOf('c_')===0 || studentId.indexOf('s_')===0 || hasJsonColumns;
}
function getCasesFresh(){
  const sh = ensureCasesSheet();
  const rows = sh.getDataRange().getValues();
  const headers = rows[0] || [];
  const hasJsonHeader = headers.indexOf('payloadJson') >= 0 || headers.indexOf('actions') >= 0;
  const byId = {};
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    if(String(row.join('')).trim()==='') continue;
    const modernRow = hasJsonHeader || isModernCaseRow(row);
    if(modernRow){
      const c = {
        id: row[0] || ('c_'+i), date:row[1]||'', reporter:row[2]||'', studentId:row[3]||'', studentName:row[4]||'',
        year:row[5]||'', category:row[6]||'', subcategory:row[7]||'', risk:row[8]||'Medium', status:row[9]||'New',
        description:row[10]||'', location:row[11]||'', assignee:row[12]||'', department:row[13]||'',
        strategies:parseJsonCell(row[14],[]), agencies:parseJsonCell(row[15],[]), bodyMap:parseJsonCell(row[16],[]),
        timeline:parseJsonCell(row[17],[]), actions:parseJsonCell(row[18],[]), strategyImpactPositive:row[19]||'',
        strategyImpactNone:row[20]||'', sendcoReason:row[21]||'', strategyDuration:row[22]||'',
        linkedCaseIds: parseJsonCell(row[23], []), studentClass: row[24]||''
      };
      byId[c.id] = {
        id:c.id, rowId:i+1, timestamp:c.date, reporterName:c.reporter, studentId:c.studentId, studentName:c.studentName,
        grade:c.year, category:c.category, severity:c.risk, description:c.description, location:c.location,
        status:c.status, assignee:c.assignee, department:c.department, strategies:c.strategies,
        agencies: Array.isArray(c.agencies) ? c.agencies.join(',') : String(c.agencies||''),
        bodyMap:c.bodyMap, timeline:c.timeline, actions:c.actions, strategyImpactPositive:c.strategyImpactPositive,
        strategyImpactNone:c.strategyImpactNone, sendcoReason:c.sendcoReason, strategyDuration:c.strategyDuration,
        linkedCaseIds:c.linkedCaseIds, studentClass:c.studentClass, payload:c
      };
      continue;
    }
    const legacyId = row[0] || ('legacy_'+(i+1));
    byId[legacyId] = { id:legacyId, rowId:i+1, timestamp:row[0], reporterName:row[1], studentId:'', studentName:row[5],
      grade:row[6], category:row[11], severity:row[12]||'', description:row[12], location:'', status:row[20]||'New',
      assignee:row[21]||'', agencies:row[22]||'', linkedCaseIds:[], studentClass:'' };
  }
  return { ok:true, status:'success', data: Object.keys(byId).map(function(k){ return byId[k]; }) };
}
function getCases(){
  const cached = cacheGetJson('cases_meta', 'cases_chunk_');
  if(cached) return { ok:true, status:'success', data:cached, version:getDataVersion() };
  const result = getCasesFresh();
  if(result.ok) cachePutJson('cases_meta', 'cases_chunk_', result.data);
  result.version = getDataVersion();
  return result;
}

function normalizeCasePayload(p){
  return {
    id: p.id || ('c_'+Utilities.getUuid().replace(/-/g,'').slice(0,12)), date:p.date||nowIso(), reporter:p.reporter||'',
    studentId:p.studentId||'', studentName:p.studentName||'', year:p.year||'', category:p.category||'',
    subcategory:p.subcategory||'', risk:p.risk||'Medium', status:p.status||'New', description:p.description||'',
    location:p.location||'', assignee:p.assignee||'', department:p.department||'',
    strategies: Array.isArray(p.strategies) ? p.strategies : String(p.strategies||'').split(',').filter(Boolean),
    agencies: Array.isArray(p.agencies) ? p.agencies : String(p.agencies||'').split(',').filter(Boolean),
    bodyMap: Array.isArray(p.bodyMap) ? p.bodyMap : [], timeline: Array.isArray(p.timeline) ? p.timeline : [],
    actions: Array.isArray(p.actions) ? p.actions : [], strategyImpactPositive:p.strategyImpactPositive||'',
    strategyImpactNone:p.strategyImpactNone||'', sendcoReason:p.sendcoReason||'', strategyDuration:p.strategyDuration||'',
    linkedCaseIds: Array.isArray(p.linkedCaseIds) ? p.linkedCaseIds.filter(Boolean) : [],
    studentClass: p.studentClass||''
  };
}
function upsertCaseRecord(payload){
  return withLock(function(){
    const sh = ensureCasesSheet();
    const cases = getCasesFresh().data || [];
    const c = normalizeCasePayload(payload);
    const idx = cases.findIndex(function(x){ return x.id === c.id; });
    const row = [c.id,c.date,c.reporter,c.studentId,c.studentName,c.year,c.category,c.subcategory,c.risk,c.status,
      c.description,c.location,c.assignee,c.department,JSON.stringify(c.strategies),JSON.stringify(c.agencies),
      JSON.stringify(c.bodyMap),JSON.stringify(c.timeline),JSON.stringify(c.actions),c.strategyImpactPositive,
      c.strategyImpactNone,c.sendcoReason,c.strategyDuration,JSON.stringify(c.linkedCaseIds),c.studentClass];
    let rowId;
    if(idx >= 0){ rowId = Number(cases[idx].rowId || (idx+2)); sh.getRange(rowId,1,1,row.length).setValues([row]); }
    else { sh.appendRow(row); rowId = sh.getLastRow(); }
    bumpDataVersion();
    return { ok:true, rowId:rowId, case:c };
  });
}
// Lets a concern be filed from the sign-in screen without an account (e.g. a
// visiting/supply staff member with no login yet — see
// openPublicReportFromAuth() in index.html). Deliberately narrow: no session
// required, but it can only ever create a brand-new case (the client-
// supplied id is discarded, so this can never be used to overwrite or
// target an existing row), status/assignee are forced rather than trusted
// from the caller, and it's rate-limited globally since it's the one write
// path in this API that doesn't require authentication.
function publicSubmitConcern(payload){
  const p = payload || {};
  const nameV = validateString(p.studentName, 1, NAME_MAX_LENGTH);
  if(!nameV.valid) return { ok:false, error:'Student name: ' + nameV.error };
  if(!norm(p.category)) return { ok:false, error:'Category is required' };

  if(!checkGlobalRateLimit('public_report_count', 20, 300)){
    return { ok:false, error:'Too many concerns submitted recently. Please wait a few minutes and try again, or ask a colleague to log in and report it directly.' };
  }

  const forced = Object.assign({}, p, { status:'New', assignee:'' });
  delete forced.id;
  return upsertCaseRecord(forced);
}
function updateCaseStatus(rowId, caseId, status){
  const data = getCasesFresh().data || [];
  const c = data.find(function(x){ return String(x.rowId)===String(rowId) || x.id===caseId; });
  if(!c) return { ok:false, error:'Case not found' };
  const payload = c.payload || normalizeCasePayload({
    id:c.id, date:c.timestamp, reporter:c.reporterName, studentName:c.studentName, year:c.grade, category:c.category,
    subcategory:'', risk:c.severity, status:status, description:c.description, location:'', assignee:c.assignee,
    department:c.department||'', studentClass:c.studentClass||'',
    agencies:(c.agencies||'').split(',').filter(Boolean), bodyMap:c.bodyMap||[], timeline:c.timeline||[], actions:c.actions||[],
    linkedCaseIds:c.linkedCaseIds||[]
  });
  payload.status = status;
  return upsertCaseRecord(payload);
}
function deleteCaseAction(caseId, rowId){
  return withLock(function(){
    const sh = ensureCasesSheet();
    const data = getCasesFresh().data || [];
    const idx = data.findIndex(function(x){ return String(x.rowId)===String(rowId) || x.id===caseId; });
    if(idx<0) return { ok:false, error:'Case not found' };
    sh.deleteRow(data[idx].rowId);
    bumpDataVersion();
    return { ok:true, status:'success' };
  });
}
// ── Students (durable per-student metadata — familyId etc.) ────────────────
// Student name/year/form/keyAdult remain derived from case rows client-side,
// same as before; this sheet only holds fields with no natural home on a
// case, so they survive index.html's rebuildStudentsFromCases().
function studentsHeaders(){ return ['id','familyId','notes','createdAt','updatedAt']; }
function ensureStudentsSheet(){ return getOrCreateSheet(SHEET_STUDENTS, studentsHeaders()); }
function loadStudentMetaMap(){
  const sh = ensureStudentsSheet();
  const rows = sh.getDataRange().getValues();
  const map = {};
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(String(r.join('')).trim()==='') continue;
    map[r[0]] = { id:r[0], rowId:i+1, familyId:r[1]||'', notes:r[2]||'', createdAt:r[3]||'', updatedAt:r[4]||'' };
  }
  return map;
}
function listStudentMeta(){
  const map = loadStudentMetaMap();
  return { ok:true, data: Object.keys(map).map(function(k){ const m=map[k]; return { id:m.id, familyId:m.familyId, notes:m.notes }; }) };
}
function saveStudentMetaAction(sessionUser, studentId, familyId, notes){
  const sid = norm(studentId);
  if(!sid) return { ok:false, error:'Student id is required' };
  const notesV = validateString(notes || '', 0, NOTES_MAX_LENGTH);
  if(!notesV.valid) return { ok:false, error:'Notes: ' + notesV.error };
  return withLock(function(){
    const sh = ensureStudentsSheet();
    const map = loadStudentMetaMap();
    const now = nowIso();
    const row = [sid, norm(familyId), notesV.value, map[sid] ? map[sid].createdAt : now, now];
    if(map[sid]) sh.getRange(map[sid].rowId,1,1,row.length).setValues([row]);
    else sh.appendRow(row);
    bumpDataVersion();
    return { ok:true };
  });
}

// ── Families ─────────────────────────────────────────────────────────────
function familiesHeaders(){ return ['familyId','familyName','studentIds','notes','createdAt','updatedAt']; }
function ensureFamiliesSheet(){ return getOrCreateSheet(SHEET_FAMILIES, familiesHeaders()); }
function listFamilies(){
  const sh = ensureFamiliesSheet();
  const rows = sh.getDataRange().getValues();
  const list = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(String(r.join('')).trim()==='') continue;
    list.push({ familyId:r[0], rowId:i+1, familyName:r[1]||'', studentIds:parseJsonCell(r[2],[]), notes:r[3]||'', createdAt:r[4]||'', updatedAt:r[5]||'' });
  }
  return { ok:true, data:list };
}
function saveFamilyAction(sessionUser, payloadJson){
  let p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch(e) {}
  const nameV = validateString(p.familyName, 1, NAME_MAX_LENGTH);
  if(!nameV.valid) return { ok:false, error:'Family name: ' + nameV.error };
  return withLock(function(){
    const sh = ensureFamiliesSheet();
    const existing = listFamilies().data;
    const familyId = norm(p.familyId) || ('fam_'+Utilities.getUuid().replace(/-/g,'').slice(0,10));
    const idx = existing.findIndex(function(x){ return x.familyId===familyId; });
    const now = nowIso();
    const row = [familyId, nameV.value, JSON.stringify(Array.isArray(p.studentIds)?p.studentIds.filter(Boolean):[]),
      norm(p.notes), idx>=0 ? existing[idx].createdAt : now, now];
    if(idx>=0) sh.getRange(existing[idx].rowId,1,1,row.length).setValues([row]);
    else sh.appendRow(row);
    bumpDataVersion();
    return { ok:true, familyId:familyId };
  });
}
function deleteFamilyAction(sessionUser, familyId){
  const fid = norm(familyId);
  if(!fid) return { ok:false, error:'Family id is required' };
  return withLock(function(){
    const sh = ensureFamiliesSheet();
    const existing = listFamilies().data;
    const idx = existing.findIndex(function(x){ return x.familyId===fid; });
    if(idx<0) return { ok:false, error:'Family not found' };
    sh.deleteRow(existing[idx].rowId);
    bumpDataVersion();
    return { ok:true };
  });
}

// ── HTTP entry points ───────────────────────────────────────────────────────
// Every action is POST-only: access codes and session tokens must never
// appear in a URL (Apps Script logs GET query strings). doGet exists only
// to answer with a clear error instead of a silent failure.
function doGet(e){
  return jsonOut({ ok:false, error:'This API only accepts POST requests.' });
}

function doPost(e){
  try{
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = norm(p.action);
    if(!action) return jsonOut({ ok:false, error:'Missing action' });

    if(action === 'login') return jsonOut(rateLimited(p.code, function(){ return loginByCode(p.code); }));
    if(action === 'publicSyncCase') return jsonOut(publicSubmitConcern(p.payload));

    const session = requireSession(p.token);
    if(!session.ok) return jsonOut(session);
    const user = session.user;

    switch(action){
      case 'logout': return jsonOut(logoutAction(p.token));
      case 'changeOwnCode': return jsonOut(changeOwnCode(user, p.currentCode, p.newCode));
      case 'updateOwnProfile': return jsonOut(updateOwnProfile(user, p.firstName, p.lastName));
      case 'getVersion': return jsonOut({ ok:true, version:getDataVersion() });
      case 'getCases': return jsonOut(getCases());
      case 'syncCase': return jsonOut(upsertCaseRecord(p.payload));
      case 'updateStatus': return jsonOut(updateCaseStatus(p.rowId, p.caseId, p.status));
      case 'deleteCase': return jsonOut(deleteCaseAction(p.caseId, p.rowId));
      case 'notifyAssignee': return jsonOut(notifyAssignee(p.assignee, p.caseId, p.studentName, p.category, p.notifier));
      case 'notifyActionOwner': return jsonOut(notifyActionOwner(p.owner, p.caseId, p.studentName, p.actionText, p.notifier));
      case 'getSendReport': return jsonOut(getSendReport(user, p.period));
      case 'saveSendReport': return jsonOut(saveSendReport(user, p.period, p.month, p.payload));
      case 'getSendCases': return jsonOut(getSendCases(user));
      case 'saveSendCase': return jsonOut(saveSendCase(user, p.payload));
      case 'deleteSendCase': return jsonOut(deleteSendCase(user, p.id));
      case 'listUsers': return jsonOut(listUsers(user));
      case 'saveUser': return jsonOut(saveUserAction(user, p.id, p.firstName, p.lastName, p.role));
      case 'regenUserCode': return jsonOut(regenUserCode(user, p.id));
      case 'toggleUser': return jsonOut(toggleUser(user, p.id));
      case 'deleteUser': return jsonOut(deleteUser(user, p.id));
      case 'listStudentMeta': return jsonOut(listStudentMeta());
      case 'saveStudentMeta': return jsonOut(saveStudentMetaAction(user, p.studentId, p.familyId, p.notes));
      case 'listFamilies': return jsonOut(listFamilies());
      case 'saveFamily': return jsonOut(saveFamilyAction(user, p.payload));
      case 'deleteFamily': return jsonOut(deleteFamilyAction(user, p.familyId));
      default: return jsonOut({ ok:false, error:'Unknown action' });
    }
  }catch(err){
    return jsonOut({ ok:false, error:String(err) });
  }
}
