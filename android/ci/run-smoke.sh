#!/usr/bin/env bash
# Runs on the GitHub build machine while a virtual phone is on. Always exits 0: results are read from the log.
{
  echo "script started $(date +%T)"
  python3 -m http.server 8765 --directory smoke-site >/dev/null 2>&1 &
  sleep 2
  adb install -r apk-out/debug-for-test.apk || { echo "FAIL could not install the app"; exit 0; }
  adb logcat -c
  echo "starting app $(date +%T)"
  adb shell am start -n com.justnew.rockmines.worktrail/.MainActivity --es smoke 1 --es url http://10.0.2.2:8765/worktrail/
  for i in $(seq 1 100); do
    if adb logcat -d -s WTSMOKE:V | grep -q WTSMOKE_DONE; then echo "smoke finished after $i checks $(date +%T)"; break; fi
    sleep 2
  done
  echo "finished waiting $(date +%T)"
  adb logcat -d -s WTSMOKE:V | sed 's/^[0-9-]* \([0-9:.]*\) *[0-9]* *[0-9]* /\1 /' | cut -c1-210
  echo "---- problems ----"
  adb logcat -d -s AndroidRuntime:E ActivityManager:E chromium:E | tail -20 | cut -c1-210
} > smoke-android.log 2>&1
cat smoke-android.log
exit 0
