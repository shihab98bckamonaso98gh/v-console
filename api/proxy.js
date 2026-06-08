const DEMO_LOGS = [
  { time: "14:23:01", carrier: "Orange", country: "Sierra Leone", appRaw: "Facebook", range: "23276XXX", sms: "<#> ***** is your Facebook code H29Q+Fsn4Sr" },
  { time: "14:22:15", carrier: "Togocel", country: "Togo", appRaw: "Instagram", range: "228986XXX", sms: "*** *** is your Instagram code. Don't share it." },
  { time: "14:21:42", carrier: "Babilon-M", country: "Tajikistan", appRaw: "Instagram", range: "992817XXX", sms: "****** is your security code." },
  { time: "14:20:58", carrier: "Mobile", country: "Guinea", appRaw: "WhatsApp", range: "224659XXX", sms: "****** is your WhatsApp code. Don't share it." },
  { time: "14:19:33", carrier: "Orange", country: "Ivory Coast", appRaw: "Facebook", range: "225077XXX", sms: "<#> ****** adalah kode Facebook Anda" },
  { time: "14:18:17", carrier: "Ucell", country: "Uzbekistan", appRaw: "Telegram", range: "9989XXXXX", sms: "*****: Your Telegram code: ****" }
];

// Generate more demo entries with sequential times
function generateDemoLogs() {
  const now = Date.now();
  return Array.from({ length: 45 }, (_, i) => {
    const base = DEMO_LOGS[i % DEMO_LOGS.length];
    const t = new Date(now - i * 5000);
    return {
      ...base,
      time: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`,
    };
  });
}

let sessionCache = {
  cookies: '',
  token: '',
  expiresAt: 0
};

async function fetchWithTimeout(url, options, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function login() {
  const email = process.env.VOLTX_EMAIL || '';
  const password = process.env.VOLTX_PASSWORD || '';
  
  // No credentials? Skip login attempt
  if (!email || !password) {
    return { cookies: '', token: '' };
  }

  try {
    // 1. Get initial cookies and CSRF token
    const initRes = await fetchWithTimeout('https://voltxsms.com/m29/', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const cookies = initRes.headers.get('set-cookie') || '';
    
    // 2. Attempt login (observed endpoint)
    const loginRes = await fetchWithTimeout('https://voltxsms.com/m29/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ email, password })
    });
    
    const loginData = await loginRes.json();
    const token = loginData.token || loginData.access_token || '';
    const newCookies = loginRes.headers.get('set-cookie') || '';
    
    return {
      cookies: [cookies, newCookies].filter(Boolean).join('; '),
      token
    };
  } catch (err) {
    console.error('Login error:', err.message);
    return { cookies: '', token: '' };
  }
}

async function fetchConsoleData(cookies, token) {
  const endpoints = [
    '/m29/api/dialer/console',
    '/m29/api/console/logs',
    '/m29/api/live/logs',
    '/api/dialer/console'
  ];
  
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Cookie': cookies || ''
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(`https://voltxsms.com${endpoint}`, {
        method: 'GET',
        headers
      });
      if (!res.ok) continue;
      
      const data = await res.json();
      let rawLogs = [];
      if (Array.isArray(data)) rawLogs = data;
      else if (data.logs) rawLogs = data.logs;
      else if (data.data && Array.isArray(data.data)) rawLogs = data.data;
      else if (data.items) rawLogs = data.items;
      
      if (rawLogs.length > 0) {
        const logs = rawLogs.map(item => ({
          time: item.time || item.created_at || '',
          carrier: item.carrier || item.operator || '',
          country: item.country || '',
          appRaw: item.app || item.service || '',
          range: item.range || item.number_range || '',
          sms: item.sms || item.message || ''
        })).filter(l => l.time || l.range);
        
        if (logs.length) return { source: 'api', logs };
      }
    } catch (err) {
      continue;
    }
  }
  
  // Fallback: scrape HTML console
  try {
    const res = await fetchWithTimeout('https://voltxsms.com/m29/', {
      method: 'GET',
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const html = await res.text();
    const logs = [];
    // Simple regex to extract cn-line blocks (adjust to actual structure)
    const lineRegex = /<div class="cn-line"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    let match;
    while ((match = lineRegex.exec(html)) !== null) {
      const block = match[1];
      const time = (block.match(/class="cn-line-time"[^>]*>([^<]+)/) || [])[1] || '';
      const carrier = (block.match(/class="cn-line-carrier"[^>]*>([^<]+)/) || [])[1] || '';
      const country = (block.match(/class="cn-line-numinfo"[^>]*>([^<]+)/) || [])[1] || '';
      const appRaw = (block.match(/class="cn-line-app"[^>]*>([^<]+)/) || [])[1] || '';
      const range = (block.match(/class="cn-line-range"[^>]*>([^<]+)/) || [])[1] || '';
      const smsMatch = block.match(/class="cn-line-sms"[^>]*>([\s\S]*?)<\/p>/);
      const sms = smsMatch ? smsMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (time || range) {
        logs.push({ time, carrier, country, appRaw, range, sms });
      }
    }
    if (logs.length) return { source: 'html', logs };
  } catch (err) {}
  
  // Final demo fallback
  return { source: 'demo', logs: generateDemoLogs() };
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Re-login every 25 minutes
    const now = Date.now();
    if (!sessionCache.expiresAt || now > sessionCache.expiresAt) {
      const session = await login();
      sessionCache = {
        cookies: session.cookies,
        token: session.token,
        expiresAt: now + 25 * 60 * 1000
      };
    }
    
    const consoleData = await fetchConsoleData(sessionCache.cookies, sessionCache.token);
    return res.status(200).json(consoleData);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(200).json({
      source: 'demo',
      logs: generateDemoLogs(),
      error: err.message
    });
  }
}