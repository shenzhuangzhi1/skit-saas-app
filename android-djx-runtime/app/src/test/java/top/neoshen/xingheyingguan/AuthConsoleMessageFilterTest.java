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
