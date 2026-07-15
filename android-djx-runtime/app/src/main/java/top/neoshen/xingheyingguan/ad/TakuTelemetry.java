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
    private final boolean clientRewardObserved;
    private final boolean closed;

    TakuTelemetry(AdSessionProtocol protocol, String sdkRequestId, String providerShowId,
                  Integer networkFirmId, String adsourceId, int callbackSequence,
                  TakuNativeState state, boolean clientRewardObserved, boolean closed) {
        this.protocol = protocol;
        this.sdkRequestId = sdkRequestId;
        this.providerShowId = providerShowId;
        this.networkFirmId = networkFirmId;
        this.adsourceId = adsourceId;
        this.callbackSequence = callbackSequence;
        this.state = state;
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

    public int getCallbackSequence() {
        return callbackSequence;
    }

    public TakuNativeState getState() {
        return state;
    }

    public boolean isClientRewardObserved() {
        return clientRewardObserved;
    }

    public boolean isClosed() {
        return closed;
    }
}
