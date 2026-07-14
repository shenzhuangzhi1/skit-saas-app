package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.net.ssl.HttpsURLConnection;

/**
 * Installs a verified web bundle for the custom WebView runtime. The bundle may update UI code only;
 * native SDKs, package identity, and advertising credentials stay in the signed APK.
 */
public class SkitRuntimeUpdateBridge {
    private static final String TAG = "SkitRuntimeUpdate";
    private static final String UPDATE_DIRECTORY = "skit-web-update";
    private static final long MAX_BUNDLE_BYTES = 50L * 1024L * 1024L;
    private static final long MAX_EXTRACTED_BYTES = 150L * 1024L * 1024L;

    private final Activity activity;
    private final WebView webView;

    public SkitRuntimeUpdateBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public void postMessage(String rawMessage) {
        try {
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            String method = message.optString("method", "");
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null) {
                payload = new JSONObject();
            }
            if ("getInfo".equals(method)) {
                JSONObject result = success();
                result.put("nativeVersion", BuildConfig.VERSION_NAME);
                resolve(id, result);
                return;
            }
            if ("installWebBundle".equals(method)) {
                JSONObject request = payload;
                new Thread(() -> install(request, id), "skit-runtime-update").start();
                return;
            }
            resolve(id, failure("Unknown native method: " + method));
        } catch (Exception error) {
            Log.e(TAG, "invalid bridge message", error);
        }
    }

    private void install(JSONObject payload, String id) {
        try {
            String bundleUrl = payload.optString("bundleUrl", "").trim();
            String expectedSha256 = payload.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
            if (!bundleUrl.startsWith("https://") || !expectedSha256.matches("[0-9a-f]{64}")) {
                resolve(id, failure("Invalid hot update manifest"));
                return;
            }

            File filesDir = activity.getFilesDir();
            File downloaded = new File(filesDir, "skit-hot-update-download.zip");
            File staging = new File(filesDir, UPDATE_DIRECTORY + "-staging");
            File active = new File(filesDir, UPDATE_DIRECTORY);
            deleteRecursively(downloaded);
            deleteRecursively(staging);
            downloadAndVerify(bundleUrl, expectedSha256, downloaded);
            extractBundle(downloaded, staging);
            if (!new File(staging, "index.html").isFile()) {
                throw new IOException("Hot update bundle does not contain index.html");
            }
            deleteRecursively(active);
            if (!staging.renameTo(active)) {
                throw new IOException("Could not activate hot update bundle");
            }
            deleteRecursively(downloaded);
            JSONObject result = success();
            result.put("installed", true);
            resolve(id, result);
        } catch (Exception error) {
            Log.e(TAG, "hot update install failed", error);
            resolve(id, failure("Hot update failed: " + error.getMessage()));
        }
    }

    private void downloadAndVerify(String source, String expectedSha256, File target) throws Exception {
        URL url = new URL(source);
        if (!(url.openConnection() instanceof HttpsURLConnection)) {
            throw new IOException("Hot update must use HTTPS");
        }
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        connection.connect();
        if (connection.getResponseCode() != HttpsURLConnection.HTTP_OK) {
            throw new IOException("Bundle download returned HTTP " + connection.getResponseCode());
        }
        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_BUNDLE_BYTES) {
            throw new IOException("Bundle is too large");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long downloaded = 0L;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                downloaded += count;
                if (downloaded > MAX_BUNDLE_BYTES) {
                    throw new IOException("Bundle is too large");
                }
                digest.update(buffer, 0, count);
                output.write(buffer, 0, count);
            }
        } finally {
            connection.disconnect();
        }
        String actualSha256 = toHex(digest.digest());
        if (!expectedSha256.equals(actualSha256)) {
            throw new IOException("Bundle SHA-256 mismatch");
        }
    }

    private void extractBundle(File archive, File targetDirectory) throws IOException {
        if (!targetDirectory.mkdirs() && !targetDirectory.isDirectory()) {
            throw new IOException("Could not create update staging directory");
        }
        String root = targetDirectory.getCanonicalPath() + File.separator;
        long extracted = 0L;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                File output = new File(targetDirectory, entry.getName());
                if (!output.getCanonicalPath().startsWith(root)) {
                    throw new IOException("Invalid entry in hot update bundle");
                }
                if (entry.isDirectory()) {
                    if (!output.mkdirs() && !output.isDirectory()) {
                        throw new IOException("Could not create update directory");
                    }
                    continue;
                }
                File parent = output.getParentFile();
                if (!parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("Could not create update directory");
                }
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    int count;
                    while ((count = zip.read(buffer)) != -1) {
                        extracted += count;
                        if (extracted > MAX_EXTRACTED_BYTES) {
                            throw new IOException("Expanded hot update bundle is too large");
                        }
                        stream.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private void resolve(String id, JSONObject result) {
        String javascript = "window.__SkitNativeBridgeResolve && window.__SkitNativeBridgeResolve("
                + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ");";
        activity.runOnUiThread(() -> webView.evaluateJavascript(javascript, null));
    }

    private JSONObject success() {
        JSONObject result = new JSONObject();
        try {
            result.put("success", true);
        } catch (Exception ignored) {
            // JSONObject only receives fixed primitive values here.
        }
        return result;
    }

    private JSONObject failure(String message) {
        JSONObject result = success();
        try {
            result.put("success", false);
            result.put("message", message == null ? "Hot update failed" : message);
        } catch (Exception ignored) {
            // JSONObject only receives fixed primitive values here.
        }
        return result;
    }

    private String toHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        return result.toString();
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        if (!file.delete()) {
            Log.w(TAG, "could not delete " + file.getAbsolutePath());
        }
    }

}
