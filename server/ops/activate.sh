#!/usr/bin/env bash
set -euo pipefail
root=/opt/sts2stats-tauri
service=sts2stats-tauri
action=${1:-}
exec 9>"$root/.deploy.lock"
flock -w 60 9

health() {
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl --fail --silent --show-error http://172.25.0.1:18765/api/v1/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
public_health() {
  curl --fail --silent --show-error https://sts2stats.quaternijkon.online/api/v1/health >/dev/null &&
    curl --fail --silent --show-error https://sts2stats.quaternijkon.online/build-info.json -o "$root/.health-manifest" &&
    cmp -s "$root/.health-manifest" "$root/current/BUILD-INFO.json"
}
switch_release() {
  ln -sfn "$1" "$root/.next" || return 1
  mv -Tf "$root/.next" "$root/current" || return 1
  systemctl restart "$service" || return 1
  health
}
if [[ "$action" == rollback ]]; then
  previous=$(readlink "$root/previous")
  current=$(readlink "$root/current")
  [[ -f "$root/$previous/server/main.mjs" ]]
  switch_release "$previous"
  ln -sfn "$current" "$root/previous"
  public_health
  exit 0
fi
[[ "$action" == deploy && "${2:-}" =~ ^[0-9TZ]+-[a-f0-9]{12}$ ]]
release="releases/$2"
[[ -x "$root/$release/runtime/bin/node" ]]
[[ -f "$root/$release/web/index.html" ]]
id -u sts2stats-sync >/dev/null 2>&1 || useradd --system --home-dir /var/lib/sts2stats-tauri --shell /usr/sbin/nologin sts2stats-sync
install -d -o sts2stats-sync -g sts2stats-sync -m 700 /var/lib/sts2stats-tauri
if [[ ! -e /etc/sts2stats-tauri.env ]]; then
  umask 077
  cat >/etc/sts2stats-tauri.env <<'ENV'
STS_BIND=172.25.0.1
STS_PORT=18765
STS_ORIGIN=https://sts2stats.quaternijkon.online
STS_WEB_ROOT=/opt/sts2stats-tauri/current/web
STS_DATABASE=/var/lib/sts2stats-tauri/sync.sqlite
STS_TRUST_PROXY=1
ENV
fi
install -m 644 "$root/$release/server/ops/sts2stats-tauri.service" /etc/systemd/system/sts2stats-tauri.service
install -m 644 "$root/$release/server/ops/sts2stats-backup.service" /etc/systemd/system/sts2stats-backup.service
install -m 644 "$root/$release/server/ops/sts2stats-backup.timer" /etc/systemd/system/sts2stats-backup.timer
systemctl daemon-reload
previous=$(readlink "$root/current" || true)
if ! switch_release "$release"; then
  if [[ -n "$previous" ]]; then switch_release "$previous"; else systemctl stop "$service"; rm -f "$root/current"; fi
  echo 'Activation failed; restored the previous service' >&2
  exit 1
fi
if [[ -n "$previous" && "$previous" != "$release" ]]; then ln -sfn "$previous" "$root/previous"; fi
if ! bash "$root/$release/server/ops/proxy.sh"; then
  if [[ -n "$previous" ]]; then switch_release "$previous"; else systemctl stop "$service"; rm -f "$root/current"; fi
  exit 1
fi
systemctl enable "$service" sts2stats-backup.timer >/dev/null
systemctl start sts2stats-backup.timer
rm -f "$root/incoming/$2.tar.gz"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if public_health; then exit 0; fi
  sleep 1
done
if [[ -n "$previous" ]]; then switch_release "$previous"; else systemctl stop "$service"; rm -f "$root/current"; fi
exit 1
