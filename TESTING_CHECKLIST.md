# Sign-In System Testing Checklist

## Pre-Deployment

### Environment Setup
- [ ] `.env` file exists with `ADMIN_CODE` set
- [ ] `PORT` is set (default: 3000)
- [ ] SMTP credentials configured (optional, for email feature)
- [ ] `npm install` completed successfully
- [ ] `npm start` runs without errors

### Server Startup
- [ ] Server starts and displays welcome message
- [ ] Admin code status shows in startup message
- [ ] Server accessible at `http://localhost:3000`

---

## Frontend Testing

### Initial Load
- [ ] Auth overlay appears on first load
- [ ] Logo and title display correctly
- [ ] Two tabs visible: "Access code" and "Email request"
- [ ] "Access code" tab is selected by default
- [ ] Focus automatically on code input

### Access Code Mode

#### Basic Flow
- [ ] User can type access code (letters + numbers)
- [ ] Input auto-converts to uppercase
- [ ] Character count updates in real-time
- [ ] Max length enforced (12 characters)
- [ ] Pressing Enter submits the form

#### Valid Code Entry
- [ ] Entering valid code → "Verifying..." state
- [ ] Button disabled during verification
- [ ] Success message appears with user's name
- [ ] UI fades to dashboard after 800ms
- [ ] User logged in and navigating to dashboard

#### Invalid Code Entry
- [ ] Entering invalid code → Error message appears
- [ ] Error message is user-friendly
- [ ] Button re-enables after error
- [ ] Input remains focused for retry
- [ ] Can clear and try again

#### Validation Errors
- [ ] Empty code → "Please enter your access code" warning
- [ ] Too short (< 6 chars) → "Must be at least 6 characters" warning
- [ ] Special characters → Automatically stripped
- [ ] Very long input → Limited to 12 chars

#### Network Issues
- [ ] Offline → "Network error" message
- [ ] Server down → "Server unavailable" message
- [ ] Timeout → "Network error" with retry option

### Email Request Mode

#### Tab Switching
- [ ] Clicking "Email request" switches to email tab
- [ ] Tab button styling updates (brand color)
- [ ] Email input receives focus
- [ ] Code mode input clears on switch
- [ ] Can switch back to code mode

#### Basic Flow
- [ ] Email input accepts text
- [ ] Valid email format required
- [ ] Clicking "Send access code" shows loading
- [ ] Button disabled during sending
- [ ] Success message: "Check your email inbox..."

#### Validation
- [ ] Empty email → "Please enter your school email" warning
- [ ] Invalid format → "Please enter a valid email address" warning
- [ ] Input clears after successful send
- [ ] Focus remains on input for retry

#### Email Delivery (if SMTP configured)
- [ ] Email arrives within 5 minutes
- [ ] Email contains the access code
- [ ] Email format is professional
- [ ] Code in email works for login
- [ ] Multiple codes overwrite old ones

### Session Management

#### First Time Login
- [ ] After successful login, overlay fades
- [ ] Dashboard loads automatically
- [ ] User name displays in top-right
- [ ] User initials show in avatar
- [ ] Role displayed correctly

#### Page Reload
- [ ] Session persists on page reload
- [ ] No auth overlay appears
- [ ] Dashboard loads immediately
- [ ] User info is still visible

#### Sign Out
- [ ] Sign out button accessible (sidebar or topbar)
- [ ] Clicking sign out shows confirmation or immediate logout
- [ ] Auth overlay reappears
- [ ] All session data cleared
- [ ] Code input is empty
- [ ] Email input is empty
- [ ] Focus on code input for accessibility

#### Session Expiration
- [ ] Sessions last 8 hours
- [ ] After 8 hours, requires re-login
- [ ] Expired session doesn't break app
- [ ] User must sign in again

---

## Accessibility Testing

### Keyboard Navigation
- [ ] Tab key moves through form inputs
- [ ] Tab moves through tabs
- [ ] Enter key submits the form
- [ ] Error messages announced to screen readers

### Screen Reader (NVDA/JAWS)
- [ ] Auth overlay is readable
- [ ] Tab labels announce properly
- [ ] Input labels are associated
- [ ] Error messages are announced
- [ ] Button state changes announced
- [ ] Success messages announced

### Visual
- [ ] Text has sufficient contrast (WCAG AA)
- [ ] Error text is not color-only
- [ ] Focus indicators visible
- [ ] Mobile layout is readable

---

## Mobile Testing

