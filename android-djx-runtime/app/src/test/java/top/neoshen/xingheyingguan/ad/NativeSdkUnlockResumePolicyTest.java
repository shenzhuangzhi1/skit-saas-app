package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Collections;

import static org.junit.Assert.assertEquals;

public class NativeSdkUnlockResumePolicyTest {

    @Test
    public void resumesTheExactEpisodeOnlyFromServerEntitlement() throws Exception {
        Class<?> type;
        try {
            type = Class.forName(
                    "top.neoshen.xingheyingguan.ad.NativeSdkUnlockResumePolicy");
        } catch (ClassNotFoundException missingPolicy) {
            throw new AssertionError(
                    "Native player does not resume after DJX finishes an async unlock",
                    missingPolicy);
        }
        Object policy = type.getConstructor().newInstance();
        Method arm = type.getMethod("arm", long.class, long.class, int.class);
        Method complete = type.getMethod(
                "completeWithServerEntitlements",
                long.class, long.class, int.class, Collection.class);

        long callbackEpoch = 7L;
        long dramaId = 1346L;
        int targetEpisode = 41;
        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);

        assertEquals(0, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode, Collections.emptyList()));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(0, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode + 1,
                Collections.singletonList(targetEpisode)));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                "DJX may omit the episode when its advisory status reports an ad error; "
                        + "the exact armed episode must still resume from server entitlement",
                targetEpisode,
                complete.invoke(policy, callbackEpoch, dramaId, 0,
                        Collections.singletonList(targetEpisode)));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(targetEpisode, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode,
                Collections.singletonList(targetEpisode)));
        assertEquals(0, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode,
                Collections.singletonList(targetEpisode)));
    }
}
