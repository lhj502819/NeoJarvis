#!/bin/bash
# dev 模式下 macOS 菜单栏第一项从 Info.plist 的 CFBundleName 读,不受 app.setName / productName 影响。
# npm install 后运行,把 Electron.app 的 bundle 名改成 J.A.R.V.I.S,dev 时菜单栏才对。
# 打包(electron-builder --mac)不受这个影响 —— productName 已配置,打包会另建 J.A.R.V.I.S.app。
set -e
APP_NAME="J.A.R.V.I.S"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLIST="$DESKTOP_DIR/node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "[patch-electron-name] $PLIST 不存在,跳过(可能 electron 未装或版本变更)"
  exit 0
fi
CUR=$(/usr/libexec/PlistBuddy -c "Print :CFBundleName" "$PLIST" 2>/dev/null || echo "")
if [ "$CUR" = "$APP_NAME" ]; then
  echo "[patch-electron-name] 已是 $APP_NAME,跳过"
  exit 0
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST"
# 刷 LaunchServices 缓存,让 macOS 立刻用新名字
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$(dirname "$PLIST")/.." 2>/dev/null || true
echo "[patch-electron-name] Info.plist CFBundleName/DisplayName → $APP_NAME"
