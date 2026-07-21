package top.neoshen.xingheyingguan;

import android.app.Activity;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.Reader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.NativePlayerGrant;
import top.neoshen.xingheyingguan.ad.TakuNativeState;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;
import top.neoshen.xingheyingguan.ad.VerifiedRewardEvidence;

/** HTTP client whose only authority is the short-lived player grant. */
final class SkitNativeApiClient {
    private static final String TAG = "SkitNativeApi";
    static final String PLAYER_GRANT_HEADER = "X-Skit-Player-Grant";
    static final String NATIVE_VERSION_HEADER = "X-Skit-Native-Version";
    static final String AD_PROTOCOL_VERSION_HEADER = "X-Skit-Ad-Protocol-Version";
    static final String NATIVE_API_PATH = "/skit/member/native";
    private static final int MAX_RESPONSE_CHARS = 1024 * 1024;
    private static final int TELEMETRY_MAX_ATTEMPTS = 3;
    private static final long[] TELEMETRY_RETRY_DELAYS_MILLIS = {150L, 400L};
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final Pattern SESSION_ID = Pattern.compile("[A-Za-z0-9_-]{22}");
    private static final Pattern SAFE_PROTOCOL_TEXT =
            Pattern.compile("[A-Za-z0-9._:/-]{1,128}");
    private static final Pattern CLIENT_LIFECYCLE_STATUS = Pattern.compile(
            "CREATED|LOADING|SHOWN|CLIENT_REWARDED|CLOSED|FAILED|LOAD_EXPIRED");

    interface Callback<T> {
        void onSuccess(T result);

        void onFailure();
    }

    static final class CreateResult {
        private final String outcome;
        private final AdSessionProtocol protocol;
        private final String sessionId;

        CreateResult(String outcome, AdSessionProtocol protocol, String sessionId) {
            this.outcome = outcome;
            this.protocol = protocol;
            this.sessionId = sessionId;
        }

        String getOutcome() {
            return outcome;
        }

        AdSessionProtocol getProtocol() {
            return protocol;
        }

        String getSessionId() {
            return sessionId;
        }
    }

    static final class SessionStatus {
        private final String sessionId;
        private final String clientLifecycleStatus;
        private final String rewardVerificationStatus;
        private final String entitlementStatus;
        private final String providerShowId;

        SessionStatus(String sessionId, String clientLifecycleStatus,
                      String rewardVerificationStatus, String entitlementStatus,
                      String providerShowId) {
            this.sessionId = sessionId;
            this.clientLifecycleStatus = clientLifecycleStatus;
            this.rewardVerificationStatus = rewardVerificationStatus;
            this.entitlementStatus = entitlementStatus;
            this.providerShowId = providerShowId;
        }

        String getSessionId() {
            return sessionId;
        }

        String getClientLifecycleStatus() {
            return clientLifecycleStatus;
        }

        String getRewardVerificationStatus() {
            return rewardVerificationStatus;
        }

        String getEntitlementStatus() {
            return entitlementStatus;
        }

        String getProviderShowId() {
            return providerShowId;
        }
    }

    private final Activity activity;
    private final NativePlayerGrant playerGrant;
    private final OkHttpClient httpClient;
    private final ExecutorService serialExecutor;
    private final HttpUrl apiRoot;
    private volatile boolean closed;

