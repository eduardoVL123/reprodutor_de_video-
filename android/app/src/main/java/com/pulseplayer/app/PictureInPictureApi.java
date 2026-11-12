package com.pulseplayer.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;
import androidx.annotation.RequiresApi;

/**
 * Tudo que usa PictureInPictureParams (Android 8+) fica aqui, fora do PictureInPicturePlugin: o Capacitor lê as
 * assinaturas dos métodos de cada plugin ao abrir o app, e no Android 7.1 (Fire OS 6) a classe não existe. Com o
 * tipo na assinatura do plugin o app fechava sozinho ao abrir (NoClassDefFoundError, reprovado na Amazon).
 * Só chamar depois de conferir Build.VERSION.SDK_INT >= O.
 */
@RequiresApi(api = Build.VERSION_CODES.O)
final class PictureInPictureApi {

    private static final Rational ASPECT_RATIO = new Rational(16, 9);

    private PictureInPictureApi() {}

    /** Android 12+: liga ou desliga a entrada automática no pop-up. */
    @RequiresApi(api = Build.VERSION_CODES.S)
    static void setAutoEnter(Activity activity, boolean autoEnter) {
        activity.setPictureInPictureParams(params(autoEnter));
    }

    /** Android 8 a 11: entra no pop-up agora. */
    static void enter(Activity activity) {
        activity.enterPictureInPictureMode(params(false));
    }

    private static PictureInPictureParams params(boolean autoEnter) {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder().setAspectRatio(ASPECT_RATIO);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter);
        }
        return builder.build();
    }
}
