package com.justnew.rockmines.worktrail;

import android.app.Activity;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Self-check used by the GitHub build on a virtual phone (test builds only).
 * Opens the app against a small test page and writes PASS / FAIL lines to the log.
 */
final class SmokeHook {
    private static final String TAG = "WTSMOKE";
    private static int failed = 0;
    // If Android restarts the app screen while the check runs, only the newest run reports.
    private static volatile Thread active;

    private static final class Superseded extends RuntimeException { }

    private static void ensureActive() {
        if (Thread.currentThread() != active) throw new Superseded();
    }

    private SmokeHook() { }

    private static void check(String name, boolean ok, String extra) {
        ensureActive();
        if (!ok) failed++;
        Log.i(TAG, (ok ? "PASS " : "FAIL ") + name + (extra == null ? "" : "  " + extra));
    }

    private static void check(String name, boolean ok) {
        check(name, ok, null);
    }

    private static String eval(final Activity a, final WebView w, final String js) throws Exception {
        final String[] out = new String[1];
        final CountDownLatch latch = new CountDownLatch(1);
        a.runOnUiThread(() -> w.evaluateJavascript(js, value -> {
            out[0] = value;
            latch.countDown();
        }));
        latch.await(15, TimeUnit.SECONDS);
        return out[0];
    }

    /** evaluateJavascript hands back JSON; this turns a JSON string result back into plain text. */
    private static String text(String json) {
        try {
            Object v = new JSONTokener(json).nextValue();
            return v == null ? "" : String.valueOf(v);
        } catch (Exception e) {
            return String.valueOf(json);
        }
    }

    /** WebView may only be touched on the main thread; this reads an address safely. */
    private static String urlOf(final Activity a, final WebView w) {
        final String[] out = new String[1];
        final CountDownLatch latch = new CountDownLatch(1);
        a.runOnUiThread(() -> {
            out[0] = String.valueOf(w.getUrl());
            latch.countDown();
        });
        try { latch.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        return out[0];
    }

    private static boolean waitFor(Activity a, java.util.concurrent.Callable<Boolean> cond, long ms) throws Exception {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            final Boolean[] r = new Boolean[1];
            final CountDownLatch l = new CountDownLatch(1);
            a.runOnUiThread(() -> {
                try { r[0] = cond.call(); } catch (Exception e) { r[0] = false; }
                l.countDown();
            });
            l.await(5, TimeUnit.SECONDS);
            if (Boolean.TRUE.equals(r[0])) return true;
            Thread.sleep(250);
        }
        return false;
    }

    static void run(final MainActivity a) {
        failed = 0;
        final Thread worker = new Thread(() -> {
            try {
                check("app started and welcome screen is showing",
                        waitFor(a, () -> a.overlayView().getUrl() != null && a.overlayView().getUrl().contains("splash/splash.html"), 20000),
                        urlOf(a, a.overlayView()));
                boolean bridged = false;
                for (int i = 0; i < 40 && !bridged; i++) {
                    bridged = "objectfunction".equals(text(eval(a, a.overlayView(), "(window.wt ? typeof window.wt + typeof window.wt.enter : 'none')")));
                    if (!bridged) Thread.sleep(250);
                }
                check("welcome screen can talk to the app", bridged);
                check("website loaded in background", waitFor(a, () -> "ready".equals(a.siteStateNow()), 40000), "state=" + a.siteStateNow());

                // Like a person tapping the welcome screen: the screen asks the app to open the website.
                eval(a, a.overlayView(), "window.wt.enter()");
                check("app opens the website when the welcome screen asks", waitFor(a, a::isEntered, 5000));
                Thread.sleep(1200);

                WebView site = a.siteView();
                check("website address is right", text(eval(a, site, "location.href")).startsWith(a.siteUrlNow()));
                check("website content is shown", "Smoke OK".equals(text(eval(a, site, "document.title"))));
                check("website has no access to the app", "undefined".equals(text(eval(a, site, "typeof window.wtNative"))));
                check("website is told it is the app", text(eval(a, site, "navigator.userAgent")).contains("RockminesWorkTrailApp/"));

                String js = "(function () {"
                        + "function d(id) { var e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; }"
                        + "var boxed = getComputedStyle(document.getElementById('boxed'));"
                        + "var root = getComputedStyle(document.getElementById('worktrail-root'));"
                        + "return JSON.stringify({ bar: d('wpadminbar'), banner: d('top-banner'), header: d('site-header'), title: d('page-title'),"
                        + " footer: d('site-footer'), cookie: d('cookie-popup'), late: d('late-widget'), root: d('worktrail-root'),"
                        + " boxedMax: boxed.maxWidth, boxedPad: boxed.paddingTop, rootRadius: root.borderTopLeftRadius,"
                        + " rootW: document.getElementById('worktrail-root').getBoundingClientRect().width, winW: window.innerWidth });"
                        + "})()";
                JSONObject s = new JSONObject(text(eval(a, site, js)));
                check("website menu, banner and footer are hidden",
                        "none".equals(s.optString("header")) && "none".equals(s.optString("banner")) && "none".equals(s.optString("footer")) && "none".equals(s.optString("title")),
                        s.toString());
                check("WordPress bar and pop-ups are hidden",
                        "none".equals(s.optString("bar")) && "none".equals(s.optString("cookie")));
                check("WorkTrail stays visible and fills the screen",
                        !"none".equals(s.optString("root")) && "none".equals(s.optString("boxedMax")) && "0px".equals(s.optString("boxedPad"))
                                && Math.abs(s.optDouble("rootW") - s.optDouble("winW")) < 20);

                check("update check: newer version is spotted",
                        UpdateChecker.isNewer("v1.1.9", "1.1.7") && UpdateChecker.isNewer("1.2.0", "1.1.99") && UpdateChecker.isNewer("v2.0.0", "1.9.9"));
                check("update check: same or older version is ignored",
                        !UpdateChecker.isNewer("v1.1.7", "1.1.7") && !UpdateChecker.isNewer("1.1.6", "1.1.7") && !UpdateChecker.isNewer("v1.0.9", "1.1.0"));

                a.runOnUiThread(a::offlineForTest);
                check("\"no internet\" page loads",
                        waitFor(a, () -> a.overlayView().getUrl() != null && a.overlayView().getUrl().contains("offline/offline.html"), 8000),
                        urlOf(a, a.overlayView()));
            } catch (Superseded ignored) {
                return;
            } catch (Throwable t) {
                if (Thread.currentThread() != active) return;
                failed++;
                Log.e(TAG, "FAIL smoke crashed: " + Log.getStackTraceString(t));
            }
            if (Thread.currentThread() != active) return;
            Log.i(TAG, failed == 0 ? "SMOKE PASSED" : "SMOKE FAILED (" + failed + ")");
            Log.i(TAG, "WTSMOKE_DONE");
        });
        active = worker;
        worker.start();
    }
}
