package top.neoshen.xingheyingguan.ad;

import java.util.regex.Pattern;

/** Enforces one monotonic SDK callback stream for one server session. */
public final class TakuSessionStateMachine {
    private static final Pattern SAFE_TEXT = Pattern.compile("[A-Za-z0-9._:/-]{1,128}");

    private final AdSessionProtocol protocol;
    private final String sdkRequestId;
    private TakuNativeState state = TakuNativeState.UNINITIALIZED;
    private int nextSequence;
    private String providerShowId;
    private Integer networkFirmId;
    private String adsourceId;
    private boolean rewardObserved;
    private boolean terminal;

    public TakuSessionStateMachine(AdSessionProtocol protocol, String sdkRequestId) {
        if (protocol == null) {
            throw new IllegalArgumentException("protocol is required");
        }
        if (!safe(sdkRequestId)) {
            throw new IllegalArgumentException("Invalid sdkRequestId");
        }
        this.protocol = protocol;
        this.sdkRequestId = sdkRequestId;
    }

    public TakuNativeState getState() {
        return state;
    }

    public void initializing() {
        requireState(TakuNativeState.UNINITIALIZED);
        state = TakuNativeState.INITIALIZING;
    }

    public TakuTelemetry loading() {
        if (state != TakuNativeState.UNINITIALIZED && state != TakuNativeState.INITIALIZING) {
            throw new IllegalStateException("Illegal state transition to LOADING from " + state);
        }
        state = TakuNativeState.LOADING;
        return event(null, null, null, false, false);
    }

    public TakuTelemetry loaded() {
        requireState(TakuNativeState.LOADING);
        state = TakuNativeState.LOADED;
        return event(null, null, null, false, false);
    }

    public TakuTelemetry showing(String showId, Integer networkFirmId, String adsourceId) {
        requireState(TakuNativeState.LOADED);
        bindShow(showId, networkFirmId, adsourceId);
        state = TakuNativeState.SHOWING;
        return event(showId, networkFirmId, adsourceId, false, false);
    }

    public TakuTelemetry rewardObserved(String showId, Integer networkFirmId, String adsourceId) {
        requireState(TakuNativeState.SHOWING);
        requireSameShow(showId, networkFirmId, adsourceId);
        if (rewardObserved) {
            throw new IllegalStateException("Duplicate reward callback");
        }
        rewardObserved = true;
        return event(showId, networkFirmId, adsourceId, true, false);
    }

    public TakuTelemetry closed(String showId, Integer networkFirmId, String adsourceId) {
        requireState(TakuNativeState.SHOWING);
        requireSameShow(showId, networkFirmId, adsourceId);
        terminal = true;
        state = TakuNativeState.CLOSED;
        return event(showId, networkFirmId, adsourceId, rewardObserved, true);
    }

    public TakuTelemetry failed(String showId, Integer networkFirmId, String adsourceId) {
        return failed(showId, networkFirmId, adsourceId, TakuFailureReason.SDK_FAILURE);
    }

    public TakuTelemetry failed(String showId, Integer networkFirmId, String adsourceId,
                                TakuFailureReason failureReason) {
        if (terminal || state == TakuNativeState.ERROR || state == TakuNativeState.CLOSED) {
            throw new IllegalStateException("Ad session is already terminal");
        }
        if (failureReason == null || failureReason == TakuFailureReason.NONE) {
            throw new IllegalArgumentException("A terminal failure reason is required");
        }
        if (showId != null) {
            if (state != TakuNativeState.SHOWING) {
                throw new IllegalStateException("Show identity is unavailable before SHOWING");
            }
            requireSameShow(showId, networkFirmId, adsourceId);
        } else if (state == TakuNativeState.SHOWING) {
            showId = providerShowId;
            networkFirmId = this.networkFirmId;
            adsourceId = this.adsourceId;
        }
        terminal = true;
        state = TakuNativeState.ERROR;
        return event(showId, networkFirmId, adsourceId, failureReason, rewardObserved, false);
    }

    private TakuTelemetry event(String showId, Integer networkFirmId, String adsourceId,
                                boolean clientRewardObserved, boolean closed) {
        return event(showId, networkFirmId, adsourceId, TakuFailureReason.NONE,
                clientRewardObserved, closed);
    }

    private TakuTelemetry event(String showId, Integer networkFirmId, String adsourceId,
                                TakuFailureReason failureReason,
                                boolean clientRewardObserved, boolean closed) {
        return new TakuTelemetry(protocol, sdkRequestId, showId, networkFirmId, adsourceId,
                nextSequence++, state, failureReason, clientRewardObserved, closed);
    }

    private void bindShow(String showId, Integer networkFirmId, String adsourceId) {
        requireShowFields(showId, networkFirmId, adsourceId);
        providerShowId = showId;
        this.networkFirmId = networkFirmId;
        this.adsourceId = adsourceId;
    }

    private void requireSameShow(String showId, Integer networkFirmId, String adsourceId) {
        requireShowFields(showId, networkFirmId, adsourceId);
        if (!providerShowId.equals(showId) || !this.networkFirmId.equals(networkFirmId)
                || !this.adsourceId.equals(adsourceId)) {
            throw new IllegalStateException("Provider show identity changed within the session");
        }
    }

    private static void requireShowFields(String showId, Integer networkFirmId, String adsourceId) {
        if (!safe(showId)) {
            throw new IllegalArgumentException("Invalid providerShowId");
        }
        if (networkFirmId == null || networkFirmId <= 0) {
            throw new IllegalArgumentException("Invalid networkFirmId");
        }
        if (!safe(adsourceId)) {
            throw new IllegalArgumentException("Invalid adsourceId");
        }
    }

    private void requireState(TakuNativeState required) {
        if (terminal || state != required) {
            throw new IllegalStateException("Illegal state transition from " + state);
        }
    }

    private static boolean safe(String value) {
        return value != null && SAFE_TEXT.matcher(value).matches();
    }
}
