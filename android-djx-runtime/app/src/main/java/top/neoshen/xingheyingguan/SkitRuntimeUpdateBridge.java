package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
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
import java.net.URLConnection;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.net.ssl.HttpsURLConnection;

import top.neoshen.xingheyingguan.update.RuntimeUpdateManifest;
import top.neoshen.xingheyingguan.update.RuntimeUpdateManifestVerifier;
import top.neoshen.xingheyingguan.update.RuntimeUpdateCommitter;

/** Installs UI-only bundles after scoped signature, hash, and anti-rollback verification. */
public class SkitRuntimeUpdateBridge {
    private static final String TAG = "SkitRuntimeUpdate";
    private static final String UPDATE_DIRECTORY = "skit-web-update";
    private static final String UPDATE_PREFERENCES = "skit-runtime-update-state";
    private static final String HIGHEST_RELEASE_KEY = "highestAcceptedRelease";
    private static final long MAX_BUNDLE_BYTES = 50L * 1024L * 1024L;
    private static final long MAX_EXTRACTED_BYTES = 150L * 1024L * 1024L;
    private static final int MAX_ZIP_ENTRIES = 10_000;
    private static final Set<String> MANIFEST_FIELDS = new HashSet<>(Arrays.asList(
            "tenantId", "applicationId", "bundleUrl", "bundleSha256",
            "protocolVersion", "releaseNo", "signature"));

    private final Activity activity;
    private final WebView webView;
    private final BridgeOriginGuard originGuard;
    private final SharedPreferences preferences;
    private final RuntimeUpdateManifestVerifier manifestVerifier;
    private final Object updateLock = new Object();

    public SkitRuntimeUpdateBridge(Activity activity, WebView webView,
                                   BridgeOriginGuard originGuard) {
        this.activity = activity;
        this.webView = webView;
        this.originGuard = originGuard;
        this.preferences = activity.getSharedPreferences(
                UPDATE_PREFERENCES, Context.MODE_PRIVATE);
        this.manifestVerifier = buildVerifier();
    }

    @JavascriptInterface
    public void postMessage(String rawMessage) {
        try {
            originGuard.requireTrustedTopLevel();
            JSONObject message = new JSONObject(rawMessage == null ? "{}" : rawMessage);
            String id = message.optString("id", "");
            if (!id.matches("[A-Za-z0-9._:-]{1,128}")) {
                throw new IllegalArgumentException("Invalid native callback ID");
            }
            String method = message.optString("method", "");
            JSONObject payload = message.optJSONObject("payload");
            if (payload == null) {
                payload = new JSONObject();
            }
            if ("getInfo".equals(method)) {
                JSONObject result = success();
                result.put("nativeVersion", BuildConfig.VERSION_NAME);
                result.put("tenantId", BuildConfig.TENANT_ID);
                result.put("applicationId", BuildConfig.APPLICATION_ID);
                result.put("protocolVersion", BuildConfig.RUNTIME_PROTOCOL_VERSION);
                result.put("highestAcceptedRelease", highestAcceptedRelease());
                result.put("updatesEnabled", manifestVerifier != null);
                resolve(id, result);
                return;
            }
            if ("installWebBundle".equals(method)) {
                JSONObject request = payload;
                new Thread(() -> install(request, id), "skit-runtime-update").start();
                return;
            }
            resolve(id, failure("Unknown native method"));
        } catch (SecurityException rejectedOrigin) {
            Log.w(TAG, "Rejected update bridge call from an untrusted top-level document");
        } catch (Throwable invalidMessage) {
            Log.w(TAG, "Rejected invalid update bridge message");
        }
    }

    private void install(JSONObject payload, String id) {
        synchronized (updateLock) {
            File downloaded = null;
            File staging = null;
            try {
                originGuard.requireTrustedTopLevel();
                if (manifestVerifier == null) {
                    throw new SecurityException("Runtime updates are disabled in this build");
                }
                RuntimeUpdateManifest manifest = parseManifest(payload);
                manifestVerifier.verify(manifest, highestAcceptedRelease());

                File filesDir = activity.getFilesDir();
                downloaded = new File(filesDir, "skit-hot-update-download.zip");
                staging = new File(filesDir,
                        UPDATE_DIRECTORY + "-staging-" + manifest.getReleaseNo());
                File active = new File(filesDir, UPDATE_DIRECTORY);
                File backup = new File(filesDir, UPDATE_DIRECTORY + "-backup");
                deleteRecursively(downloaded);
                deleteRecursively(staging);
                deleteRecursively(backup);
                downloadAndVerify(
                        manifest.getBundleUrl(), manifest.getBundleSha256(), downloaded);
                extractBundle(downloaded, staging);
                if (!new File(staging, "index.html").isFile()) {
                    throw new IOException("Hot update bundle is incomplete");
                }
                File preparedStaging = staging;
                RuntimeUpdateCommitter.activateThenPersist(manifest.getReleaseNo(),
                        () -> activate(preparedStaging, active, backup),
                        releaseNo -> preferences.edit().putLong(
                                HIGHEST_RELEASE_KEY, releaseNo).commit());
                deleteRecursively(downloaded);
                JSONObject result = success();
                result.put("installed", true);
                result.put("releaseNo", manifest.getReleaseNo());
                resolve(id, result);
            } catch (Throwable failure) {
                Log.w(TAG, "Runtime update rejected type="
                        + failure.getClass().getSimpleName());
                deleteRecursively(downloaded);
                deleteRecursively(staging);
                resolve(id, failure("Hot update rejected"));
            }
        }
    }

