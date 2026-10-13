package com.justnew.rockmines.worktrail;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.util.Collections;

/**
 * Rockmines WorkTrail for Android.
 * A full-screen window around rockminesgeo.com/worktrail/ with a welcome animation,
 * the website's own menu and banner hidden, file upload, downloads, the Back button,
 * a friendly page when the internet is down, and a notice when a newer version exists.
 * All data stays on the website.
 */
public class MainActivity extends Activity {

    static final String SITE_URL = "https://rockminesgeo.com/worktrail/";
    static final String ASSET_BASE = "https://appassets.androidplatform.net/assets/";
    static final String UA_TAG = "RockminesWorkTrailApp";
    private static final int REQ_FILES = 4101;
    private static final long LOAD_TIMEOUT_MS = 30000;

    private String siteUrl = SITE_URL;
    private String siteOrigin;
    private WebView site;
    private WebView overlay;
    private WebViewAssetLoader assets;
    private String cleanScript = "";
    private boolean docStartScript = false;

    // loading | ready | failed
    private String siteState = "loading";
    private String failInfo = "";
    private boolean entered = false;
    private ValueCallback<Uri[]> filePathCallback;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeout = new Runnable() {
        @Override
        public void run() {
            if ("loading".equals(siteState)) {
                fail("timed out");
            }
        }
    };

    /* ---------------------------------------------------------------- start-up */

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (BuildConfig.DEBUG && getIntent() != null && getIntent().getStringExtra("url") != null) {
            siteUrl = getIntent().getStringExtra("url"); // used only by the automatic self-check
        }
        siteOrigin = originOf(siteUrl);
        cleanScript = readAsset("clean-view.js");

        assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(flags);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        site = new WebView(this);
        configureSite(site);
        site.setVisibility(View.INVISIBLE);
        root.addView(site, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        overlay = new WebView(this);
        configureOverlay(overlay);
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        loadSite();
        overlay.loadUrl(ASSET_BASE + "splash/splash.html");

        if (BuildConfig.DEBUG && getIntent() != null && getIntent().hasExtra("smoke")) {
            SmokeHook.run(this);
        } else {
            ui.postDelayed(new Runnable() {
                @Override
                public void run() {
                    UpdateChecker.check(MainActivity.this, false);
                }
            }, 25000);
        }
    }

    /* ------------------------------------------------------------- the website */

    @SuppressLint("SetJavaScriptEnabled")
    private void configureSite(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " " + UA_TAG + "/" + BuildConfig.VERSION_NAME);
        w.setBackgroundColor(Color.WHITE);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(w, false);

        // Hide the website's own menu, banner, footer and WordPress bar before the page draws.
        if (!cleanScript.isEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(w, cleanScript, Collections.singleton(siteOrigin));
                docStartScript = true;
            } catch (Exception e) {
                docStartScript = false;
            }
        }

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!docStartScript && url != null && url.startsWith(siteOrigin)) {
                    view.evaluateJavascript(cleanScript, null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!docStartScript && url != null && url.startsWith(siteOrigin)) {
                    view.evaluateJavascript(cleanScript, null);
                }
                CookieManager.getInstance().flush();
                if ("loading".equals(siteState)) {
                    ui.removeCallbacks(loadTimeout);
                    setSiteState("ready");
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    fail(String.valueOf(error.getDescription()));
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                    fail("server code " + errorResponse.getStatusCode());
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if ("wtapp".equals(request.getUrl().getScheme())) {
                    handleAppLink(request.getUrl().getHost());
                    return true;
                }
                if (url.startsWith(siteOrigin)) {
                    return false;
                }
                openOutside(request.getUrl());
                return true;
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILES);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "No app found to choose files.", Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, which) -> result.confirm())
                        .setOnCancelListener(d -> result.confirm())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, which) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });

        w.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) r.addRequestHeader("Cookie", cookie);
                r.addRequestHeader("User-Agent", userAgent);
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                r.setMimeType(mimeType);
                r.setTitle(name);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                Toast.makeText(MainActivity.this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Could not download this file.", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void loadSite() {
        siteState = "loading";
        failInfo = "";
        ui.removeCallbacks(loadTimeout);
        ui.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);
        site.loadUrl(siteUrl);
    }

    private void setSiteState(String state) {
        siteState = state;
        pushStateToOverlay();
    }

    private void fail(String why) {
        ui.removeCallbacks(loadTimeout);
        failInfo = why == null ? "" : why;
        setSiteState("failed");
        if (entered) showOffline();
    }

    /* ----------------------------------------------- the program's own screens */

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureOverlay(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        w.setBackgroundColor(Color.WHITE);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.addJavascriptInterface(new Bridge(), "wtNative");
        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ASSET_BASE); // these screens never leave the app
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushStateToOverlay();
            }
        });
    }

    private void pushStateToOverlay() {
        if (overlay != null) {
            overlay.evaluateJavascript("window.__wtSiteState && window.__wtSiteState('" + siteState + "')", null);
        }
    }

    private void enterSite() {
        entered = true;
        site.setVisibility(View.VISIBLE);
        overlay.setVisibility(View.GONE);
        site.requestFocus();
    }

    private void showOffline() {
        entered = false;
        site.setVisibility(View.INVISIBLE);
        overlay.setVisibility(View.VISIBLE);
        String why = failInfo.length() > 80 ? failInfo.substring(0, 80) : failInfo;
        overlay.loadUrl(ASSET_BASE + "offline/offline.html?why=" + Uri.encode(why));
    }

    /** The only things the welcome and "no internet" screens can ask the app to do. */
    private class Bridge {
        @JavascriptInterface
        public String siteState() {
            return siteState;
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void enter() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if ("ready".equals(siteState)) enterSite();
                    else if ("failed".equals(siteState)) showOffline();
                }
            });
        }

        @JavascriptInterface
        public void retry() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    entered = false;
                    overlay.setVisibility(View.VISIBLE);
                    site.setVisibility(View.INVISIBLE);
                    loadSite();
                    overlay.loadUrl(ASSET_BASE + "splash/splash.html?quick=1");
                }
            });
        }
    }

    /* ------------------------------------------------------------ links, files */

    private void handleAppLink(String action) {
        if ("reload".equals(action)) {
            site.reload();
        } else if ("update".equals(action)) {
            UpdateChecker.check(this, true);
        }
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app found to open this link.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILES) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (entered && site.canGoBack()) {
            site.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        site.onResume();
        site.resumeTimers();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        site.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    /* ----------------------------------------------------- helpers (and tests) */

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    static String originOf(String url) {
        try {
            URI u = URI.create(url);
            return u.getScheme() + "://" + u.getAuthority();
        } catch (Exception e) {
            return url;
        }
    }

    WebView siteView() { return site; }
    WebView overlayView() { return overlay; }
    String siteStateNow() { return siteState; }
    boolean isEntered() { return entered; }
    String siteUrlNow() { return siteUrl; }
    void enterForTest() { enterSite(); }
    void offlineForTest() { showOffline(); }
}
