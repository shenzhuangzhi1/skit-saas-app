package com.skit.preview;

import android.app.Activity;
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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "SkitPreview";
    private WebView webView;
    private LocalAssetServer assetServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        assetServer = new LocalAssetServer(getAssets(), "www");
        assetServer.start();

        WebView.setWebContentsDebuggingEnabled(true);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);

        webView.setWebChromeClient(
                new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                        Log.d(
                                TAG,
                                "console "
                                        + consoleMessage.messageLevel()
                                        + " "
                                        + consoleMessage.sourceId()
                                        + ":"
                                        + consoleMessage.lineNumber()
                                        + " "
                                        + consoleMessage.message());
                        return true;
                    }
                });
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        Uri uri = request.getUrl();
                        return uri == null || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()));
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        Log.d(TAG, "page finished " + url);
                        view.evaluateJavascript(
                                "JSON.stringify({href:location.href,text:document.body.innerText.slice(0,240),appChildren:(document.querySelector('#app')&&document.querySelector('#app').children.length)||0,appHtml:(document.querySelector('#app')&&document.querySelector('#app').innerHTML.length)||0})",
                                value -> Log.d(TAG, "dom " + value));
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

    private static final class LocalAssetServer implements Closeable, Runnable {
        private final AssetManager assets;
        private final String root;
        private ServerSocket serverSocket;
        private Thread thread;

        LocalAssetServer(AssetManager assets, String root) {
            this.assets = assets;
            this.root = root;
        }

        void start() {
            try {
                serverSocket = new ServerSocket(0);
                thread = new Thread(this, "skit-preview-assets");
                thread.setDaemon(true);
                thread.start();
            } catch (IOException e) {
                throw new IllegalStateException("Unable to start preview asset server", e);
            }
        }

        String getBaseUrl() {
            return "http://127.0.0.1:" + serverSocket.getLocalPort() + "/";
        }

        @Override
        public void run() {
            while (serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    Thread requestThread = new Thread(() -> handle(socket), "skit-preview-request");
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
                try (InputStream asset = assets.open(root + path)) {
                    body = readAll(asset);
                } catch (IOException e) {
                    status = "404 Not Found";
                    type = "text/plain; charset=utf-8";
                    body = "Not found".getBytes(StandardCharsets.UTF_8);
                }
                Log.d(TAG, "asset " + status + " " + path + " " + body.length);
                writeResponse(output, status, type, body);
            } catch (IOException ignored) {
            }
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
