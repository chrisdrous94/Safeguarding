const SHEET_USERS = 'users';
const SHEET_CASES = 'cases';

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowIso(){ return new Date().toISOString(); }
function norm(s){ return String(s || '').trim(); }
function normUpper(s){ return norm(s).toUpperCase(); }
function normLower(s){ return norm(s).toLowerCase(); }

function hashCode(code){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normUpper(code));
  return bytes.map(function(b){ const v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}

function genCode(len){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out='';
  for(let i=0;i<(len||8);i++) out += chars.charAt(Math.floor(Math.random()*chars.length));
  return out;
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
      id: r[0],
      firstName: r[1],
      lastName: r[2],
      role: r[3] || 'Teacher',
      email: r[4] || '',
      codeHash: r[5] || '',
      active: String(r[6]).toLowerCase() !== 'false',
      createdAt: r[7] || '',
      updatedAt: r[8] || '',
      lastLogin: r[9] || ''
    });
  }
  return users;
}

function saveUsers(users){
  const sh = getOrCreateSheet(SHEET_USERS, userHeaders());
  const headers = userHeaders();
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(!users || !users.length) return;
  const rows = users.map(function(u){
    return [u.id,u.firstName,u.lastName,u.role,u.email,u.codeHash,Boolean(u.active),u.createdAt,u.updatedAt,u.lastLogin];
  });
  sh.getRange(2,1,rows.length,headers.length).setValues(rows);
}

function publicUser(u){
  return {
    id:u.id,
    firstName:u.firstName,
    lastName:u.lastName,
    role:u.role,
    email:u.email,
    active:Boolean(u.active),
    createdAt:u.createdAt,
    updatedAt:u.updatedAt,
    lastLogin:u.lastLogin
  };
}

function bootstrapAdminCode(){
  const scriptProp = normUpper(PropertiesService.getScriptProperties().getProperty('ADMIN_CODE'));
  if(scriptProp) return scriptProp;
  // Temporary bootstrap fallback for fresh deployments.
  return 'CHRISTOF97740590!';
}

function isAdminCode(code){
  const admin = bootstrapAdminCode();
  if(!PropertiesService.getScriptProperties().getProperty('ADMIN_CODE')){
    try { PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', admin); } catch(e) {}
  }
  return !!admin && normUpper(code) === admin;
}

function requireAdmin(adminCode){
  if(isAdminCode(adminCode)) return { ok:true, admin:{ id:'__admin__', firstName:'System', lastName:'Admin', role:'Lead DSL' } };
  const users = loadUsers();
  const codeHash = hashCode(adminCode);
  const u = users.find(function(x){
    return x.active && x.codeHash === codeHash && (x.role==='Lead DSL' || x.role==='Senior Leadership');
  });
  if(!u) return { ok:false, error:'Invalid admin code' };
  return { ok:true, admin:u };
}

function getCases(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CASES) || ss.getSheets()[0];
  const rows = sh.getDataRange().getValues();
  const cases = [];
  for(let i=1;i<rows.length;i++){
    if(String(rows[i].join('')).trim()==='') continue;
    cases.push({
      rowId:i+1,
      timestamp:rows[i][0],
      reporterName:rows[i][1],
      studentName:rows[i][5],
      grade:rows[i][6],
      category:rows[i][11],
      severity:rows[i][12]||'',
      description:rows[i][12],
      status:rows[i][20]||'New',
      assignee:rows[i][21]||'',
      agencies:rows[i][22]||''
    });
  }
  return { ok:true, status:'success', data:cases };
}

function loginByCode(code){
  const c = normUpper(code);
  if(!c) return { ok:false, error:'Access code is required' };
  if(isAdminCode(c)){
    return { ok:true, user:{ id:'__admin__', firstName:'System', lastName:'Admin', role:'Lead DSL' } };
  }
  const users = loadUsers();
  const codeHash = hashCode(c);
  const idx = users.findIndex(function(u){ return u.codeHash===codeHash; });
  if(idx<0) return { ok:false, error:'Access code not recognized' };
  if(!users[idx].active) return { ok:false, error:'This access code has been deactivated.' };
  users[idx].lastLogin = nowIso();
  users[idx].updatedAt = nowIso();
  saveUsers(users);
  return { ok:true, user:publicUser(users[idx]) };
}

function verifyEmail(email){
  const e = normLower(email);
  if(!e || e.indexOf('@')===-1) return { ok:false, error:'Invalid email' };

  const users = loadUsers();
  let u = users.find(function(x){ return normLower(x.email)===e; });
  const code = genCode(8);
  const codeHash = hashCode(code);

  if(!u){
    u = {
      id: 'u_' + Utilities.getUuid().replace(/-/g,'').slice(0,12),
      firstName: e.split('@')[0],
      lastName: '',
      role: 'Teacher',
      email: e,
      codeHash: codeHash,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastLogin: ''
    };
    users.push(u);
  } else {
    u.codeHash = codeHash;
    u.active = true;
    u.updatedAt = nowIso();
  }
  saveUsers(users);

  try {
    MailApp.sendEmail({
      to: e,
      subject: 'Your Safeguarding Access Code',
      body: 'Your access code is: ' + code + '\n\nUse this code to sign in.'
    });
  } catch(err) {
    // Keep response generic for privacy/security
  }

  return { ok:true, message:'If the email is registered, an access code will be sent shortly.' };
}

