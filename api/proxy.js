const https = require('https');
const http = require('http');
const url = require('url');

const EMAIL = process.env.VOLTX_EMAIL || 'shihab98bc@gmail.com';
const PASSWORD = process.env.VOLTX_PASSWORD || 'Zxcv1234+-*/';

// Simple HTTP request helper (no external deps needed)
function request(options, postData) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'http:' ? http : https;
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

function parseCookies(headers) {
  const raw = headers['set-cookie'] || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(c => c.split(';')[0]).filter(Boolean).join('; ');
}

// Try to find the real API endpoint by inspecting the JS bundle
async function discoverApiBase(cookies) {
  try {
    const parsed = url.parse('https://voltxsms.com');
    const res = await request({
      hostname: parsed.hostname,
      path: '/m29/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': cookies || ''
      },
      protocol: 'https:'
    });
    // Look for API base URLs in the HTML
    const matches = res.body.match(/https?:\/\/[^"'\s]+\/api/g) || [];
    return [...new Set(matches)];
  } catch (e) { return []; }
}

async function tryLogin() {
  // Step 1: GET the page to collect cookies
  let cookies = '';
  try {
    const initRes = await request({
      hostname: 'voltxsms.com',
      path: '/m29/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      protocol: 'https:'
    });
    cookies = parseCookies(initRes.headers);
  } catch (e) {}

  // Step 2: Try various login endpoint patterns
  const loginPaths = [
    '/m29/api/auth/login',
    '/api/auth/login',
    '/m29/api/login',
    '/api/login',
    '/m29/api/user/login',
    '/api/user/login',
    '/m29/api/session',
  ];

  const body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const formBody = `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`;

  for (const path of loginPaths) {
    // Try JSON
    try {
      const res = await request({
        hostname: 'voltxsms.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://voltxsms.com',
          'Referer': 'https://voltxsms.com/m29/',
          'Cookie': cookies,
        },
        protocol: 'https:'
      }, body);

      if (res.status >= 200 && res.status < 400) {
        const newCookies = parseCookies(res.headers);
        const allCookies = [cookies, newCookies].filter(Boolean).join('; ');
        let token = '';
        try {
          const j = JSON.parse(res.body);
          token = j.token || j.access_token || j.data?.token || j.data?.access_token || '';
        } catch (e) {}
        return { cookies: allCookies, token, loginBody: res.body, loginPath: path };
      }
    } catch (e) {}

    // Try form-encoded
    try {
      const res = await request({
        hostname: 'voltxsms.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody),
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://voltxsms.com',
          'Referer': 'https://voltxsms.com/m29/',
          'Cookie': cookies,
        },
        protocol: 'https:'
      }, formBody);

      if (res.status >= 200 && res.status < 400) {
        const newCookies = parseCookies(res.headers);
        const allCookies = [cookies, newCookies].filter(Boolean).join('; ');
        let token = '';
        try {
          const j = JSON.parse(res.body);
          token = j.token || j.access_token || j.data?.token || '';
        } catch (e) {}
        return { cookies: allCookies, token, loginBody: res.body, loginPath: path };
      }
    } catch (e) {}
  }

  return { cookies, token: '' };
}

