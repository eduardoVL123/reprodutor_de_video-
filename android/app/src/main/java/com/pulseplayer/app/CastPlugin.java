package com.pulseplayer.app;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.media.MediaRouter;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;

/**
 * Transmitir para o Chromecast (Google Cast) em celular e tablet, com o receptor padrão do
 * Google (ver CastOptionsProvider). O JavaScript escolhe a TV (requestSession), manda a mídia
 * (load) e controla play/pausa/parar; o estado na TV volta pelo evento castMediaStatus
 * (ver src/services/cast.js). Em TVs não é usado.
 *
 * As APIs do Cast exigem a thread principal: todo acesso passa por onMain().
 * SEGURANÇA: a URL da mídia leva usuário e senha da lista; nunca registrar em log.
 */
@CapacitorPlugin(name = "Cast")
public class CastPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private CastContext castContext;
    private PluginCall pendingSession;
    private boolean sessionStarting = false;

    private final RemoteMediaClient.Callback mediaCallback = new RemoteMediaClient.Callback() {
        @Override
        public void onStatusUpdated() {
            RemoteMediaClient client = remoteClient();
            if (client != null) {
                emitState(stateOf(client.getPlayerState(), client.getIdleReason()));
            }
        }
    };

    private final SessionManagerListener<CastSession> sessionListener = new SessionManagerListener<CastSession>() {
        @Override
        public void onSessionStarting(@NonNull CastSession session) {
            sessionStarting = true;
        }

        @Override
        public void onSessionStarted(@NonNull CastSession session, @NonNull String sessionId) {
            sessionStarting = false;
            watchMedia(session);
            resolveSession(session);
        }

        @Override
        public void onSessionResumed(@NonNull CastSession session, boolean wasSuspended) {
            watchMedia(session);
        }

        @Override
        public void onSessionStartFailed(@NonNull CastSession session, int error) {
            sessionStarting = false;
            rejectSession("Não foi possível conectar à TV.");
        }

        @Override
        public void onSessionEnded(@NonNull CastSession session, int error) {
            emitState("ended");
        }

        @Override
        public void onSessionEnding(@NonNull CastSession session) {}

        @Override
        public void onSessionResuming(@NonNull CastSession session, @NonNull String sessionId) {}

        @Override
        public void onSessionResumeFailed(@NonNull CastSession session, int error) {}

        @Override
        public void onSessionSuspended(@NonNull CastSession session, int reason) {}
    };

    /** Celular/tablet com Google Play Services: nunca em TV (Android TV / Google TV). */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean isTv = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        boolean hasPlayServices =
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        if (isTv || !hasPlayServices) {
            call.resolve(available(false));
            return;
        }
        onMain(() ->
            CastContext.getSharedInstance(getContext(), ContextCompat.getMainExecutor(getContext()))
                .addOnSuccessListener(ctx -> {
                    if (castContext == null) {
                        castContext = ctx;
                        sessionManager().addSessionManagerListener(sessionListener, CastSession.class);
                        CastSession current = sessionManager().getCurrentCastSession();
                        if (current != null) watchMedia(current);
                    }
                    call.resolve(available(true));
                })
                .addOnFailureListener(err -> call.resolve(available(false)))
        );
    }

    /** Abre o seletor de aparelhos; resolve com o nome da TV quando a conexão fecha. */
    @PluginMethod
    public void requestSession(PluginCall call) {
        onMain(() -> {
            Activity activity = getActivity();
            if (castContext == null || activity == null) {
                call.reject("Transmissão indisponível.");
                return;
            }
            CastSession current = sessionManager().getCurrentCastSession();
            if (current != null && current.isConnected()) {
                call.resolve(deviceOf(current));
                return;
            }
            rejectSession("Escolha de TV substituída.");
            pendingSession = call;
            MediaRouteChooserDialog dialog = new MediaRouteChooserDialog(activity);
            dialog.setRouteSelector(castContext.getMergedSelector());
            // Fechar sem escolher TV (a rota continua sendo o próprio celular) cancela o pedido.
            dialog.setOnDismissListener(d -> {
                if (!sessionStarting && MediaRouter.getInstance(activity).getSelectedRoute().isDefault()) {
                    rejectSession("cancelled");
                }
            });
            dialog.show();
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Mídia sem endereço.");
            return;
        }
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(MediaMetadata.KEY_TITLE, call.getString("title", ""));
        MediaInfo media = new MediaInfo.Builder(url)
            .setStreamType(Boolean.TRUE.equals(call.getBoolean("live", false)) ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(call.getString("contentType", "video/mp4"))
            .setMetadata(metadata)
            .build();
        onMain(() -> {
            RemoteMediaClient client = remoteClient();
            if (client == null) {
                call.reject("Nenhuma TV conectada.");
                return;
            }
            MediaLoadRequestData request = new MediaLoadRequestData.Builder()
                .setMediaInfo(media)
                .setAutoplay(true)
                .setCurrentTime((long) (call.getDouble("position", 0.0) * 1000)) // filme continua de onde estava
                .build();
            client.load(request)
                .setResultCallback(result -> {
                    if (result.getStatus().isSuccess()) {
                        call.resolve();
                    } else {
                        call.reject("A TV não conseguiu abrir o vídeo (código " + result.getStatus().getStatusCode() + ").");
                    }
                });
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        onMain(() -> {
            RemoteMediaClient client = remoteClient();
            if (client != null) client.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        onMain(() -> {
            RemoteMediaClient client = remoteClient();
            if (client != null) client.pause();
            call.resolve();
        });
    }

    /** Para o vídeo na TV e encerra a transmissão. */
    @PluginMethod
    public void stop(PluginCall call) {
        onMain(() -> {
            if (castContext != null) sessionManager().endCurrentSession(true);
            call.resolve();
        });
    }

    private void watchMedia(CastSession session) {
        RemoteMediaClient client = session.getRemoteMediaClient();
        if (client != null) {
            client.unregisterCallback(mediaCallback);
            client.registerCallback(mediaCallback);
        }
    }

    private static String stateOf(int playerState, int idleReason) {
        switch (playerState) {
            case MediaStatus.PLAYER_STATE_PLAYING:
                return "playing";
            case MediaStatus.PLAYER_STATE_PAUSED:
                return "paused";
            case MediaStatus.PLAYER_STATE_BUFFERING:
            case MediaStatus.PLAYER_STATE_LOADING:
                return "buffering";
            default:
                return idleReason == MediaStatus.IDLE_REASON_ERROR ? "error" : "idle";
        }
    }

    private void emitState(String state) {
        JSObject data = new JSObject();
        data.put("state", state);
        notifyListeners("castMediaStatus", data);
    }

    private void resolveSession(CastSession session) {
        if (pendingSession != null) {
            pendingSession.resolve(deviceOf(session));
            pendingSession = null;
        }
    }

    private void rejectSession(String message) {
        if (pendingSession != null) {
            pendingSession.reject(message);
            pendingSession = null;
        }
    }

    private static JSObject deviceOf(CastSession session) {
        JSObject data = new JSObject();
        data.put("deviceName", session.getCastDevice() != null ? session.getCastDevice().getFriendlyName() : "");
        return data;
    }

    private static JSObject available(boolean value) {
        JSObject data = new JSObject();
        data.put("available", value);
        return data;
    }

    private SessionManager sessionManager() {
        return castContext.getSessionManager();
    }

    private RemoteMediaClient remoteClient() {
        if (castContext == null) return null;
        CastSession session = sessionManager().getCurrentCastSession();
        return session != null && session.isConnected() ? session.getRemoteMediaClient() : null;
    }

    private void onMain(Runnable task) {
        main.post(task);
    }
}
