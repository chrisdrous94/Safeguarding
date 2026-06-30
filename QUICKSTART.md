# Quick Start Guide

## For Administrators

### Setup (First Time)

1. **Create `.env` file** in the project root:
   ```
   ADMIN_CODE=ADMIN1234
   PORT=3000
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open browser:**
   - Go to `http://localhost:3000`
   - You should see the auth overlay

5. **Sign in with Admin Code:**
   - Enter your `ADMIN_CODE` (e.g., `ADMIN1234`)
   - Click "Access platform"
   - You're now logged in as System Admin

6. **Create users:**
   - Go to "Users" section in sidebar
   - Click "Create user"
   - Enter name and role
   - System auto-generates access codes
   - Share codes with staff securely

### Email Setup (Optional)

To enable email-based access code requests:

1. **Edit `.env` and add:**
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

2. **For Gmail (most common):**
   - Enable 2-Factor Authentication in Google Account
   - Go to: https://myaccount.google.com/apppasswords
   - Generate an app password for "Mail" and "Windows"
   - Copy the password to `SMTP_PASS`

3. **Test email:**
   - Sign out
   - Click "Email request" tab
   - Enter a test email
   - Check inbox for access code

4. **Restart server:**
   ```bash
   npm start
   ```

---

## For Staff/Teachers

### Getting Started

1. **First Time?** (No access code yet)
   - Go to `http://localhost:3000`
   - Click "Email request" tab
   - Enter your school email
   - Click "Send access code"
   - Check your inbox (1-5 minutes)
   - Copy the code

2. **Sign In**
   - Back at the login screen
   - Click "Access code" tab (or it's default)
   - Paste your access code
   - Click "Access platform"
   - Done! You're in

3. **Sign Out**
   - Click "Sign out" button
   - (Sidebar on desktop, topbar on mobile)
   - You'll be logged out

### Using the Platform

**Main Views:**
- **Dashboard** - Overview of all safeguarding concerns
- **Concerns** - Manage individual cases
- **Students** - View student profiles and flags
- **Actions** - Track outstanding tasks
- **Analytics** - View trends and patterns

**Reporting a Concern:**
- Green "+ Report a concern" button
- Fill in the form with case details
- Concerns are immediately visible to DSL
- You can track status in real-time

---

## For Developers

### Project Structure

```
safeguarding/
├── server.js              # Express server, all routes
├── index.html             # Single-page app (frontend)
├── data-store.js          # User & data persistence
├── package.json           # Dependencies
├── .env                   # Configuration (not in git)
├── users.json             # User database
├── api/                   # API modules (legacy, integrated to server.js now)
│   ├── login.js
│   └── verify-email.js
└── SIGNIN_IMPROVEMENTS.md # This documentation
```

### Key Files Modified

**index.html** (Frontend)
- New auth overlay with two tabs
- `authSetMode()` - Mode switching
- `authShowMessage()` - Error/success display
- `doCodeLogin()` - Improved code login
- `doEmailRequest()` - New email request
- `signOut()` - Complete logout

**server.js** (Backend)
- `/api/login` - Enhanced with better errors
- `/api/verify-email` - NEW endpoint for email codes
- Improved error messages and security

### Authentication Flow

```
User Opens App
    ↓
checkSavedAuth() - Check localStorage
    ├─ Valid session? → Go to dashboard
    └─ No session? → Show auth overlay
         ↓
   User chooses mode
         ↓
    ┌────────────────────────────┐
    │                            │
  Code Mode                Email Mode
    │                            │
    ↓                            ↓
Enter code               Enter email
    │                            │
    ↓                            ↓
POST /api/login          POST /api/verify-email
    │                            │
    ↓                            ↓
Valid? → persistSession()  Email sent → Show message
    │                            │
    ↓                            ↓
Go to dashboard           User checks email
                          Gets new code
                          Signs in via code mode
```

### Session Storage

Session data in localStorage:
```json
{
  "ics_auth": "{\"name\":\"John Doe\",\"role\":\"Lead DSL\",\"userId\":\"u_abc123\",\"expires\":\"2026-07-01T10:00:00Z\"}"
}
```

- Expires after 8 hours
- Auto-restored on page load
- Fully cleared on sign out

### Environment Variables

```bash
# Required
ADMIN_CODE=YOUR_ADMIN_CODE_HERE

# Optional
PORT=3000

# For email functionality
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Running Tests

See `TESTING_CHECKLIST.md` for comprehensive testing guide.

Quick test:
```bash
npm start
# Open http://localhost:3000
# Try signing in with admin code
```

---

## Troubleshooting

### Server won't start
```bash
# Check Node version
node --version  # Should be v14+

# Check port in use
# Change PORT in .env to another port (e.g., 8000)

# Clear node_modules and reinstall
rm -rf node_modules
npm install
npm start
```

### Sign-in fails
```
1. Check admin code is correct in .env
2. Check server logs for errors
3. Clear browser cache (Ctrl+Shift+Delete)
4. Try incognito mode
```

### Email not working
```
1. Check SMTP credentials in .env
2. Verify email address format
3. Check spam folder
4. Check server logs: grep "email" *.log
```

### Lost access codes
```
# Edit users.json and set a new code hash
# OR
1. Get your email via email request mode
2. Use the new code to sign in
```

---

## Common Tasks

### Create New Admin User (via API)
```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_CODE" \
  -d '{
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "Lead DSL"
  }'
```

### Get All Users
```bash
curl http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer YOUR_ADMIN_CODE"
```

### Reset User Code
```bash
curl -X POST http://localhost:3000/api/admin/users/u_abc123/reset-code \
  -H "Authorization: Bearer YOUR_ADMIN_CODE"
```

---

## Performance Tips

- **Production:** Use a process manager (pm2, systemd)
- **Scaling:** Add load balancer, multiple instances
- **Database:** Consider moving from JSON to proper DB
- **Caching:** Add Redis for session store
- **Monitoring:** Set up error tracking (Sentry, LogRocket)

---

## Security Checklist

- [ ] Use HTTPS in production
- [ ] Set strong `ADMIN_CODE`
- [ ] Keep `.env` out of version control
- [ ] Use environment variables, not hardcoded values
- [ ] Regular database backups
- [ ] Monitor for suspicious login attempts
- [ ] Keep dependencies updated
- [ ] Rate limit API endpoints
- [ ] Sanitize all user inputs
- [ ] Use secure session storage

---

## Support

**Documentation:**
- [SIGNIN_IMPROVEMENTS.md](./SIGNIN_IMPROVEMENTS.md) - Full feature guide
- [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md) - Testing procedures

**Resources:**
- Express.js: https://expressjs.com
- Nodemailer: https://nodemailer.com
- Tailwind CSS: https://tailwindcss.com

**Contact:**
- For bugs: Check GitHub issues
- For features: Create a GitHub discussion
- For urgent issues: Contact support team

---

**Last Updated:** 2026-06-30
**Version:** 2.0
