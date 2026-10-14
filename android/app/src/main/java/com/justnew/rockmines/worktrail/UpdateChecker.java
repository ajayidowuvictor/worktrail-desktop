package com.justnew.rockmines.worktrail;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/** Looks for a newer Rockmines WorkTrail on the project's GitHub Releases page and offers the download. */
final class UpdateChecker {

    static final String LATEST_API = "https://api.github.com/repos/ajayidowuvictor/worktrail-desktop/releases/latest";
    static final String APK_LINK = "https://github.com/ajayidowuvictor/worktrail-desktop/releases/latest/download/Rockmines-WorkTrail.apk";
    private static final long EVERY_MS = 12L * 60 * 60 * 1000;

    /** True while the person is in Android's settings switching on "install updates"; we carry on when they come back. */
    private static volatile boolean waitingForPermission = false;

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
                .setMessage("Version " + version + " of Rockmines WorkTrail is ready. Tap Update now: it downloads here, then Android asks you to confirm the update.")
                .setPositiveButton("Update now", (d, w) -> startUpdate(activity))
                .setNegativeButton("Later", null)
                .show();
    }

    private static boolean canInstall(Activity activity) {
        return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls();
    }

    /** Android asks once whether this app may install updates; if not yet allowed, explain and open that setting. */
    private static void startUpdate(final Activity activity) {
        if (canInstall(activity)) {
            download(activity);
            return;
        }
        new AlertDialog.Builder(activity)
                .setTitle("One quick step")
                .setMessage("Android needs your OK before WorkTrail can install its own updates. Tap Open settings, switch on \"Allow from this source\", then press the back button. The update will carry on by itself.")
                .setPositiveButton("Open settings", (d, w) -> {
                    waitingForPermission = true;
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                    } catch (Exception e) {
                        waitingForPermission = false;
                        openInBrowser(activity);
                    }
                })
                .setNegativeButton("Later", null)
                .show();
    }

    /** Called when the app comes back to the front: carries on if the person just allowed installing. */
    static void onResume(Activity activity) {
        if (waitingForPermission && canInstall(activity)) {
            waitingForPermission = false;
            download(activity);
        }
    }

    private static void openInBrowser(Activity activity) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_LINK)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(activity, "No browser found.", Toast.LENGTH_LONG).show();
        }
    }

    private static void download(final Activity activity) {
        final float density = activity.getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (22 * density);
        box.setPadding(pad, (int) (8 * density), pad, 0);
        final TextView label = new TextView(activity);
        label.setText("Starting download...");
        label.setTextSize(15);
        label.setGravity(Gravity.START);
        final ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(true);
        bar.setMax(100);
        box.addView(label);
        box.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Downloading update")
                .setView(box)
                .setCancelable(false)
                .setNegativeButton("Cancel", (d, w) -> cancelled.set(true))
                .create();
        dialog.show();

        new Thread(new Runnable() {
            @Override
            public void run() {
                File result = null;
                String problem = null;
                try {
                    File dir = new File(activity.getCacheDir(), "updates");
                    if (!dir.exists()) dir.mkdirs();
                    File[] old = dir.listFiles();
                    if (old != null) for (File f : old) f.delete();
                    File tmp = new File(dir, "download.part");
                    File apk = new File(dir, "Rockmines-WorkTrail.apk");

                    HttpURLConnection c = (HttpURLConnection) new URL(APK_LINK).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true);
                    c.setRequestProperty("User-Agent", "RockminesWorkTrailApp/" + BuildConfig.VERSION_NAME);
                    if (c.getResponseCode() != 200) throw new Exception("The download page answered " + c.getResponseCode() + ".");
                    final long total = c.getContentLengthLong();
                    long got = 0;
                    long lastUi = 0;
                    try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelled.get()) throw new Exception("cancelled");
                            out.write(buf, 0, n);
                            got += n;
                            long now = System.currentTimeMillis();
                            if (now - lastUi > 200) {
                                lastUi = now;
                                final long g = got;
                                activity.runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (total > 0) {
                                            bar.setIndeterminate(false);
                                            bar.setProgress((int) (g * 100 / total));
                                            label.setText(String.format(java.util.Locale.US, "%.1f MB of %.1f MB", g / 1048576.0, total / 1048576.0));
                                        } else {
                                            label.setText(String.format(java.util.Locale.US, "%.1f MB downloaded", g / 1048576.0));
                                        }
                                    }
                                });
                            }
                        }
                    }
                    if (got < 100000 || (total > 0 && got != total)) throw new Exception("The download was cut short. Please try again.");
                    // A real app file is a zip: it starts with "PK". Anything else (an error page) must never be installed.
                    byte[] head = new byte[2];
                    try (InputStream check = new java.io.FileInputStream(tmp)) {
                        if (check.read(head) != 2 || head[0] != 'P' || head[1] != 'K') throw new Exception("The file that came back was not the app. Please try again.");
                    }
                    if (apk.exists()) apk.delete();
                    if (!tmp.renameTo(apk)) throw new Exception("Could not save the update on this phone.");
                    result = apk;
                } catch (Exception e) {
                    problem = "cancelled".equals(e.getMessage()) ? "cancelled" : (e.getMessage() == null || e.getMessage().isEmpty() ? "The download did not finish." : e.getMessage());
                }
                final File done = result;
                final String why = problem;
                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            dialog.dismiss();
                        } catch (Exception ignored) {
                            // the screen was closed meanwhile
                        }
                        if (activity.isFinishing()) return;
                        if (done != null) install(activity, done);
                        else if (!"cancelled".equals(why)) failed(activity, why);
                    }
                });
            }
        }).start();
    }

    private static void install(Activity activity, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
        } catch (Exception e) {
            failed(activity, "Android would not open the installer.");
        }
    }

    private static void failed(final Activity activity, String why) {
        new AlertDialog.Builder(activity)
                .setTitle("Could not update")
                .setMessage(why + "\n\nYou can try again, or download it with your browser instead.")
                .setPositiveButton("Try again", (d, w) -> startUpdate(activity))
                .setNeutralButton("Use browser", (d, w) -> openInBrowser(activity))
                .setNegativeButton("Close", null)
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
