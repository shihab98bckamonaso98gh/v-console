// Real scraper for voltxsms.com – handles login, token, and console API
const CONSOLE_API = 'https://api.2oo9.cloud/MXS47FLFX0U/tnevs/@public/api/console';
const LOGIN_URL = 'https://voltxsms.com/m29/api/auth/login';
const BASE_URL = 'https://voltxsms.com';

// Helper for fetch with timeout
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

// Login to voltxsms.com and return { token, cookies }
async function login(email, password) {
  // Step 1: GET the login page to obtain initial cookies and CSRF token (if needed)
  let cookies = '';
  let csrfToken = '';
  try {
    const initRes = await fetchWithTimeout(BASE_URL + '/m29/', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });
    const setCookie = initRes.headers.get('set-cookie');
    if (setCookie) cookies = setCookie.split(';')[0];
    const html = await initRes.text();
    const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/) ||
                      html.match(/csrf_token["']?\s*:\s*["']([^"']+)["']/);
    if (csrfMatch) csrfToken = csrfMatch[1];
  } catch (err) {
    console.error('Failed to fetch login page:', err.message);
  }

  // Step 2: POST login credentials (JSON)
  const loginPayload = { email, password };
  if (csrfToken) loginPayload.csrf_token = csrfToken;

  const loginRes = await fetchWithTimeout(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0',
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/m29/',
      'Cookie': cookies,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(loginPayload),
  });

  if (!loginRes.ok) {
    const errorText = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status}): ${errorText.slice(0, 200)}`);
  }

  const loginData = await loginRes.json();
  const token = loginData.token || loginData.access_token || loginData.data?.token;
  if (!token) throw new Error('No token returned from login API');

  // Merge any new cookies from login response
  const newCookies = loginRes.headers.get('set-cookie');
  if (newCookies) cookies = [cookies, newCookies.split(';')[0]].filter(Boolean).join('; ');

  return { token, cookies };
}

// Fetch console logs using the authenticated API
async function fetchConsole(token, cookies) {
  // Try the provided console API first
  try {
    const res = await fetchWithTimeout(CONSOLE_API, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (res.ok) {
      const data = await res.json();
      let logs = [];
      if (Array.isArray(data)) logs = data;
      else if (data.logs && Array.isArray(data.logs)) logs = data.logs;
      else if (data.data && Array.isArray(data.data)) logs = data.data;
      else if (data.items && Array.isArray(data.items)) logs = data.items;
      if (logs.length) return logs;
    }
  } catch (err) {
    console.error('Provided console API failed:', err.message);
  }

  // Fallback to the internal console endpoint
  const internalApi = BASE_URL + '/m29/api/dialer/console';
  const res = await fetchWithTimeout(internalApi, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/m29/',
    },
  });

  if (!res.ok) {
    throw new Error(`Console API returned ${res.status}`);
  }

  const data = await res.json();
  let logs = [];
  if (Array.isArray(data)) logs = data;
  else if (data.logs && Array.isArray(data.logs)) logs = data.logs;
  else if (data.data && Array.isArray(data.data)) logs = data.data;
  else logs = [];

  return logs;
}

// Transform raw logs to frontend format
function transformLogs(rawLogs) {
  return rawLogs.map(item => ({
    time: item.time || item.created_at || item.timestamp || '',
    carrier: item.carrier || item.operator || item.network || '',
    country: item.country || item.location || '',
    appRaw: item.app || item.service || item.brand || item.sender || '',
    range: item.range || item.number_range || item.prefix || item.msisdn || '',
    sms: item.sms || item.message || item.body || item.text || '',
  })).filter(log => log.time || log.range);
}

// Session cache (in-memory, survives warm lambda)
let session = {
  token: null,
  cookies: null,
  expiresAt: 0,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = process.env.VOLTX_EMAIL;
  const password = process.env.VOLTX_PASSWORD;

  if (!email || !password) {
    return res.status(200).json({
      source: 'error',
      logs: [],
      error: 'Missing VOLTX_EMAIL or VOLTX_PASSWORD environment variables',
    });
  }

  const now = Date.now();
  // Re-authenticate every 20 minutes
  if (!session.token || now > session.expiresAt) {
    try {
      const { token, cookies } = await login(email, password);
      session.token = token;
      session.cookies = cookies;
      session.expiresAt = now + 20 * 60 * 1000;
    } catch (err) {
      console.error('Login error:', err.message);
      return res.status(200).json({
        source: 'error',
        logs: [],
        error: `Login failed: ${err.message}. Check your credentials.`,
      });
    }
  }

  // Fetch live console logs
  try {
    const rawLogs = await fetchConsole(session.token, session.cookies);
    const logs = transformLogs(rawLogs);
    if (logs.length === 0) {
      return res.status(200).json({
        source: 'live',
        logs: [],
        note: 'No messages in console at this moment.',
      });
    }
    return res.status(200).json({
      source: 'live',
      logs,
    });
  } catch (err) {
    console.error('Console fetch error:', err.message);
    return res.status(200).json({
      source: 'error',
      logs: [],
      error: `Failed to fetch console: ${err.message}`,
    });
  }
};