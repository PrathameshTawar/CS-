# Deployment Guide

This guide covers deploying the STRIDE OPS demo to **GitHub Pages** and **Netlify**. Both are free and work with a static site (no backend needed).

---

## Prerequisites

- Your project pushed to a **GitHub repository**
- The demo builds successfully:

```bash
npm run demo:build
# → dist-demo/index.html + dist-demo/bundle.js
```

---

## Option A: GitHub Pages (Recommended)

### Quick Setup (5 minutes)

1. **Enable GitHub Pages** in your repo:
   - Go to **Settings > Pages**
   - Under "Source", select **"GitHub Actions"**

2. **Push to main** — the CI workflow runs tests automatically.

3. **Tag a release** to trigger deployment:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow in `.github/workflows/deploy.yml` will:
- Run all 186 tests
- Build the demo bundle
- Deploy to GitHub Pages

Your site will be live at:
```
https://<username>.github.io/<repo-name>/
```

### Demo URLs

After deployment, you can use query parameters:

```
https://<username>.github.io/<repo-name>/?mode=classic&biome=forest&seed=4242
https://<username>.github.io/<repo-name>/?mode=ai&biome=snow&difficulty=hard
https://<username>.github.io/<repo-name>/?mode=classic&llmKey=sk-or-v1-...
```

---

## Option B: Netlify

### One-Click Setup (3 minutes)

1. Push your repo to GitHub/GitLab.

2. Go to [app.netlify.com](https://app.netlify.com) and click **"Add new site" > "Import an existing project"**.

3. Select your repo. Netlify auto-detects the `netlify.toml` config.

4. Click **"Deploy site"** — done.

### Deploy from CLI (power users)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build the demo
npm run demo:build

# Deploy
npx netlify deploy --prod --dir=dist-demo
```

### Custom Domain

1. In Netlify dashboard: **Site settings > Domain management**
2. Add your custom domain
3. Update your DNS records as instructed

---

## What Gets Deployed

The deployment contains only the **static demo** files:

```
dist-demo/
├── index.html              # Entry point (game container)
├── bundle.js               # Webpack bundle (~860 KB)
├── bundle.js.LICENSE.txt   # Third-party licenses
└── bundle.js.map           # Source map (debugging)
```

The **entire game** runs client-side in the browser — no server needed.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | GitHub Actions CI/CD pipeline |
| `netlify.toml` | Netlify build settings, redirects, headers |

---

## Environment Variables

No environment variables are needed for deployment. The LLM API key is handled client-side:

- Users enter their API key in the AI mode settings panel
- Keys are stored in **browser localStorage** only
- Never committed to source code
- Use `?llmKey=sk-or-v1-...` to pre-seed on page load

---

## Manual Build & Serve

If you just want to test the built demo locally:

```bash
# Build
npm run demo:build

# Serve with the included static server
node serve-demo.mjs
# → http://localhost:8099
```

---

## Troubleshooting

### GitHub Pages: "404 page not found"

- Check that **Settings > Pages > Source** is set to **"GitHub Actions"** (not a branch)
- Verify the workflow ran successfully under **Actions** tab
- Make sure you tagged a version (`git tag v1.0.0 && git push origin v1.0.0`)

### Netlify: "Build failed"

- Check the **Deploy log** in Netlify dashboard
- Common issues:
  - Missing `netlify.toml` (should be in the repo root)
  - `npm ci` fails if `package-lock.json` is missing — run `npm install` locally first
  - Node version mismatch — set `NODE_VERSION` environment variable in Netlify

### Demo loads but is blank

- Open browser DevTools (F12) and check the **Console** tab for errors
- The most common cause is a blocked canvas context (some privacy extensions block WebGL)
- Verify your browser supports WebGL: https://get.webgl.org/

### Slow performance

- The demo targets 144 FPS on capable hardware
- If running on integrated graphics, try:
  - Close other GPU-intensive applications
  - Use Chrome or Edge (best WebGL performance)
  - Lower the resolution in your browser zoom settings