    SkitNativeApiClient(Activity activity, NativePlayerGrant playerGrant) {
        this.activity = activity;
        this.playerGrant = playerGrant;
        this.httpClient = newHttpClient();
        this.serialExecutor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "skit-native-api");
            thread.setDaemon(true);
            return thread;
        });
        this.apiRoot = apiRoot(BuildConfig.API_BASE_URL, BuildConfig.API_PATH);
    }

    static OkHttpClient newHttpClient() {
        return new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .callTimeout(20, TimeUnit.SECONDS)
                .build();
    }

    void getEntitlements(Callback<List<Integer>> callback) {
        execute("GET", NATIVE_API_PATH + "/entitlements", null, data -> {
            JSONArray values = data.optJSONArray("grantedEpisodeNos");
            if (values == null || values.length() == 0) {
                return Collections.emptyList();
            }
            List<Integer> result = new ArrayList<>(values.length());
            for (int index = 0; index < values.length(); index++) {
                int episode = values.optInt(index, -1);
                if (episode <= 0) {
                    throw new IOException("Invalid entitlement response");
                }
                result.add(episode);
            }
            return Collections.unmodifiableList(result);
        }, callback);
    }

    /**
     * Gets the real display pair selected from a signed reward callback, never from H5 or local
     * telemetry. A successful response with {@code verified=false} intentionally returns null.
     */
    void getVerifiedRewardProvenance(int episodeNo,
                                     Callback<VerifiedRewardEvidence> callback) {
        if (episodeNo <= 0) {
            callback.onFailure();
            return;
        }
        execute("GET", NATIVE_API_PATH + "/entitlements/" + episodeNo
                + "/reward-provenance", null, data ->
                parseVerifiedRewardProvenance(episodeNo, data), callback);
    }

    void createAdSession(long dramaId, int episodeNo, Callback<CreateResult> callback) {
        playerGrant.requireDrama(dramaId);
        if (episodeNo <= 0) {
            callback.onFailure();
            return;
        }
        JSONObject request = new JSONObject();
        put(request, "dramaId", dramaId);
        put(request, "episodeNo", episodeNo);
        execute("POST", NATIVE_API_PATH + "/ad-sessions", request, data ->
                parseCreateResult(
                        data.optString("outcome", ""),
                        data.optInt("protocolVersion", -1),
                        data.optString("sessionId", ""),
                        data.optString("provider", ""),
                        data.optString("placementId", ""),
                        data.optString("userId", ""),
                        data.optString("customData", ""),
                        data.optString("scene", "")), callback);
    }

    static CreateResult parseCreateResult(String outcome, int protocolVersion,
                                          String sessionId, String provider,
                                          String placementId, String userId,
                                          String customData, String scene) throws IOException {
        if ("ALREADY_ENTITLED".equals(outcome)) {
            return new CreateResult(outcome, null, null);
        }
        if (!"CREATED".equals(outcome) && !"REUSED".equals(outcome)
                && !"VERIFYING".equals(outcome)) {
            throw new IOException("Invalid ad session outcome");
        }
        if ("VERIFYING".equals(outcome)) {
            if (protocolVersion != AdSessionProtocol.SUPPORTED_VERSION
                    || !matches(SESSION_ID, sessionId)
                    || !AdSessionProtocol.SUPPORTED_PROVIDER.equals(provider)
                    || !matches(SAFE_PROTOCOL_TEXT, placementId)
                    || !matches(SAFE_PROTOCOL_TEXT, userId)
                    || !AdSessionProtocol.SUPPORTED_SCENE.equals(scene)) {
                throw new IOException("Invalid ad session polling reference");
            }
            return new CreateResult(outcome, null, sessionId);
        }
        try {
            AdSessionProtocol protocol = new AdSessionProtocol(
                    protocolVersion, sessionId, provider, placementId,
                    userId, customData, scene);
            return new CreateResult(outcome, protocol, protocol.getSessionId());
        } catch (IllegalArgumentException invalidProtocol) {
            throw new IOException("Invalid native ad session protocol", invalidProtocol);
        }
    }

    private static boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).matches();
    }

    void recordTelemetry(TakuTelemetry telemetry, Callback<SessionStatus> callback) {
        if (telemetry.getState() == TakuNativeState.LOADED) {
            callback.onSuccess(null);
            return;
        }
        JSONObject event = new JSONObject();
        put(event, "protocolVersion", telemetry.getProtocol().getProtocolVersion());
        put(event, "clientEventId", telemetry.getProtocol().getSessionId()
                + ":" + telemetry.getCallbackSequence());
        put(event, "callbackSequence", telemetry.getCallbackSequence());
        put(event, "sessionId", telemetry.getProtocol().getSessionId());
        put(event, "provider", telemetry.getProtocol().getProvider());
        put(event, "placementId", telemetry.getProtocol().getPlacementId());
        put(event, "eventType", eventType(telemetry));
        put(event, "nativeState", telemetry.getState().name());
        put(event, "sdkRequestId", telemetry.getSdkRequestId());
        put(event, "providerShowId", telemetry.getProviderShowId());
        put(event, "networkFirmId", telemetry.getNetworkFirmId());
        put(event, "adsourceId", telemetry.getAdsourceId());
        put(event, "clientRewardObserved", telemetry.isClientRewardObserved());
        put(event, "closed", telemetry.isClosed());
        JSONObject request = new JSONObject();
        JSONArray events = new JSONArray();
        events.put(event);
        put(request, "events", events);
        String path = NATIVE_API_PATH + "/ad-sessions/"
                + telemetry.getProtocol().getSessionId() + "/client-events";
        execute("POST", path, request, SkitNativeApiClient::parseSessionStatus, callback,
                TELEMETRY_MAX_ATTEMPTS);
    }

    void getSession(String sessionId, Callback<SessionStatus> callback) {
        if (sessionId == null || !sessionId.matches("[A-Za-z0-9_-]{22}")) {
            callback.onFailure();
            return;
        }
        execute("GET", NATIVE_API_PATH + "/ad-sessions/" + sessionId,
                null, SkitNativeApiClient::parseSessionStatus, callback);
    }

    void close() {
        boolean cleanupSubmitted = false;
        synchronized (this) {
            if (closed) {
                return;
            }
            closed = true;
            try {
                serialExecutor.execute(() -> httpClient.connectionPool().evictAll());
                cleanupSubmitted = true;
            } catch (RejectedExecutionException rejected) {
                // The executor was already stopped unexpectedly; clean up below, outside the lock.
            }
            serialExecutor.shutdown();
        }
        if (!cleanupSubmitted) {
            httpClient.connectionPool().evictAll();
        }
    }

    private <T> void execute(String method, String path, JSONObject body,
                             Parser<T> parser, Callback<T> callback) {
        execute(method, path, body, parser, callback, 1);
    }

    private <T> void execute(String method, String path, JSONObject body,
                             Parser<T> parser, Callback<T> callback, int maxAttempts) {
        boolean submitted = false;
        synchronized (this) {
            if (!closed) {
                try {
                    serialExecutor.execute(() -> executeWithRetry(
                            method, path, body, parser, callback, maxAttempts));
                    submitted = true;
                } catch (RejectedExecutionException rejected) {
                    // close() won the admission race; report failure below, outside the lock.
                }
            }
        }
        if (!submitted) {
            activity.runOnUiThread(callback::onFailure);
        }
    }

    private <T> void executeWithRetry(String method, String path, JSONObject body,
                                      Parser<T> parser, Callback<T> callback,
                                      int maxAttempts) {
        Exception finalFailure = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                T result = executeOnce(method, path, body, parser);
                activity.runOnUiThread(() -> callback.onSuccess(result));
                return;
            } catch (Exception failure) {
                finalFailure = failure;
                if (attempt < maxAttempts) {
                    try {
                        Thread.sleep(telemetryRetryDelayMillis(attempt));
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        finalFailure = interrupted;
                        break;
                    }
                }
            }
        }
        Log.w(TAG, "native API request failed after retries: "
                + (finalFailure == null ? "unknown" : finalFailure.getClass().getSimpleName()));
        activity.runOnUiThread(callback::onFailure);
    }

    private <T> T executeOnce(String method, String path, JSONObject body,
                              Parser<T> parser) throws Exception {
        Request.Builder request = new Request.Builder()
                .url(url(path))
                .header("Accept", "application/json")
                .header(PLAYER_GRANT_HEADER, playerGrant.getGrantToken())
                .header(NATIVE_VERSION_HEADER, BuildConfig.VERSION_NAME)
                .header(AD_PROTOCOL_VERSION_HEADER,
                        String.valueOf(AdSessionProtocol.SUPPORTED_VERSION));
        if ("POST".equals(method)) {
            request.post(RequestBody.create(body == null ? "{}" : body.toString(), JSON));
        } else {
            request.get();
        }
        try (Response response = httpClient.newCall(request.build()).execute()) {
            if (!response.isSuccessful()) {
                Log.w(TAG, "native API rejected request with HTTP status=" + response.code());
                throw new IOException("Native API request was rejected");
            }
            JSONObject envelope = new JSONObject(readBody(response.body()));
            if (envelope.optInt("code", -1) != 0) {
                Log.w(TAG, "native API rejected request with application error");
                throw new IOException("Native API request was rejected");
            }
            JSONObject data = envelope.optJSONObject("data");
            if (data == null) {
                throw new IOException("Native API response data is missing");
            }
            return parser.parse(data);
        }
    }

    private static long telemetryRetryDelayMillis(int attempt) {
        int index = Math.max(0, Math.min(attempt - 1,
                TELEMETRY_RETRY_DELAYS_MILLIS.length - 1));
        return TELEMETRY_RETRY_DELAYS_MILLIS[index];
    }

    private HttpUrl url(String path) {
        String normalized = path.startsWith("/") ? path.substring(1) : path;
        return apiRoot.newBuilder().addPathSegments(normalized).build();
    }

    private static HttpUrl apiRoot(String baseUrl, String apiPath) {
        HttpUrl base = HttpUrl.get(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
        HttpUrl.Builder builder = base.newBuilder();
        String normalizedPath = apiPath == null ? "" : apiPath.trim();
        while (normalizedPath.startsWith("/")) {
            normalizedPath = normalizedPath.substring(1);
        }
        while (normalizedPath.endsWith("/")) {
            normalizedPath = normalizedPath.substring(0, normalizedPath.length() - 1);
        }
        if (normalizedPath.length() > 0) {
            builder.addPathSegments(normalizedPath);
        }
        builder.addPathSegment("");
        return builder.build();
    }

    private static String readBody(ResponseBody body) throws IOException {
        if (body == null || body.contentLength() > MAX_RESPONSE_CHARS) {
            throw new IOException("Native API response is invalid");
        }
        StringBuilder result = new StringBuilder();
        try (Reader reader = body.charStream()) {
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                result.append(buffer, 0, count);
                if (result.length() > MAX_RESPONSE_CHARS) {
                    throw new IOException("Native API response is too large");
                }
            }
        }
        return result.toString();
    }

    private static SessionStatus parseSessionStatus(JSONObject data) throws IOException {
        return parseSessionStatus(
                data.optString("sessionId", ""),
                data.optString("clientLifecycleStatus", ""),
                data.optString("rewardVerificationStatus", ""),
                data.optString("entitlementStatus", ""),
                data.optString("providerShowId", ""));
    }

    static SessionStatus parseSessionStatus(String sessionId, String lifecycle,
                                            String reward, String entitlement,
                                            String showId) throws IOException {
        if (!matches(SESSION_ID, sessionId)
                || !matches(CLIENT_LIFECYCLE_STATUS, lifecycle)
                || reward.length() == 0 || entitlement.length() == 0) {
            throw new IOException("Invalid native session response");
        }
        return new SessionStatus(sessionId, lifecycle, reward, entitlement,
                showId.length() == 0 ? null : showId);
    }

    static VerifiedRewardEvidence parseVerifiedRewardProvenance(int episodeNo, JSONObject data)
            throws IOException {
        if (data == null) {
            return null;
        }
        return parseVerifiedRewardProvenance(episodeNo,
                data.optBoolean("verified", false), data.optInt("episodeNo", -1),
                data.optString("provider", ""), data.optString("sessionId", ""),
                data.optString("providerShowId", ""));
    }

    static VerifiedRewardEvidence parseVerifiedRewardProvenance(int expectedEpisodeNo,
                                                                 boolean verified,
                                                                 int responseEpisodeNo,
                                                                 String provider,
                                                                 String sessionId,
                                                                 String providerShowId)
            throws IOException {
        if (!verified) {
            return null;
        }
        if (responseEpisodeNo != expectedEpisodeNo || !"TAKU".equals(provider)) {
            throw new IOException("Invalid native reward provenance response");
        }
        try {
            return new VerifiedRewardEvidence(sessionId, providerShowId);
        } catch (IllegalArgumentException invalid) {
            throw new IOException("Invalid native reward provenance response", invalid);
        }
    }

    private static String eventType(TakuTelemetry telemetry) {
        switch (telemetry.getState()) {
            case LOADING:
                return "LOAD_STARTED";
            case SHOWING:
                return telemetry.isClientRewardObserved() ? "REWARD_OBSERVED" : "SHOWN";
            case CLOSED:
                return "CLOSED";
            case ERROR:
                return "FAILED";
            default:
                throw new IllegalArgumentException("Unsupported native telemetry state");
        }
    }

    private interface Parser<T> {
        T parse(JSONObject data) throws Exception;
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value == null ? JSONObject.NULL : value);
        } catch (Throwable ignored) {
        }
    }
}
