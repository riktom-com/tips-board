# tips-board — South Georgia Field Reports

**Live at:** https://tips.riktom.com

## Stack
- FastAPI + SQLite backend (port 8008)
- Static HTML/CSS/JS frontend
- No user accounts — name + email per post/reply

## Files
- `backend/main.py` — FastAPI app
- `backend/requirements.txt`
- `frontend/index.html` — single-page app
- `frontend/js/app.js` — all fetch/render logic
- `frontend/css/style.css` — styles

## Deploy
```bash
# Backend
rsync -az -e "ssh -i ~/.ssh/riktom_vps" backend/ root@72.62.83.12:/opt/tips-board/backend/
# Frontend
rsync -az -e "ssh -i ~/.ssh/riktom_vps" frontend/ root@72.62.83.12:/opt/tips-board/frontend/
```

## Systemd
Service: `tips-api.service` on port 8008
DB path: `/opt/tips-board/tips.db` (set via `Environment=DB_PATH=...`)

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

[Install]
WantedBy=multi-user.target
```

## Nginx
Config at `/etc/nginx/sites-available/tips.riktom.com`
- Static at `/opt/tips-board/frontend`
- `/api/` → proxy_pass http://127.0.0.1:8008/api/

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
