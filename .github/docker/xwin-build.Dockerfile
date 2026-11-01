# Windows release builds run in this image: cargo-xwin cross-compiles against the
# MSVC CRT and Windows SDK, and makensis packs the installer. Microsoft's servers
# took 13 minutes to hand over the SDK and the Actions cache kept evicting it, so
# it is downloaded once here, when main rebuilds the image.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# tauri-cli looks for an appindicator library on the build host even for a
# Windows target.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      unzip \
      xz-utils \
      build-essential \
      pkg-config \
      file \
      nsis \
      lld \
      llvm \
      clang \
      libayatana-appindicator3-dev \
      osslsigncode \
 && apt-get clean

ARG CARGO_XWIN_VERSION=0.18.4
ARG CARGO_XWIN_SHA256=35d05e10b12e0f8d56bf25a4bb77700c1369e7d8db63e82a09c2dcf536c6ed71
RUN curl -fsSL --retry 5 -o /tmp/cargo-xwin.tar.gz \
      "https://github.com/rust-cross/cargo-xwin/releases/download/v${CARGO_XWIN_VERSION}/cargo-xwin-v${CARGO_XWIN_VERSION}.x86_64-unknown-linux-musl.tar.gz" \
 && echo "${CARGO_XWIN_SHA256}  /tmp/cargo-xwin.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/cargo-xwin.tar.gz -C /usr/local/bin \
 && rm /tmp/cargo-xwin.tar.gz

ENV XWIN_CACHE_DIR=/opt/xwin

# cargo-xwin fetches the SDK on its first build. A throwaway toolchain builds an
# empty crate to trigger it and is removed again; the release job installs its own.
RUN curl -fsSL --retry 5 https://sh.rustup.rs | sh -s -- -y --profile minimal --target x86_64-pc-windows-msvc --no-modify-path \
 && . "$HOME/.cargo/env" \
 && cargo new --quiet /tmp/warm \
 && cd /tmp/warm \
 && cargo xwin build --release --target x86_64-pc-windows-msvc \
 && cd / \
 && rm -rf /tmp/warm "$HOME/.cargo" "$HOME/.rustup" \
 && chmod -R a+rX /opt/xwin
