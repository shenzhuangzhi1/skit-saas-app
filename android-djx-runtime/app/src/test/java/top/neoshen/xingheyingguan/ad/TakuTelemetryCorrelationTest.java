package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public class TakuTelemetryCorrelationTest {

    @Test
    public void retainsDynamicNetworkAndOnlyAOneWayAdsourceAliasForLogs() {
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

        TakuTelemetry telemetry = machine.showing("show-1", 451, "private-adsource-987");

        assertEquals(Integer.valueOf(451), telemetry.getNetworkFirmId());
        assertNotEquals("private-adsource-987", telemetry.getAdsourceAlias());
        assertTrue(telemetry.getAdsourceAlias().matches("[a-f0-9]{12}"));
        String correlation = telemetry.safeSourceCorrelation();
        assertTrue(correlation.contains("networkFirmId=451"));
        assertTrue(correlation.contains("adsourceAlias=" + telemetry.getAdsourceAlias()));
        assertFalse(correlation.contains("private-adsource-987"));
    }
}
