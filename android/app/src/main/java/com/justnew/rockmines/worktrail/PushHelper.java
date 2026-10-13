package com.justnew.rockmines.worktrail;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.media.AudioAttributes;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Phone alerts. Google gives every phone a private "address" (token). The app puts it in a small
 * cookie for the website; when the person is signed in, the website remembers that this phone
 * belongs to them and can send alerts to it. Nothing else is shared.
 */
final class PushHelper {

    // "2" = the version with WorkTrail's own sounds. "q" = the quiet version, used when the person switched Sounds off.
    static final String CHANNEL_TASKS = "tasks2";
    static final String CHANNEL_CHAT = "chat2";
    static final String CHANNEL_TASKS_QUIET = "tasks2q";
    static final String CHANNEL_CHAT_QUIET = "chat2q";
    static final String COOKIE = "wt_push_token";

    private PushHelper() { }

    interface Listener {
        void onNewToken(String token);
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // The first version of the channels had the phone's default sound.
        nm.deleteNotificationChannel("tasks");
        nm.deleteNotificationChannel("chat");
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        nm.createNotificationChannel(channel(CHANNEL_TASKS, "Tasks and updates", "New tasks, approvals, comments and reminders", soundUri(c, R.raw.wt_notify), attrs));
        nm.createNotificationChannel(channel(CHANNEL_CHAT, "Messages", "Chat messages from colleagues", soundUri(c, R.raw.wt_message), attrs));
        nm.createNotificationChannel(channel(CHANNEL_TASKS_QUIET, "Tasks and updates (no sound)", "Used when Sounds is switched off in WorkTrail", null, null));
        nm.createNotificationChannel(channel(CHANNEL_CHAT_QUIET, "Messages (no sound)", "Used when Sounds is switched off in WorkTrail", null, null));
    }

    private static NotificationChannel channel(String id, String name, String description, Uri sound, AudioAttributes attrs) {
        NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(description);
        ch.setSound(sound, attrs); // null = silent
        ch.enableVibration(sound != null);
        return ch;
    }

    static Uri soundUri(Context c, int rawId) {
        return Uri.parse("android.resource://" + c.getPackageName() + "/" + rawId);
    }

    /** Puts the phone's address in a cookie for the website (runs on the main thread). */
    static void setCookie(final String token) {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                try {
                    CookieManager cm = CookieManager.getInstance();
                    cm.setAcceptCookie(true);
                    cm.setCookie(MainActivity.SITE_URL, COOKIE + "=" + token + "; Max-Age=31536000; Path=/; Secure; SameSite=Lax");
                    cm.flush();
                } catch (Throwable ignored) {
                    // No WebView on this phone: nothing to do.
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) r.run();
        else new Handler(Looper.getMainLooper()).post(r);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("wt", Context.MODE_PRIVATE);
    }

    /** Keeps the token and sets the cookie. Returns true when the token is new. */
    static boolean saveToken(Context c, String token) {
        if (token == null || token.isEmpty()) return false;
        String old = prefs(c).getString("fcm", "");
        prefs(c).edit().putString("fcm", token).apply();
        setCookie(token);
        return !token.equals(old);
    }

    static String savedToken(Context c) {
        return prefs(c).getString("fcm", "");
    }

    /** Asks Google for this phone's address. Quietly does nothing when Google services are missing. */
    static void fetchToken(final Context c, final Listener listener) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                try {
                    if (task.isSuccessful() && task.getResult() != null) {
                        boolean isNew = saveToken(c, task.getResult());
                        if (isNew && listener != null) listener.onNewToken(task.getResult());
                    }
                } catch (Throwable ignored) { }
            });
        } catch (Throwable ignored) {
            // Google services not available (for example on a test phone).
        }
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    static Notification build(Context c, String kind, String title, String body, String url, boolean sound) {
        boolean chat = "chat".equals(kind);
        String channel = chat ? (sound ? CHANNEL_CHAT : CHANNEL_CHAT_QUIET) : (sound ? CHANNEL_TASKS : CHANNEL_TASKS_QUIET);
        Intent open = new Intent(c, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (MainActivity.isOwnUrl(url)) open.putExtra(MainActivity.EXTRA_OPEN, url);
        int req = (int) (System.currentTimeMillis() & 0x7fffffff);
        PendingIntent pi = PendingIntent.getActivity(c, req, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder nb = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_wt)
                .setColor(0xFF039331)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory("chat".equals(kind) ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_EVENT)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi);
        if (Build.VERSION.SDK_INT < 26) {
            // Older phones have no channels: set the sound and vibration on the alert itself.
            if (sound) nb.setSound(soundUri(c, chat ? R.raw.wt_message : R.raw.wt_notify)).setVibrate(new long[]{0, 120, 80, 120});
            else nb.setSilent(true);
        }
        return nb.build();
    }

    static void show(Context c, String kind, String title, String body, String url, boolean sound) {
        if (!canNotify(c)) return;
        ensureChannels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        int id = (int) (System.currentTimeMillis() & 0x7fffffff);
        nm.notify(id, build(c, kind, title == null || title.isEmpty() ? "Rockmines WorkTrail" : title, body == null ? "" : body, url, sound));
    }

    /** Parses a tap target safely: only the website's own pages are ever opened. */
    static Uri safeUri(String url) {
        return MainActivity.isOwnUrl(url) ? Uri.parse(url) : null;
    }
}
