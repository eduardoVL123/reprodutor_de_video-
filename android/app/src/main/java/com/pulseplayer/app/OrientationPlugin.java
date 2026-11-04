package com.pulseplayer.app;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Orientação da tela (RFC-023): no celular e no tablet o app gira livre; o player pede "deitado" enquanto toca
 * e solta ao fechar (ver src/services/platform.js). Na TV a tela fica sempre deitada e estas chamadas não fazem nada.
 */
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {

    @PluginMethod
    public void lockLandscape(PluginCall call) {
        apply(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        call.resolve();
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        apply(ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        call.resolve();
    }

    private void apply(int orientation) {
        final Activity activity = getActivity();
        if (activity == null || isTv(activity)) {
            return;
        }
        activity.runOnUiThread(() -> activity.setRequestedOrientation(orientation));
    }

    /** Android TV / Google TV: sempre deitada (MainActivity trava ao abrir). */
    static boolean isTv(Activity activity) {
        return activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }
}
