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
        Method begin = type.getMethod("begin", long.class, long.class, int.class);
        Method observeTerminal = type.getMethod(
                "observeTerminal", long.class, long.class, int.class);
        Method authorizeFromServer = type.getMethod(
                "authorizeFromServer", long.class, long.class, Collection.class);
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
        begin.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertTrue((Boolean) hasOutstandingResumeScope.invoke(policy));
        assertTrue(
                "server-authorized scope must suppress a synchronous SDK finish "
                        + "before unlockFlowEnd arrives",
                (Boolean) shouldSuppressTerminalFinish.invoke(policy));

        try {
            begin.invoke(policy, callbackEpoch + 1L, dramaId, targetEpisode + 1);
            fail("a second SDK unlock must not replace an armed resume scope");
        } catch (InvocationTargetException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        assertEquals(
                "a stale terminal callback must not cancel the current armed scope",
                0,
                observeTerminal.invoke(
                        policy, callbackEpoch + 1L, dramaId, targetEpisode));
        assertTrue((Boolean) hasOutstandingResumeScope.invoke(policy));

        assertEquals(
                "terminal-first must retain the exact scope while authoritative checks finish",
                0,
                observeTerminal.invoke(policy, callbackEpoch, dramaId, 0));
        assertTrue((Boolean) hasOutstandingResumeScope.invoke(policy));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertFalse((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));
        assertEquals(
                "the later exact server entitlement must complete a terminal-first rendezvous",
                targetEpisode,
                authorizeFromServer.invoke(policy, callbackEpoch, dramaId,
                        Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));

        begin.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                "server-first must wait for the exact terminal callback",
                0,
                authorizeFromServer.invoke(policy, callbackEpoch, dramaId,
                        Collections.singletonList(targetEpisode)));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertEquals(
                "DJX may omit both drama and episode on ERROR_GET_VIDEO_AD_ERROR",
                targetEpisode,
                observeTerminal.invoke(policy, callbackEpoch, 0L, 0));
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));

        begin.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                "a mismatched positive drama id must never consume another drama's entitlement",
                -1,
                observeTerminal.invoke(policy, callbackEpoch, dramaId + 1L, 0));
        assertFalse((Boolean) hasOutstandingResumeScope.invoke(policy));

        begin.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(0, observeTerminal.invoke(
                policy, callbackEpoch, dramaId, targetEpisode));
        assertEquals(-1, authorizeFromServer.invoke(
                policy, callbackEpoch, dramaId, Collections.emptyList()));
        assertFalse((Boolean) hasOutstandingResumeScope.invoke(policy));

        begin.invoke(policy, callbackEpoch, dramaId, targetEpisode);
        assertEquals(0, authorizeFromServer.invoke(
                policy, callbackEpoch, dramaId,
                Collections.singletonList(targetEpisode)));
        assertEquals(targetEpisode, observeTerminal.invoke(
                policy, callbackEpoch, dramaId, targetEpisode));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertTrue((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));

        try {
            begin.invoke(policy, callbackEpoch + 1L, dramaId, targetEpisode + 1);
            fail("a new SDK unlock must not overwrite a server-authorized pending resume");
        } catch (InvocationTargetException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        assertTrue((Boolean) isPendingResume.invoke(
                policy, callbackEpoch, targetEpisode));

        assertEquals(
                "a duplicate DJX terminal callback must not consume the pending recovery",
                0,
                observeTerminal.invoke(policy, callbackEpoch, dramaId, targetEpisode));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));

        assertFalse((Boolean) consumeForAttachment.invoke(policy, targetEpisode + 1));
        assertTrue((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertTrue((Boolean) consumeForAttachment.invoke(policy, targetEpisode));
        assertFalse((Boolean) shouldSuppressTerminalFinish.invoke(policy));
        assertFalse((Boolean) hasOutstandingResumeScope.invoke(policy));
        assertEquals(
                "an unrelated DJX terminal callback has no scope to reject",
                0, observeTerminal.invoke(
                policy, callbackEpoch, dramaId, targetEpisode));
    }

    @Test
    public void ignoresTerminalCallbacksThatHaveNoSdkOwnedScope() {
        NativeSdkUnlockResumePolicy policy = new NativeSdkUnlockResumePolicy();

        assertEquals(0, policy.observeTerminal(7L, 1286L, 0));
        assertFalse(policy.hasOutstandingResumeScope());
    }

    @Test
    public void rejectsAnExplicitlyMismatchedDuplicateTerminalBeforeResume() {
        NativeSdkUnlockResumePolicy policy = new NativeSdkUnlockResumePolicy();
        long callbackEpoch = 7L;
        long dramaId = 1337L;
        int targetEpisode = 5;

        policy.begin(callbackEpoch, dramaId, targetEpisode);
        assertEquals(0, policy.observeTerminal(callbackEpoch, dramaId, 0));
        assertEquals(
                NativeSdkUnlockResumePolicy.REJECTED_EPISODE,
                policy.observeTerminal(callbackEpoch, dramaId + 1L, targetEpisode));
        assertFalse(policy.hasOutstandingResumeScope());
        assertEquals(
                NativeSdkUnlockResumePolicy.REJECTED_EPISODE,
                policy.authorizeFromServer(
                        callbackEpoch, dramaId,
                        Collections.singletonList(targetEpisode)));

        policy.begin(callbackEpoch, dramaId, targetEpisode);
        assertEquals(
                NativeSdkUnlockResumePolicy.REJECTED_EPISODE,
                policy.observeTerminal(
                        callbackEpoch, dramaId, targetEpisode + 1));
        assertFalse(policy.hasOutstandingResumeScope());
    }

    @Test
    public void exposesOnlyOneSidedRendezvousAndCancelReleasesEveryState() {
        NativeSdkUnlockResumePolicy policy = new NativeSdkUnlockResumePolicy();
        long callbackEpoch = 9L;
        long dramaId = 1337L;
        int targetEpisode = 5;

        policy.begin(callbackEpoch, dramaId, targetEpisode);
        assertFalse(policy.isWaitingForCounterpart(callbackEpoch, targetEpisode));
        policy.cancel();
        policy.begin(callbackEpoch, dramaId, targetEpisode);

        assertEquals(0, policy.observeTerminal(callbackEpoch, dramaId, 0));
        assertTrue(policy.isWaitingForCounterpart(callbackEpoch, targetEpisode));
        policy.cancel();
        policy.begin(callbackEpoch, dramaId, targetEpisode);

        assertEquals(0, policy.authorizeFromServer(
                callbackEpoch, dramaId, Collections.singletonList(targetEpisode)));
        assertTrue(policy.isWaitingForCounterpart(callbackEpoch, targetEpisode));
        policy.cancel();
        policy.begin(callbackEpoch, dramaId, targetEpisode);

        assertEquals(0, policy.observeTerminal(callbackEpoch, dramaId, 0));
        assertEquals(targetEpisode, policy.authorizeFromServer(
                callbackEpoch, dramaId, Collections.singletonList(targetEpisode)));
        assertFalse(policy.isWaitingForCounterpart(callbackEpoch, targetEpisode));
        policy.cancel();

        policy.begin(callbackEpoch + 1L, dramaId, targetEpisode + 1);
        assertTrue(policy.hasOutstandingResumeScope());

        assertEquals(0, policy.observeTerminal(
                callbackEpoch, dramaId, targetEpisode));
        assertEquals(0, policy.authorizeFromServer(
                callbackEpoch, dramaId,
                Collections.singletonList(targetEpisode)));
        assertFalse(policy.isWaitingForCounterpart(
                callbackEpoch + 1L, targetEpisode + 1));
        assertEquals(0, policy.observeTerminal(
                callbackEpoch + 1L, dramaId, targetEpisode + 1));
        assertEquals(targetEpisode + 1, policy.authorizeFromServer(
                callbackEpoch + 1L, dramaId,
                Collections.singletonList(targetEpisode + 1)));
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

        Map<String, Object> dramaOnly = new HashMap<>();
        dramaOnly.put("drama_id", dramaId);
        assertEquals(
                "DJX may preserve the correct drama while omitting the episode on its "
                        + "terminal ad-error callback",
                0,
                reportedEpisode.invoke(null, dramaOnly, dramaId));

        Map<String, Object> wrongDrama = new HashMap<>(exact);
        wrongDrama.put("drama_id", dramaId + 1L);
        assertEquals(-1, reportedEpisode.invoke(null, wrongDrama, dramaId));

        Map<String, Object> malformedEpisode = new HashMap<>(exact);
        malformedEpisode.put("index", 41.5D);
        assertEquals(-1, reportedEpisode.invoke(null, malformedEpisode, dramaId));
    }
}
