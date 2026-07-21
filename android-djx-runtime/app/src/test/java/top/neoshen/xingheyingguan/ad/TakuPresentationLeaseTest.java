package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TakuPresentationLeaseTest {

    @Test
    public void cancellationBeforeShowPermanentlyWinsTheLease() {
        TakuPresentationLease lease = new TakuPresentationLease();

        assertTrue(lease.cancelBeforeShow());
        assertFalse(lease.cancelBeforeShow());
        assertFalse(lease.requestShow());
    }

    @Test
    public void aRequestedPresentationCannotBeCancelledByTheHostHideItCauses() {
        TakuPresentationLease lease = new TakuPresentationLease();

        assertTrue(lease.requestShow());
        assertFalse(lease.requestShow());
        assertFalse(lease.cancelBeforeShow());
    }
}
