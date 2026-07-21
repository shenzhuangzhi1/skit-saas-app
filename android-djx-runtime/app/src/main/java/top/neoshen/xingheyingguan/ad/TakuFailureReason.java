package top.neoshen.xingheyingguan.ad;

/** Safe, UI-only failure categories. Raw provider messages never cross the native bridge. */
public enum TakuFailureReason {
    NONE,
    NO_FILL,
    SDK_FAILURE;

    public static TakuFailureReason fromSdkCode(String code) {
        return "4001".equals(code) ? NO_FILL : SDK_FAILURE;
    }
}
