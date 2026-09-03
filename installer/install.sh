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
	*) fail "Millida Launcher собирается только под x86_64, а здесь $arch. Напишите нам: millida.net/support" ;;
	esac
	;;
Darwin)
	case "$arch" in
	arm64 | aarch64) name="millida-launcher-setup-darwin-aarch64" ;;
	x86_64) name="millida-launcher-setup-darwin-x86_64" ;;
	*) fail "Неизвестный процессор Mac: $arch. Напишите нам: millida.net/support" ;;
	esac
	;;
*)
	fail "Эта система не поддерживается: $os. Установщик для Windows — на millida.net/launcher"
	;;
esac

if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -q --https-only -O "$2" "$1"; }
else
	fail "Нужен curl или wget, но их нет в системе"
fi

if command -v sha256sum >/dev/null 2>&1; then
	digest() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
	digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
	fail "Нужен sha256sum или shasum, но их нет в системе"
fi

work=$(mktemp -d 2>/dev/null || mktemp -d -t millida-setup)
trap 'rm -rf "$work"' EXIT INT TERM HUP

echo "Скачиваем установщик Millida Launcher…"
fetch "$base/$name" "$work/setup" || fail "Не скачался установщик. Проверьте подключение к интернету."
fetch "$base/$name.sha256" "$work/setup.sha256" || fail "Не скачалась контрольная сумма установщика."

expected=$(cut -d' ' -f1 <"$work/setup.sha256")
actual=$(digest "$work/setup")
[ -n "$expected" ] || fail "Пустая контрольная сумма установщика."
[ "$expected" = "$actual" ] || fail "Установщик скачался повреждённым, запустите установку ещё раз."

chmod +x "$work/setup"
"$work/setup"
