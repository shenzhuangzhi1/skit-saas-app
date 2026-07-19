package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public class VerifiedRewardEvidenceTest {

    @Test
    public void acceptsOnlyRawProviderIdentifiersAndCorrelatesBothValues() {
        VerifiedRewardEvidence evidence = new VerifiedRewardEvidence(
                "abcdefghijklmnopqrstuv", "taku-show-20260719");

        assertTrue(evidence.matches("abcdefghijklmnopqrstuv", "taku-show-20260719"));
        assertFalse(evidence.matches("abcdefghijklmnopqrstuv", "different-show"));
        assertFalse(evidence.toString().contains("taku-show-20260719"));
    }

    @Test
    public void rejectsHashesAndMalformedProviderIdentifiers() {
        assertThrows(IllegalArgumentException.class,
                () -> new VerifiedRewardEvidence("f69f9b70d1c9", "taku-show-20260719"));
        assertThrows(IllegalArgumentException.class,
                () -> new VerifiedRewardEvidence("abcdefghijklmnopqrstuv", "not a show id"));
    }
}
