package top.neoshen.xingheyingguan;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class AuthConsoleMessageFilterTest {

    @Test
    public void acceptsOnlyTheStructuredAuthDiagnostic() {
        String message =
                "[auth] business-response http=200 code=401 path=/skit/member/user/profile";

        assertEquals(message, AuthConsoleMessageFilter.forLog(message));
        assertEquals(
                "[auth] session-verification http=200 code=AUTH_SESSION_STALE "
                        + "path=/skit/member/user/profile",
                AuthConsoleMessageFilter.forLog(
                        "[auth] session-verification http=200 code=AUTH_SESSION_STALE "
                                + "path=/skit/member/user/profile"));
    }

    @Test
    public void acceptsOnlyStructuredAdUnlockDiagnostics() {
        assertEquals(
                "[ad-unlock] stage=native code=NATIVE_AD_NO_FILL",
                AuthConsoleMessageFilter.forLog(
                        "[ad-unlock] stage=native code=NATIVE_AD_NO_FILL"));
        assertEquals(
                "[ad-unlock] stage=session code=401",
                AuthConsoleMessageFilter.forLog(
                        "[ad-unlock] stage=session code=401"));
    }

    @Test
    public void rejectsArbitraryConsoleOutputAndSensitiveUrlData() {
        assertNull(AuthConsoleMessageFilter.forLog("login token=secret"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[auth] business-response http=200 code=401 "
                                + "path=/skit/member/user/profile?token=secret"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[auth] business-response http=200 code=401 "
                                + "path=/skit/member/user/13800000000/profile"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[auth] session-verification http=200 code=13800000000 "
                                + "path=/skit/member/user/profile"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[auth] session-verification http=200 code=TOKEN_SECRET_ABC123 "
                                + "path=/skit/member/user/profile"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[ad-unlock] stage=identity code=13800000000"));
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[ad-unlock] stage=native code=AUTH_SECRET_TOKEN_ABC123"));
    }

    @Test
    public void rejectsMultilineAndOversizedMessages() {
        assertNull(
                AuthConsoleMessageFilter.forLog(
                        "[auth] business-response http=200 code=401 "
                                + "path=/skit/member/user/profile\nsecret"));
        assertNull(AuthConsoleMessageFilter.forLog("[auth] " + "x".repeat(300)));
    }
}
