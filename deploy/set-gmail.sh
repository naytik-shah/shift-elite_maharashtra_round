#!/usr/bin/env bash
# Switches the stack to real email through Gmail, so login codes arrive in the person's inbox.
#
#   bash deploy/set-gmail.sh
#
# You need a Gmail account with 2-Step Verification on, and an App password for it:
#   Google Account > Security > 2-Step Verification > App passwords (16 characters)
# The password is typed here, never put in chat or in git. It is written only to deploy/.env, which is ignored by git.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-deploy/.env}"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing. Copy deploy/.env.example first." >&2; exit 1; }

read -r -p "Gmail address: " addr
read -r -s -p "App password (typing is hidden): " pass
echo
pass="${pass// /}"   # Google shows it in groups of four
if [[ ! "$addr" =~ ^[^@[:space:]]+@(gmail|googlemail)\.com$ ]]; then echo "That does not look like a Gmail address." >&2; exit 1; fi
if [ "${#pass}" -ne 16 ]; then echo "An app password has 16 characters. Check it and try again." >&2; exit 1; fi

ADDR="$addr" PASS="$pass" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os, re
p = os.environ['ENV_FILE']
s = open(p).read()
vals = {
    'SMTP_HOST': 'smtp.gmail.com',
    'SMTP_PORT': '465',
    'SMTP_USER': os.environ['ADDR'],
    'SMTP_PASS': os.environ['PASS'],
    'MAIL_FROM': 'Fair Drop <%s>' % os.environ['ADDR'],
}
for k, v in vals.items():
    line = '%s=%s' % (k, v)
    if re.search(r'^%s=.*$' % k, s, flags=re.M):
        s = re.sub(r'^%s=.*$' % k, lambda m: line, s, flags=re.M)
    else:
        s += '\n' + line + '\n'
open(p, 'w').write(s)
PY
echo "Saved to $ENV_FILE."
[ "${DRY_RUN:-}" = "1" ] && exit 0

COMPOSE_EXTRA="-f deploy/docker-compose.expose.yml" bash deploy/up.sh

echo "Checking the login with Gmail..."
if docker compose -f deploy/docker-compose.yml exec -T api1 node -e "
const nodemailer = require('nodemailer');
nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  .verify().then(() => { console.log('Gmail accepted the login.'); process.exit(0); }).catch((e) => { console.error('Gmail refused it: ' + e.message); process.exit(1); });
"; then
  echo "Done. Real codes now go by email. Start the web app without the test key (the web-live config on port 5181) to see them arrive."
else
  echo "Gmail did not accept those details. Check the address and the app password, then run this again." >&2
  exit 1
fi
