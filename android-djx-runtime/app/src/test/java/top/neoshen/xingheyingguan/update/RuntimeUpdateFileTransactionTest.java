package top.neoshen.xingheyingguan.update;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RuntimeUpdateFileTransactionTest {

    private static final String DIRECTORY = "skit-web-update";

    @Rule
    public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void keepsThePreviousRuntimeUntilTheNewReleaseIsDurablyCommitted()
            throws Exception {
        File root = temporaryFolder.newFolder("keep-backup");
        File active = runtime(root, DIRECTORY, 41L);
        File staging = runtime(root, DIRECTORY + "-staging-42", 42L);

        RuntimeUpdateFileTransaction transaction = new RuntimeUpdateFileTransaction(
                root, DIRECTORY, 42L, staging);
        transaction.activate();

        assertEquals(42L, marker(active));
        assertEquals(41L, marker(new File(root, DIRECTORY + "-backup")));
        assertTrue(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));

        transaction.complete();

        assertFalse(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));
        assertEquals(41L, marker(new File(root, DIRECTORY + "-backup")));
    }

    @Test
    public void startupCompletesTheDurableFloorFromTheVerifiedActiveMarker()
            throws Exception {
        File root = temporaryFolder.newFolder("recover-active");
        runtime(root, DIRECTORY, 41L);
        File staging = runtime(root, DIRECTORY + "-staging-42", 42L);
        new RuntimeUpdateFileTransaction(root, DIRECTORY, 42L, staging).activate();
        AtomicLong persisted = new AtomicLong(41L);

        long floor = RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, persisted.get(), this::marker,
                releaseNo -> {
                    persisted.set(releaseNo);
                    return true;
                });

        assertEquals(42L, floor);
        assertEquals(42L, persisted.get());
        assertEquals(42L, marker(new File(root, DIRECTORY)));
        assertEquals(41L, marker(new File(root, DIRECTORY + "-backup")));
        assertFalse(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));
    }

    @Test
    public void startupRestoresTheBackupWhenTheDurableFloorCannotBeAdvanced()
            throws Exception {
        File root = temporaryFolder.newFolder("rollback-active");
        runtime(root, DIRECTORY, 41L);
        File staging = runtime(root, DIRECTORY + "-staging-42", 42L);
        new RuntimeUpdateFileTransaction(root, DIRECTORY, 42L, staging).activate();

        long floor = RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 41L, this::marker, releaseNo -> false);

        assertEquals(41L, floor);
        assertEquals(41L, marker(new File(root, DIRECTORY)));
        assertFalse(new File(root, DIRECTORY + "-backup").exists());
        assertFalse(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));
    }

    @Test
    public void startupRestoresBackupWhenThePendingActiveMarkerCannotBeVerified()
            throws Exception {
        File root = temporaryFolder.newFolder("rollback-invalid-active");
        runtime(root, DIRECTORY, 41L);
        File staging = runtime(root, DIRECTORY + "-staging-42", 42L);
        new RuntimeUpdateFileTransaction(root, DIRECTORY, 42L, staging).activate();
        write(new File(root, DIRECTORY + "/release.marker"), "invalid");

        long floor = RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 41L, this::marker, releaseNo -> true);

        assertEquals(41L, floor);
        assertEquals(41L, marker(new File(root, DIRECTORY)));
        assertFalse(new File(root, DIRECTORY + "-backup").exists());
        assertFalse(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));
    }

    @Test
    public void startupRestoresBackupIfTheProcessDiedBetweenTheTwoDirectoryRenames()
            throws Exception {
        File root = temporaryFolder.newFolder("recover-between-renames");
        File active = runtime(root, DIRECTORY, 41L);
        runtime(root, DIRECTORY + "-staging-42", 42L);
        RuntimeUpdateFileTransaction.writePreparedJournal(root, DIRECTORY, 42L);
        assertTrue(active.renameTo(new File(root, DIRECTORY + "-backup")));

        long floor = RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 41L, this::marker, releaseNo -> true);

        assertEquals(41L, floor);
        assertEquals(41L, marker(new File(root, DIRECTORY)));
        assertFalse(new File(root, DIRECTORY + "-staging-42").exists());
        assertFalse(RuntimeUpdateFileTransaction.hasPendingTransaction(root, DIRECTORY));
    }

    @Test
    public void startupRemovesAnIncompleteJournalWriteBeforeTheNextTransaction()
            throws Exception {
        File root = temporaryFolder.newFolder("recover-journal-temp");
        runtime(root, DIRECTORY, 41L);
        write(new File(root, DIRECTORY + "-transaction-prepared.tmp"), "partial");

        assertEquals(41L, RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 41L, this::marker, releaseNo -> true));

        File staging = runtime(root, DIRECTORY + "-staging-42", 42L);
        RuntimeUpdateFileTransaction transaction = new RuntimeUpdateFileTransaction(
                root, DIRECTORY, 42L, staging);
        transaction.activate();
        assertEquals(42L, marker(new File(root, DIRECTORY)));
    }

    @Test
    public void versionFloorIsTheMaximumOfApkPersistedAndVerifiedActiveReleases()
            throws Exception {
        File root = temporaryFolder.newFolder("max-floor");
        runtime(root, DIRECTORY, 42L);

        assertEquals(43L, RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 43L, 41L, this::marker, releaseNo -> false));
        assertEquals(44L, RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 44L, this::marker, releaseNo -> false));
        assertEquals(42L, RuntimeUpdateFileTransaction.recover(
                root, DIRECTORY, 40L, 41L, this::marker, releaseNo -> false));
    }

    @Test
    public void obsoleteBackupCanOnlyBeRemovedAfterActiveReleaseIsDurable()
            throws Exception {
        File root = temporaryFolder.newFolder("safe-cleanup");
        runtime(root, DIRECTORY, 42L);
        runtime(root, DIRECTORY + "-backup", 41L);

        assertFalse(RuntimeUpdateFileTransaction.deleteBackupIfDurable(
                root, DIRECTORY, 41L, this::marker));
        assertTrue(new File(root, DIRECTORY + "-backup").exists());

        assertTrue(RuntimeUpdateFileTransaction.deleteBackupIfDurable(
                root, DIRECTORY, 42L, this::marker));
        assertFalse(new File(root, DIRECTORY + "-backup").exists());
    }

    private File runtime(File root, String name, long releaseNo) throws Exception {
        File directory = new File(root, name);
        assertTrue(directory.mkdirs());
        write(new File(directory, "release.marker"), Long.toString(releaseNo));
        write(new File(directory, "index.html"), "release " + releaseNo);
        return directory;
    }

    private long marker(File directory) throws Exception {
        if (directory == null || !directory.isDirectory()) {
            return 0L;
        }
        File marker = new File(directory, "release.marker");
        if (!marker.isFile()) {
            return 0L;
        }
        byte[] bytes = new byte[(int) marker.length()];
        try (java.io.FileInputStream input = new java.io.FileInputStream(marker)) {
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) {
                    break;
                }
                offset += count;
            }
            if (offset != bytes.length) {
                return 0L;
            }
        }
        try {
            return Long.parseLong(new String(bytes, StandardCharsets.UTF_8));
        } catch (NumberFormatException invalidMarker) {
            return 0L;
        }
    }

    private void write(File file, String value) throws Exception {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }
}
