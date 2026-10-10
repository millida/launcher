#!/usr/bin/env bash
set -eu

bundle="src-tauri/target/$TARGET/release/bundle"
out="upload/$TARGET"
mkdir -p "$out"

find "$bundle" -type f \( \
  -name '*.exe' -o -name '*.msi' -o -name '*.dmg' -o -name '*.tar.gz' \
  -o -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \
\) -print0 | while IFS= read -r -d '' f; do
  cp "$f" "$out/$(basename "$f" | tr ' ' '-')"
done

updater=$(find "$bundle/$UPDATER_DIR" -type f -name "$UPDATER_PATTERN" | head -n1)
if [ -z "$updater" ]; then
  echo "::error::updater artifact $UPDATER_DIR/$UPDATER_PATTERN not found"
  exit 1
fi

extra=""
read -r -a specs <<< "${UPDATER_EXTRA:-}"
for spec in "${specs[@]}"; do
  IFS=: read -r extra_dir extra_pattern extra_key <<< "$spec"
  package=$(find "$bundle/$extra_dir" -type f -name "$extra_pattern" | head -n1)
  if [ -z "$package" ]; then
    echo "::error::package $extra_dir/$extra_pattern not found, $extra_key would get no updates"
    exit 1
  fi
  entry=$(printf '{"key":"%s","file":"%s"}' "$extra_key" "$(basename "$package" | tr ' ' '-')")
  extra="$extra${extra:+,}$entry"
done

printf '{"key":"%s","file":"%s","extra":[%s]}\n' "$UPDATER_KEY" "$(basename "$updater" | tr ' ' '-')" "$extra" > "$out/updater.json"
cat "$out/updater.json"
