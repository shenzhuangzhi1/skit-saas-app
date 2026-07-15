package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public class NativePlayerGrantTest {

    @Test
    public void acceptsAStillValidGrantBoundToTheRequestedDrama() {
        NativePlayerGrant grant = new NativePlayerGrant(
                17L,
                901L,
                "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
                2_000L,
                1_000L);
        assertEquals(901L, grant.getDramaId());
    }

    @Test
    public void rejectsExpiredWrongLengthOrWrongDramaGrants() {
        assertThrows(IllegalArgumentException.class, () -> new NativePlayerGrant(
                17L, 901L, "short", 2_000L, 1_000L));
        assertThrows(IllegalArgumentException.class, () -> new NativePlayerGrant(
                17L, 901L, "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789", 1_000L, 1_000L));
        NativePlayerGrant grant = new NativePlayerGrant(
                17L, 901L, "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789", 2_000L, 1_000L);
        assertThrows(IllegalArgumentException.class, () -> grant.requireDrama(902L));
    }
}
