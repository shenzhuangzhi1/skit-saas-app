package top.neoshen.xingheyingguan.ad;

/** Safe, UI-only failure categories. Raw provider messages never cross the native bridge. */
public enum TakuFailureReason {
    NONE,
    NO_FILL,
    PRIVACY_CONSENT_REQUIRED,
    PANGLE_INIT_FAILED,
    TAKU_INIT_FAILED,
    SDK_FAILURE;

    public static TakuFailureReason fromSdkCode(String code) {
        return "4001".equals(code) ? NO_FILL : SDK_FAILURE;
    }
}
