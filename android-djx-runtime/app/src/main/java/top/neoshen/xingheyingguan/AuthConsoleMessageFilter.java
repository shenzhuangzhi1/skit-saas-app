package top.neoshen.xingheyingguan;

import java.util.regex.Pattern;

public final class AuthConsoleMessageFilter {
    private static final int MAX_LENGTH = 240;
    private static final Pattern SAFE_AUTH_MESSAGE =
            Pattern.compile(
                    "^\\[auth\\] [a-z0-9-]{1,40} "
                            + "http=(?:[1-5][0-9]{2}|unknown) "
                            + "code=[A-Za-z0-9_-]{1,64} "
                            + "path=/(?:[A-Za-z_-]+/?){1,12}$");

    private AuthConsoleMessageFilter() {
    }

    public static String forLog(String message) {
        if (message == null
                || message.length() > MAX_LENGTH
                || !SAFE_AUTH_MESSAGE.matcher(message).matches()) {
            return null;
        }
        return message;
    }
}
