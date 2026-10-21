#!/usr/bin/env bash
set -euo pipefail
domain=sts2stats.quaternijkon.online
proxy=/root/nginx-proxy-manager/data/nginx/proxy_host/98-sts2stats-tauri.conf
cert=/root/nginx-proxy-manager/letsencrypt/live/$domain/fullchain.pem
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
apply_config() {
  [[ ! -f "$proxy" ]] || cp -p "$proxy" "$proxy.previous"
  install -m 644 "$temporary" "$proxy"
  if ! docker exec nginx-proxy-manager nginx -t; then
    if [[ -f "$proxy.previous" ]]; then mv "$proxy.previous" "$proxy"; else rm -f "$proxy"; fi
    return 1
  fi
  docker exec nginx-proxy-manager nginx -s reload
}
http_config() {
  cat <<'CONF'
server {
  listen 80;
  listen [::]:80;
  server_name sts2stats.quaternijkon.online;
  include conf.d/include/letsencrypt-acme-challenge.conf;
  access_log off;
  location / { return 301 https://$host$request_uri; }
}
CONF
}
http_config >"$temporary"
if [[ ! -f "$cert" ]]; then
  apply_config
  docker exec nginx-proxy-manager /opt/certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w /data/letsencrypt-acme-challenge --cert-name "$domain" -d "$domain"
fi
http_config >"$temporary"
cat >>"$temporary" <<'CONF'
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name sts2stats.quaternijkon.online;
  ssl_certificate /etc/letsencrypt/live/sts2stats.quaternijkon.online/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sts2stats.quaternijkon.online/privkey.pem;
  include conf.d/include/ssl-cache.conf;
  include conf.d/include/ssl-ciphers.conf;
  access_log off;
  error_log /data/logs/sts2stats-tauri_error.log warn;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Frame-Options DENY always;
  client_max_body_size 256m;
  location / {
    proxy_pass http://172.25.0.1:18765;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 130s;
    proxy_send_timeout 130s;
    proxy_request_buffering off;
  }
}
CONF
apply_config
cat >/etc/systemd/system/sts2stats-certificate.service <<'UNIT'
[Unit]
Description=Renew the STS2Stats HTTPS certificate
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec nginx-proxy-manager /opt/certbot/bin/certbot renew --cert-name sts2stats.quaternijkon.online --quiet --deploy-hook "nginx -s reload"
UNIT
cat >/etc/systemd/system/sts2stats-certificate.timer <<'UNIT'
[Unit]
Description=Check the STS2Stats HTTPS certificate daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now sts2stats-certificate.timer >/dev/null
