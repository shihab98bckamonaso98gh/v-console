// Real scraper for voltxsms.com – dynamic login & console fetch
const BASE_URL = 'https://voltxsms.com';
const LOGIN_PAGE = BASE_URL + '/m29/';
const PROVIDED_API = 'https://api.2oo9.cloud/MXS47FLFX0U/tnevs/@public/api/console';

// Helper fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Parse HTML to find login form action and CSRF token
function parseLoginForm(html) {
  // Look for <form ... action="...">
  const formMatch = html.match(/<form[^>]*action="([^"]+)"[^>]*>/i);
  let action = formMatch ? formMatch[1] : '/m29/api/auth/login';
  if (action.startsWith('/')) action = BASE_URL + action;
  
  // Look for CSRF token (common names)
  const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/i) ||
                    html.match(/name="_token"\s+value="([^"]+)"/i) ||
                    html.match(/name="csrf"\s+value="([^"]+)"/i);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  
  return { action, csrfToken };
}

// Login using dynamic endpoint
async function login(email, password) {
  // Step 1: GET login page to obtain form action and cookies
  const initRes = await fetchWithTimeout(LOGIN_PAGE, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!initRes.ok) throw new Error(`Cannot fetch login page: ${initRes.status}`);
  
  const html = await initRes.text();
  const { action, csrfToken } = parseLoginForm(html);
  const cookies = initRes.headers.get('set-cookie') || '';
  
  // Step 2: Submit credentials via form-urlencoded
  const body = new URLSearchParams();
  body.append('email', email);
  body.append('password', password);
  if (csrfToken) body.append('csrf_token', csrfToken);
  
  const loginRes = await fetchWithTimeout(action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      'Cookie': cookies,
      'Origin': BASE_URL,
      'Referer': LOGIN_PAGE,
    },
    body: body.toString(),
    redirect: 'manual', // handle redirect manually
  });
  
  // After login, the server may redirect to dashboard
  let finalCookies = cookies;
  if (loginRes.headers.has('set-cookie')) {
    const newCookie = loginRes.headers.get('set-cookie');
    finalCookies = [cookies, newCookie.split(';')[0]].filter(Boolean).join('; ');
  }
  
  // Check if login succeeded (redirect to dashboard or 200 with token)
  if (loginRes.status === 302 || loginRes.status === 303) {
    // Redirect means success – we have session cookie
    return { cookies: finalCookies, token: null };
  }
  
  // Some sites return JSON with token
  try {
    const data = await loginRes.json();
    const token = data.token || data.access_token;
    if (token) return { cookies: finalCookies, token };
  } catch (e) {}
  
  // If we get here, login likely failed
  throw new Error('Login failed – invalid credentials or form structure changed');
}

// Fetch console data using either internal API or provided API
async function fetchConsoleData(cookies, token) {
  // First try the provided API (with Bearer token if available)
  if (token) {
    try {
      const res = await fetchWithTimeout(PROVIDED_API, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const logs = extractLogs(data);
        if (logs.length) return logs;
      }
    } catch (e) {}
  }
  
  // Fallback: internal console endpoint (requires session cookie)
  const internalEndpoints = [
    '/m29/api/dialer/console',
    '/m29/api/console/logs',
    '/api/dialer/console',
  ];
  
  for (const endpoint of internalEndpoints) {
    try {
      const res = await fetchWithTimeout(BASE_URL + endpoint, {
        method: 'GET',
        headers: {
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const logs = extractLogs(data);
        if (logs.length) return logs;
      }
    } catch (e) {}
  }
  
  // If nothing works, try scraping the console page HTML
  const consolePage = await fetchWithTimeout(BASE_URL + '/m29/', {
    method: 'GET',
    headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await consolePage.text();
  const logs = scrapeHtmlLogs(html);
  if (logs.length) return logs;
  
  throw new Error('No console data accessible – site structure may have changed');
}

// Extract logs from JSON response (handles various shapes)
function extractLogs(data) {
  let raw = [];
  if (Array.isArray(data)) raw = data;
  else if (data.logs && Array.isArray(data.logs)) raw = data.logs;
  else if (data.data && Array.isArray(data.data)) raw = data.data;
  else if (data.items && Array.isArray(data.items)) raw = data.items;
  else if (data.results && Array.isArray(data.results)) raw = data.results;
  else return [];
  
  return raw.map(item => ({
    time: item.time || item.created_at || item.timestamp || '',
    carrier: item.carrier || item.operator || item.network || '',
    country: item.country || item.location || '',
    appRaw: item.app || item.service || item.brand || item.sender || '',
    range: item.range || item.number_range || item.prefix || item.msisdn || '',
    sms: item.sms || item.message || item.body || item.text || '',
  })).filter(log => log.time || log.range);
}

// Scrape HTML console (if JSON fails)
function scrapeHtmlLogs(html) {
  const logs = [];
  const lineRegex = /<div class="cn-line"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let match;
  while ((match = lineRegex.exec(html)) !== null) {
    const block = match[1];
    const time = (block.match(/<div class="cn-line-time"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const carrier = (block.match(/<div class="cn-line-carrier"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const country = (block.match(/<div class="cn-line-numinfo"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const appRaw = (block.match(/<div class="cn-line-app"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const range = (block.match(/<div class="cn-line-range"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const smsMatch = block.match(/<div class="cn-line-sms"[^>]*>([\s\S]*?)<\/div>/);
    const sms = smsMatch ? smsMatch[1].replace(/<[^>]+>/g, '').replace(/➜/g, '').trim() : '';
    if (time || range) logs.push({ time, carrier, country, appRaw, range, sms });
  }
  return logs;
}

// Session cache
let session = { cookies: '', token: '', expiresAt: 0 };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const email = process.env.VOLTX_EMAIL;
  const password = process.env.VOLTX_PASSWORD;
  if (!email || !password) {
    return res.status(200).json({ source: 'error', logs: [], error: 'Missing credentials in environment variables' });
  }
  
  const now = Date.now();
  if (!session.cookies || now > session.expiresAt) {
    try {
      const { cookies, token } = await login(email, password);
      session = { cookies, token, expiresAt: now + 20 * 60 * 1000 };
    } catch (err) {
      return res.status(200).json({ source: 'error', logs: [], error: `Login failed: ${err.message}` });
    }
  }
  
  try {
    const logs = await fetchConsoleData(session.cookies, session.token);
    if (logs.length === 0) {
      return res.status(200).json({ source: 'live', logs: [], note: 'No messages right now' });
    }
    return res.status(200).json({ source: 'live', logs });
  } catch (err) {
    return res.status(200).json({ source: 'error', logs: [], error: `Console fetch failed: ${err.message}` });
  }
};