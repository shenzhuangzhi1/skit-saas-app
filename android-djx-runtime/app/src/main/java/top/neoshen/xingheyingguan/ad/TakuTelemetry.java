package top.neoshen.xingheyingguan.ad;

/** A strict, immutable client telemetry event. It is never an entitlement decision. */
public final class TakuTelemetry {
    private final AdSessionProtocol protocol;
    private final String sdkRequestId;
    private final String providerShowId;
    private final Integer networkFirmId;
    private final String adsourceId;
    private final int callbackSequence;
    private final TakuNativeState state;
    private final TakuFailureReason failureReason;
    private final boolean clientRewardObserved;
    private final boolean closed;

    TakuTelemetry(AdSessionProtocol protocol, String sdkRequestId, String providerShowId,
                  Integer networkFirmId, String adsourceId, int callbackSequence,
                  TakuNativeState state, TakuFailureReason failureReason,
                  boolean clientRewardObserved, boolean closed) {
        if (failureReason == null
                || ((state == TakuNativeState.ERROR)
                != (failureReason != TakuFailureReason.NONE))) {
            throw new IllegalArgumentException("Failure reason does not match native state");
        }
        this.protocol = protocol;
        this.sdkRequestId = sdkRequestId;
        this.providerShowId = providerShowId;
        this.networkFirmId = networkFirmId;
        this.adsourceId = adsourceId;
        this.callbackSequence = callbackSequence;
        this.state = state;
        this.failureReason = failureReason;
        this.clientRewardObserved = clientRewardObserved;
        this.closed = closed;
    }

    public AdSessionProtocol getProtocol() {
        return protocol;
    }

    public String getSdkRequestId() {
        return sdkRequestId;
    }

    public String getProviderShowId() {
        return providerShowId;
    }

    public Integer getNetworkFirmId() {
        return networkFirmId;
    }

    public String getAdsourceId() {
        return adsourceId;
    }

    public String getAdsourceAlias() {
        return SafeEvidenceReference.of(adsourceId);
    }

    public String safeSourceCorrelation() {
        return "networkFirmId=" + (networkFirmId == null ? "<none>" : networkFirmId)
                + " adsourceAlias=" + getAdsourceAlias();
    }

    public int getCallbackSequence() {
        return callbackSequence;
    }

    public TakuNativeState getState() {
        return state;
    }

    public TakuFailureReason getFailureReason() {
        return failureReason;
    }

    public boolean isClientRewardObserved() {
        return clientRewardObserved;
    }

    public boolean isClosed() {
        return closed;
    }
}
