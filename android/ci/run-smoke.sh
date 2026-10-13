#!/usr/bin/env bash
# Runs on the GitHub build machine while a virtual phone is on. Always exits 0: results are read from the log.
python3 -m http.server 8765 --directory smoke-site >/dev/null 2>&1 &
sleep 2
adb install -r apk-out/debug-for-test.apk || { echo "FAIL could not install the app" > smoke-android.log; exit 0; }
adb logcat -c
adb shell am start -n com.justnew.rockmines.worktrail/.MainActivity --es smoke 1 --es url http://10.0.2.2:8765/worktrail/
for i in $(seq 1 100); do
  if adb logcat -d -s WTSMOKE:V | grep -q WTSMOKE_DONE; then break; fi
  sleep 2
done
adb logcat -d -s WTSMOKE:V > smoke-android.log
echo "---- other errors ----" >> smoke-android.log
adb logcat -d -s AndroidRuntime:E chromium:E | tail -30 >> smoke-android.log
cat smoke-android.log
exit 0
