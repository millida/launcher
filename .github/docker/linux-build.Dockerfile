# Linux release builds run in this image instead of installing 700 packages on
# every run. AppImage takes GLib, GTK and WebKit from the build machine, so the
# base is the oldest supported Ubuntu, and the list must stay the one in
# release-public.yml: that step installs whatever an older image lacks.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y \
      ca-certificates \
      curl \
      git \
      unzip \
      xz-utils \
      pkg-config \
      libwebkit2gtk-4.1-dev \
      libappindicator3-dev \
      librsvg2-dev \
      patchelf \
      libxdo-dev \
      libasound2-dev \
      libssl-dev \
      build-essential \
      file \
      wget \
      xdg-utils \
      desktop-file-utils \
      binutils \
      libgstreamer1.0-0 \
      libgstreamer-plugins-base1.0-0 \
      gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good \
      gstreamer1.0-plugins-bad \
      gstreamer1.0-libav \
      gstreamer1.0-gl \
      gstreamer1.0-pulseaudio \
      gstreamer1.0-alsa \
 && apt-get clean