    private RuntimeUpdateManifest parseManifest(JSONObject payload) {
        if (payload == null || payload.length() != MANIFEST_FIELDS.size()) {
            throw new IllegalArgumentException("Runtime update manifest fields are invalid");
        }
        for (String field : MANIFEST_FIELDS) {
            if (!payload.has(field)) {
                throw new IllegalArgumentException("Runtime update manifest is incomplete");
            }
        }
        String encodedSignature = payload.optString("signature", "");
        if (encodedSignature.length() < 344 || encodedSignature.length() > 1024
                || encodedSignature.length() % 4 != 0
                || !encodedSignature.matches("[A-Za-z0-9+/]+={0,2}")) {
            throw new SecurityException("Runtime update signature encoding is invalid");
        }
        byte[] signature;
        try {
            signature = Base64.decode(encodedSignature, Base64.NO_WRAP);
        } catch (IllegalArgumentException invalidBase64) {
            throw new SecurityException("Runtime update signature encoding is invalid");
        }
        return new RuntimeUpdateManifest(
                payload.optString("tenantId", ""),
                payload.optString("applicationId", ""),
                payload.optString("bundleUrl", ""),
                payload.optString("bundleSha256", "").toLowerCase(Locale.ROOT),
                payload.optInt("protocolVersion", -1),
                payload.optLong("releaseNo", -1L),
                signature);
    }

    private RuntimeUpdateManifestVerifier buildVerifier() {
        if (BuildConfig.RUNTIME_UPDATE_PUBLIC_KEY == null
                || BuildConfig.RUNTIME_UPDATE_PUBLIC_KEY.length() == 0) {
            return null;
        }
        try {
            byte[] key = Base64.decode(
                    BuildConfig.RUNTIME_UPDATE_PUBLIC_KEY, Base64.NO_WRAP);
            return new RuntimeUpdateManifestVerifier(
                    key,
                    BuildConfig.TENANT_ID,
                    BuildConfig.APPLICATION_ID,
                    BuildConfig.RUNTIME_PROTOCOL_VERSION);
        } catch (Throwable invalidBuildConfig) {
            Log.w(TAG, "Runtime updates disabled because build metadata is invalid");
            return null;
        }
    }

    private long highestAcceptedRelease() {
        return Math.max(BuildConfig.RUNTIME_RELEASE_NO,
                preferences.getLong(HIGHEST_RELEASE_KEY, BuildConfig.RUNTIME_RELEASE_NO));
    }

    private void downloadAndVerify(String source, String expectedSha256, File target)
            throws Exception {
        URL url = new URL(source);
        URLConnection rawConnection = url.openConnection();
        if (!(rawConnection instanceof HttpsURLConnection)) {
            throw new IOException("Hot update must use HTTPS");
        }
        HttpsURLConnection connection = (HttpsURLConnection) rawConnection;
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        connection.connect();
        if (connection.getResponseCode() != HttpsURLConnection.HTTP_OK) {
            throw new IOException("Bundle download failed");
        }
        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_BUNDLE_BYTES) {
            throw new IOException("Bundle size is invalid");
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
        if (!expectedSha256.equals(toHex(digest.digest()))) {
            throw new IOException("Bundle SHA-256 mismatch");
        }
    }

    private void extractBundle(File archive, File targetDirectory) throws IOException {
        if (!targetDirectory.mkdirs() && !targetDirectory.isDirectory()) {
            throw new IOException("Could not create update staging directory");
        }
        String root = targetDirectory.getCanonicalPath() + File.separator;
        long extracted = 0L;
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ZIP_ENTRIES) {
                    throw new IOException("Hot update has too many files");
                }
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
                if (parent == null || (!parent.mkdirs() && !parent.isDirectory())) {
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

    private void activate(File staging, File active, File backup) throws IOException {
        if (active.exists() && !active.renameTo(backup)) {
            throw new IOException("Could not prepare active runtime update");
        }
        if (!staging.renameTo(active)) {
            if (backup.exists() && !backup.renameTo(active)) {
                Log.e(TAG, "Could not restore prior runtime update");
            }
            throw new IOException("Could not activate runtime update");
        }
        deleteRecursively(backup);
    }

    private void resolve(String id, JSONObject result) {
        String javascript = "window.__SkitNativeBridgeResolve && window.__SkitNativeBridgeResolve("
                + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ");";
        activity.runOnUiThread(() -> {
            try {
                originGuard.requireTrustedTopLevel();
                webView.evaluateJavascript(javascript, null);
            } catch (SecurityException rejectedOrigin) {
                Log.w(TAG, "Dropped update callback after top-level origin changed");
            }
        });
    }

    private JSONObject success() {
        JSONObject result = new JSONObject();
        put(result, "success", true);
        return result;
    }

    private JSONObject failure(String message) {
        JSONObject result = new JSONObject();
        put(result, "success", false);
        put(result, "message", message == null ? "Hot update failed" : message);
        return result;
    }

    private static String toHex(byte[] bytes) {
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
            Log.w(TAG, "Could not remove internal update file");
        }
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Throwable ignored) {
        }
    }
}
