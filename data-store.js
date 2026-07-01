const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'users.json');
const ALGO = 'aes-256-gcm';

function getKey(){
  const k = process.env.DATA_KEY || '';
  if(!k) return null;
  // If user provided a base64 32-byte key, accept it; else derive from passphrase
  if(k.length===44 && k.endsWith('=')) return Buffer.from(k,'base64');
  return crypto.createHash('sha256').update(k).digest();
}

function encryptObj(obj){
  const key = getKey();
  const data = Buffer.from(JSON.stringify(obj),'utf8');
  if(!key) return JSON.stringify(obj);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({v:1, iv:iv.toString('base64'), tag:tag.toString('base64'), data:enc.toString('base64')});
}

function decryptObj(raw){
  const key = getKey();
  try{
    const parsed = JSON.parse(raw);
    if(!key || !parsed || !parsed.v) return parsed;
    const iv = Buffer.from(parsed.iv,'base64');
    const tag = Buffer.from(parsed.tag,'base64');
    const enc = Buffer.from(parsed.data,'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  }catch(e){
    try{ return JSON.parse(raw); }catch(e2){ return [] }
  }
}

function loadUsers(){
  try{
    if(!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE,'utf8');
    return decryptObj(raw) || [];
  }catch(e){ return []; }
}

function saveUsers(users){
  try{
    const out = encryptObj(users);
    fs.writeFileSync(USERS_FILE, out, 'utf8');
    return true;
  }catch(e){ return false; }
}

function genAccessCode(len=14){
  const upper='ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower='abcdefghijkmnopqrstuvwxyz';
  const digits='23456789';
  const symbols='!@#$%^&*_-+=';
  const all=upper+lower+digits+symbols;
  const size=Math.max(12, len||14);
  const pick=(chars)=> chars[Math.floor(Math.random()*chars.length)];
  const out=[pick(upper), pick(lower), pick(digits), pick(symbols)];
  for(let i=out.length;i<size;i++) out.push(pick(all));
  for(let i=out.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    const t=out[i]; out[i]=out[j]; out[j]=t;
  }
  return out.join('');
}

function hashCode(code){ return bcrypt.hashSync(code, 10); }
function compareCode(code, hash){ try{ return bcrypt.compareSync(code, hash); }catch(e){ return false; } }

module.exports = { loadUsers, saveUsers, genAccessCode, hashCode, compareCode };
