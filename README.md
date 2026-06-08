# VoltX SMS Live Console

A responsive web app that mirrors the VoltX SMS live console with brand filters, 1-click copy, and silent 5-second auto-refresh.

## Features

- **Live Console** — mirrors data from voltxsms.com every 5 seconds
- **Silent refresh** — background polling, never interrupts scrolling
- **Brand filters** — All / Facebook / Instagram / WhatsApp / Telegram / Twitter tabs
- **1-click copy** — tap any range (e.g. `99470XXX`) to copy to clipboard instantly
- **Full-text search** — filter by carrier, country, range, SMS text
- **Responsive** — works on mobile, tablet, desktop

## Deploy to Vercel (step-by-step)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/voltx-console.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and log in (or sign up free)
2. Click **"Add New Project"**
3. Import your GitHub repo
4. Vercel auto-detects the config — click **Deploy**
5. Done! Your site is live at `https://your-project.vercel.app`

### 3. Set Environment Variables (Credentials)

In your Vercel project dashboard:
- Go to **Settings → Environment Variables**
- Add:
  - `VOLTX_EMAIL` = your voltxsms.com email
  - `VOLTX_PASSWORD` = your voltxsms.com password

> ⚠️ Never commit credentials to GitHub. Always use env vars.

## Local Development

```bash
npm install
npx vercel dev
# Visit http://localhost:3000
```

## Project Structure

```
voltx-console/
├── api/
│   └── proxy.js        # Serverless function — logs in + fetches data
├── public/
│   └── index.html      # Full frontend app
├── vercel.json         # Vercel routing config
├── package.json
└── README.md
```

## How It Works

1. Browser loads `index.html`
2. Every 5 seconds, JS calls `/api/proxy`
3. The Vercel serverless function logs into voltxsms.com, fetches the console page/API, and returns parsed data
4. Frontend renders the logs, maintaining scroll position (silent refresh)
5. Click any `XXXXXNNN` range badge → copied to clipboard instantly

## Troubleshooting

- **No data showing?** — Check that `VOLTX_EMAIL` and `VOLTX_PASSWORD` env vars are set in Vercel
- **CORS errors?** — The proxy handles this; make sure you're calling `/api/proxy` not the target site directly
- **Showing demo data?** — The proxy couldn't reach voltxsms.com; check credentials or if the site is up
