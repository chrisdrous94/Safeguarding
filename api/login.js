const { loadUsers, compareCode } = require('../data-store');

function validateCode(value){
  if(typeof value !== 'string') return { valid:false, error:'Access code must be a string' };
  const trimmed = value.toUpperCase().trim();
  if(trimmed.length < 6 || trimmed.length > 12) return { valid:false, error:'Access code must be 6-12 characters' };
  if(!/^[A-Z0-9]+$/.test(trimmed)) return { valid:false, error:'Access code must contain only letters and numbers' };
  return { valid:true, value:trimmed };
}

module.exports = (req, res) => {
  if(req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const body = req.body || {};
  const { code } = body;
  const v = validateCode(code);
  if(!v.valid) return res.status(400).json({ ok:false, error:v.error });
  const normalized = v.value;

  const ADMIN_CODE = (process.env.ADMIN_CODE||'').toUpperCase().trim();
  if(ADMIN_CODE && normalized === ADMIN_CODE){
    return res.json({ ok:true, user:{ id:'__admin__', firstName:'System', lastName:'Admin', role:'Lead DSL' } });
  }

  const users = loadUsers();
  const user = users.find(u => u.codeHash && compareCode(normalized, u.codeHash));
  if(!user) return res.status(401).json({ ok:false, error:'Access code not recognized' });
  if(!user.active) return res.status(403).json({ ok:false, error:'This access code has been deactivated.' });

  user.lastLogin = new Date().toISOString();
  // persist
  try{ require('../data-store').saveUsers(users); }catch(e){}

  return res.json({ ok:true, user:{ id:user.id, firstName:user.firstName, lastName:user.lastName, role:user.role } });
};
