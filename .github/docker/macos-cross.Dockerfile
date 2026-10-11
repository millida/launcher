# Тулчейн для сборки macOS-бандлов на Linux-раннере. Минута macOS-раннера стоит
# $0.16, минута Linux — $0.004, и вся разница между ними — это компилятор и
# несколько утилит упаковки, которые здесь и лежат.
#
# osxcross даёт clang + cctools (ld64, lipo, install_name_tool) + macOS SDK.
# Образ crazy-max собирается из исходников Apple SDK, извлечённых из Xcode;
# лицензию Xcode нужно принимать самостоятельно — см. .github/docs/MACOS-CROSS.md.
ARG OSXCROSS_TAG=15.5-debian
FROM ghcr.io/crazy-max/osxcross:${OSXCROSS_TAG} AS osxcross

# База обязана совпадать с той, на которой собран образ osxcross: его clang и
# cctools слинкованы динамически, и на bookworm падают с «GLIBC_2.38 not found».
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# xorriso пишет файловую систему образа (HFS+ и ISO9660), libdmg-hfsplus
# заворачивает её в UDIF — без этой обёртки Finder образ не смонтирует;
# llvm-ar/ranlib нужны крейтам, которые компилируют C для Mach-O (ring).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    unzip \
    git \
    make \
    cmake \
    g++ \
    zlib1g-dev \
    python3 \
    python3-pip \
    librsvg2-bin \
    imagemagick \
    llvm \
    clang \
    libc6-dev \
    xorriso \
    file \
  && rm -rf /var/lib/apt/lists/*

# Единственный способ собрать настоящий .dmg без macOS: hdiutil здесь заменяет
# `dmg` из libdmg-hfsplus. Код 2018 года, отсюда и стандарт языка тех лет —
# gcc 14 иначе считает ошибкой то, что тогда было предупреждением. Заголовков
# OpenSSL в образе быть не должно: с ними собирается ещё и работа с FileVault,
# написанная под OpenSSL 1.0, и сборка падает на непрозрачном HMAC_CTX.
ARG LIBDMG_COMMIT=7ac55ec64c96f7800d9818ce64c79670e7f02b67
RUN curl -fsSL "https://github.com/planetbeing/libdmg-hfsplus/archive/${LIBDMG_COMMIT}.tar.gz" -o /tmp/libdmg.tar.gz \
  && mkdir -p /tmp/libdmg \
  && tar -xzf /tmp/libdmg.tar.gz -C /tmp/libdmg --strip-components=1 \
  && cmake -S /tmp/libdmg -B /tmp/libdmg/build \
     -DCMAKE_BUILD_TYPE=Release \
     -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
     -DCMAKE_C_FLAGS="-std=gnu89 -w" \
  && make -C /tmp/libdmg/build -j"$(nproc)" dmg-bin \
  && install -m 0755 /tmp/libdmg/build/dmg/dmg /usr/local/bin/dmg \
  && rm -rf /tmp/libdmg /tmp/libdmg.tar.gz

# Оформление окна образа лежит в .DS_Store, а он ссылается на фон записью
# alias — её нельзя получить от пути, который не смонтирован. ds_store и
# mac_alias собирают файл целиком на Linux. Debian закрывает системный python
# от pip, а внутри образа сборки ломать нечего — ставим прямо в него.
RUN pip3 install --no-cache-dir --break-system-packages ds_store==1.3.1 mac_alias==2.2.2

COPY --from=osxcross /osxcross /osxcross

ENV PATH="/osxcross/bin:${PATH}"
ENV LD_LIBRARY_PATH="/osxcross/lib:${LD_LIBRARY_PATH}"

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/bun/bin:${PATH}

ARG RUST_VERSION=stable
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
  && sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
     --default-toolchain "${RUST_VERSION}" \
     --target aarch64-apple-darwin --target x86_64-apple-darwin \
  && rm /tmp/rustup-init.sh \
  && chmod -R a+w "${RUSTUP_HOME}" "${CARGO_HOME}"

ENV BUN_INSTALL=/usr/local/bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"

# rcodesign — замена codesign: подписывает .app с Linux, умеет ad-hoc (как
# signingIdentity "-" в tauri.conf.json), .p12 и нотаризацию через Apple API.
ARG RCODESIGN_VERSION=0.29.0
RUN curl -fsSL -o /tmp/rcodesign.tar.gz \
    "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
  && tar -xzf /tmp/rcodesign.tar.gz -C /tmp \
  && install -m 0755 "/tmp/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl/rcodesign" /usr/local/bin/rcodesign \
  && rm -rf /tmp/rcodesign.tar.gz "/tmp/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl"

# Кросс-компилятор для крейтов с C-кодом и линкер для Rust. oa64/o64 — симлинки
# osxcross на clang с уже подставленным -target и -isysroot, поэтому SDKROOT
# отдельно задавать не нужно (и не стоит: он ломает пути в некоторых версиях).
ENV CC_aarch64_apple_darwin=oa64-clang \
    CXX_aarch64_apple_darwin=oa64-clang++ \
    AR_aarch64_apple_darwin=llvm-ar \
    RANLIB_aarch64_apple_darwin=llvm-ranlib \
    CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=oa64-clang \
    CC_x86_64_apple_darwin=o64-clang \
    CXX_x86_64_apple_darwin=o64-clang++ \
    AR_x86_64_apple_darwin=llvm-ar \
    RANLIB_x86_64_apple_darwin=llvm-ranlib \
    CARGO_TARGET_X86_64_APPLE_DARWIN_LINKER=o64-clang

RUN rcodesign --version && xorriso --version 2>&1 | head -n1 && dmg 2>&1 | head -n1 \
  && rsvg-convert --version && magick --version | head -n1 \
  && python3 -c "import ds_store, mac_alias; print('ds_store и mac_alias на месте')" \
  && oa64-clang --version | head -n1
