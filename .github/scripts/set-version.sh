#!/usr/bin/env bash
set -eu

version="${1:-}"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::'$version' is not a release version"
  exit 1
fi

replace_first() {
  awk -v v="$version" -v pattern="$2" -v replacement="$3" \
    'BEGIN{d=0}{ if(!d && $0 ~ pattern){ sub(pattern "[^\"]*\"", replacement v "\""); d=1 } print }' "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}

replace_first src-tauri/tauri.conf.json '"version"[[:space:]]*:[[:space:]]*"' '"version": "'
grep -q "\"version\": \"$version\"" src-tauri/tauri.conf.json
echo "Version $version"