function listUsers(adminCode){
  const auth = requireAdmin(adminCode);
  if(!auth.ok) return { ok:false, error:auth.error };
  return { ok:true, users: loadUsers().map(publicUser) };
}

function saveUserAction(adminCode, id, firstName, lastName, role){
  const auth = requireAdmin(adminCode);
  if(!auth.ok) return { ok:false, error:auth.error };
  const fn = norm(firstName), ln = norm(lastName), rl = norm(role)||'Teacher';
  if(!fn || !ln) return { ok:false, error:'First and last name are required' };

  const users = loadUsers();
  let u = users.find(function(x){ return x.id === id; });
  if(u){
    u.firstName = fn; u.lastName = ln; u.role = rl; u.updatedAt = nowIso();
    saveUsers(users);
    return { ok:true, user:publicUser(u) };
  }

  const code = genCode(8);
  u = {
    id: 'u_' + Utilities.getUuid().replace(/-/g,'').slice(0,12),
    firstName: fn,
    lastName: ln,
    role: rl,
    email: '',
    codeHash: hashCode(code),
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastLogin: ''
  };
  users.push(u);
  saveUsers(users);
  const out = publicUser(u);
  out.code = code;
  return { ok:true, user:out };
}

function regenUserCode(adminCode, id){
  const auth = requireAdmin(adminCode);
  if(!auth.ok) return { ok:false, error:auth.error };
  const users = loadUsers();
  const u = users.find(function(x){ return x.id===id; });
  if(!u) return { ok:false, error:'User not found' };
  const code = genCode(8);
  u.codeHash = hashCode(code);
  u.updatedAt = nowIso();
  saveUsers(users);
  return { ok:true, code:code };
}

function toggleUser(adminCode, id){
  const auth = requireAdmin(adminCode);
  if(!auth.ok) return { ok:false, error:auth.error };
  const users = loadUsers();
  const u = users.find(function(x){ return x.id===id; });
  if(!u) return { ok:false, error:'User not found' };
  u.active = !Boolean(u.active);
  u.updatedAt = nowIso();
  saveUsers(users);
  return { ok:true, active:Boolean(u.active) };
}

function deleteUser(adminCode, id){
  const auth = requireAdmin(adminCode);
  if(!auth.ok) return { ok:false, error:auth.error };
  const users = loadUsers();
  const next = users.filter(function(u){ return u.id!==id; });
  saveUsers(next);
  return { ok:true };
}

function doGet(e){
  try {
    const action = norm(e && e.parameter && e.parameter.action) || 'getCases';
    if(action==='getCases') return jsonOut(getCases());
    if(action==='login') return jsonOut(loginByCode(e.parameter.code));
    if(action==='verifyEmail') return jsonOut(verifyEmail(e.parameter.email));
    if(action==='listUsers') return jsonOut(listUsers(e.parameter.adminCode));
    if(action==='saveUser') return jsonOut(saveUserAction(e.parameter.adminCode, e.parameter.id, e.parameter.firstName, e.parameter.lastName, e.parameter.role));
    if(action==='regenUserCode') return jsonOut(regenUserCode(e.parameter.adminCode, e.parameter.id));
    if(action==='toggleUser') return jsonOut(toggleUser(e.parameter.adminCode, e.parameter.id));
    if(action==='deleteUser') return jsonOut(deleteUser(e.parameter.adminCode, e.parameter.id));
    return jsonOut({ ok:false, error:'Unknown action' });
  } catch(err){
    return jsonOut({ ok:false, error:String(err) });
  }
}

function doPost(e){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_CASES);
  if(!sh){
    sh = ss.insertSheet(SHEET_CASES);
    const header = [];
    for(let i=1;i<=23;i++) header.push('col'+i);
    sh.getRange(1,1,1,23).setValues([header]);
  }
  const p = JSON.parse(e.postData.contents || '{}');
  if (p.action==='report' && p.payload){
    const c = p.payload;
    const row = new Array(23).fill('');
    row[0] = c.date || nowIso();
    row[1] = c.reporter || '';
    row[5] = c.studentName || '';
    row[6] = c.year || '';
    row[11] = c.category || '';
    row[12] = c.description || '';
    row[20] = c.status || 'New';
    row[21] = c.assignee || '';
    row[22] = (c.agencies || []).join(',');
    sh.appendRow(row);
  }
  if (p.action==='updateStatus' && p.rowId) sh.getRange(Number(p.rowId),21).setValue(p.status);
  if (p.action==='deleteCase' && p.rowId) sh.getRange(Number(p.rowId),1,1,sh.getLastColumn()).clearContent();
  return jsonOut({ ok:true, status:'success' });
}
