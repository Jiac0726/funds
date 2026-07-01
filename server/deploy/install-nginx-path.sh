#!/bin/sh
set -eu

target=/etc/nginx/sites-enabled/saa
snippet=/etc/nginx/snippets/funds-api.conf

test -f "$target"
test -f "$snippet"
if ! grep -Fq 'include /etc/nginx/snippets/funds-api.conf;' "$target"; then
    mkdir -p /etc/nginx/backups
    cp "$target" /etc/nginx/backups/saa.before-funds
    sed -i '$i\    include /etc/nginx/snippets/funds-api.conf;' "$target"
fi

nginx -t
systemctl reload nginx
