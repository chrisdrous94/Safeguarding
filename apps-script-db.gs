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
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm(code));
  return bytes.map(function(b){ const v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}

function hashCodeLegacy(code){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normUpper(code));
  return bytes.map(function(b){ const v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}

function genCode(len){
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*_-+=';
  const all = upper + lower + digits + symbols;
  const size = Math.max(12, len || 14);
  const pick = function(chars){ return chars.charAt(Math.floor(Math.random()*chars.length)); };
  const out = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for(let i=out.length;i<size;i++) out.push(pick(all));
  for(let i=out.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const t = out[i]; out[i]=out[j]; out[j]=t;
  }
  return out.join('');
}

function isStrongPassword(code){
  const s = norm(code);
  return s.length>=12 &&
    /[A-Z]/.test(s) &&
    /[a-z]/.test(s) &&
    /[0-9]/.test(s) &&
    /[^A-Za-z0-9]/.test(s) &&
    !/\s/.test(s);
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
  const codeHashLegacy = hashCodeLegacy(adminCode);
  const u = users.find(function(x){
    return x.active && (x.codeHash === codeHash || x.codeHash === codeHashLegacy) && (x.role==='Lead DSL' || x.role==='Senior Leadership' || x.role==='Principal');
  });
  if(u) return { ok:true, admin:u };
  const activeAdminUsers = users.filter(function(x){
    return x.active && (x.role==='Lead DSL' || x.role==='Senior Leadership' || x.role==='Principal');
  });
  if(activeAdminUsers.length===0 && adminCode){
    try { PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', normUpper(adminCode)); } catch(e) {}
    return { ok:true, admin:{ id:'__bootstrap__', firstName:'System', lastName:'Admin', role:'Lead DSL' } };
  }
  if(!u) return { ok:false, error:'Invalid admin code' };
  return { ok:true, admin:u };
}

function caseHeaders(){
  return ['id','timestamp','reporter','studentId','studentName','year','category','subcategory','risk','status','description','location','assignee','department','strategies','agencies','bodyMap','timeline','actions'];
}

function ensureCasesSheet(){
  return getOrCreateSheet(SHEET_CASES, caseHeaders());
}

function parseJsonCell(value, fallback){
  if(value===undefined || value===null || value==='') return fallback;
  if(typeof value === 'object') return value;
  try { return JSON.parse(value); } catch(e) { return fallback; }
}

function isModernCaseRow(row){
  if(!row || row.length < 19) return false;
  const id = String(row[0] || '');
  const studentId = String(row[3] || '');
  const jsonAgencies = parseJsonCell(row[15], null);
  const jsonBodyMap = parseJsonCell(row[16], null);
  const jsonTimeline = parseJsonCell(row[17], null);
  const jsonActions = parseJsonCell(row[18], null);
  const hasJsonColumns = Array.isArray(jsonAgencies) || Array.isArray(jsonBodyMap) || Array.isArray(jsonTimeline) || Array.isArray(jsonActions);
  return id.indexOf('c_')===0 || studentId.indexOf('s_')===0 || hasJsonColumns;
}

function getCases(){
  const sh = ensureCasesSheet();
  const rows = sh.getDataRange().getValues();
  const headers = rows[0] || [];
  const hasJsonHeader = headers.indexOf('payloadJson') >= 0 || headers.indexOf('actions') >= 0;
  const cases = [];
  const byId = {};
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    if(String(row.join('')).trim()==='') continue;
    const modernRow = hasJsonHeader || isModernCaseRow(row);
    if(modernRow){
      const c = {
        id: row[0] || ('c_' + i),
        date: row[1] || '',
        reporter: row[2] || '',
        studentId: row[3] || '',
        studentName: row[4] || '',
        year: row[5] || '',
        category: row[6] || '',
        subcategory: row[7] || '',
        risk: row[8] || 'Medium',
        status: row[9] || 'New',
        description: row[10] || '',
        location: row[11] || '',
        assignee: row[12] || '',
        department: row[13] || '',
        strategies: parseJsonCell(row[14], []),
        agencies: parseJsonCell(row[15], []),
        bodyMap: parseJsonCell(row[16], []),
        timeline: parseJsonCell(row[17], []),
        actions: parseJsonCell(row[18], [])
      };
      const out = {
        id:c.id,
        rowId:i+1,
        timestamp:c.date,
        reporterName:c.reporter,
        studentId:c.studentId,
        studentName:c.studentName,
        grade:c.year,
        category:c.category,
        severity:c.risk,
        description:c.description,
        location:c.location,
        status:c.status,
        assignee:c.assignee,
        department:c.department,
        strategies:c.strategies,
        agencies:Array.isArray(c.agencies) ? c.agencies.join(',') : String(c.agencies||''),
        bodyMap:c.bodyMap,
        timeline:c.timeline,
        actions:c.actions,
        payload:c
      };
      // Keep the latest row for each case id to collapse pre-existing duplicate updates.
      byId[c.id] = out;
      continue;
    }
    const legacyId = row[0] || ('legacy_' + (i+1));
    const outLegacy = {
      id:legacyId,
      rowId:i+1,
      timestamp:row[0],
      reporterName:row[1],
      studentId:'',
      studentName:row[5],
      grade:row[6],
      category:row[11],
      severity:row[12]||'',
      description:row[12],
      location:'',
      status:row[20]||'New',
      assignee:row[21]||'',
      agencies:row[22]||''
    };
    byId[legacyId] = outLegacy;
  }
  Object.keys(byId).forEach(function(k){ cases.push(byId[k]); });
  return { ok:true, status:'success', data:cases };
}

function normalizeCasePayload(p){
  return {
    id: p.id || ('c_' + Utilities.getUuid().replace(/-/g,'').slice(0,12)),
    date: p.date || nowIso(),
    reporter: p.reporter || '',
    studentId: p.studentId || '',
    studentName: p.studentName || '',
    year: p.year || '',
    category: p.category || '',
    subcategory: p.subcategory || '',
    risk: p.risk || 'Medium',
    status: p.status || 'New',
    description: p.description || '',
    location: p.location || '',
    assignee: p.assignee || '',
    department: p.department || '',
    strategies: Array.isArray(p.strategies) ? p.strategies : String(p.strategies || '').split(',').filter(Boolean),
    agencies: Array.isArray(p.agencies) ? p.agencies : String(p.agencies || '').split(',').filter(Boolean),
    bodyMap: Array.isArray(p.bodyMap) ? p.bodyMap : [],
    timeline: Array.isArray(p.timeline) ? p.timeline : [],
    actions: Array.isArray(p.actions) ? p.actions : []
  };
}

function upsertCaseRecord(payload){
  const sh = ensureCasesSheet();
  const cases = getCases().data || [];
  const c = normalizeCasePayload(payload);
  const idx = cases.findIndex(function(x){ return x.id === c.id; });
  const row = [c.id,c.date,c.reporter,c.studentId,c.studentName,c.year,c.category,c.subcategory,c.risk,c.status,c.description,c.location,c.assignee,c.department,JSON.stringify(c.strategies),JSON.stringify(c.agencies),JSON.stringify(c.bodyMap),JSON.stringify(c.timeline),JSON.stringify(c.actions)];
  if(idx >= 0){
    const targetRow = Number(cases[idx].rowId || (idx + 2));
    sh.getRange(targetRow, 1, 1, row.length).setValues([row]);
    return { ok:true, rowId: targetRow, case:c };
  }
  sh.appendRow(row);
  return { ok:true, rowId: sh.getLastRow(), case:c };
}

function loginByCode(code){
  const c = norm(code);
  if(!c) return { ok:false, error:'Access code is required' };
  if(isAdminCode(c)){
    return { ok:true, user:{ id:'__admin__', firstName:'System', lastName:'Admin', role:'Lead DSL' } };
  }
  const users = loadUsers();
  const codeHash = hashCode(c);
  const codeHashLegacy = hashCodeLegacy(c);
  const idx = users.findIndex(function(u){ return u.codeHash===codeHash || u.codeHash===codeHashLegacy; });
  if(idx<0) return { ok:false, error:'Access code not recognized' };
  if(!users[idx].active) return { ok:false, error:'This access code has been deactivated.' };
  if(users[idx].codeHash===codeHashLegacy) users[idx].codeHash = codeHash;
  users[idx].lastLogin = nowIso();
  users[idx].updatedAt = nowIso();
  saveUsers(users);
  return { ok:true, user:publicUser(users[idx]) };
}

function changeOwnCode(currentCode, newCode){
  const cur = norm(currentCode);
  const nxt = norm(newCode);

  if(!cur || !nxt) return { ok:false, error:'Current and new password are required' };
  if(cur===nxt) return { ok:false, error:'New password must be different' };
  if(!isStrongPassword(nxt)) return { ok:false, error:'New password does not meet security requirements' };

  if(isAdminCode(cur)){
    try {
      PropertiesService.getScriptProperties().setProperty('ADMIN_CODE', normUpper(nxt));
      return { ok:true };
    } catch(e) {
      return { ok:false, error:'Could not update admin password' };
    }
  }

  const users = loadUsers();
  const curHash = hashCode(cur);
  const curLegacy = hashCodeLegacy(cur);
  const idx = users.findIndex(function(u){ return u.codeHash===curHash || u.codeHash===curLegacy; });

  if(idx<0) return { ok:false, error:'Current password is incorrect' };
  if(!users[idx].active) return { ok:false, error:'This account is deactivated' };

  users[idx].codeHash = hashCode(nxt);
  users[idx].updatedAt = nowIso();
  saveUsers(users);
  return { ok:true };
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

  const code = genCode(14);
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
  const code = genCode(14);
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

function findUserByName(name){
  const n = norm(name).toLowerCase();
  return loadUsers().find(function(u){
    return (normLower(u.firstName) + ' ' + normLower(u.lastName)).trim() === n;
  });
}

function notifyAssignee(assignee, caseId, studentName, category, notifier){
  const names = String(assignee).split(',').map(s => s.trim()).filter(Boolean);
  names.forEach(name => {
    const u = findUserByName(name);
    if(!u || !u.email) return { ok:true, skipped:`${name}: no email registered` };
    try {
      MailApp.sendEmail({
        to: u.email,
        subject: '[Safeguarding] You have been assigned a case: ' + studentName,
        body: 'You have been assigned to a safeguarding case by ' + (notifier||'the system') + '.\n\n'
            + 'Student: ' + studentName + '\n'
            + 'Category: ' + category + '\n'
            + 'Case reference: ' + caseId + '\n\n'
            + 'Please log in to review the full case record, chronology and any outstanding actions.\n\n'
            + 'This is an automated notification. Do not reply to this email.'
      });
    } catch(err) {
      return { ok:true, skipped:String(err) };
    }
  });
  return { ok:true };
}

function notifyActionOwner(owner, caseId, studentName, actionText, notifier){
  const u = findUserByName(owner);
  if(!u || !u.email) return { ok:true, skipped:'no email registered' };
  try {
    MailApp.sendEmail({
      to: u.email,
      subject: '[Safeguarding] New action assigned to you – ' + studentName,
      body: 'A new action has been assigned to you by ' + (notifier||'the system') + '.\n\n'
          + 'Student: ' + studentName + '\n'
          + 'Action: ' + actionText + '\n'
          + 'Case reference: ' + caseId + '\n\n'
          + 'Please log in to review and complete this action.\n\n'
          + 'This is an automated notification. Do not reply to this email.'
    });
    return { ok:true };
  } catch(err) {
    return { ok:true, skipped:String(err) };
  }
}

function doGet(e){
  try {
    const action = norm(e && e.parameter && e.parameter.action) || 'getCases';
    if(action==='getCases') return jsonOut(getCases());
    if(action==='login') return jsonOut(loginByCode(e.parameter.code));
    if(action==='changeOwnCode') return jsonOut(changeOwnCode(e.parameter.currentCode, e.parameter.newCode));
    if(action==='listUsers') return jsonOut(listUsers(e.parameter.adminCode));
    if(action==='saveUser') return jsonOut(saveUserAction(e.parameter.adminCode, e.parameter.id, e.parameter.firstName, e.parameter.lastName, e.parameter.role));
    if(action==='regenUserCode') return jsonOut(regenUserCode(e.parameter.adminCode, e.parameter.id));
    if(action==='toggleUser') return jsonOut(toggleUser(e.parameter.adminCode, e.parameter.id));
    if(action==='deleteUser') return jsonOut(deleteUser(e.parameter.adminCode, e.parameter.id));
    if(action==='notifyAssignee') return jsonOut(notifyAssignee(e.parameter.assignee, e.parameter.caseId, e.parameter.studentName, e.parameter.category, e.parameter.notifier));
    if(action==='notifyActionOwner') return jsonOut(notifyActionOwner(e.parameter.owner, e.parameter.caseId, e.parameter.studentName, e.parameter.actionText, e.parameter.notifier));
    return jsonOut({ ok:false, error:'Unknown action' });
  } catch(err){
    return jsonOut({ ok:false, error:String(err) });
  }
}

function doPost(e){
  const p = JSON.parse(e.postData.contents || '{}');
  if (p.action==='report' && p.payload) return jsonOut(upsertCaseRecord(p.payload));
  if (p.action==='syncCase' && p.payload) return jsonOut(upsertCaseRecord(p.payload));
  if (p.action==='updateStatus' && (p.rowId || p.caseId)){
    const data = getCases().data || [];
    const c = data.find(function(x){ return String(x.rowId)===String(p.rowId) || x.id===p.caseId; });
    if(!c) return jsonOut({ ok:false, error:'Case not found' });
    const payload = c.payload || normalizeCasePayload({
      id:c.id, date:c.timestamp, reporter:c.reporterName, studentName:c.studentName, year:c.grade,
      category:c.category, subcategory:'', risk:c.severity, status:p.status, description:c.description,
      location:'', assignee:c.assignee, agencies:(c.agencies||'').split(',').filter(Boolean), bodyMap:c.bodyMap||[], timeline:c.timeline||[], actions:c.actions||[]
    });
    payload.status = p.status;
    return jsonOut(upsertCaseRecord(payload));
  }
  if (p.action==='deleteCase' && (p.rowId || p.caseId)){
    const sh = ensureCasesSheet();
    const data = getCases().data || [];
    const idx = data.findIndex(function(x){ return String(x.rowId)===String(p.rowId) || x.id===p.caseId; });
    if(idx<0) return jsonOut({ ok:false, error:'Case not found' });
    sh.deleteRow(idx + 2);
    return jsonOut({ ok:true, status:'success' });
  }
  return jsonOut({ ok:false, error:'Unknown action' });
}
