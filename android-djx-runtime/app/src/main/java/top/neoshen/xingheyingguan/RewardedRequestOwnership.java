package top.neoshen.xingheyingguan;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;

/** Owns the one native rewarded-ad request whose JavaScript callback is still live. */
final class RewardedRequestOwnership {
    static final class Request {
        private final String callbackId;
        private final AdSessionProtocol protocol;

        private Request(String callbackId, AdSessionProtocol protocol) {
            this.callbackId = callbackId;
            this.protocol = protocol;
        }

        String getCallbackId() {
            return callbackId;
        }

        AdSessionProtocol getProtocol() {
            return protocol;
        }
    }

    private Request active;

    synchronized void begin(String callbackId, AdSessionProtocol protocol) {
        if (callbackId == null || protocol == null) {
            throw new IllegalArgumentException("Rewarded request identity is required");
        }
        if (active != null) {
            throw new IllegalStateException("A Taku session is already active");
        }
        active = new Request(callbackId, protocol);
    }

    synchronized boolean isCurrent(String callbackId) {
        return active != null && active.callbackId.equals(callbackId);
    }

    synchronized Request clearIfCurrent(String callbackId) {
        if (!isCurrent(callbackId)) {
            return null;
        }
        return clear();
    }

    synchronized Request clear() {
        Request request = active;
        active = null;
        return request;
    }
}
