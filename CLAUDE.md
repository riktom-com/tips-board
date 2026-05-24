# tips-board — South Georgia Field Reports

**Live at:** https://tips.riktom.com

**Last updated:** 2026-05-24 — Image upload feature added (JPG/PNG/WebP, 4 per post, max 8 MB each)

## Stack
- FastAPI + SQLite backend (port 8008)
- Static HTML/CSS/JS frontend with FileReader image preview
- No user accounts — name + email per post/reply
- Image uploads with Pillow validation, UUID filenames, immutable cache headers

## Features
- **Posts:** Create tips, reports, fishing/hunting sightings
- **Image uploads:** Up to 4 photos per post (JPG/PNG/WebP), max 8 MB each
- **Gallery view:** Post detail shows thumbnail gallery, full-size images on click
- **Image count badge:** Feed cards display 📷 badge if post has photos
- **Upload progress:** Sequential upload with feedback ("Uploading photos 1/3…")

## Database
- `posts` table: id, name, email, category (fishing|hunting|ramps|camping|general), area, title, body, created_at
- `post_images` table: id, post_id, filename (UUID), created_at. CASCADE delete on post removal.

## Files
- `backend/main.py` — FastAPI app with image validation (MIME types, Pillow verify, size limits)
- `backend/requirements.txt` — includes python-multipart, Pillow
- `frontend/index.html` — single-page app with image picker form, gallery view
- `frontend/js/app.js` — all fetch/render logic, FileReader preview, sequential image upload
- `frontend/css/style.css` — image picker styles, gallery, badge

## Deploy
```bash
# Backend
rsync -az -e "ssh -i ~/.ssh/riktom_vps" backend/ root@72.62.83.12:/opt/tips-board/backend/
# Frontend
rsync -az -e "ssh -i ~/.ssh/riktom_vps" frontend/ root@72.62.83.12:/opt/tips-board/frontend/
```

## Systemd
Service: `tips-api.service` on port 8008
Environment variables: DB_PATH, UPLOAD_DIR (both via `Environment=...`)

### Example systemd unit `/etc/systemd/system/tips-api.service`
```ini
[Unit]
Description=South Georgia Field Reports API
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/tips-board/backend
ExecStart=/opt/tips-board/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8008
Restart=always
Environment=DB_PATH=/opt/tips-board/tips.db
Environment=UPLOAD_DIR=/opt/tips-board/uploads

[Install]
WantedBy=multi-user.target
```

## Nginx
Config at `/etc/nginx/sites-available/tips.riktom.com`
- Static at `/opt/tips-board/frontend`
- `/api/` → proxy_pass http://127.0.0.1:8008/api/
- `/uploads/` → alias /opt/tips-board/uploads/ (cached 30 days, immutable)
- `client_max_body_size 10m` — allow up to 10 MB uploads

### Example nginx config
```nginx
server {
    listen 80;
    server_name tips.riktom.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name tips.riktom.com;

    ssl_certificate     /etc/letsencrypt/live/tips.riktom.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tips.riktom.com/privkey.pem;

    client_max_body_size 10m;

    root /opt/tips-board/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8008/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        alias /opt/tips-board/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

## DNS
Add A record: `tips` → `72.62.83.12` in Squarespace DNS panel

## Setup on VPS
```bash
# Create dirs
mkdir -p /opt/tips-board/{backend,frontend}

# Python venv
python3 -m venv /opt/tips-board/venv
/opt/tips-board/venv/bin/pip install -r /opt/tips-board/backend/requirements.txt

# SSL cert (after DNS propagates)
certbot --nginx -d tips.riktom.com

# Enable service
systemctl enable --now tips-api
```


## Standardized Nav (rk-nav)

This app uses the shared riktom.com nav block (scoped `.rk-*` classes, self-contained CSS) that is identical across all 13 riktom.com properties. The block is enclosed by marker comments:

```
<!-- rk-nav:start -->
... nav HTML + scoped style ...
<!-- rk-nav:end -->
```

**To update the nav site-wide** (add a new app, change a link, restyle):
1. Edit `sync/patch_local.py` in riktom-site root (local) or `/tmp/patch_navs.py` on the VPS with the new HTML.
2. Run the patcher — it finds the markers and replaces the block in place. The replace is idempotent.
3. For repos with React/Vite builds (e.g. fire-watcher), re-patch after rebuild since `dist/index.html` is regenerated.

Nav contents: Logo · About · Blog · Apps ▾ (12 apps) · 💡 Suggest · 🏠 Home (top-right white pill). Apps: RiverWatch, Fire Watcher, Hunt & Fish Forecast, Hunting Tracker, Truck Finder, Burn Permit, Ramp Radar, Field Reports, Deer Radar, Trip Planner, Night Sky, Family Fun Finder, Friday Night Scoreboard.
