package com.pulseplayer.app;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pop-up (Picture-in-Picture) em celular e tablet: com um vídeo tocando, sair do app (Home ou
 * troca de app) leva o vídeo para uma janela flutuante. O JavaScript liga/desliga com
 * setEnabled conforme o player (ver src/services/platform.js). Em TVs não é usado.
 *
 * Android 12+ usa a entrada automática do sistema (setAutoEnterEnabled); Android 8 a 11 entra
 * pelo onUserLeaveHint da MainActivity.
 *
 * Nenhum tipo do Android 8+ na assinatura dos métodos daqui: ver PictureInPictureApi.
 */
@CapacitorPlugin(name = "PictureInPicture")
public class PictureInPicturePlugin extends Plugin {

    private volatile boolean enabled = false;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity != null && isSupported() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.runOnUiThread(() -> PictureInPictureApi.setAutoEnter(activity, enabled));
        }
        call.resolve();
    }

    /** Há vídeo tocando e o aparelho suporta pop-up (celular/tablet com Android 8+). */
    boolean shouldEnterOnLeave() {
        return enabled && isSupported();
    }

    /** Entrada manual, usada pela MainActivity no Android 8 a 11. */
    void enterNow() {
        Activity activity = getActivity();
        if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PictureInPictureApi.enter(activity);
            } catch (IllegalStateException ignored) {
                // A Activity já está saindo da tela: sem pop-up desta vez.
            }
        }
    }

    void notifyModeChanged(boolean active) {
        JSObject data = new JSObject();
        data.put("active", active);
        notifyListeners("pictureInPictureChange", data);
    }

    private boolean isSupported() {
        Activity activity = getActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        PackageManager pm = activity.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
            && !pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }
}
