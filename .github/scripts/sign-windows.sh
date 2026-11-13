#!/usr/bin/env bash
# Authenticode-signs the given PE files in place with the Certum SimplySign cloud
# certificate (CERTUM_EMAIL, CERTUM_OTP). Runs only in jobs that install no
# project dependencies, so no third-party build code ever sees the OTP seed.
set -euo pipefail

SSIGN_VERSION=v0.1.11
SSIGN_SHA256=54f49ed781fe9284d0f704faf1ca28175f21ea19881abc3fae62437146edc18f

if [ "$#" -eq 0 ]; then
  echo "::error::no files to sign"
  exit 1
fi

tools="${RUNNER_TEMP:-/tmp}/ssign"
mkdir -p "$tools"
curl -fsSL --retry 5 -o "$tools/ssign.tar.gz" \
  "https://github.com/Le-Syl21/ssign/releases/download/$SSIGN_VERSION/ssign-linux-x86_64.tar.gz"
echo "$SSIGN_SHA256  $tools/ssign.tar.gz" | sha256sum -c -
tar -xzf "$tools/ssign.tar.gz" -C "$tools"
ssign="$tools/ssign"
[ -x "$ssign" ] || { echo "::error::ssign binary not found in the release archive"; exit 1; }

if ! command -v osslsigncode > /dev/null; then
  sudo apt-get install -y osslsigncode > /dev/null || { sudo apt-get update > /dev/null && sudo apt-get install -y osslsigncode > /dev/null; }
fi

here=$(dirname "$0")
for f in "$@"; do
  name=$(basename "$f")
  # The Authenticode digest excludes the signature: an unchanged digest proves
  # the signed file is the one that was built.
  built=$(node "$here/pe-digest.mjs" "$f" | cut -d' ' -f1)
  "$ssign" "$f"
  signed=$(node "$here/pe-digest.mjs" "$f" | cut -d' ' -f1)
  if [ -z "$built" ] || [ "$built" != "$signed" ]; then
    echo "::error::signed $name is not the file that was built"
    exit 1
  fi
  osslsigncode verify -in "$f" \
    -CAfile /etc/ssl/certs/ca-certificates.crt \
    -TSA-CAfile /etc/ssl/certs/ca-certificates.crt > "$tools/verify.log" || { cat "$tools/verify.log"; exit 1; }
  echo "$name: signed"
done
