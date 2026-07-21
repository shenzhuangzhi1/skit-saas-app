package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TakuFailureReasonTest {

    @Test
    public void exposesOnlyTheExactNoFillCode() {
        assertEquals(TakuFailureReason.NO_FILL, TakuFailureReason.fromSdkCode("4001"));
        assertEquals(TakuFailureReason.SDK_FAILURE, TakuFailureReason.fromSdkCode(null));
        assertEquals(TakuFailureReason.SDK_FAILURE, TakuFailureReason.fromSdkCode(""));
        assertEquals(TakuFailureReason.SDK_FAILURE, TakuFailureReason.fromSdkCode("4009"));
        assertEquals(TakuFailureReason.SDK_FAILURE,
                TakuFailureReason.fromSdkCode("4001 Return Ad is empty"));
    }
}
