const ds = require('../data-store');
const nodemailer = require('nodemailer');

function validateEmail(e){ return typeof e==='string' && /@/.test(e); }

module.exports = async (req, res) => {
  if(req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const { email } = req.body || {};
  if(!validateEmail(email)) return res.status(400).json({ ok:false, error:'Invalid email' });

  const code = ds.genAccessCode();
  const codeHash = ds.hashCode(code);

  // create or update user as Lead DSL (admin)
  const users = ds.loadUsers();
  let user = users.find(u => u.email && u.email.toLowerCase()===email.toLowerCase());
  if(user){
    user.codeHash = codeHash; user.role = 'Lead DSL'; user.active = true; user.email = email; user.updatedAt = new Date().toISOString();
  } else {
    user = { id: 'u_' + require('crypto').randomBytes(8).toString('hex'), firstName:email.split('@')[0], lastName:'', role:'Lead DSL', codeHash, active:true, email, createdAt:new Date().toISOString(), lastLogin:null };
    users.push(user);
  }
  ds.saveUsers(users);

  // send email with code
  try{
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT||'587',10),
      secure: (process.env.SMTP_SECURE==='true'),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const info = await transporter.sendMail({ from: process.env.SMTP_USER, to: email, subject: 'Your admin access code', text: `Your admin access code: ${code}\n\nUse this code to sign into the Safeguarding app.` });
  }catch(e){
    // do not expose SMTP errors
    console.error('email send failed', e && e.message);
  }

  return res.json({ ok:true, message:'If the email exists you will receive an access code shortly.' });
};
