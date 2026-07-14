package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class AdSessionProtocolTest {

    @Test
    public void acceptsOnlyTheServerIssuedTakuProtocol() {
        AdSessionProtocol protocol = new AdSessionProtocol(
                1,
                "session_0123456789ABCD",
                "TAKU",
                "tenant-placement-1",
                "opaque-member-1",
                "token_0123456789ABCDEFGH",
                "drama_unlock");

        assertEquals("session_0123456789ABCD", protocol.getSessionId());
        assertEquals("tenant-placement-1", protocol.getPlacementId());
    }

    @Test
    public void rejectsWrongProviderVersionOrIdentityFields() {
        assertThrows(IllegalArgumentException.class, () -> new AdSessionProtocol(
                2, "session_0123456789ABCD", "TAKU", "placement", "user",
                "token_0123456789ABCDEFGH", "drama_unlock"));
        assertThrows(IllegalArgumentException.class, () -> new AdSessionProtocol(
                1, "session_0123456789ABCD", "PANGLE", "placement", "user",
                "token_0123456789ABCDEFGH", "drama_unlock"));
        assertThrows(IllegalArgumentException.class, () -> new AdSessionProtocol(
                1, "short", "TAKU", "placement", "user",
                "token_0123456789ABCDEFGH", "drama_unlock"));
        assertThrows(IllegalArgumentException.class, () -> new AdSessionProtocol(
                1, "session_0123456789ABCD", "TAKU", "placement", "user",
                "short", "drama_unlock"));
    }
}
