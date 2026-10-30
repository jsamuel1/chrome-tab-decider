#!/usr/bin/env bash
# Set up a Google Cloud project, branded for sauhsoj.wtf, whose OAuth client publishes this
# publisher's Chrome extensions, then point every repo's Chrome Web Store secrets at it.
#
#   scripts/gcloud-oauth-setup.sh [project-id]
#
# gcloud does the parts Google has an API for: the project and the Chrome Web Store API. The
# consent screen and a "Desktop app" OAuth client have no public API, so for those the script
# opens the Console page with what to enter, then waits for the client's JSON download. It
# stores the client ID and secret as secrets of each repo's chrome-web-store environment without
# printing them, deletes the download, and mints a refresh token with
# cws-refresh-token.mjs --from-github.
#
# Safe to re-run: an existing project and an enabled API are left as they are.
set -euo pipefail

PROJECT_ID=${1:-sauhsoj-dev} # IDs are permanent; this one predates the move to sauhsoj.wtf
PROJECT_NAME="sauhsoj-wtf"   # project display names may not contain "."
APP_NAME="sauhsoj.wtf"       # what the consent screen shows
DOMAIN="sauhsoj.wtf"
SITE="https://me.sauhsoj.wtf"
CLIENT_NAME="Chrome Web Store publishing"
REPOS=(jsamuel1/chrome-tab-decider jsamuel1/chrome-copy-url)
ENVIRONMENT="chrome-web-store" # protected: only main and v* tags can read its secrets
CONSOLE="https://console.cloud.google.com/auth"
here=$(cd "$(dirname "$0")" && pwd)
account=$(gcloud config get-value account 2>/dev/null)

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
open_page() { echo "  $1"; open "$1" 2>/dev/null || true; }

step "1. Project $PROJECT_ID (as $account)"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  already exists"
else
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi

step "2. Chrome Web Store API"
gcloud services enable chromewebstore.googleapis.com --project="$PROJECT_ID"

step "3. Consent screen (no API for this: set it up in the Console)"
cat <<EOF
  Branding → Get started:  app name "$APP_NAME", support email $account,
                           audience External, contact email $account
  Branding:                home page $SITE/, privacy policy $SITE/privacy.html,
                           terms of service $SITE/terms.html, authorized domain $DOMAIN
  Audience:                Publish app (in Testing, refresh tokens die after 7 days)
EOF
open_page "$CONSOLE/branding?project=$PROJECT_ID"
read -rp "  Press Enter once the consent screen is saved… "

step "4. OAuth client (no API for this: create it in the Console)"
echo "  Application type Desktop app, name \"$CLIENT_NAME\"."
echo "  In the dialog that shows the secret, click Download JSON."
marker=$(mktemp)
open_page "$CONSOLE/clients/create?project=$PROJECT_ID"
echo "  Waiting for client_secret_*.json in ~/Downloads…"
json=""
until [ -n "$json" ]; do
  sleep 2
  json=$(find ~/Downloads -maxdepth 1 -name 'client_secret_*.json' -newer "$marker" | head -1)
done
rm -f "$marker"

# Read one field of the downloaded client without echoing it. "installed" means a Desktop
# app client; a "web" client would reject the token script's loopback redirect.
field() {
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (!j.installed) { console.error("This is not a Desktop app client: create one of type Desktop app."); process.exit(1); }
    process.stdout.write(j.installed[process.argv[2]]);
  ' "$json" "$1"
}
field client_id >/dev/null # fail before touching any secret

step "5. GitHub secrets ($ENVIRONMENT environment)"
for repo in "${REPOS[@]}"; do
  field client_id | gh secret set CWS_CLIENT_ID --repo "$repo" --env "$ENVIRONMENT"
  field client_secret | gh secret set CWS_CLIENT_SECRET --repo "$repo" --env "$ENVIRONMENT"
done
rm -f "$json"
echo "  Deleted $(basename "$json") from Downloads."

step "6. Refresh token"
node "$here/cws-refresh-token.mjs" --from-github "${REPOS[@]}"
