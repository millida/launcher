#!/bin/sh
set -eu

base="https://launcher-storage.millida.net/setup"

fail() {
	echo "$1" >&2
	exit 1
}

os=$(uname -s 2>/dev/null || echo unknown)
arch=$(uname -m 2>/dev/null || echo unknown)

case "$os" in
Linux)
	case "$arch" in
	x86_64 | amd64) name="millida-launcher-setup-linux-x86_64" ;;
	*) fail "Millida Launcher is built only for x86_64, but this machine is $arch. Contact us: millida.net/support" ;;
	esac
	;;
Darwin)
	case "$arch" in
	arm64 | aarch64) name="millida-launcher-setup-darwin-aarch64" ;;
	x86_64) name="millida-launcher-setup-darwin-x86_64" ;;
	*) fail "Unknown Mac processor: $arch. Contact us: millida.net/support" ;;
	esac
	;;
*)
	fail "This system is not supported: $os. The Windows installer is at millida.net/launcher"
	;;
esac

if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -q --https-only -O "$2" "$1"; }
else
	fail "curl or wget is required, but neither is installed"
fi

if command -v sha256sum >/dev/null 2>&1; then
	digest() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
	digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
	fail "sha256sum or shasum is required, but neither is installed"
fi

work=$(mktemp -d 2>/dev/null || mktemp -d -t millida-setup)
trap 'rm -rf "$work"' EXIT INT TERM HUP

echo "Downloading the Millida Launcher installer..."
fetch "$base/$name" "$work/setup" || fail "The installer failed to download. Check your internet connection."
fetch "$base/$name.sha256" "$work/setup.sha256" || fail "The installer checksum failed to download."

expected=$(cut -d' ' -f1 <"$work/setup.sha256")
actual=$(digest "$work/setup")
[ -n "$expected" ] || fail "The installer checksum is empty."
[ "$expected" = "$actual" ] || fail "The installer downloaded corrupted. Run the installation again."

chmod +x "$work/setup"
"$work/setup"
