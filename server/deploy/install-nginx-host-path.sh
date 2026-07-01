#!/bin/sh
set -eu

target=/etc/nginx/sites-enabled/mirofish-gskj-cloud
include_line='    include /etc/nginx/snippets/funds-api.conf;'

test -f "$target"
if grep -Fq "$include_line" "$target"; then
    nginx -t
    systemctl reload nginx
    exit 0
fi

mkdir -p /etc/nginx/backups
cp "$target" /etc/nginx/backups/mirofish-gskj-cloud.before-funds
awk -v include_line="$include_line" '
BEGIN { depth = 0 }
{
    if ($0 == "}" && depth == 1) print include_line
    print
    opens = gsub(/{/, "{")
    closes = gsub(/}/, "}")
    depth += opens - closes
}
' "$target" > "$target.funds-new"
mv "$target.funds-new" "$target"

nginx -t
systemctl reload nginx
