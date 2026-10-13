package com.justnew.rockmines.worktrail;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Looks for a newer Rockmines WorkTrail on the project's GitHub Releases page and offers the download. */
final class UpdateChecker {

    static final String LATEST_API = "https://api.github.com/repos/ajayidowuvictor/worktrail-desktop/releases/latest";
    static final String APK_LINK = "https://github.com/ajayidowuvictor/worktrail-desktop/releases/latest/download/Rockmines-WorkTrail.apk";
    private static final long EVERY_MS = 12L * 60 * 60 * 1000;

    private UpdateChecker() { }

    static void check(final Activity activity, final boolean manual) {
        final SharedPreferences prefs = activity.getSharedPreferences("wt", Context.MODE_PRIVATE);
        if (!manual && System.currentTimeMillis() - prefs.getLong("lastCheck", 0) < EVERY_MS) return;

        new Thread(new Runnable() {
            @Override
            public void run() {
                String latest = null;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(LATEST_API).openConnection();
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(10000);
                    c.setRequestProperty("Accept", "application/vnd.github+json");
                    c.setRequestProperty("User-Agent", "RockminesWorkTrailApp/" + BuildConfig.VERSION_NAME);
                    if (c.getResponseCode() == 200) {
                        try (InputStream in = c.getInputStream()) {
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            byte[] buf = new byte[4096];
                            int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                            latest = new JSONObject(out.toString("UTF-8")).optString("tag_name", null);
                        }
                    }
                } catch (Exception ignored) {
                    latest = null;
                }
                prefs.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
                final String found = latest;
                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (activity.isFinishing()) return;
                        if (found == null || found.isEmpty()) {
                            if (manual) Toast.makeText(activity, "Could not check for updates right now.", Toast.LENGTH_LONG).show();
                        } else if (isNewer(found, BuildConfig.VERSION_NAME)) {
                            offer(activity, found.replaceFirst("^v", ""));
                        } else if (manual) {
                            Toast.makeText(activity, "You have the latest version (" + BuildConfig.VERSION_NAME + ").", Toast.LENGTH_LONG).show();
                        }
                    }
                });
            }
        }).start();
    }

    private static void offer(final Activity activity, String version) {
        new AlertDialog.Builder(activity)
                .setTitle("New version available")
                .setMessage("Version " + version + " of Rockmines WorkTrail is ready. Download it, then open the downloaded file to update.")
                .setPositiveButton("Download", (d, w) -> {
                    try {
                        activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_LINK)));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(activity, "No browser found.", Toast.LENGTH_LONG).show();
                    }
                })
                .setNegativeButton("Later", null)
                .show();
    }

    /** True when version "a" (for example v1.1.8) is higher than version "b" (for example 1.1.7). */
    static boolean isNewer(String a, String b) {
        int[] x = parts(a);
        int[] y = parts(b);
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? x[i] : 0;
            int q = i < y.length ? y[i] : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int[] parts(String v) {
        String[] bits = v.replaceFirst("^[vV]", "").split("\\.");
        int[] out = new int[bits.length];
        for (int i = 0; i < bits.length; i++) {
            try {
                out[i] = Integer.parseInt(bits[i].replaceAll("[^0-9]", ""));
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }
}
