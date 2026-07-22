package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

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
        Method shouldSuppressTerminalFinish = type.getMethod(
                "shouldSuppressTerminalFinish");
        Method hasOutstandingResumeScope = type.getMethod(
                "hasOutstandingResumeScope");
        Method isPendingResume = type.getMethod(
                "isPendingResume", long.class, int.class);
        Method consumeForAttachment = type.getMethod(
                "consumePendingResumeForAttachment", int.class);

        long callbackEpoch = 7L;
        long dramaId = 1346L;
        int targetEpisode = 41;
        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertTrue((Boolean) hasOutstandingResumeScope.invoke(policy));
        assertFalse((Boolean) shouldSuppressTerminalFinish.invoke(policy));

        try {
            arm.invoke(policy, callbackEpoch + 1L, dramaId, targetEpisode + 1);
            fail("a second SDK unlock must not replace an armed resume scope");
        } catch (InvocationTargetException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        assertEquals(
                "a stale terminal callback must not cancel the current armed scope",
                0,
                complete.invoke(policy, callbackEpoch + 1L, dramaId, targetEpisode,
                        Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) hasOutstandingResumeScope.invoke(policy));

        assertEquals(0, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode, Collections.emptyList()));
        assertFalse((Boolean) hasOutstandingResumeScope.invoke(policy));

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
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                "DJX may omit both drama and episode on ERROR_GET_VIDEO_AD_ERROR; "
                        + "the exact armed scope must still resume from server entitlement",
                targetEpisode,
                complete.invoke(policy, callbackEpoch, 0L, 0,
                        Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                "a mismatched positive drama id must never consume another drama's entitlement",
                0,
                complete.invoke(policy, callbackEpoch, dramaId + 1L, 0,
                        Collections.singletonList(targetEpisode)));

        arm.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(targetEpisode, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode,
                Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertTrue((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));

        try {
            arm.invoke(policy, callbackEpoch + 1L, dramaId, targetEpisode + 1);
            fail("a new SDK unlock must not overwrite a server-authorized pending resume");
        } catch (InvocationTargetException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        assertTrue((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));

        assertEquals(
                "a duplicate DJX terminal callback must not consume the pending recovery",
                0,
                complete.invoke(policy, callbackEpoch, dramaId, targetEpisode,
                        Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));

        assertFalse((Boolean) consumeForAttachment.invoke(policy, targetEpisode + 1));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));
        assertFalse((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertFalse((Boolean) hasOutstandingResumeScope.invoke(policy));
        assertEquals(0, complete.invoke(
                policy, callbackEpoch, dramaId, targetEpisode,
                Collections.singletonList(targetEpisode)));
    }

    @Test
    public void distinguishesMissingTerminalEvidenceFromMalformedOrMismatchedEvidence()
            throws Exception {
        Class<?> type;
        try {
            type = Class.forName(
                    "top.neoshen.xingheyingguan.ad.NativeSdkUnlockTerminalEvidence");
        } catch (ClassNotFoundException missingParser) {
            throw new AssertionError(
                    "DJX terminal evidence needs an explicit absent-versus-invalid parser",
                    missingParser);
        }
        Method reportedEpisode = type.getMethod(
                "reportedEpisode", Map.class, long.class);
        long dramaId = 1346L;
        int targetEpisode = 41;

        assertEquals(0, reportedEpisode.invoke(null, null, dramaId));
        assertEquals(0, reportedEpisode.invoke(null, Collections.emptyMap(), dramaId));

        Map<String, Object> indexOnly = new HashMap<>();
        indexOnly.put("index", targetEpisode);
        assertEquals(targetEpisode, reportedEpisode.invoke(null, indexOnly, dramaId));

        Map<String, Object> exact = new HashMap<>();
        exact.put("drama_id", dramaId);
        exact.put("index", targetEpisode);
        assertEquals(targetEpisode, reportedEpisode.invoke(null, exact, dramaId));

        Map<String, Object> wrongDrama = new HashMap<>(exact);
        wrongDrama.put("drama_id", dramaId + 1L);
        assertEquals(-1, reportedEpisode.invoke(null, wrongDrama, dramaId));

        Map<String, Object> malformedEpisode = new HashMap<>(exact);
        malformedEpisode.put("index", 41.5D);
        assertEquals(-1, reportedEpisode.invoke(null, malformedEpisode, dramaId));
    }
}
