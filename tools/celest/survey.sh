#!/usr/bin/env bash
# survey.sh — read-only system survey, embedded into the celest binary.
# Changes nothing. Safe to run as a normal user (a few checks need root and
# are skipped silently if unavailable).

sep() { printf '\n\n===== %s =====\n' "$1"; }

sep "IDENTITY"
echo "host      : $(hostname -f 2>/dev/null || hostname)"
echo "date      : $(date -Is)"
echo "uptime    : $(uptime -p 2>/dev/null || uptime)"
echo "load      : $(cat /proc/loadavg 2>/dev/null)"
echo "user      : $(id)"
echo "sudo      : $(sudo -n true 2>/dev/null && echo 'passwordless YES' || echo 'no / needs password')"

sep "OS"
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null
echo "kernel    : $(uname -srm)"
echo "arch      : $(uname -m)"
echo "virtual   : $(systemd-detect-virt 2>/dev/null || echo unknown)"
echo "timezone  : $(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null)"

sep "CPU / MEMORY"
echo "cores     : $(nproc)"
grep -m1 'model name' /proc/cpuinfo 2>/dev/null
free -h 2>/dev/null
echo "swap      : $(swapon --show=NAME,SIZE --noheadings 2>/dev/null | tr '\n' ' ' || echo none)"

sep "DISK"
df -hT 2>/dev/null | grep -vE 'tmpfs|devtmpfs|overlay$'
echo "--- inodes ---"
df -i 2>/dev/null | grep -vE 'tmpfs|devtmpfs|overlay$' | head -8
echo "--- biggest dirs in \$HOME ---"
du -sh "$HOME"/* 2>/dev/null | sort -rh | head -12

sep "NETWORK"
ip -4 addr show 2>/dev/null | grep -E '^[0-9]+:|inet ' || ifconfig 2>/dev/null | head -30
echo "--- default route ---"
ip route 2>/dev/null | head -5
echo "--- listening ports ---"
(ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | head -30
echo "--- firewall ---"
sudo -n iptables -S 2>/dev/null | head -15 || echo "iptables: no access"
sudo -n ufw status 2>/dev/null | head -10 || echo "ufw: n/a"
echo "--- public ip ---"
curl -s -m 5 https://api.ipify.org 2>/dev/null || echo "n/a"

sep "SERVICES"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -30 || echo "no systemd"
echo "--- failed ---"
systemctl --failed --no-pager --no-legend 2>/dev/null | head -10

sep "CONTAINERS"
command -v docker >/dev/null && { sudo -n docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | head -20 || echo "docker present, no permission"; } || echo "docker: not installed"
command -v podman >/dev/null && podman ps -a 2>/dev/null | head -10

sep "RUNTIMES"
for c in python3 node npm pnpm yarn bun go rustc cargo java javac php ruby dotnet git gh docker psql mysql sqlite3 redis-cli nginx caddy; do
  p=$(command -v "$c" 2>/dev/null) && printf '%-10s %-26s %s\n' "$c" "$p" "$($c --version 2>&1 | head -1 | cut -c1-58)"
done

sep "HOME LAYOUT"
ls -la "$HOME" 2>/dev/null | head -40

sep "GIT REPOS (maxdepth 3)"
find "$HOME" -maxdepth 3 -name .git -type d 2>/dev/null | while read -r g; do
  d=$(dirname "$g")
  printf '\n%s\n  branch: %s\n  remote: %s\n  last  : %s\n  dirty : %s files\n' \
    "$d" \
    "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)" \
    "$(git -C "$d" remote get-url origin 2>/dev/null)" \
    "$(git -C "$d" log -1 --format='%h %ad %s' --date=short 2>/dev/null)" \
    "$(git -C "$d" status --porcelain 2>/dev/null | wc -l)"
done

sep "RECENT FILES (14d, excl. node_modules/.git/.cache)"
find "$HOME" -maxdepth 4 \( -name node_modules -o -name .git -o -name .cache \) -prune -o -type f -mtime -14 -print 2>/dev/null | head -15

sep "TOP PROCESSES (mem)"
ps aux --sort=-%mem 2>/dev/null | head -8

sep "CRON / TIMERS"
crontab -l 2>/dev/null | head -10 || echo "no user crontab"
sudo -n crontab -l -u root 2>/dev/null | head -10 | sed 's/^/root: /'
systemctl list-timers --no-pager --no-legend 2>/dev/null | head -8

sep "PACKAGES"
command -v apt >/dev/null && echo "apt: $(dpkg -l 2>/dev/null | grep -c '^ii') installed"
command -v dnf >/dev/null && echo "dnf: $(rpm -qa 2>/dev/null | wc -l) installed"

sep "END"
