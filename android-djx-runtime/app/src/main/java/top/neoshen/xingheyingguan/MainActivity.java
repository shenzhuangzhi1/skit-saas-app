package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "SkitDjxRuntime";
    private static final String ASSET_HOST = "127.0.0.1";
    private static final int ASSET_PORT = 18765;
    private WebView webView;
    private LocalAssetServer assetServer;
    private BridgeOriginGuard originGuard;
    private SkitTakuAdBridge takuAdBridge;
    private boolean bridgesAttached;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TakuRewardedAdController.initialize(getApplicationContext());
        assetServer = new LocalAssetServer(getAssets(), "www", new File(getFilesDir(), "skit-web-update"));
        assetServer.start();

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        setContentView(webView);
        originGuard = new BridgeOriginGuard(assetServer.getBaseUrl());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(
                new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                        Log.d(TAG, "web console level=" + consoleMessage.messageLevel());
                        return true;
                    }
                });
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        if (!request.isForMainFrame()) {
                            return false;
                        }
                        Uri uri = request.getUrl();
                        if (uri != null && originGuard.isTrustedTopLevel(uri.toString())) {
                            return false;
                        }
                        if (uri != null && ("http".equalsIgnoreCase(uri.getScheme())
                                || "https".equalsIgnoreCase(uri.getScheme()))) {
                            openExternal(uri);
                        }
                        return true;
                    }

                    @Override
                    public void onPageStarted(WebView view, String url,
                                              android.graphics.Bitmap favicon) {
                        super.onPageStarted(view, url, favicon);
                        originGuard.updateTopLevel(url);
                        if (!originGuard.isTrustedTopLevel(url)) {
                            detachBridges();
                        }
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        originGuard.updateTopLevel(url);
                        if (originGuard.isTrustedTopLevel(url)) {
                            attachBridges();
                            Log.d(TAG, "trusted local page finished");
                        } else {
                            detachBridges();
                        }
                    }
                });

        webView.loadUrl(assetServer.getBaseUrl() + "index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        detachBridges();
        if (originGuard != null) {
            originGuard.updateTopLevel(null);
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (assetServer != null) {
            assetServer.close();
            assetServer = null;
        }
        super.onDestroy();
    }

    private void attachBridges() {
        if (bridgesAttached) {
            return;
        }
        takuAdBridge = new SkitTakuAdBridge(this, webView, originGuard);
        webView.addJavascriptInterface(
                new SkitPangleDramaBridge(this, webView, originGuard), "SkitPangleDramaNative");
        webView.addJavascriptInterface(takuAdBridge, "SkitTakuAdNative");
        webView.addJavascriptInterface(
                new SkitRuntimeUpdateBridge(this, webView, originGuard), "SkitRuntimeUpdateNative");
        bridgesAttached = true;
    }

    private void detachBridges() {
        if (webView == null || !bridgesAttached) {
            return;
        }
        webView.removeJavascriptInterface("SkitPangleDramaNative");
        webView.removeJavascriptInterface("SkitTakuAdNative");
        webView.removeJavascriptInterface("SkitRuntimeUpdateNative");
        if (takuAdBridge != null) {
            takuAdBridge.destroy();
            takuAdBridge = null;
        }
        bridgesAttached = false;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException noBrowser) {
            Log.w(TAG, "No system browser available for external navigation");
        }
    }

    private static final class LocalAssetServer implements Closeable, Runnable {
        private final AssetManager assets;
        private final String root;
        private final File updateRoot;
        private ServerSocket serverSocket;
        private Thread thread;

        LocalAssetServer(AssetManager assets, String root, File updateRoot) {
            this.assets = assets;
            this.root = root;
            this.updateRoot = updateRoot;
        }

        void start() {
            try {
                serverSocket = createServerSocket();
                thread = new Thread(this, "skit-djx-assets");
                thread.setDaemon(true);
                thread.start();
            } catch (IOException e) {
                throw new IllegalStateException("Unable to start asset server", e);
            }
        }

        String getBaseUrl() {
            return "http://" + ASSET_HOST + ":" + serverSocket.getLocalPort() + "/";
        }

        private ServerSocket createServerSocket() throws IOException {
            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            try {
                socket.bind(new InetSocketAddress(ASSET_HOST, ASSET_PORT));
                return socket;
            } catch (IOException fixedPortError) {
                socket.close();
                ServerSocket fallback = new ServerSocket();
                fallback.bind(new InetSocketAddress(ASSET_HOST, 0));
                Log.w(TAG, "Stable asset port unavailable; local state will be session-only", fixedPortError);
                return fallback;
            }
        }

        @Override
        public void run() {
            while (serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    Thread requestThread = new Thread(() -> handle(socket), "skit-djx-request");
                    requestThread.setDaemon(true);
                    requestThread.start();
                } catch (IOException ignored) {
                    break;
                }
            }
        }

        private void handle(Socket socket) {
            try (Socket closeableSocket = socket;
                    InputStream input = closeableSocket.getInputStream();
                    BufferedOutputStream output =
                            new BufferedOutputStream(closeableSocket.getOutputStream())) {
                String request = readRequest(input);
                String path = parsePath(request);
                byte[] body;
                String status = "200 OK";
                String type = contentType(path);
                try (InputStream asset = openAsset(path)) {
                    body = readAll(asset);
                } catch (IOException e) {
                    status = "404 Not Found";
                    type = "text/plain; charset=utf-8";
                    body = "Not found".getBytes(StandardCharsets.UTF_8);
                }
                writeResponse(output, status, type, body);
            } catch (IOException ignored) {
            }
        }

        private InputStream openAsset(String path) throws IOException {
            String relativePath = path.startsWith("/") ? path.substring(1) : path;
            File candidate = new File(updateRoot, relativePath);
            String updateRootPath = updateRoot.getCanonicalPath() + File.separator;
            if (candidate.getCanonicalPath().startsWith(updateRootPath) && candidate.isFile()) {
                return new FileInputStream(candidate);
            }
            return assets.open(root + path);
        }

        private String readRequest(InputStream input) throws IOException {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int matched = 0;
            int current;
            byte[] end = new byte[] {'\r', '\n', '\r', '\n'};
            while ((current = input.read()) != -1) {
                buffer.write(current);
                if (current == end[matched]) {
                    matched++;
                } else {
                    matched = current == end[0] ? 1 : 0;
                }
                if (matched == end.length) {
                    break;
                }
            }
            return buffer.toString("UTF-8");
        }

        private String parsePath(String request) {
            String[] parts = request.split(" ");
            String rawPath = parts.length > 1 ? parts[1] : "/";
            int queryIndex = rawPath.indexOf('?');
            if (queryIndex >= 0) {
                rawPath = rawPath.substring(0, queryIndex);
            }
            try {
                rawPath = URLDecoder.decode(rawPath, "UTF-8");
            } catch (Exception ignored) {
            }
            if (rawPath.equals("/") || rawPath.isEmpty()) {
                return "/index.html";
            }
            if (rawPath.contains("..")) {
                return "/index.html";
            }
            return rawPath.startsWith("/") ? rawPath : "/" + rawPath;
        }

        private String contentType(String path) {
            String lower = path.toLowerCase(Locale.US);
            if (lower.endsWith(".html")) return "text/html; charset=utf-8";
            if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
            if (lower.endsWith(".css")) return "text/css; charset=utf-8";
            if (lower.endsWith(".json")) return "application/json; charset=utf-8";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".ttf")) return "font/ttf";
            if (lower.endsWith(".woff")) return "font/woff";
            if (lower.endsWith(".woff2")) return "font/woff2";
            return "application/octet-stream";
        }

        private byte[] readAll(InputStream input) throws IOException {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        }

        private void writeResponse(OutputStream output, String status, String type, byte[] body)
                throws IOException {
            String headers =
                    "HTTP/1.1 "
                            + status
                            + "\r\nContent-Type: "
                            + type
                            + "\r\nContent-Length: "
                            + body.length
                            + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
            output.write(headers.getBytes(StandardCharsets.UTF_8));
            try (InputStream bodyInput = new ByteArrayInputStream(body)) {
                byte[] chunk = new byte[8192];
                int read;
                while ((read = bodyInput.read(chunk)) != -1) {
                    output.write(chunk, 0, read);
                }
            }
            output.flush();
        }

        @Override
        public void close() {
            if (serverSocket != null) {
                try {
                    serverSocket.close();
                } catch (IOException ignored) {
                }
            }
        }
    }
}
