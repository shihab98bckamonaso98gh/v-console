const fetch = require('node-fetch');

// In-memory session store (resets on cold start, fine for Vercel)
let sessionCookie = null;
let lastLoginAttempt = 0;

const BASE_URL = 'https://voltxsms.com';
const LOGIN_URL = `${BASE_URL}/m29/#/auth/login`;
const CONSOLE_URL = `${BASE_URL}/m29/#/dialer/console`;
const API_BASE = `${BASE_URL}/m29`;

// Credentials - set as Vercel env vars: VOLTX_EMAIL and VOLTX_PASSWORD
const EMAIL = process.env.VOLTX_EMAIL || 'shihab98bc@gmail.com';
const PASSWORD = process.env.VOLTX_PASSWORD || 'Zxcv1234+-*/';

async function doLogin() {
  try {
    // First, get the main page to pick up any initial cookies
    const initRes = await fetch(`${BASE_URL}/m29/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow'
    });

    const initCookies = initRes.headers.get('set-cookie') || '';

    // Try the API login endpoint (common pattern for Vue/React SPAs)
    const loginRes = await fetch(`${BASE_URL}/m29/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/m29/`,
        'Cookie': initCookies,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      redirect: 'follow'
    });

    const loginCookies = loginRes.headers.get('set-cookie');
    if (loginCookies) {
      sessionCookie = loginCookies.split(';')[0];
      return true;
    }

    // Try alternate login endpoint patterns
    const loginRes2 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/m29/`,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      redirect: 'follow'
    });

    const loginCookies2 = loginRes2.headers.get('set-cookie');
    if (loginCookies2) {
      sessionCookie = loginCookies2.split(';')[0];
      return true;
    }

    return false;
  } catch (e) {
    console.error('Login error:', e.message);
    return false;
  }
}

async function fetchConsoleData() {
  // Try multiple API endpoint patterns that Vue/React SPAs typically use
  const endpoints = [
    `${BASE_URL}/m29/api/dialer/console`,
    `${BASE_URL}/m29/api/console/logs`,
    `${BASE_URL}/m29/api/live/logs`,
    `${BASE_URL}/api/dialer/console`,
    `${BASE_URL}/api/console`,
  ];

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/m29/`,
    'X-Requested-With': 'XMLHttpRequest',
  };

  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
    // Also try Authorization header patterns
    if (sessionCookie.includes('token=')) {
      const token = sessionCookie.split('token=')[1];
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { headers, redirect: 'follow' });
      if (res.ok) {
        const data = await res.json();
        return { success: true, data, endpoint };
      }
    } catch (e) {
      // try next
    }
  }

  // If JSON APIs fail, try scraping the HTML page itself
  try {
    const pageRes = await fetch(`${BASE_URL}/m29/`, {
      headers,
      redirect: 'follow'
    });
    const html = await pageRes.text();
    // Return the HTML for client-side parsing
    return { success: true, html, type: 'html' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Re-login if no session or if it's been more than 30 minutes
    const now = Date.now();
    if (!sessionCookie || now - lastLoginAttempt > 1800000) {
      await doLogin();
      lastLoginAttempt = now;
    }

    const result = await fetchConsoleData();

    if (!result.success) {
      // Return demo/fallback data so the UI still works
      return res.status(200).json({
        success: false,
        message: 'Could not reach source. Showing cached demo data.',
        logs: getDemoLogs()
      });
    }

    return res.status(200).json({
      success: true,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(200).json({
      success: false,
      message: err.message,
      logs: getDemoLogs()
    });
  }
};

function getDemoLogs() {
  const apps = ['Facebook', 'Instagram', 'WhatsApp', 'Telegram', 'Twitter'];
  const carriers = ['Orange (Airtel)', 'Togo Cellulaire (Togocel)', 'Babilon-M', 'Mobile'];
  const countries = ['Sierra Leone', 'Togo', 'Tajikistan', 'Guinea', 'Ivory Coast'];
  const ranges = ['23276XXX', '228986XXX', '992817XXX', '224659XXX', '225077XXX', '232753XXX'];
  const messages = [
    'is your Facebook code H29Q+Fsn4Sr',
    'is your Instagram code. Don\'t share it. SIYRxKrru1t',
    'is your security code. Don\'t share it.',
    'is your WhatsApp code. Don\'t share it.',
    'est votre code Facebook H29Q+Fsn4Sr',
  ];

  return Array.from({ length: 50 }, (_, i) => {
    const now = new Date(Date.now() - i * 3000);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const appIdx = Math.floor(Math.random() * apps.length);
    const app = apps[appIdx];
    return {
      time: `${hh}:${mm}:${ss}`,
      carrier: carriers[Math.floor(Math.random() * carriers.length)],
      country: countries[Math.floor(Math.random() * countries.length)],
      app,
      range: ranges[Math.floor(Math.random() * ranges.length)],
      sms: `****** ${messages[Math.floor(Math.random() * messages.length)]}`
    };
  });
}
