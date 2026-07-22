package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class ThirdPartySdkBootstrapTest {

    @Test
    public void preConsentRequestsFailFastAndConsentStartsEachSdkOnceAfterRetry() {
        FakeStarter starter = new FakeStarter();
        ThirdPartySdkBootstrap bootstrap = new ThirdPartySdkBootstrap(starter);
        RecordingCallback content = new RecordingCallback();
        RecordingCallback ad = new RecordingCallback();

        bootstrap.whenContentReady(content);
        bootstrap.whenRewardedAdReady(ad);

        assertEquals(Arrays.asList(), starter.starts);
        assertEquals(0, content.readyCount);
        assertEquals(0, ad.readyCount);
        assertEquals(1, content.blockedCount);
        assertEquals(1, ad.blockedCount);

        bootstrap.deliverConsent(true);
        bootstrap.deliverConsent(true);
        assertEquals(Arrays.asList(), starter.starts);

        content = new RecordingCallback();
        ad = new RecordingCallback();
        bootstrap.whenContentReady(content);
        bootstrap.whenRewardedAdReady(ad);
        assertEquals(Arrays.asList("PANGLE"), starter.starts);

        starter.completePangle();
        assertEquals(Arrays.asList("PANGLE", "TAKU"), starter.starts);
        assertEquals(1, content.readyCount);
        assertEquals(0, ad.readyCount);

        starter.completeTaku();
        assertEquals(1, ad.readyCount);

        bootstrap.whenContentReady(new RecordingCallback());
        bootstrap.whenRewardedAdReady(new RecordingCallback());
        assertEquals(Arrays.asList("PANGLE", "TAKU"), starter.starts);
    }

    @Test
    public void adFirstAndContentFirstBothEstablishPangleBeforeTaku() {
        FakeStarter adFirstStarter = new FakeStarter();
        ThirdPartySdkBootstrap adFirst = new ThirdPartySdkBootstrap(adFirstStarter);
        adFirst.deliverConsent(true);
        adFirst.whenRewardedAdReady(new RecordingCallback());
        assertEquals(Arrays.asList("PANGLE"), adFirstStarter.starts);
        adFirstStarter.completePangle();
        assertEquals(Arrays.asList("PANGLE", "TAKU"), adFirstStarter.starts);

        FakeStarter contentFirstStarter = new FakeStarter();
        ThirdPartySdkBootstrap contentFirst = new ThirdPartySdkBootstrap(contentFirstStarter);
        contentFirst.deliverConsent(true);
        contentFirst.whenContentReady(new RecordingCallback());
        assertEquals(Arrays.asList("PANGLE"), contentFirstStarter.starts);
        contentFirstStarter.completePangle();
        contentFirst.whenRewardedAdReady(new RecordingCallback());
        assertEquals(Arrays.asList("PANGLE", "TAKU"), contentFirstStarter.starts);
    }

    @Test
    public void explicitDenialBlocksRequestsWithoutInventingConsent() {
        FakeStarter starter = new FakeStarter();
        ThirdPartySdkBootstrap bootstrap = new ThirdPartySdkBootstrap(starter);
        RecordingCallback denied = new RecordingCallback();

        bootstrap.deliverConsent(false);
        bootstrap.whenRewardedAdReady(denied);

        assertEquals(Arrays.asList(), starter.starts);
        assertEquals(1, denied.blockedCount);
        assertEquals(ThirdPartySdkBootstrap.CONSENT_REQUIRED_CODE, denied.lastCode);
    }

    @Test
    public void failedBootstrapDrainsOnlyThatAttemptAndCanRetryCleanly() {
        FakeStarter starter = new FakeStarter();
        ThirdPartySdkBootstrap bootstrap = new ThirdPartySdkBootstrap(starter);
        RecordingCallback content = new RecordingCallback();
        RecordingCallback ad = new RecordingCallback();
        bootstrap.deliverConsent(true);

        bootstrap.whenContentReady(content);
        bootstrap.whenRewardedAdReady(ad);
        starter.failPangle();

        assertEquals(1, content.blockedCount);
        assertEquals(1, ad.blockedCount);
        assertEquals(ThirdPartySdkBootstrap.PANGLE_INIT_FAILED_CODE, content.lastCode);
        assertEquals(ThirdPartySdkBootstrap.PANGLE_INIT_FAILED_CODE, ad.lastCode);
        assertEquals(Arrays.asList("PANGLE"), starter.starts);

        RecordingCallback retry = new RecordingCallback();
        bootstrap.whenContentReady(retry);
        assertEquals(Arrays.asList("PANGLE", "PANGLE"), starter.starts);
        starter.completePangle();
        assertEquals(1, retry.readyCount);
        assertEquals(1, content.blockedCount);
        assertEquals(1, ad.blockedCount);
    }

    @Test
    public void failedTakuBootstrapUsesOnlyTheStableTakuFailureCode() {
        FakeStarter starter = new FakeStarter();
        ThirdPartySdkBootstrap bootstrap = new ThirdPartySdkBootstrap(starter);
        RecordingCallback ad = new RecordingCallback();
        bootstrap.deliverConsent(true);

        bootstrap.whenRewardedAdReady(ad);
        starter.completePangle();
        starter.failTaku();

        assertEquals(1, ad.blockedCount);
        assertEquals(ThirdPartySdkBootstrap.TAKU_INIT_FAILED_CODE, ad.lastCode);
    }

    @Test
    public void cancelledUnknownConsentRequestCannotStartOrReceiveALateCallback() {
        FakeStarter starter = new FakeStarter();
        ThirdPartySdkBootstrap bootstrap = new ThirdPartySdkBootstrap(starter);
        RecordingCallback cancelled = new RecordingCallback();

        ThirdPartySdkBootstrap.Registration registration =
                bootstrap.whenRewardedAdReady(cancelled);
        registration.cancel();
        bootstrap.deliverConsent(true);

        assertEquals(Arrays.asList(), starter.starts);
        assertEquals(0, cancelled.readyCount);
        assertEquals(1, cancelled.blockedCount);
    }

    private static final class RecordingCallback implements ThirdPartySdkBootstrap.Callback {
        private int readyCount;
        private int blockedCount;
        private int lastCode;

        @Override
        public void onReady() {
            readyCount += 1;
        }

        @Override
        public void onBlocked(int code, String message) {
            blockedCount += 1;
            lastCode = code;
        }
    }

    private static final class FakeStarter implements ThirdPartySdkBootstrap.Starter {
        private final List<String> starts = new ArrayList<>();
        private ThirdPartySdkBootstrap.Completion pangle;
        private ThirdPartySdkBootstrap.Completion taku;

        @Override
        public void startPangle(ThirdPartySdkBootstrap.Completion completion) {
            starts.add("PANGLE");
            pangle = completion;
        }

        @Override
        public void startTaku(ThirdPartySdkBootstrap.Completion completion) {
            starts.add("TAKU");
            taku = completion;
        }

        private void completePangle() {
            pangle.onSuccess();
        }

        private void completeTaku() {
            taku.onSuccess();
        }

        private void failPangle() {
            pangle.onFailure(-700, "bootstrap failed");
        }

        private void failTaku() {
            taku.onFailure(-799, "provider detail must not escape");
        }
    }
}
