#!/usr/bin/env bash
# Build and export the native ATHENA Windows prototype.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
LOCAL_DOTNET="$ROOT/tools/.cache/dotnet"
LOCAL_GODOT="$ROOT/tools/.cache/godot/Godot_v4.5-stable_mono_win64/Godot_v4.5-stable_mono_win64.exe"

if [ -x "$LOCAL_DOTNET/dotnet.exe" ]; then
  export DOTNET_ROOT="$LOCAL_DOTNET"
  export PATH="$LOCAL_DOTNET:$PATH"
  DOTNET="$LOCAL_DOTNET/dotnet.exe"
else
  DOTNET="$(command -v dotnet)"
fi

if [ -x "$LOCAL_GODOT" ]; then
  GODOT="$LOCAL_GODOT"
else
  GODOT="$(command -v godot || command -v godot4)"
fi

"$DOTNET" build "$ROOT/athena-desktop/AthenaDesktop.csproj"
mkdir -p "$ROOT/athena-desktop/build"
"$GODOT" --headless --path "$ROOT/athena-desktop" \
  --export-release "Windows Desktop" "$ROOT/athena-desktop/build/ATHENA.exe"

echo "Built $ROOT/athena-desktop/build/ATHENA.exe"
