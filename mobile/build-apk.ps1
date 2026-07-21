# Local release APK — unlimited, no EAS queue, no quota.
# Usage:  .\build-apk.ps1        (from mobile/)
# Output: android\app\build\outputs\apk\release\app-release.apk
#
# Notes:
# - Signed with the debug keystore, so the FIRST install over an EAS build
#   needs an uninstall. Between local builds, updates install cleanly.
# - cmake is pinned to 3.30.5 in android/local.properties: its ninja handles
#   Windows long paths, which the New Architecture codegen paths exceed.
# - Run `npx expo prebuild -p android --no-install` again only after adding
#   a native module or changing app.json plugins. Prebuild WIPES
#   android/local.properties; this script now rewrites it, so you don't have
#   to remember — and more importantly, don't have to remember the escaping.

$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME = "C:\venv\tools\android-sdk"
$env:SENTRY_DISABLE_AUTO_UPLOAD = "true"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

# .properties files treat backslash as an ESCAPE character: written with
# backslashes, C:\venv\tools becomes "\v" plus a literal TAB and gradle dies at
# configuration with "The filename, directory name, or volume label syntax is
# incorrect" — which points nowhere near the real cause. Forward slashes work
# fine on Windows and sidestep it entirely.
$localProps = "$PSScriptRoot\android\local.properties"
if (Test-Path "$PSScriptRoot\android") {
  @"
sdk.dir=C:/venv/tools/android-sdk
cmake.dir=C:/venv/tools/android-sdk/cmake/3.30.5
"@ | Out-File -FilePath $localProps -Encoding ascii
} else {
  Write-Host "No android/ directory — run: npx expo prebuild -p android --no-install" -ForegroundColor Yellow
  exit 1
}

Set-Location "$PSScriptRoot\android"
.\gradlew.bat assembleRelease
Set-Location $PSScriptRoot

$apk = "android\app\build\outputs\apk\release\app-release.apk"
if (Test-Path $apk) {
  Write-Host "`nAPK ready: $((Get-Item $apk).FullName)" -ForegroundColor Green
  Write-Host ("Size: {0:N1} MB" -f ((Get-Item $apk).Length / 1MB))
  Write-Host "Install directly with phone connected: adb install -r $apk"
}
