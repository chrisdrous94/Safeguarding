# Sign-In Process Improvements

## Overview
The sign-in process has been completely redesigned to be more intuitive, user-friendly, and secure. Users now have two convenient options for accessing the platform.

---

## Key Improvements

### 1. **Dual Login Methods**
Users can now choose between two authentication methods:

#### Method A: Direct Access Code
- Users with an existing code can sign in immediately
- Quick and efficient for regular users
- Code entry box with live character count
- Visual feedback during validation

#### Method B: Email Request
- Teachers and staff without a code can request one via email
- Click "Email request" tab to switch modes
- System automatically generates and emails a code
- Code arrives within minutes (requires SMTP configuration)
- Email-based flow for self-service access

### 2. **Enhanced User Experience**

✅ **Clearer Visual Design**
- Modern gradient background
- Two-tab interface for easy mode switching
- Responsive layout that works on all devices
- Improved typography and spacing

✅ **Real-Time Feedback**
- Error messages appear instantly
- Character count shows in real-time
- Loading states during authentication
- Success messages with user's first name
- Color-coded messages (success/error/warning/info)

✅ **Better Accessibility**
- Proper ARIA labels for form inputs
- Focus management for keyboard navigation
- Semantic HTML structure
- High contrast colors for readability
- Form submission with Enter key

✅ **Improved Error Messaging**
- Friendly, non-technical error messages
- Specific guidance for each error type
- Links to contact DSL for help
- Security-conscious generic messages (no user enumeration)

✅ **Session Management**
- Persistent sessions with 8-hour expiration
- Automatic session restoration on page reload
- Clear logout that removes all session data
- Session data stored securely in localStorage

---

## Frontend Changes (`index.html`)

### Auth Overlay Redesign
```html
- Two-tab interface: "Access code" and "Email request"
- Real-time validation with character counter
- Error/success message containers
- Loading state indicators on buttons
- Helpful guidance text
```

### New Authentication Functions

#### `authSetMode(mode)`
- Switches between 'code' and 'email' tabs
- Manages visual state of buttons
- Sets focus appropriately
- Updates ARIA attributes

#### `authShowMessage(mode, message, type)`
- Displays typed feedback messages
- Color-coded by type (success/error/warning/info)
- Auto-hides success messages after 5 seconds
- Shows appropriate icons

#### `doCodeLogin()`
- Enhanced with better validation
- Shows loading state during authentication
- Displays friendly error messages
- Auto-focuses input on error
- Handles network errors gracefully

#### `doEmailRequest()`
- New function for email-based access
- Validates email format
- Shows loading state
- Privacy-respecting response (always positive)
- Clears input on success

#### `signOut()`
- Completely clears session data
- Resets auth inputs
- Clears error messages
- Shows auth overlay properly
- Resets to 'code' mode
- Returns focus for accessibility

### Improved Session Functions
- `checkSavedAuth()` - Validates session on page load
- `persistSession()` - Saves auth securely
- `loadPrefs()` - Restores user preferences

---

## Backend Changes (`server.js`)

### Enhanced Login Endpoint
```
POST /api/login

Improvements:
- Better error messages
- Generic error for security (no user enumeration)
- Graceful handling of inactive codes
- Last login timestamp tracking
- Input validation and sanitization
```

### New Email Request Endpoint
```
POST /api/verify-email

Features:
- Email validation
- Automatic user creation if needed
- Access code generation
- Email delivery (SMTP-dependent)
- Privacy-respecting responses
- Comprehensive error handling
- 24-hour code validity

Requires Environment Variables:
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE (true/false)
- SMTP_USER
- SMTP_PASS
```

### Security Improvements
- No user enumeration attacks possible
- Email delivery errors don't expose system info
- Rate limiting ready (future enhancement)
- Input sanitization on all fields
- Secure error messages

---

## Setup Instructions

### Prerequisites
1. Node.js and npm installed
2. `.env` file configured with:
   ```
   ADMIN_CODE=YOUR_ADMIN_CODE_HERE
   PORT=3000
   
   # For email functionality (optional)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

### Running the Server
```bash
npm install
npm start
```

Server runs at: `http://localhost:3000`

### Creating Your First Admin Code
1. Set `ADMIN_CODE` in `.env`
2. Sign in with that code
3. Code creates a "System Admin" user

### Testing Email Functionality
1. Configure SMTP credentials in `.env`
2. Click "Email request" tab
3. Enter your email and click "Send access code"
4. Check your inbox (and spam folder)
5. Use the code received to sign in

---

## User Flows

### First-Time User (No Code)
1. Open app → Auth overlay appears
2. Click "Email request" tab
3. Enter school email
4. Click "Send access code"
5. Check email for access code (1-5 minutes)
6. Return to app, click "Access code" tab
7. Enter code received by email
8. Success! Logged in

### Existing User (Has Code)
1. Open app → Auth overlay appears
2. Enter your access code
3. Click "Access platform" or press Enter
4. Success! Logged in with restored session

### Returning User (Valid Session)
1. Open app
2. Auth overlay briefly appears then disappears
3. Dashboard loads automatically
4. Ready to use platform

### Signing Out
1. Click "Sign out" button (sidebar or topbar)
2. Auth overlay reappears
3. All session data cleared
4. Must re-authenticate to continue

---

## Browser Support

✅ Chrome/Edge (latest 2 versions)
✅ Firefox (latest 2 versions)
✅ Safari (latest 2 versions)
✅ Mobile browsers (iOS Safari, Chrome Mobile)

---

## Troubleshooting

### "Server unavailable" Error
- Make sure server is running: `npm start`
- Check URL is `http://localhost:3000` (not `file://`)
- Check browser console for network errors

### Didn't receive email code
- Check spam/junk folder
- Verify SMTP credentials in `.env`
- Check server logs for email errors
- Wait 5 minutes (email can be slow)

### Can't remember access code
- Click "Email request" tab
- Enter email to receive new code
- Old codes remain valid for existing sessions

### Stuck on login screen
- Try clearing browser cache: Ctrl+Shift+Delete
- Check localStorage: `localStorage.clear()`
- Sign out and sign back in

---

## Future Enhancements

Possible improvements for future versions:
- Rate limiting on login attempts
- SMS-based code delivery option
- QR code generation for easy code sharing
- Biometric authentication (fingerprint/face)
- Single sign-on (SSO) integration
- Two-factor authentication (2FA)
- Password reset flow
- Session timeout warnings

---

## Support

For issues or questions:
1. Check this document
2. Review console errors (F12 → Console tab)
3. Contact your IT department
4. Reach out to your Designated Safeguarding Lead (DSL)

---

**Last Updated:** 2026-06-30
**Version:** 2.0
