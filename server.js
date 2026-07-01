'use strict';
require('dotenv').config();

const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const ds      = require('./data-store');

const app = express();

// Basic CORS support for hosted frontends (e.g., GitHub Pages -> Render API)
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || '*').trim();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname)));

// ── Validation & Constants ───────────────────────────────────────────────────
const VALID_ROLES = ['Teacher','Pastoral Lead','Deputy DSL','Lead DSL','Senior Leadership'];
const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 24;
const NAME_MAX_LENGTH = 100;

// ── Response helpers ─────────────────────────────────────────────────────────
const ApiError = (status, message) => ({ status, body: { ok: false, error: message } });

function validateString(value, min = 1, max = NAME_MAX_LENGTH) {
  if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    return { valid: false, error: `Must be ${min}-${max} characters` };
  }
  return { valid: true, value: trimmed };
}

function validateCode(value) {
  if (typeof value !== 'string') return { valid: false, error: 'Access code must be a string' };
  const trimmed = value.trim();
  if (trimmed.length < CODE_MIN_LENGTH || trimmed.length > CODE_MAX_LENGTH) {
    return { valid: false, error: `Access code must be ${CODE_MIN_LENGTH}-${CODE_MAX_LENGTH} characters` };
  }
  if (/[\s]/.test(trimmed)) {
    return { valid: false, error: 'Access code cannot contain spaces' };
  }
  if (!/^[\x21-\x7E]+$/.test(trimmed)) {
    return { valid: false, error: 'Access code contains invalid characters' };
  }
  return { valid: true, value: trimmed };
}

function validateRole(value) {
  if (!VALID_ROLES.includes(value)) {
    return { valid: false, error: `Role must be one of: ${VALID_ROLES.join(', ')}` };
  }
  return { valid: true, value };
}

// Use data-store for persistent encrypted users and code helpers
// functions available: ds.loadUsers(), ds.saveUsers(users), ds.genAccessCode(), ds.hashCode(), ds.compareCode()

// ── Admin auth middleware ─────────────────────────────────────────────────────
const ADMIN_CODE = (process.env.ADMIN_CODE || '').toUpperCase().trim();

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Missing or invalid authorization header. Expected: Authorization: Bearer <code>'
    });
  }

  const code = authHeader.slice(7).trim();

  if (!code) {
    return res.status(401).json({
      ok: false,
      error: 'Access code cannot be empty'
    });
  }

  // Master admin from environment
  if (ADMIN_CODE && (code === ADMIN_CODE || code.toUpperCase() === ADMIN_CODE)) {
    req.adminUser = { id: '__admin__', firstName: 'System', lastName: 'Admin', role: 'Lead DSL' };
    return next();
  }

  // Check authorized users
  const users = ds.loadUsers();
  const user = users.find(u => u.codeHash && ds.compareCode(code, u.codeHash) && u.active);
  if (!user) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid access code or insufficient permissions'
    });
  }

  if (!['Lead DSL', 'Senior Leadership'].includes(user.role)) {
    return res.status(403).json({
      ok: false,
      error: 'Insufficient permissions for this operation'
    });
  }

  req.adminUser = user;
  next();
}

// ── POST /api/login ───────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      error: 'Invalid request'
    });
  }

  const { code } = req.body;
  const validation = validateCode(code);

  if (!validation.valid) {
    return res.status(400).json({
      ok: false,
      error: validation.error
    });
  }

  const normalizedCode = validation.value;

  // Check master admin code first
  if (ADMIN_CODE && (normalizedCode === ADMIN_CODE || normalizedCode.toUpperCase() === ADMIN_CODE)) {
    return res.json({
      ok: true,
      user: {
        id: '__admin__',
        firstName: 'System',
        lastName: 'Admin',
        role: 'Lead DSL'
      }
    });
  }

  // Check user database
  const users = ds.loadUsers();
  const user = users.find(u => u.codeHash && ds.compareCode(normalizedCode, u.codeHash));

  if (!user) {
    // Return generic message for security
    return res.status(401).json({
      ok: false,
      error: 'Access code not recognized. Check your code and try again.'
    });
  }

  if (!user.active) {
    return res.status(403).json({
      ok: false,
      error: 'This access code has been deactivated. Please contact your safeguarding team.'
    });
  }

  // Update last login
  user.lastLogin = new Date().toISOString();
  ds.saveUsers(users);

  res.json({
    ok: true,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    }
  });
});