### Responsive Layout
- [ ] Auth overlay centered on phone
- [ ] Inputs are touch-friendly (44px minimum)
- [ ] Text size is readable
- [ ] Buttons have appropriate spacing
- [ ] No horizontal scrolling needed

### Touch Input
- [ ] Code input accepts touch keyboard
- [ ] Uppercase auto-conversion works
- [ ] Submit button tappable
- [ ] Tab switching works on touch
- [ ] Mobile keyboard closes after submit

### iOS Specific
- [ ] Page zoom works
- [ ] Autocomplete doesn't interfere
- [ ] Notch doesn't cover content
- [ ] Safe area respected

### Android Specific
- [ ] Keyboard doesn't overlap buttons
- [ ] Back button handled properly
- [ ] Orientation change handled

---

## Security Testing

### Input Validation
- [ ] SQL injection attempts blocked
- [ ] XSS attempts blocked
- [ ] Code injection attempts blocked
- [ ] Very long inputs handled
- [ ] Special characters sanitized

### Session Security
- [ ] Session stored in localStorage (encrypted data)
- [ ] No sensitive data in URL
- [ ] No passwords stored anywhere
- [ ] HTTPS recommended (in production)
- [ ] Cross-origin requests handled

### Error Messages
- [ ] No system paths exposed
- [ ] No database information leaked
- [ ] No user enumeration possible
- [ ] Generic messages for sensitive errors

---

## Performance Testing

### Load Time
- [ ] Auth overlay appears instantly
- [ ] Font loads without FOUT
- [ ] Interactive within 2 seconds
- [ ] No janky animations

### Responsiveness
- [ ] Code input never freezes
- [ ] Buttons respond immediately to clicks
- [ ] No delay in character count update
- [ ] Animations are smooth (60fps)

### Network
- [ ] Login request < 1 second (normal network)
- [ ] Email send response < 2 seconds
- [ ] Handles slow networks gracefully
- [ ] Timeout after 10 seconds

---

## Browser Compatibility

### Chrome/Edge
- [ ] Auth overlay displays correctly
- [ ] All features work
- [ ] No console errors
- [ ] Mobile responsive

### Firefox
- [ ] Auth overlay displays correctly
- [ ] All features work
- [ ] No console errors
- [ ] Mobile responsive

### Safari
- [ ] Auth overlay displays correctly
- [ ] All features work
- [ ] No console errors
- [ ] iOS responsive

### Mobile Browsers
- [ ] Chrome Mobile ✓
- [ ] Safari Mobile ✓
- [ ] Firefox Mobile ✓

---

## Email Functionality (Optional)

### SMTP Configuration
- [ ] SMTP_HOST is valid
- [ ] SMTP_PORT is correct (usually 587)
- [ ] SMTP_SECURE matches port (false for 587)
- [ ] SMTP_USER is valid email
- [ ] SMTP_PASS is correct

### Gmail Setup (if using Gmail)
- [ ] Gmail account has 2FA enabled
- [ ] App-specific password generated
- [ ] App password used in SMTP_PASS
- [ ] "Less secure apps" not needed (using app password)

### Email Testing
- [ ] Test email sends without errors
- [ ] Email arrives in inbox (not spam)
- [ ] Email format is readable
- [ ] Code in email is correct
- [ ] Email uses provided template
- [ ] Multiple emails overwrite previous codes

---

## Error Scenarios

### Simulate Failures
- [ ] Kill server while user logs in
- [ ] Disconnect network
- [ ] Provide invalid SMTP config
- [ ] Use invalid code multiple times
- [ ] Try code case variations

### Expected Behavior
- [ ] Graceful error message in all cases
- [ ] User can retry
- [ ] No app crashes
- [ ] Console shows helpful errors
- [ ] No sensitive data exposed

---

## Deployment Checklist

### Before Going Live
- [ ] All tests pass
- [ ] No console errors
- [ ] `.env` is configured
- [ ] SMTP is working (if enabled)
- [ ] Users have admin codes assigned
- [ ] Support documentation updated
- [ ] Server has sufficient resources
- [ ] Database backups enabled
- [ ] Monitoring/logging enabled

### Post-Deployment
- [ ] Monitor error logs
- [ ] Test first few logins manually
- [ ] Collect user feedback
- [ ] Fix any issues immediately
- [ ] Document any workarounds
- [ ] Update support docs as needed

---

**Last Updated:** 2026-06-30
**Checklist Version:** 1.0
