// Real scraper for voltxsms.com – uses live API endpoints
const fetch = require('node-fetch'); // Vercel Node 18+ includes fetch globally, but we add for safety

// Optional: use native fetch if available
const nativeFetch = globalThis.fetch || fetch;

// Session cache (in-memory, survives warm starts)
let session = {
  token: null,
  cookies: null,
  expiresAt: 0,
};

async function login(email, password) {
  const loginUrl = 'https://voltxsms.com/m29/api/auth/login';
  const payload = { email, password };

  const response = await nativeFetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://voltxsms.com',
      'Referer': 'https://voltxsms.com/m29/',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  // The API returns { token: '...', user: {...} } or similar
  const token = data.token || data.access_token || data.data?.token;
  if (!token) throw new Error('No token returned from login API');

  // Extract cookies from Set-Cookie header (for session continuity)
  const setCookie = response.headers.get('set-cookie');
  const cookies = setCookie ? setCookie.split(';')[0] : '';

  return { token, cookies };
}

async function fetchConsole(token, cookies) {
  const consoleUrl = 'https://voltxsms.com/m29/api/dialer/console';
  const response = await nativeFetch(consoleUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Authorization': `Bearer ${token}`,
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://voltxsms.com',
      'Referer': 'https://voltxsms.com/m29/',
    },
  });

  if (!response.ok) {
    throw new Error(`Console API returned ${response.status}`);
  }

  const data = await response.json();
  // The console endpoint returns an array of log objects
  let logs = [];
  if (Array.isArray(data)) logs = data;
  else if (data.logs && Array.isArray(data.logs)) logs = data.logs;
  else if (data.data && Array.isArray(data.data)) logs = data.data;
  else logs = [];

  // Transform to the format expected by the frontend
  return logs.map(item => ({
    time: item.time || item.created_at || '',
    carrier: item.carrier || item.operator || '',
    country: item.country || '',
    appRaw: item.app || item.service || item.brand || '',
    range: item.range || item.number_range || item.prefix || '',
    sms: item.sms || item.message || item.body || '',
  }));
}

// Demo data as absolute last resort (only if site is completely unreachable)
function generateDemoLogs() {
  const entries = [
    { time: "14:23:01", carrier: "Orange", country: "Sierra Leone", appRaw: "Facebook", range: "23276XXX", sms: "<#> ***** is your Facebook code" },
    { time: "14:22:15", carrier: "Togocel", country: "Togo", appRaw: "Instagram", range: "228986XXX", sms: "*** *** is your Instagram code" },
    { time: "14:21:42", carrier: "Babilon-M", country: "Tajikistan", appRaw: "Instagram", range: "992817XXX", sms: "****** is your security code" },
  ];
  const now = Date.now();
  return Array.from({ length: 30 }, (_, i) => {
    const base = entries[i % entries.length];
    const t = new Date(now - i * 5000);
    return {
      ...base,
      time: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`,
    };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = process.env.VOLTX_EMAIL;
  const password = process.env.VOLTX_PASSWORD;

  if (!email || !password) {
    return res.status(200).json({
      source: 'error',
      logs: generateDemoLogs(),
      error: 'Missing VOLTX_EMAIL or VOLTX_PASSWORD environment variables',
    });
  }

  const now = Date.now();
  // Re-authenticate every 25 minutes (or if token missing)
  if (!session.token || now > session.expiresAt) {
    try {
      const { token, cookies } = await login(email, password);
      session.token = token;
      session.cookies = cookies;
      session.expiresAt = now + 25 * 60 * 1000; // 25 minutes
    } catch (err) {
      console.error('Login error:', err.message);
      return res.status(200).json({
        source: 'error',
        logs: generateDemoLogs(),
        error: `Login failed: ${err.message}. Check your credentials.`,
      });
    }
  }

  // Fetch live console logs
  try {
    const logs = await fetchConsole(session.token, session.cookies);
    if (logs.length === 0) {
      // Sometimes the API returns an empty array – try refreshing the session
      const { token, cookies } = await login(email, password);
      session.token = token;
      session.cookies = cookies;
      session.expiresAt = now + 25 * 60 * 1000;
      const retryLogs = await fetchConsole(token, cookies);
      if (retryLogs.length === 0) {
        return res.status(200).json({
          source: 'live',
          logs: retryLogs,
          note: 'Console API returned empty array – maybe no messages yet.',
        });
      }
      return res.status(200).json({ source: 'live', logs: retryLogs });
    }
    return res.status(200).json({ source: 'live', logs });
  } catch (err) {
    console.error('Console fetch error:', err.message);
    return res.status(200).json({
      source: 'error',
      logs: generateDemoLogs(),
      error: `Failed to fetch console: ${err.message}`,
    });
  }
};