// Email-based code issuance is intentionally disabled.
app.post('/api/verify-email', (_req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Email access code request has been disabled. Contact the DSL team for a secure code.'
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  const users = ds.loadUsers().map(u => ({
    ...u,
    code: undefined,
    codeHash: undefined
  }));

  res.json({
    ok: true,
    count: users.length,
    users
  });
});

// ── POST /api/admin/users  (create) ──────────────────────────────────────────
app.post('/api/admin/users', requireAdmin, (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      error: 'Invalid request body'
    });
  }

  const { firstName, lastName, role } = req.body;

  // Validate firstName
  const firstNameValidation = validateString(firstName, 1, NAME_MAX_LENGTH);
  if (!firstNameValidation.valid) {
    return res.status(400).json({
      ok: false,
      error: `First name: ${firstNameValidation.error}`
    });
  }

  // Validate lastName
  const lastNameValidation = validateString(lastName, 1, NAME_MAX_LENGTH);
  if (!lastNameValidation.valid) {
    return res.status(400).json({
      ok: false,
      error: `Last name: ${lastNameValidation.error}`
    });
  }

  // Validate role
  const roleValidation = validateRole(role);
  if (!roleValidation.valid) {
    return res.status(400).json({
      ok: false,
      error: roleValidation.error
    });
  }

  const users = ds.loadUsers();
  const newUser = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    firstName: firstNameValidation.value,
    lastName: lastNameValidation.value,
    role: roleValidation.value,
    // create and store hashed code
    codeHash: ds.hashCode(ds.genAccessCode()),
    active: true,
    createdAt: new Date().toISOString(),
    lastLogin: null
  };

  users.push(newUser);
  ds.saveUsers(users);

  res.status(201).json({
    ok: true,
    user: newUser
  });
});

// ── PUT /api/admin/users/:id  (edit name / role) ─────────────────────────────
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      error: 'Invalid request body'
    });
  }

  const users = ds.loadUsers();
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      ok: false,
      error: 'User not found'
    });
  }

  const { firstName, lastName, role } = req.body;

  // Validate and update firstName if provided
  if (firstName !== undefined) {
    const validation = validateString(firstName, 1, NAME_MAX_LENGTH);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: `First name: ${validation.error}`
      });
    }
    user.firstName = validation.value;
  }

  // Validate and update lastName if provided
  if (lastName !== undefined) {
    const validation = validateString(lastName, 1, NAME_MAX_LENGTH);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: `Last name: ${validation.error}`
      });
    }
    user.lastName = validation.value;
  }

  // Validate and update role if provided
  if (role !== undefined) {
    const validation = validateRole(role);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: validation.error
      });
    }
    user.role = validation.value;
  }

  ds.saveUsers(users);
  res.json({ ok: true, user: { ...user, code: undefined, codeHash: undefined } });
});

// ── POST /api/admin/users/:id/regenerate  (new code) ─────────────────────────
app.post('/api/admin/users/:id/regenerate', requireAdmin, (req, res) => {
  const users = ds.loadUsers();
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      ok: false,
      error: 'User not found'
    });
  }

  const newCode = ds.genAccessCode();
  user.codeHash = ds.hashCode(newCode);
  ds.saveUsers(users);

  res.json({ ok: true, code: newCode });
});

// ── POST /api/admin/users/:id/toggle  (grant / revoke) ───────────────────────
app.post('/api/admin/users/:id/toggle', requireAdmin, (req, res) => {
  const users = ds.loadUsers();
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      ok: false,
      error: 'User not found'
    });
  }

  user.active = !user.active;
  ds.saveUsers(users);

  res.json({
    ok: true,
    active: user.active,
    message: user.active ? 'Access granted' : 'Access revoked'
  });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  let users = ds.loadUsers();
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      ok: false,
      error: 'User not found'
    });
  }

  users = users.filter(u => u.id !== req.params.id);
  ds.saveUsers(users);

  res.json({
    ok: true,
    message: 'User deleted successfully'
  });
});

// ── Serve index.html for all other routes ────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  const hasAdmin = !!ADMIN_CODE;
  console.log('\n  ┌─────────────────────────────────────────────────┐');
  console.log('  │   I CAN School · Safeguarding Platform          │');
  console.log('  ├─────────────────────────────────────────────────┤');
  console.log(`  │   Server   →  http://localhost:${PORT}${' '.repeat(Math.max(0, 15 - String(PORT).length))}│`);
  console.log(`  │   Admin    →  ${hasAdmin ? '✅ Configured in .env' : '⚠️  Not configured'}${' '.repeat(Math.max(0, 25 - (hasAdmin ? 20 : 15)))}│`);
  console.log('  └─────────────────────────────────────────────────┘\n');
});
