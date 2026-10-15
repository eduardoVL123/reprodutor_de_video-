package com.neutrotv.player;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class MainActivity extends BridgeActivity {

    private static javax.net.ssl.SSLSocketFactory trustAllSslSocketFactory;

    static {
        try {
            TrustManager[] trustAllCerts = new TrustManager[] {
                new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                    public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                }
            };
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, trustAllCerts, new SecureRandom());
            trustAllSslSocketFactory = sc.getSocketFactory();
        } catch (Exception e) {
            trustAllSslSocketFactory = null;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemUI();
        setupWebView();
    }

    @Override
    protected void onStart() {
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
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);

            if (!webViewConfigured) {
                webView.setWebViewClient(new CustomBridgeWebViewClient(getBridge()));
                webViewConfigured = true;
            }
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
                if (conn instanceof HttpsURLConnection && trustAllSslSocketFactory != null) {
                    ((HttpsURLConnection) conn).setSSLSocketFactory(trustAllSslSocketFactory);
                    ((HttpsURLConnection) conn).setHostnameVerifier((h, s) -> true);
                }
                conn.setInstanceFollowRedirects(false);
                conn.setRequestMethod(method);
                conn.setRequestProperty("User-Agent", "IPTVSmarterPlayer/1.0");
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
                byte[] errBytes = ("{\"error\":\"NativeHttp: " + e.getMessage() + "\"}").getBytes("utf-8");
                return new WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", corsHeaders, new ByteArrayInputStream(errBytes));
            } catch (Exception ignored) {}
        }
        return null;
    }

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
