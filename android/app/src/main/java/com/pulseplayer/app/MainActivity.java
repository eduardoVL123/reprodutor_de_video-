package com.pulseplayer.app;

import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.PluginHandle;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String USER_AGENT = "PulsePlayer/1.1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Plugins do próprio app precisam ser registrados antes do Capacitor iniciar.
        registerPlugin(PictureInPicturePlugin.class);
        registerPlugin(CastPlugin.class);
        super.onCreate(savedInstanceState);
        // Android 9 a 14: na horizontal a janela desviava da câmera e sobrava uma faixa preta (15+ já ocupa).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        hideSystemUI();
        setupWebView();
    }

    /** Android 8 a 11: entra no pop-up ao sair do app com vídeo tocando (12+ entra sozinho). */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        PictureInPicturePlugin pip = pictureInPicture();
        if (pip != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.S && pip.shouldEnterOnLeave()) {
            pip.enterNow();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        PictureInPicturePlugin pip = pictureInPicture();
        if (pip != null) {
            pip.notifyModeChanged(isInPictureInPictureMode);
        }
    }

    private PictureInPicturePlugin pictureInPicture() {
        if (getBridge() == null) {
            return null;
        }
        PluginHandle handle = getBridge().getPlugin("PictureInPicture");
        return handle != null ? (PictureInPicturePlugin) handle.getInstance() : null;
    }

    @Override
    public void onStart() {
        super.onStart();
        setupWebView();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private boolean webViewConfigured = false;

    private void setupWebView() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            // O app é servido por http://localhost (Capacitor): não precisa ler arquivos locais.
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);

            if (!webViewConfigured) {
                webView.setWebViewClient(new CustomBridgeWebViewClient(getBridge()));
                webView.setWebChromeClient(new CustomBridgeWebChromeClient(getBridge()));
                webViewConfigured = true;
            }
        }
    }

    private class CustomBridgeWebChromeClient extends BridgeWebChromeClient {
        public CustomBridgeWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    private class CustomBridgeWebViewClient extends BridgeWebViewClient {
        public CustomBridgeWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request != null && request.getUrl() != null) {
                String urlStr = request.getUrl().toString();
                String scheme = request.getUrl().getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    boolean isApi = urlStr.contains("player_api.php") || urlStr.contains("get.php");
                    boolean isPlaylist = urlStr.contains(".m3u8") || urlStr.contains(".m3u");
                    if (isApi || isPlaylist) {
                        WebResourceResponse response = interceptWithNativeHttp(request, urlStr, isPlaylist);
                        if (response != null) {
                            return response;
                        }
                    }
                }
            }
            return super.shouldInterceptRequest(view, request);
        }
    }

    /**
     * Faz a requisição de API/playlist pelo motor HTTP nativo (sem CORS). A validação de
     * certificado TLS é a padrão do Android: um painel com https inválido responde 502 e o
     * JavaScript repete a chamada em http:// (ver xtreamApi.js).
     */
    private WebResourceResponse interceptWithNativeHttp(WebResourceRequest request, String initialUrl, boolean isPlaylist) {
        String method = request.getMethod() != null ? request.getMethod() : "GET";
        Map<String, String> corsHeaders = new HashMap<>();
        corsHeaders.put("Access-Control-Allow-Origin", "*");
        corsHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
        corsHeaders.put("Access-Control-Allow-Headers", "*");
        corsHeaders.put("Access-Control-Expose-Headers", "*");

        if ("OPTIONS".equalsIgnoreCase(method)) {
            return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", corsHeaders, new ByteArrayInputStream(new byte[0]));
        }

        HttpURLConnection conn = null;
        String currentUrl = initialUrl;
        int redirects = 0;
        try {
            while (redirects < 8) {
                URL target = new URL(currentUrl);
                conn = (HttpURLConnection) target.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod(method);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "*/*");
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(120000);

                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc != null && !loc.isEmpty()) {
                        currentUrl = new URL(target, loc).toString();
                        conn.disconnect();
                        redirects++;
                        continue;
                    }
                }

                corsHeaders.put("X-Final-Url", currentUrl);
                String contentType = conn.getContentType();
                String mimeType = isPlaylist ? "application/vnd.apple.mpegurl" : "application/json";
                if (contentType != null && !contentType.isEmpty()) {
                    int semi = contentType.indexOf(';');
                    mimeType = semi != -1 ? contentType.substring(0, semi).trim() : contentType.trim();
                }

                int statusCode = conn.getResponseCode();
                String msg = conn.getResponseMessage();
                if (msg == null || msg.trim().isEmpty()) {
                    msg = "OK";
                }
                InputStream inStream = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (inStream == null) {
                    inStream = new ByteArrayInputStream(new byte[0]);
                }
                return new WebResourceResponse(mimeType, "utf-8", statusCode, msg, corsHeaders, inStream);
            }
        } catch (Exception e) {
            try {
                String reason = String.valueOf(e.getMessage()).replace("\\", "\\\\").replace("\"", "\\\"");
                byte[] errBytes = ("{\"error\":\"NativeHttp: " + reason + "\"}").getBytes("utf-8");
                return new WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", corsHeaders, new ByteArrayInputStream(errBytes));
            } catch (Exception ignored) {}
        }
        return null;
    }

    /**
     * O botão Voltar do controle vira uma tecla Escape no JavaScript, que decide o que fechar
     * (ou encerrar o app na tela inicial, via plugin App do Capacitor).
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && getBridge() != null && getBridge().getWebView() != null) {
                final WebView webView = getBridge().getWebView();
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));",
                            null
                        );
                    }
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void hideSystemUI() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}
