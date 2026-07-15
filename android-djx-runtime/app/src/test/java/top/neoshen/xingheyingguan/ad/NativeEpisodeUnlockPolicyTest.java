package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NativeEpisodeUnlockPolicyTest {

    @Test
    public void nativePlaybackAlwaysUsesZeroFreeEpisodesAndOneEpisodePerReward() throws Exception {
        Class<?> type = policyType();
        assertEquals(0, type.getField("FREE_SET").getInt(null));
        assertEquals(1, type.getField("LOCK_SET").getInt(null));
    }

    @Test
    public void episodeAServerEntitlementCannotUnlockEpisodeBOrBeReplayed() throws Exception {
        Class<?> type = policyType();
        Constructor<?> constructor = type.getConstructor();
        Object policy = constructor.newInstance();
        Method begin = type.getMethod("begin", long.class, int.class);
        Method isActive = type.getMethod("isActive", long.class, long.class, int.class);
        Method consumeIfEntitled = type.getMethod(
                "consumeIfEntitled", long.class, long.class, int.class, List.class);
        Method cancel = type.getMethod("cancel", long.class);

        long dramaId = 901L;
        long episodeAGeneration = (Long) begin.invoke(policy, dramaId, 7);
        assertFalse((Boolean) consumeIfEntitled.invoke(
                policy, episodeAGeneration, dramaId, 8, Arrays.asList(7, 8)));
        assertTrue((Boolean) isActive.invoke(policy, episodeAGeneration, dramaId, 7));
        assertTrue((Boolean) consumeIfEntitled.invoke(
                policy, episodeAGeneration, dramaId, 7, Arrays.asList(7)));
        assertFalse((Boolean) consumeIfEntitled.invoke(
                policy, episodeAGeneration, dramaId, 7, Arrays.asList(7)));

        long episodeBGeneration = (Long) begin.invoke(policy, dramaId, 8);
        assertFalse((Boolean) consumeIfEntitled.invoke(
                policy, episodeAGeneration, dramaId, 8, Arrays.asList(8)));
        assertFalse((Boolean) consumeIfEntitled.invoke(
                policy, episodeBGeneration, dramaId + 1, 8, Arrays.asList(8)));
        assertTrue((Boolean) isActive.invoke(policy, episodeBGeneration, dramaId, 8));
        cancel.invoke(policy, episodeBGeneration);
        assertFalse((Boolean) isActive.invoke(policy, episodeBGeneration, dramaId, 8));

        long episodeCAfterCancelGeneration = (Long) begin.invoke(policy, dramaId, 9);
        assertTrue((Boolean) consumeIfEntitled.invoke(
                policy, episodeCAfterCancelGeneration, dramaId, 9, Arrays.asList(9)));
    }

    private static Class<?> policyType() {
        try {
            return Class.forName(
                    "top.neoshen.xingheyingguan.ad.NativeEpisodeUnlockPolicy");
        } catch (ClassNotFoundException missingPolicy) {
            throw new AssertionError("Native episode unlock policy is missing", missingPolicy);
        }
    }
}