async function fetchConsole(cookies, token) {
  const consolePaths = [
    '/m29/api/dialer/console',
    '/m29/api/console',
    '/m29/api/console/logs',
    '/m29/api/live',
    '/m29/api/live/logs',
    '/m29/api/logs',
    '/api/dialer/console',
    '/api/console/logs',
    '/api/console',
    '/api/live/logs',
    '/api/logs',
    '/m29/api/dialer/logs',
  ];

  const authHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://voltxsms.com',
    'Referer': 'https://voltxsms.com/m29/',
    'Cookie': cookies || '',
  };
  if (token) authHeaders['Authorization'] = `Bearer ${token}`;

  for (const path of consolePaths) {
    try {
      const res = await request({
        hostname: 'voltxsms.com',
        path,
        method: 'GET',
        headers: authHeaders,
        protocol: 'https:'
      });

      if (res.status === 200 && res.body.trim().startsWith('{') || res.body.trim().startsWith('[')) {
        try {
          const data = JSON.parse(res.body);
          return { ok: true, data, path };
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Last resort: scrape the full SPA page HTML and extract console data from it
  try {
    const res = await request({
      hostname: 'voltxsms.com',
      path: '/m29/',
      method: 'GET',
      headers: {
        ...authHeaders,
        'Accept': 'text/html,application/xhtml+xml',
      },
      protocol: 'https:'
    });
    return { ok: true, html: res.body, path: 'html-scrape' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Parse cn-line HTML blocks
function parseHtml(html) {
  const logs = [];
  const lineRegex = /<div class="cn-line"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;

  // More robust: find each cn-line block
  const blocks = html.split('class="cn-line"').slice(1);
  blocks.forEach(block => {
    try {
      const time = (block.match(/class="cn-line-time"[^>]*>([^<]+)</) || [])[1]?.trim() || '';
      const carrier = (block.match(/class="cn-line-carrier"[^>]*>([^<]+)</) || [])[1]?.trim() || '';
      const country = (block.match(/class="cn-line-numinfo"[^>]*>([^<]+)</) || [])[1]?.trim() || '';
      const appRaw = (block.match(/class="cn-line-app"[^>]*>([^<]+)</) || [])[1]?.trim() || '';
      const range = (block.match(/class="cn-line-range"[^>]*>([^<]+)</) || [])[1]?.trim() || '';
      const smsMatch = block.match(/class="cn-line-sms"[^>]*>([\s\S]*?)<\/p>/);
      let sms = smsMatch ? smsMatch[1].replace(/<[^>]+>/g, '').replace(/➜/g, '').trim() : '';

      if (time || range) {
        logs.push({ time, carrier, country, appRaw, range, sms });
      }
    } catch (e) {}
  });

  return logs;
}

// Generate realistic demo data
function demoLogs() {
  const entries = [
    { app: 'Facebook', range: '23276XXX', carrier: 'Orange (Airtel)', country: 'Sierra Leone', sms: '<#> ***** is your Facebook code H29Q+Fsn4Sr' },
    { app: 'Facebook', range: '228986XXX', carrier: 'Togo Cellulaire (Togocel)', country: 'Togo', sms: '<#> *** *** is your Instagram code. Don\'t share it. SIYRxKrru1t' },
    { app: 'Instagram', range: '992817XXX', carrier: 'Babilon-M', country: 'Tajikistan', sms: '******: ****** is your security code. Don\'t share it.' },
    { app: 'WhatsApp', range: '224659XXX', carrier: 'Mobile', country: 'Guinea', sms: '****** is your WhatsApp code. Don\'t share it.' },
    { app: 'Facebook', range: '225077XXX', carrier: 'Orange', country: 'Ivory Coast', sms: '<#> ****** adalah kode Facebook Anda Laz+nxCarLW' },
    { app: 'Telegram', range: '9989XXXXX', carrier: 'Ucell', country: 'Uzbekistan', sms: '*****: Your Telegram code: ****' },
    { app: 'Instagram', range: '232753XXX', carrier: 'Orange (Airtel)', country: 'Sierra Leone', sms: '*** *** is your Instagram code. Don\'t share it.' },
    { app: 'Facebook', range: '22465468XXX', carrier: 'Mobile', country: 'Guinea', sms: '****** is your Instagram code. Don\'t share it. #ig' },
    { app: 'WhatsApp', range: '2347XXXXXX', carrier: 'MTN Nigeria', country: 'Nigeria', sms: '****** is your WhatsApp Business verification code' },
    { app: 'Telegram', range: '380XXXXXXX', carrier: 'Kyivstar', country: 'Ukraine', sms: 'Telegram code ****** (do not share)' },
  ];

  const now = Date.now();
  return Array.from({ length: 50 }, (_, i) => {
    const base = entries[i % entries.length];
    const t = new Date(now - i * 3000);
    return {
      ...base,
      time: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`,
    };
  });
}

// Session cache (survives warm lambda invocations)
let _session = null;
let _sessionTime = 0;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Re-login every 25 minutes
    const now = Date.now();
    if (!_session || now - _sessionTime > 25 * 60 * 1000) {
      _session = await tryLogin();
      _sessionTime = now;
    }

    const result = await fetchConsole(_session.cookies, _session.token);

    if (!result.ok) {
      return res.status(200).json({ source: 'demo', logs: demoLogs(), error: result.error });
    }

    // Got JSON API data
    if (result.data) {
      let raw = [];
      if (Array.isArray(result.data)) raw = result.data;
      else if (result.data.logs) raw = result.data.logs;
      else if (result.data.data) raw = Array.isArray(result.data.data) ? result.data.data : [];
      else if (result.data.items) raw = result.data.items;
      else raw = [result.data];

      const logs = raw.map(item => ({
        time: item.time || item.created_at || item.timestamp || '',
        carrier: item.carrier || item.operator || item.network || '',
        country: item.country || item.region || item.location || '',
        appRaw: item.app || item.service || item.brand || item.sender || '',
        range: item.range || item.number_range || item.prefix || item.msisdn || '',
        sms: item.sms || item.message || item.body || item.text || '',
      }));

      if (logs.length > 0) {
        return res.status(200).json({ source: 'api', logs, apiPath: result.path });
      }
    }

    // Got HTML — parse cn-line blocks
    if (result.html) {
      const logs = parseHtml(result.html);
      if (logs.length > 0) {
        return res.status(200).json({ source: 'html', logs });
      }
      // HTML arrived but no cn-line found — probably still on login page
      // Force re-login next time
      _session = null;
      return res.status(200).json({ source: 'demo', logs: demoLogs(), note: 'Parsed 0 lines from HTML — credentials may need updating' });
    }

    return res.status(200).json({ source: 'demo', logs: demoLogs(), note: 'No parseable data' });

  } catch (err) {
    return res.status(200).json({ source: 'demo', logs: demoLogs(), error: err.message });
  }
};
