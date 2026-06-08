// Real scraper for voltxsms.com – tries all possible login paths
const BASE_URL = 'https://voltxsms.com';
const LOGIN_PAGE = BASE_URL + '/m29/';

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

// Try multiple login endpoints and content types
async function tryLogin(email, password, initialCookies = '') {
  const loginAttempts = [
    // JSON POST to common endpoints
    { url: '/m29/api/auth/login', contentType: 'application/json', body: JSON.stringify({ email, password }) },
    { url: '/api/auth/login', contentType: 'application/json', body: JSON.stringify({ email, password }) },
    { url: '/m29/api/login', contentType: 'application/json', body: JSON.stringify({ email, password }) },
    { url: '/api/login', contentType: 'application/json', body: JSON.stringify({ email, password }) },
    { url: '/m29/api/user/login', contentType: 'application/json', body: JSON.stringify({ email, password }) },
    // Form-urlencoded attempts
    { url: '/m29/api/auth/login', contentType: 'application/x-www-form-urlencoded', body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}` },
    { url: '/api/auth/login', contentType: 'application/x-www-form-urlencoded', body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}` },
    { url: '/m29/api/login', contentType: 'application/x-www-form-urlencoded', body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}` },
  ];

  for (const attempt of loginAttempts) {
    try {
      const res = await fetchWithTimeout(BASE_URL + attempt.url, {
        method: 'POST',
        headers: {
          'Content-Type': attempt.contentType,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Cookie': initialCookies,
          'Origin': BASE_URL,
          'Referer': LOGIN_PAGE,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: attempt.body,
      });

      if (res.status === 200 || res.status === 201 || res.status === 302) {
        let token = null;
        let cookies = res.headers.get('set-cookie') || '';
        try {
          const data = await res.json();
          token = data.token || data.access_token || data.data?.token;
        } catch (e) {}

        // Merge cookies
        if (initialCookies && cookies) cookies = initialCookies + '; ' + cookies.split(';')[0];
        else if (!cookies && initialCookies) cookies = initialCookies;

        if (token || cookies) {
          return { success: true, cookies, token, usedEndpoint: attempt.url };
        }
      }
    } catch (err) {
      // continue to next attempt
    }
  }
  return { success: false, error: 'All login endpoints failed – check credentials and site structure' };
}

// Fetch console logs using the authenticated session
async function fetchConsoleData(cookies, token) {
  // Try internal console endpoints
  const endpoints = [
    '/m29/api/dialer/console',
    '/m29/api/console/logs',
    '/api/dialer/console',
    '/m29/api/live/logs',
  ];

  for (const endpoint of endpoints) {
    try {
      const headers = {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetchWithTimeout(BASE_URL + endpoint, { headers });
      if (res.ok) {
        const data = await res.json();
        let rawLogs = [];
        if (Array.isArray(data)) rawLogs = data;
        else if (data.logs && Array.isArray(data.logs)) rawLogs = data.logs;
        else if (data.data && Array.isArray(data.data)) rawLogs = data.data;
        else if (data.items && Array.isArray(data.items)) rawLogs = data.items;
        if (rawLogs.length) {
          return rawLogs.map(item => ({
            time: item.time || item.created_at || item.timestamp || '',
            carrier: item.carrier || item.operator || '',
            country: item.country || '',
            appRaw: item.app || item.service || item.brand || '',
            range: item.range || item.number_range || item.prefix || '',
            sms: item.sms || item.message || item.body || '',
          })).filter(l => l.time || l.range);
        }
      }
    } catch (err) {}
  }

  // Last resort: scrape HTML console
  const htmlRes = await fetchWithTimeout(LOGIN_PAGE, {
    headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await htmlRes.text();
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
  if (logs.length) return logs;
  throw new Error('No console data accessible – login may have failed silently');
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
    return res.status(200).json({ source: 'error', logs: [], error: 'Missing VOLTX_EMAIL or VOLTX_PASSWORD' });
  }

  const now = Date.now();
  if (!session.cookies || now > session.expiresAt) {
    // First get initial cookies from the homepage
    let initCookies = '';
    try {
      const initRes = await fetchWithTimeout(LOGIN_PAGE, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
      initCookies = initRes.headers.get('set-cookie') || '';
    } catch (err) {}

    const loginResult = await tryLogin(email, password, initCookies);
    if (!loginResult.success) {
      return res.status(200).json({ source: 'error', logs: [], error: loginResult.error });
    }
    session = {
      cookies: loginResult.cookies,
      token: loginResult.token,
      expiresAt: now + 20 * 60 * 1000,
    };
  }

  try {
    const logs = await fetchConsoleData(session.cookies, session.token);
    if (logs.length === 0) {
      return res.status(200).json({ source: 'live', logs: [], note: 'No messages in console' });
    }
    return res.status(200).json({ source: 'live', logs });
  } catch (err) {
    return res.status(200).json({ source: 'error', logs: [], error: err.message });
  }
};