#!/usr/bin/env bash

# One production content policy is shared by the base APK and every signed hot-update bundle.
export VITE_DRAMA_MOCK_REWARD_AD="false"
export VITE_DRAMA_REAL_CONTENT_REQUIRED="true"

# Older signed native shells do not expose SkitRuntimeUpdate. Embed the exact
# base-APK runtime identity so protected ad-session requests remain compatible.
if [[ -n "${SKIT_VERSION_NAME:-}" ]]; then
  export VITE_SKIT_NATIVE_VERSION="$SKIT_VERSION_NAME"
fi
if [[ -n "${SKIT_RUNTIME_PROTOCOL_VERSION:-}" ]]; then
  export VITE_SKIT_AD_PROTOCOL_VERSION="$SKIT_RUNTIME_PROTOCOL_VERSION"
fi
