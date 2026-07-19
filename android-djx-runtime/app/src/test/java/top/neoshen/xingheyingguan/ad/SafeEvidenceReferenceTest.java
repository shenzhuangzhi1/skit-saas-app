package top.neoshen.xingheyingguan.ad;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

public class SafeEvidenceReferenceTest {

    @Test
    public void hashesIdentifiersToTheSameTwelveHexCharactersUsedByTheVerifier() {
        assertEquals("<none>", SafeEvidenceReference.of(null));
        assertEquals("f69f9b70d1c9", SafeEvidenceReference.of("abcdefghijklmnopqrstuv"));
        assertEquals("f5a47f4a915c", SafeEvidenceReference.of("taku-show-20260719"));
        assertNotEquals("taku-show-20260719",
                SafeEvidenceReference.of("taku-show-20260719"));
    }
}
