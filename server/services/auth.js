const crypto = require('crypto');

const COOKIE_NAME = 'psi_dash_auth';
const DEFAULT_ALLOWED_DOMAIN = 'psiengines.com';
const DEFAULT_SESSION_HOURS = 12;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function getAllowedDomain() {
  return String(process.env.AUTH_ALLOWED_DOMAIN || DEFAULT_ALLOWED_DOMAIN).trim().toLowerCase();
}

function getSharedPassword() {
  return String(process.env.AUTH_SHARED_PASSWORD || '');
}

function getSessionSecret() {
  return String(process.env.AUTH_SESSION_SECRET || '');
}

function getSessionTtlSeconds() {
  const rawHours = Number(process.env.AUTH_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  const hours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 60 * 60);
}

function isAuthEnabled() {
  return normalizeBoolean(process.env.AUTH_ENABLED, isProduction());
}

function isAuthConfigured() {
  if (!isAuthEnabled()) return true;
  return Boolean(getSharedPassword() && getSessionSecret());
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  const allowedDomain = getAllowedDomain();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.endsWith(`@${allowedDomain}`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function timingSafeMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateSharedPassword(candidate) {
  return timingSafeMatch(candidate, getSharedPassword());
}

function parseCookies(cookieHeader = '') {
  const result = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function signValue(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function encodeSession(payload) {
  const base = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${base}.${signValue(base)}`;
}

function decodeSession(token) {
  if (!token || !getSessionSecret()) return null;
  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex <= 0) return null;

  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  const expectedSignature = signValue(payloadPart);

  if (!timingSafeMatch(signaturePart, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.email || !payload.exp) return null;
    if (Date.now() >= Number(payload.exp)) return null;
    if (!isAllowedEmail(payload.email)) return null;

    return {
      email: normalizeEmail(payload.email),
      exp: Number(payload.exp),
      iat: Number(payload.iat) || 0,
    };
  } catch (error) {
    return null;
  }
}

function getSessionUser(req) {
  if (!isAuthEnabled() || !isAuthConfigured()) return null;
  const cookies = parseCookies(req.headers.cookie || '');
  return decodeSession(cookies[COOKIE_NAME]);
}

function buildCookieParts(value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds || 0))}`,
  ];

  if (isProduction()) {
    parts.push('Secure');
  }

  return parts;
}

function setAuthCookie(res, email) {
  const ttlSeconds = getSessionTtlSeconds();
  const now = Date.now();
  const token = encodeSession({
    email: normalizeEmail(email),
    iat: now,
    exp: now + (ttlSeconds * 1000),
  });

  res.setHeader('Set-Cookie', buildCookieParts(token, ttlSeconds).join('; '));
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', buildCookieParts('', 0).join('; '));
}

function getSafeRedirectPath(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('/') || text.startsWith('//')) return '/';
  if (text.startsWith('/login')) return '/';
  return text;
}

function getAuthState(req) {
  const enabled = isAuthEnabled();
  const configured = isAuthConfigured();
  const user = enabled && configured ? getSessionUser(req) : null;

  return {
    enabled,
    configured,
    authenticated: enabled ? Boolean(user) : true,
    allowedDomain: getAllowedDomain(),
    user: user ? { email: user.email } : null,
  };
}

function renderLoginPage({ nextPath = '/', errorMessage = '', statusCode = 200 } = {}) {
  const enabled = isAuthEnabled();
  const configured = isAuthConfigured();
  const allowedDomain = getAllowedDomain();
  const heading = enabled
    ? 'PSI Dashboard Access'
    : 'Authentication Disabled';
  const subheading = enabled
    ? `Use your @${allowedDomain} email and the shared access password to continue.`
    : 'Authentication is turned off for this environment.';
  const setupMessage = enabled && !configured
    ? 'Authentication is enabled, but the shared password or session secret is not configured yet.'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PSI Dashboard Access</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f1f5f9;
      --panel: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #dbe2ea;
      --primary: #2563eb;
      --danger-bg: #fef2f2;
      --danger-text: #991b1b;
      --danger-border: #fecaca;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      background: linear-gradient(180deg, #eff6ff 0%, var(--bg) 100%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .panel {
      width: min(100%, 440px);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.12);
      padding: 28px;
    }
    .eyebrow {
      display: inline-flex;
      padding: 4px 10px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    form { display: grid; gap: 14px; }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    input {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 14px;
      color: var(--text);
    }
    input:focus {
      outline: 2px solid rgba(37, 99, 235, 0.16);
      border-color: var(--primary);
    }
    button {
      border: 0;
      border-radius: 10px;
      background: var(--primary);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 14px;
      cursor: pointer;
    }
    button[disabled] {
      opacity: 0.55;
      cursor: default;
    }
    .notice {
      display: none;
      margin-bottom: 16px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--danger-border);
      background: var(--danger-bg);
      color: var(--danger-text);
      font-size: 14px;
      font-weight: 800;
      line-height: 1.45;
    }
    .notice.show { display: block; }
  </style>
</head>
<body>
  <main class="panel">
    <div class="eyebrow">Restricted Access</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(subheading)}</p>
    <div id="login-notice" class="notice${errorMessage || setupMessage ? ' show' : ''}">${escapeHtml(errorMessage || setupMessage)}</div>
    <form id="login-form"${enabled && configured ? '' : ' style="display:none"'} novalidate>
      <input type="hidden" name="next" value="${escapeHtml(getSafeRedirectPath(nextPath))}">
      <label>
        Email
        <input type="email" name="email" placeholder="name@${escapeHtml(allowedDomain)}" autocomplete="username" required>
      </label>
      <label>
        Access Password
        <input type="password" name="password" placeholder="Shared access password" autocomplete="current-password" required>
      </label>
      <button id="login-button" type="submit">Enter Dashboard</button>
    </form>
  </main>
  <script>
    (function () {
      var form = document.getElementById('login-form');
      if (!form) return;

      var button = document.getElementById('login-button');
      var notice = document.getElementById('login-notice');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        button.disabled = true;
        notice.textContent = '';
        notice.classList.remove('show');

        var formData = new FormData(form);
        var payload = {
          email: String(formData.get('email') || ''),
          password: String(formData.get('password') || ''),
          next: String(formData.get('next') || '/')
        };

        try {
          var response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Unable to sign in.');
          }
          window.location.href = data.redirectTo || '/';
        } catch (error) {
          notice.textContent = error.message || 'Unable to sign in.';
          notice.classList.add('show');
          button.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  clearAuthCookie,
  getAuthState,
  getSafeRedirectPath,
  getSessionUser,
  isAllowedEmail,
  isAuthConfigured,
  isAuthEnabled,
  renderLoginPage,
  setAuthCookie,
  validateSharedPassword,
};
