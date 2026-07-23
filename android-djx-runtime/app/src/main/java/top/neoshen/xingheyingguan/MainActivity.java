package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

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
import java.util.Collections;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import top.neoshen.xingheyingguan.ad.ThirdPartySdkBootstrap;

public class MainActivity extends Activity {
    private static final String TAG = "SkitDjxRuntime";
    private static final String ASSET_HOST = "127.0.0.1";
    private static final int ASSET_PORT = 18765;
    private static final int BOTTOM_NAV_HEIGHT_DP = 56;
    private FrameLayout rootContainer;
    private FrameLayout bannerHost;
    private WebView webView;
    private LocalAssetServer assetServer;
    private BridgeOriginGuard originGuard;
    private SkitPangleDramaBridge pangleDramaBridge;
    private SkitTakuAdBridge takuAdBridge;
    private SkitPrivacyConsentBridge privacyConsentBridge;
    private SkitRuntimeUpdateBridge runtimeUpdateBridge;
    private ThirdPartySdkBootstrap thirdPartySdkBootstrap;
    private PangleInitializationRegistrationSlot pangleInitializationSlot;
    private boolean nativeMessageListenerAttached;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        thirdPartySdkBootstrap = createThirdPartySdkBootstrap();
        assetServer = new LocalAssetServer(getAssets(), "www", new File(getFilesDir(), "skit-web-update"));
        assetServer.start();

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        rootContainer = new FrameLayout(this);
        webView = new WebView(this);
        rootContainer.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        bannerHost = new FrameLayout(this);
        bannerHost.setVisibility(View.GONE);
        FrameLayout.LayoutParams bannerLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        bannerLayout.gravity = Gravity.BOTTOM;
        bannerLayout.bottomMargin = dpToPx(BOTTOM_NAV_HEIGHT_DP);
        rootContainer.addView(bannerHost, bannerLayout);
        setContentView(rootContainer);
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
                        String safeDiagnostic =
                                AuthConsoleMessageFilter.forLog(consoleMessage.message());
                        if (safeDiagnostic != null) {
                            Log.w(TAG, safeDiagnostic);
                        } else {
                            Log.d(TAG, "web console level=" + consoleMessage.messageLevel());
                        }
                        return true;
                    }
                });
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        if (!request.isForMainFrame()) {
                            Uri frameUri = request.getUrl();
                            if (frameUri == null) {
                                return true;
                            }
                            return !originGuard.isTrustedTopLevel(frameUri.toString());
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
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        originGuard.updateTopLevel(url);
                        if (originGuard.isTrustedTopLevel(url)) {
                            Log.d(TAG, "trusted local page finished");
                        }
                    }
                });

        attachNativeMessageChannel();
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
        detachNativeMessageChannel();
        cancelPangleInitializationRegistration();
        if (originGuard != null) {
            originGuard.updateTopLevel(null);
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (rootContainer != null) {
            rootContainer.removeAllViews();
            rootContainer = null;
        }
        bannerHost = null;
        if (assetServer != null) {
            assetServer.close();
            assetServer = null;
        }
        if (thirdPartySdkBootstrap != null) {
            thirdPartySdkBootstrap.close();
            thirdPartySdkBootstrap = null;
        }
        super.onDestroy();
    }

    private void attachNativeMessageChannel() {
        if (nativeMessageListenerAttached) {
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new IllegalStateException("Secure native WebView messaging is unavailable");
        }
        pangleDramaBridge = new SkitPangleDramaBridge(
                this, webView, originGuard, thirdPartySdkBootstrap);
        takuAdBridge = new SkitTakuAdBridge(
                this, webView, originGuard, thirdPartySdkBootstrap, bannerHost);
        privacyConsentBridge = new SkitPrivacyConsentBridge(
                this, webView, originGuard, thirdPartySdkBootstrap);
        runtimeUpdateBridge = new SkitRuntimeUpdateBridge(this, webView, originGuard);
        WebViewCompat.addWebMessageListener(
                webView,
                "SkitNativeBridge",
                Collections.singleton(originGuard.trustedOriginRule()),
                this::onNativeMessage);
        nativeMessageListenerAttached = true;
    }

    private void onNativeMessage(WebView sourceWebView,
                                 WebMessageCompat message,
                                 Uri sourceOrigin,
                                 boolean isMainFrame,
                                 JavaScriptReplyProxy replyProxy) {
        if (!isMainFrame || !originGuard.isTrustedMessageOrigin(sourceOrigin)) {
            Log.w(TAG, "Rejected native message outside the trusted main frame");
            return;
        }
        if (message.getType() != WebMessageCompat.TYPE_STRING || message.getData() == null) {
            Log.w(TAG, "Rejected non-string native message");
            return;
        }
        try {
            originGuard.requireTrustedTopLevel();
            String rawMessage = message.getData();
            JSONObject envelope = new JSONObject(rawMessage);
            switch (envelope.optString("bridge", "")) {
                case "PANGLE":
                    pangleDramaBridge.postMessage(rawMessage);
                    break;
                case "TAKU":
                    takuAdBridge.postMessage(rawMessage);
                    break;
                case "PRIVACY":
                    privacyConsentBridge.postMessage(rawMessage);
                    break;
                case "RUNTIME_UPDATE":
                    runtimeUpdateBridge.postMessage(rawMessage);
                    break;
                default:
                    Log.w(TAG, "Rejected unknown native bridge route");
                    break;
            }
        } catch (Throwable rejectedMessage) {
            Log.w(TAG, "Rejected malformed native message");
        }
    }

    private void detachNativeMessageChannel() {
        if (webView == null || !nativeMessageListenerAttached) {
            return;
        }
        WebViewCompat.removeWebMessageListener(webView, "SkitNativeBridge");
        if (takuAdBridge != null) {
            takuAdBridge.destroy();
            takuAdBridge = null;
        }
        if (pangleDramaBridge != null) {
            pangleDramaBridge.destroy();
        }
        pangleDramaBridge = null;
        privacyConsentBridge = null;
        runtimeUpdateBridge = null;
        nativeMessageListenerAttached = false;
    }

    private int dpToPx(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private ThirdPartySdkBootstrap createThirdPartySdkBootstrap() {
        return new ThirdPartySdkBootstrap(new ThirdPartySdkBootstrap.Starter() {
            @Override
            public void startPangle(ThirdPartySdkBootstrap.Completion completion) {
                PangleInitializationRegistrationSlot slot =
                        new PangleInitializationRegistrationSlot();
                PangleInitializationRegistrationSlot previous = pangleInitializationSlot;
                pangleInitializationSlot = slot;
                if (previous != null) {
                    previous.cancel();
                }
                PangleAdSdkInitializer.Registration registration =
                        PangleAdSdkInitializer.ensureStarted(
                        getApplicationContext(),
                        BuildConfig.DEBUG,
                        new PangleAdSdkInitializer.Callback() {
                            @Override
                            public void onSuccess() {
                                if (!slot.complete()) {
                                    return;
                                }
                                clearPangleInitializationSlot(slot);
                                completion.onSuccess();
                            }

                            @Override
                            public void onFailure(int code, String message) {
                                if (!slot.complete()) {
                                    return;
                                }
                                clearPangleInitializationSlot(slot);
                                completion.onFailure(code, "Pangle initialization failed");
                            }
                        });
                slot.attach(registration);
            }

            @Override
            public void startTaku(ThirdPartySdkBootstrap.Completion completion) {
                TakuRewardedAdController.initialize(getApplicationContext(),
                        new TakuRewardedAdController.InitializationCallback() {
                            @Override
                            public void onReady() {
                                completion.onSuccess();
                            }

                            @Override
                            public void onFailure() {
                                completion.onFailure(-703, "Taku initialization failed");
                            }
                        });
            }
        });
    }

    private void clearPangleInitializationSlot(PangleInitializationRegistrationSlot slot) {
        if (pangleInitializationSlot == slot) {
            pangleInitializationSlot = null;
        }
    }

    private void cancelPangleInitializationRegistration() {
        PangleInitializationRegistrationSlot slot = pangleInitializationSlot;
        pangleInitializationSlot = null;
        if (slot != null) {
            slot.cancel();
        }
    }

    private static final class PangleInitializationRegistrationSlot {
        private PangleAdSdkInitializer.Registration registration;
        private boolean terminal;

        synchronized void attach(PangleAdSdkInitializer.Registration value) {
            if (value == null) {
                throw new IllegalArgumentException("Pangle initialization registration is required");
            }
            if (terminal) {
                value.cancel();
                return;
            }
            registration = value;
        }

        synchronized boolean complete() {
            if (terminal) {
                return false;
            }
            terminal = true;
            registration = null;
            return true;
        }

        void cancel() {
            PangleAdSdkInitializer.Registration value;
            synchronized (this) {
                if (terminal) {
                    return;
                }
                terminal = true;
                value = registration;
                registration = null;
            }
            if (value != null) {
                value.cancel();
            }
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException noBrowser) {
            Log.w(TAG, "No system browser available for external navigation");
        }
    }

    private static final class LocalAssetServer implements Closeable, Runnable {
        private static final int SOCKET_READ_TIMEOUT_MILLIS = 1_000;
        private static final int REQUEST_HEADER_DEADLINE_MILLIS = 2_000;
        private static final int REQUEST_LIFECYCLE_DEADLINE_MILLIS = 3_000;
        private static final int MAX_REQUEST_LINE_BYTES = 8 * 1024;
        private static final int MAX_REQUEST_HEADER_BYTES = 16 * 1024;
        private static final int REQUEST_WORKER_COUNT = 4;
        private static final int REQUEST_QUEUE_CAPACITY = 8;

        private final AssetManager assets;
        private final String root;
        private final File updateRoot;
        private final int preferredPort;
        private final Set<Socket> activeConnections =
                Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
        private final ThreadPoolExecutor requestExecutor;
        private final ScheduledThreadPoolExecutor connectionDeadlineExecutor;
        private ServerSocket serverSocket;
        private Thread thread;

        LocalAssetServer(AssetManager assets, String root, File updateRoot) {
            this(assets, root, updateRoot, ASSET_PORT);
        }

        LocalAssetServer(AssetManager assets, String root, File updateRoot, int preferredPort) {
            if (preferredPort <= 0 || preferredPort > 65_535) {
                throw new IllegalArgumentException("preferredPort is invalid");
            }
            this.assets = assets;
            this.root = root;
            this.updateRoot = updateRoot;
            this.preferredPort = preferredPort;
            AtomicInteger workerNumber = new AtomicInteger();
            requestExecutor = new ThreadPoolExecutor(
                    REQUEST_WORKER_COUNT,
                    REQUEST_WORKER_COUNT,
                    0L,
                    TimeUnit.MILLISECONDS,
                    new ArrayBlockingQueue<>(REQUEST_QUEUE_CAPACITY),
                    runnable -> {
                        Thread worker = new Thread(
                                runnable,
                                "skit-djx-request-" + workerNumber.incrementAndGet());
                        worker.setDaemon(true);
                        return worker;
                    },
                    new ThreadPoolExecutor.AbortPolicy());
            connectionDeadlineExecutor = new ScheduledThreadPoolExecutor(
                    1,
                    runnable -> {
                        Thread deadlineWorker = new Thread(runnable, "skit-djx-deadline");
                        deadlineWorker.setDaemon(true);
                        return deadlineWorker;
                    });
            connectionDeadlineExecutor.setRemoveOnCancelPolicy(true);
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
                socket.bind(new InetSocketAddress(ASSET_HOST, preferredPort));
                return socket;
            } catch (IOException fixedPortError) {
                socket.close();
                ServerSocket fallback = new ServerSocket();
                fallback.bind(new InetSocketAddress(ASSET_HOST, 0));
                logPortFallback(fixedPortError);
                return fallback;
            }
        }

        private void logPortFallback(IOException fixedPortError) {
            try {
                Log.w(TAG,
                        "Stable asset port unavailable; local state will be session-only",
                        fixedPortError);
            } catch (RuntimeException unavailableInLocalUnitTests) {
                // Android's local-unit-test stub throws here; logging must not break fallback.
            }
        }

        @Override
        public void run() {
            while (serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    socket.setSoTimeout(SOCKET_READ_TIMEOUT_MILLIS);
                    activeConnections.add(socket);
                    ScheduledFuture<?> lifecycleDeadline;
                    try {
                        lifecycleDeadline = connectionDeadlineExecutor.schedule(
                                () -> closeConnection(socket),
                                REQUEST_LIFECYCLE_DEADLINE_MILLIS,
                                TimeUnit.MILLISECONDS);
                    } catch (RejectedExecutionException shuttingDown) {
                        closeConnection(socket);
                        continue;
                    }
                    try {
                        requestExecutor.execute(() -> handle(socket, lifecycleDeadline));
                    } catch (RejectedExecutionException atCapacity) {
                        lifecycleDeadline.cancel(false);
                        closeConnection(socket);
                    }
                } catch (IOException ignored) {
                    break;
                }
            }
        }

        private void handle(Socket socket, ScheduledFuture<?> lifecycleDeadline) {
            try (Socket closeableSocket = socket;
                    InputStream input = closeableSocket.getInputStream();
                    BufferedOutputStream output =
                            new BufferedOutputStream(closeableSocket.getOutputStream())) {
                String request;
                try {
                    request = readRequest(input);
                } catch (RequestLimitException oversizedRequest) {
                    byte[] body = oversizedRequest.getStatus().getBytes(StandardCharsets.UTF_8);
                    writeResponse(
                            output,
                            oversizedRequest.getStatus(),
                            "text/plain; charset=utf-8",
                            body);
                    return;
                }
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
            } finally {
                lifecycleDeadline.cancel(false);
                activeConnections.remove(socket);
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
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(MAX_REQUEST_HEADER_BYTES);
            int matched = 0;
            int requestLineBytes = 0;
            boolean requestLineComplete = false;
            int previous = -1;
            int current;
            byte[] end = new byte[] {'\r', '\n', '\r', '\n'};
            long headerDeadlineNanos = System.nanoTime()
                    + TimeUnit.MILLISECONDS.toNanos(REQUEST_HEADER_DEADLINE_MILLIS);
            while ((current = input.read()) != -1) {
                if (System.nanoTime() > headerDeadlineNanos) {
                    throw new IOException("Request header deadline exceeded");
                }
                buffer.write(current);
                if (buffer.size() > MAX_REQUEST_HEADER_BYTES) {
                    throw new RequestLimitException("431 Request Header Fields Too Large");
                }
                if (!requestLineComplete) {
                    requestLineBytes++;
                    if (requestLineBytes > MAX_REQUEST_LINE_BYTES) {
                        throw new RequestLimitException("414 URI Too Long");
                    }
                    if (previous == '\r' && current == '\n') {
                        requestLineComplete = true;
                    }
                }
                if (current == end[matched]) {
                    matched++;
                } else {
                    matched = current == end[0] ? 1 : 0;
                }
                if (matched == end.length) {
                    break;
                }
                previous = current;
            }
            return buffer.toString("UTF-8");
        }

        private void closeConnection(Socket socket) {
            activeConnections.remove(socket);
            try {
                socket.close();
            } catch (IOException ignored) {
            }
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
            for (Socket connection : activeConnections.toArray(new Socket[0])) {
                closeConnection(connection);
            }
            requestExecutor.shutdownNow();
            connectionDeadlineExecutor.shutdownNow();
        }

        private static final class RequestLimitException extends IOException {
            private final String status;

            RequestLimitException(String status) {
                super(status);
                this.status = status;
            }

            String getStatus() {
                return status;
            }
        }
    }
}
