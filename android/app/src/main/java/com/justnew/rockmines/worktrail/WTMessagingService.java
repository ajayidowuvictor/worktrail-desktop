package com.justnew.rockmines.worktrail;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Receives the alerts the website sends through Google and shows them as phone notifications. */
public class WTMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        PushHelper.saveToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        // While the app is open the person already sees everything in it, so no extra pop-up.
        if (MainActivity.visible) return;
        Map<String, String> d = message.getData();
        if (d == null || d.isEmpty()) return;
        PushHelper.show(this, d.get("kind"), d.get("title"), d.get("body"), d.get("url"), !"0".equals(d.get("sound")));
    }
}
