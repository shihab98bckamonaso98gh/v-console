const https = require('https');

// Helper for HTTPS requests with cookies and headers
function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// Parse cookies from Set-Cookie headers
function parseCookies(headers) {
  const setCookie = headers['set-cookie'] || [];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
}

// Extract CSRF token from HTML
function extractCsrfToken(html) {
  const match = html.match(/name="csrf_token" value="([^"]+)"/) ||
                html.match(/csrf_token["']?\s*:\s*["']([^"']+)["']/) ||
                html.match(/token["']?\s*:\s*["']([^"']+)["']/);
  return match ? match[1] : '';
}

// Main login & fetch function
async function getLiveConsole(email, password) {
  let cookies = '';
  let csrfToken = '';

  // ---- STEP 1: GET login page (get cookies + CSRF) ----
  try {
    const initRes = await request({
      hostname: 'voltxsms.com',
      path: '/m29/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    cookies = parseCookies(initRes.headers);
    csrfToken = extractCsrfToken(initRes.body);
  } catch (err) {
    console.error('Failed to fetch login page:', err.message);
    return { success: false, error: 'Cannot reach voltxsms.com' };
  }

  // ---- STEP 2: POST login credentials ----
  const loginData = JSON.stringify({ email, password, csrf_token: csrfToken });
  const formData = `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&csrf_token=${encodeURIComponent(csrfToken)}`;

  let loginSuccess = false;
  let finalCookies = cookies;

  // Try JSON login first (most common)
  try {
    const loginRes = await request({
      hostname: 'voltxsms.com',
      path: '/m29/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData),
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://voltxsms.com',
        'Referer': 'https://voltxsms.com/m29/',
      },
    }, loginData);
    const newCookies = parseCookies(loginRes.headers);
    finalCookies = [cookies, newCookies].filter(Boolean).join('; ');
    if (loginRes.status === 200 || loginRes.status === 201) {
      const json = JSON.parse(loginRes.body);
      if (json.token || json.access_token || json.success === true) loginSuccess = true;
    }
  } catch (e) {}

  // If JSON failed, try form‑encoded
  if (!loginSuccess) {
    try {
      const loginRes = await request({
        hostname: 'voltxsms.com',
        path: '/m29/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formData),
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0',
          'Origin': 'https://voltxsms.com',
          'Referer': 'https://voltxsms.com/m29/',
        },
      }, formData);
      const newCookies = parseCookies(loginRes.headers);
      finalCookies = [cookies, newCookies].filter(Boolean).join('; ');
      if (loginRes.status === 200 || loginRes.status === 302) loginSuccess = true;
    } catch (e) {}
  }

  if (!loginSuccess) {
    return { success: false, error: 'Login failed – check email/password' };
  }

  // ---- STEP 3: Fetch the console page (HTML) ----
  let consoleHtml = '';
  try {
    const consoleRes = await request({
      hostname: 'voltxsms.com',
      path: '/m29/',
      method: 'GET',
      headers: {
        'Cookie': finalCookies,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    consoleHtml = consoleRes.body;
  } catch (err) {
    return { success: false, error: 'Failed to fetch console page after login' };
  }

  // ---- STEP 4: Parse the console HTML for logs ----
  const logs = [];
  // Regex to find each .cn-line block (adjust if the site changes)
  const lineRegex = /<div class="cn-line"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let match;
  while ((match = lineRegex.exec(consoleHtml)) !== null) {
    const block = match[1];
    const time = (block.match(/<div class="cn-line-time"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const carrier = (block.match(/<div class="cn-line-carrier"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const country = (block.match(/<div class="cn-line-numinfo"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const appRaw = (block.match(/<div class="cn-line-app"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const range = (block.match(/<div class="cn-line-range"[^>]*>([^<]+)/) || [])[1]?.trim() || '';
    const smsMatch = block.match(/<div class="cn-line-sms"[^>]*>([\s\S]*?)<\/div>/);
    let sms = smsMatch ? smsMatch[1].replace(/<[^>]+>/g, '').replace(/➜/g, '').trim() : '';

    if (time || range) {
      logs.push({ time, carrier, country, appRaw, range, sms });
    }
  }

  if (logs.length === 0) {
    // Perhaps the console data is loaded via XHR – try to find it in embedded JSON
    const jsonMatch = consoleHtml.match(/window\.__INITIAL_STATE__\s*=\s*({[^;]+})/);
    if (jsonMatch) {
      try {
        const initialState = JSON.parse(jsonMatch[1]);
        const liveLogs = initialState?.logs || initialState?.console || initialState?.messages || [];
        if (Array.isArray(liveLogs) && liveLogs.length) {
          liveLogs.forEach(item => {
            logs.push({
              time: item.time || item.created_at || '',
              carrier: item.carrier || item.operator || '',
              country: item.country || '',
              appRaw: item.app || item.service || '',
              range: item.range || item.number || '',
              sms: item.sms || item.message || '',
            });
          });
        }
      } catch (e) {}
    }
  }

  if (logs.length === 0) {
    return { success: false, error: 'Logged in but no console data found – site structure may have changed' };
  }

  return { success: true, logs };
}

// Demo logs for absolute fallback (only if everything fails)
function generateDemoLogs() {
  const demoEntries = [
    { time: "14:23:01", carrier: "Orange", country: "Sierra Leone", appRaw: "Facebook", range: "23276XXX", sms: "<#> ***** is your Facebook code H29Q+Fsn4Sr" },
    { time: "14:22:15", carrier: "Togocel", country: "Togo", appRaw: "Instagram", range: "228986XXX", sms: "*** *** is your Instagram code" },
    { time: "14:21:42", carrier: "Babilon-M", country: "Tajikistan", appRaw: "Instagram", range: "992817XXX", sms: "****** is your security code" },
    { time: "14:20:58", carrier: "Mobile", country: "Guinea", appRaw: "WhatsApp", range: "224659XXX", sms: "****** is your WhatsApp code" },
    { time: "14:19:33", carrier: "Orange", country: "Ivory Coast", appRaw: "Facebook", range: "225077XXX", sms: "<#> ****** adalah kode Facebook Anda" },
    { time: "14:18:17", carrier: "Ucell", country: "Uzbekistan", appRaw: "Telegram", range: "9989XXXXX", sms: "*****: Your Telegram code" },
  ];
  const now = Date.now();
  return Array.from({ length: 50 }, (_, i) => {
    const base = demoEntries[i % demoEntries.length];
    const t = new Date(now - i * 5000);
    return {
      ...base,
      time: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`,
    };
  });
}

// ---- Vercel handler ----
let sessionCache = { cookies: '', expires: 0, lastLogs: [] };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = process.env.VOLTX_EMAIL;
  const password = process.env.VOLTX_PASSWORD;

  if (!email || !password) {
    return res.status(200).json({
      source: 'demo',
      logs: generateDemoLogs(),
      error: 'Missing credentials – set VOLTX_EMAIL and VOLTX_PASSWORD in Vercel environment variables',
    });
  }

  // Re‑fetch every 25 seconds (to keep session alive)
  const now = Date.now();
  if (!sessionCache.expires || now > sessionCache.expires) {
    const live = await getLiveConsole(email, password);
    if (live.success && live.logs.length) {
      sessionCache = {
        logs: live.logs,
        expires: now + 25000, // 25 seconds
      };
    } else {
      // If live fetch fails, keep previous logs if any, otherwise demo
      if (!sessionCache.logs) sessionCache.logs = generateDemoLogs();
      sessionCache.expires = now + 10000; // retry sooner
      return res.status(200).json({
        source: 'error',
        logs: sessionCache.logs,
        error: live.error || 'Live data unavailable – check credentials or site changes',
      });
    }
  }

  // Return live data
  return res.status(200).json({
    source: 'live',
    logs: sessionCache.logs,
  });
};