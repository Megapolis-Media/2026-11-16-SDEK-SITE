#!/usr/bin/env sh
# /etc/letsencrypt/renewal-hooks/deploy/cdek-nginx
set -eu
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
