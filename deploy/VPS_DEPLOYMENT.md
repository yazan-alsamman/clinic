# VPS Deployment — Performance & Security Optimization

Run every command in order. Each section is labeled **safe to run** or **one-time setup**.

---

## 1. Pull the latest code

```bash
cd /var/www/clinic

# Discard the locally-modified package-lock.json, then pull
git checkout -- frontend/package-lock.json
git pull
```

---

## 2. Rebuild the frontend

```bash
cd /var/www/clinic/frontend

npm install
npm run build
```

Expected output — you should see ~40 small chunks instead of one giant file:

```
dist/assets/index-xxxxx.js          ~29 kB   (was 906 kB)
dist/assets/vendor-react-xxxxx.js   ~189 kB
dist/assets/vendor-router-xxxxx.js  ~42 kB
dist/assets/vendor-xlsx-xxxxx.js    ~282 kB  (only loads on /reports/daily)
dist/assets/Dashboard-xxxxx.js      ~2 kB
... (one chunk per page)
```

---

## 3. Create PM2 log directory  *(one-time setup)*

```bash
sudo mkdir -p /var/log/clinic
sudo chown -R $(whoami):$(whoami) /var/log/clinic
```

---

## 4. Reload PM2 with the new config

```bash
cd /var/www/clinic
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

Verify it is running:

```bash
pm2 status
pm2 logs clinic-api --lines 20
```

---

## 5. Enable gzip in nginx  *(one-time setup)*

Open the main nginx config:

```bash
sudo nano /etc/nginx/nginx.conf
```

Find the `http { ... }` block and add these lines **inside** it (before the `include` lines):

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/javascript application/javascript
           application/json application/xml image/svg+xml;
gzip_min_length 1024;
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 6. Apply the updated site config (security headers + webp cache rule)

```bash
sudo cp /var/www/clinic/deploy/nginx.conf /etc/nginx/sites-available/clinic
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

If `nginx -t` fails, check the error and do **not** reload until it passes.

---

## 7. Compress the clinic logo  *(one-time setup — biggest remaining asset)*

The logo is currently **1.1 MB**. This compresses it to ~100–150 KB.

### Option A — ImageMagick (recommended, usually pre-installed)

```bash
# Check if ImageMagick is available
convert --version

# Compress in-place (keeps PNG, reduces size ~70%)
convert /var/www/clinic/frontend/src/assets/logo-elias-clinic.png \
  -quality 85 \
  -resize 800x800\> \
  /var/www/clinic/frontend/src/assets/logo-elias-clinic.png

# Also create a WebP version
convert /var/www/clinic/frontend/src/assets/logo-elias-clinic.png \
  -quality 85 \
  /var/www/clinic/frontend/src/assets/logo-elias-clinic.webp
```

### Option B — Install sharp-cli if ImageMagick is not available

```bash
npm install -g sharp-cli

sharp -i /var/www/clinic/frontend/src/assets/logo-elias-clinic.png \
      -o /var/www/clinic/frontend/src/assets/logo-elias-clinic.webp \
      --format webp --quality 85
```

After compressing, rebuild the frontend so Vite picks up the smaller asset:

```bash
cd /var/www/clinic/frontend
npm run build
```

---

## 8. Verify everything is working

```bash
# Check nginx is running with no errors
sudo systemctl status nginx

# Check the API is up
curl -s http://localhost:5000/api/health

# Check PM2
pm2 status

# Check gzip is active (look for "Content-Encoding: gzip" in the response)
curl -sI -H "Accept-Encoding: gzip" http://localhost/assets/ | grep -i encoding
```

Open the site in a browser and confirm:
- Login works
- Dashboard loads
- Patient search works
- `/reports/daily` loads and Excel export still works

---

## Summary of what changed

| Area | Change | Impact |
|------|--------|--------|
| Frontend JS | Code splitting — all pages lazy-loaded | Initial JS: 906 KB → 29 KB |
| Frontend JS | `xlsx` deferred to `/reports/daily` only | 282 KB never downloaded by most users |
| Frontend JS | Vendor chunks (react, router, xlsx) | Better long-term browser caching |
| Security | `postcss` vulnerability patched | Moderate XSS vuln closed |
| PM2 | Exponential backoff on crashes | No more rapid restart storms |
| PM2 | `max_memory_restart` 1 GB → 512 MB | Catches memory leaks earlier |
| PM2 | Structured log files | Easier debugging |
| nginx | gzip compression | JS: 248 KB → served as ~84 KB over the wire |
| nginx | Security headers (X-Frame, CSP, etc.) | Closes common browser-level attack vectors |
| Logo | Manual compression step | 1.1 MB → ~130 KB (pending step 7) |

---

## xlsx vulnerability note

The `xlsx` package has a known high-severity vulnerability with **no upstream fix available**.
Your usage is safe because:

- **Backend**: only reads a known seed file offline — no user-uploaded files are parsed.
- **Frontend**: only *exports* data to Excel — it never *parses* an uploaded file.

The vulnerability (prototype pollution + ReDoS) only triggers when parsing **malicious user-uploaded Excel files**. Do not add any feature that parses user-uploaded `.xlsx` files without a server-side sanitization layer.
