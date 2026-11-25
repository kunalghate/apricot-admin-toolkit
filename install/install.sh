#!/bin/sh
# Apricot Admin Toolkit installer for Mac.
# Installs into your own user folder. No administrator password needed.
#
#   curl -fsSL https://raw.githubusercontent.com/kunalghate/apricot-admin-toolkit/main/install/install.sh | sh

set -e

REPO="kunalghate/apricot-admin-toolkit"
APP_NAME="Apricot Admin Toolkit"
DIR="$HOME/.apricot-admin-toolkit"
BIN="$DIR/apricot-toolkit"
LAUNCHER="$HOME/Applications/$APP_NAME.command"

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  *) ARCH="x64" ;;
esac
URL="https://github.com/$REPO/releases/latest/download/apricot-toolkit-macos-$ARCH.tar.gz"

echo ""
echo "  Installing $APP_NAME..."

# Close a running copy so it can be updated.
pkill -f "$BIN" 2>/dev/null || true

mkdir -p "$DIR" "$HOME/Applications"
TMP="$(mktemp -d)"
echo "  Downloading (about 35 MB)..."
if ! curl -fsSL "$URL" -o "$TMP/app.tar.gz"; then
  echo ""
  echo "  The download didn't work. Check your internet connection and try again."
  exit 1
fi
tar -xzf "$TMP/app.tar.gz" -C "$TMP"
mv -f "$TMP/apricot-toolkit" "$BIN"
chmod +x "$BIN"
rm -rf "$TMP"

# A double-clickable launcher. It opens a Terminal window; closing it stops the toolkit.
cat > "$LAUNCHER" <<EOF
#!/bin/sh
clear
exec "$BIN"
EOF
chmod +x "$LAUNCHER"

echo ""
echo "  Done! $APP_NAME is installed."
echo "  To start it later, open your Applications folder (in your home folder)"
echo "  and double-click \"$APP_NAME\". You can also find it with Spotlight."
echo ""
echo "  Starting it now..."
echo ""
exec "$BIN"
