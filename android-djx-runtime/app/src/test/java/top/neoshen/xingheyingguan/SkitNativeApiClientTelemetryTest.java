package top.neoshen.xingheyingguan;

import org.junit.Test;

import java.util.Map;

import top.neoshen.xingheyingguan.ad.AdSessionProtocol;
import top.neoshen.xingheyingguan.ad.TakuSessionStateMachine;
import top.neoshen.xingheyingguan.ad.TakuTelemetry;

import static org.junit.Assert.assertEquals;

public class SkitNativeApiClientTelemetryTest {

    @Test
    public void postRewardFailurePayloadPreservesRewardAndShowEvidence() {
        AdSessionProtocol protocol = new AdSessionProtocol(
                1,
                "session_0123456789ABCD",
                "TAKU",
                "tenant-placement-1",
                "opaque-member-1",
                "token_0123456789ABCDEFGH",
                "drama_unlock");
        TakuSessionStateMachine machine = new TakuSessionStateMachine(protocol, "request-1");
        machine.loading();
        machine.loaded();
        machine.showing("show-1", 66, "source-1");
        machine.rewardObserved("show-1", 66, "source-1");
        TakuTelemetry failure = machine.failed(null, null, null);

        Map<String, Object> payload = SkitNativeApiClient.telemetryEvent(failure);

        assertEquals("FAILED", payload.get("eventType"));
        assertEquals("ERROR", payload.get("nativeState"));
        assertEquals(Boolean.TRUE, payload.get("clientRewardObserved"));
        assertEquals("show-1", payload.get("providerShowId"));
        assertEquals(66, payload.get("networkFirmId"));
        assertEquals("source-1", payload.get("adsourceId"));
    }
}
