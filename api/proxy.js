// Real scraper – fetches live console data from the provided API
const CONSOLE_API = 'https://api.2oo9.cloud/MXS47FLFX0U/tnevs/@public/api/console';

// Helper to fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
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

// Generate demo data (only as last resort)
function generateDemoLogs() {
  const entries = [
    { time: "14:23:01", carrier: "Orange", country: "Sierra Leone", appRaw: "Facebook", range: "23276XXX", sms: "<#> ***** is your Facebook code H29Q+Fsn4Sr" },
    { time: "14:22:15", carrier: "Togocel", country: "Togo", appRaw: "Instagram", range: "228986XXX", sms: "*** *** is your Instagram code" },
    { time: "14:21:42", carrier: "Babilon-M", country: "Tajikistan", appRaw: "Instagram", range: "992817XXX", sms: "****** is your security code" },
    { time: "14:20:58", carrier: "Mobile", country: "Guinea", appRaw: "WhatsApp", range: "224659XXX", sms: "****** is your WhatsApp code" },
    { time: "14:19:33", carrier: "Orange", country: "Ivory Coast", appRaw: "Facebook", range: "225077XXX", sms: "<#> ****** adalah kode Facebook Anda" },
    { time: "14:18:17", carrier: "Ucell", country: "Uzbekistan", appRaw: "Telegram", range: "9989XXXXX", sms: "*****: Your Telegram code" },
  ];
  const now = Date.now();
  return Array.from({ length: 50 }, (_, i) => {
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

  try {
    // Fetch live data from the console API
    const response = await fetchWithTimeout(CONSOLE_API, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VoltX-Console/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    // Parse JSON – read body only once
    const data = await response.json();
    
    // Extract logs array (handle different possible structures)
    let logs = [];
    if (Array.isArray(data)) logs = data;
    else if (data.logs && Array.isArray(data.logs)) logs = data.logs;
    else if (data.data && Array.isArray(data.data)) logs = data.data;
    else if (data.results && Array.isArray(data.results)) logs = data.results;
    else if (data.items && Array.isArray(data.items)) logs = data.items;
    else logs = [];

    // Transform to the format expected by frontend
    const formattedLogs = logs.map(item => ({
      time: item.time || item.created_at || item.timestamp || '',
      carrier: item.carrier || item.operator || item.network || '',
      country: item.country || item.location || '',
      appRaw: item.app || item.service || item.brand || item.sender || '',
      range: item.range || item.number_range || item.prefix || item.msisdn || '',
      sms: item.sms || item.message || item.body || item.text || '',
    })).filter(log => log.time || log.range); // remove completely empty

    if (formattedLogs.length === 0) {
      return res.status(200).json({
        source: 'error',
        logs: generateDemoLogs(),
        error: 'API returned empty or malformed data',
      });
    }

    // Success – return live data
    return res.status(200).json({
      source: 'live',
      logs: formattedLogs,
    });

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(200).json({
      source: 'error',
      logs: generateDemoLogs(),
      error: `Failed to fetch: ${err.message}`,
    });
  }
};