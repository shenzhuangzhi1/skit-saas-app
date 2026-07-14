package top.neoshen.xingheyingguan.update;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Two-phase filesystem transaction for a runtime bundle directory.
 *
 * <p>The prepared journal is durable before the old active directory is moved. The activated
 * journal is durable after the new directory is active. Both journals remain until the caller has
 * durably advanced its anti-rollback floor. The previous active directory is deliberately kept as
 * a backup until that point can be proven.</p>
 */
public final class RuntimeUpdateFileTransaction implements RuntimeUpdateCommitter.Transaction {
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    private static final String JOURNAL_MAGIC = "SKIT_RUNTIME_TRANSACTION_V1\n";
    private static final String PREPARED_SUFFIX = "-transaction-prepared";
    private static final String ACTIVATED_SUFFIX = "-transaction-activated";
    private static final int MAX_JOURNAL_BYTES = 128;

    private final File root;
    private final String directoryName;
    private final long releaseNo;
    private final File staging;
    private final File active;
    private final File backup;
    private boolean activeInstalled;

    public RuntimeUpdateFileTransaction(File root, String directoryName, long releaseNo,
                                        File staging) throws IOException {
        validateRootAndName(root, directoryName);
        if (releaseNo <= 0L || staging == null) {
            throw new IllegalArgumentException("Runtime update transaction input is invalid");
        }
        File expectedStaging = new File(root, stagingName(directoryName, releaseNo));
        if (!expectedStaging.getCanonicalFile().equals(staging.getCanonicalFile())) {
            throw new IllegalArgumentException("Runtime update staging directory is invalid");
        }
        this.root = root;
        this.directoryName = directoryName;
        this.releaseNo = releaseNo;
        this.staging = staging;
        this.active = new File(root, directoryName);
        this.backup = new File(root, directoryName + "-backup");
    }

    @Override
    public void activate() throws IOException {
        if (!staging.isDirectory()) {
            throw new IOException("Runtime update staging directory is missing");
        }
        if (hasPendingTransaction(root, directoryName)) {
            throw new IOException("A runtime update recovery is still pending");
        }
        if (backup.exists()) {
            throw new IOException("Previous runtime backup has not been safely retired");
        }

        writePreparedJournal(root, directoryName, releaseNo);
        if (active.exists() && !active.renameTo(backup)) {
            throw new IOException("Could not preserve the active runtime update");
        }
        if (!staging.renameTo(active)) {
            throw new IOException("Could not activate the prepared runtime update");
        }
        activeInstalled = true;
        writeActivatedJournal(root, directoryName, releaseNo);
    }

    @Override
    public void rollback() throws IOException {
        rollbackPending(root, directoryName, releaseNo, activeInstalled);
        activeInstalled = false;
    }

    @Override
    public void complete() throws IOException {
        clearJournals(root, directoryName);
    }

    public static boolean hasPendingTransaction(File root, String directoryName) {
        validateRootAndNameUnchecked(root, directoryName);
        return preparedJournal(root, directoryName).exists()
                || activatedJournal(root, directoryName).exists();
    }

    /**
     * Recovers an interrupted transaction and returns the effective anti-rollback floor.
     */
    public static long recover(File root, String directoryName, long baseRelease,
                               long persistedRelease, MarkerVerifier markerVerifier,
                               RuntimeUpdateCommitter.ReleaseState releaseState) throws Exception {
        validateRootAndName(root, directoryName);
        if (baseRelease < 0L || persistedRelease < 0L || markerVerifier == null
                || releaseState == null) {
            throw new IllegalArgumentException("Runtime update recovery input is invalid");
        }
        deleteRecursively(journalTemporary(preparedJournal(root, directoryName)));
        deleteRecursively(journalTemporary(activatedJournal(root, directoryName)));
        File active = new File(root, directoryName);
        File backup = new File(root, directoryName + "-backup");
        long activeRelease = verifiedRelease(markerVerifier, active);
        Long pendingRelease = pendingRelease(root, directoryName);
        if (pendingRelease == null) {
            return max(baseRelease, persistedRelease, activeRelease);
        }

        File staging = new File(root, stagingName(directoryName, pendingRelease));
        if (activeRelease == pendingRelease) {
            if (persistedRelease < pendingRelease) {
                boolean persisted;
                try {
                    persisted = releaseState.persist(pendingRelease);
                } catch (Exception persistenceFailure) {
                    try {
                        rollbackPending(root, directoryName, pendingRelease, true);
                    } catch (IOException rollbackFailure) {
                        persistenceFailure.addSuppressed(rollbackFailure);
                    }
                    throw persistenceFailure;
                }
                if (!persisted) {
                    rollbackPending(root, directoryName, pendingRelease, true);
                    activeRelease = verifiedRelease(markerVerifier, active);
                    return max(baseRelease, persistedRelease, activeRelease);
                }
                persistedRelease = pendingRelease;
            }
            clearJournals(root, directoryName);
            return max(baseRelease, persistedRelease, activeRelease);
        }

        // The process stopped before the new runtime became a verified active directory. Restore
        // the preserved directory if the first rename already happened, then discard only staging.
        if (active.exists() && activeRelease == 0L && backup.exists()) {
            rollbackPending(root, directoryName, pendingRelease, true);
            activeRelease = verifiedRelease(markerVerifier, active);
            return max(baseRelease, persistedRelease, activeRelease);
        }
        if (!active.exists() && backup.exists() && !backup.renameTo(active)) {
            throw new IOException("Could not restore the preserved runtime update");
        }
        deleteRecursively(staging);
        clearJournals(root, directoryName);
        activeRelease = verifiedRelease(markerVerifier, active);
        return max(baseRelease, persistedRelease, activeRelease);
    }

    /**
     * Retires a prior backup only when the current active marker is verified and already durable.
     */
    public static boolean deleteBackupIfDurable(File root, String directoryName,
                                                long durableRelease,
                                                MarkerVerifier markerVerifier) throws Exception {
        validateRootAndName(root, directoryName);
        if (durableRelease < 0L || markerVerifier == null) {
            throw new IllegalArgumentException("Runtime backup cleanup input is invalid");
        }
        File backup = new File(root, directoryName + "-backup");
        if (!backup.exists() || hasPendingTransaction(root, directoryName)) {
            return false;
        }
        long activeRelease = verifiedRelease(
                markerVerifier, new File(root, directoryName));
        if (activeRelease <= 0L || activeRelease > durableRelease) {
            return false;
        }
        deleteRecursively(backup);
        return !backup.exists();
    }

    static void writePreparedJournal(File root, String directoryName, long releaseNo)
            throws IOException {
        validateRootAndName(root, directoryName);
        writeJournal(preparedJournal(root, directoryName), releaseNo);
    }

    private static void writeActivatedJournal(File root, String directoryName, long releaseNo)
            throws IOException {
        writeJournal(activatedJournal(root, directoryName), releaseNo);
    }

    private static void writeJournal(File journal, long releaseNo) throws IOException {
        if (releaseNo <= 0L || journal.exists()) {
            throw new IOException("Runtime update journal is invalid");
        }
        File temporary = journalTemporary(journal);
        if (temporary.exists()) {
            throw new IOException("Runtime update journal temporary file already exists");
        }
        byte[] contents = (JOURNAL_MAGIC + releaseNo + "\n")
                .getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(contents);
            output.getFD().sync();
        }
        if (!temporary.renameTo(journal)) {
            deleteRecursively(temporary);
            throw new IOException("Could not commit runtime update journal");
        }
    }

    private static Long pendingRelease(File root, String directoryName) throws IOException {
        File prepared = preparedJournal(root, directoryName);
        File activated = activatedJournal(root, directoryName);
        if (!prepared.exists() && !activated.exists()) {
            return null;
        }
        if (!prepared.isFile() || (activated.exists() && !activated.isFile())) {
            throw new IOException("Runtime update journal type is invalid");
        }
        long preparedRelease = readJournal(prepared);
        if (activated.exists() && readJournal(activated) != preparedRelease) {
            throw new IOException("Runtime update journal phases disagree");
        }
        return preparedRelease;
    }

    private static long readJournal(File journal) throws IOException {
        if (journal.length() <= 0L || journal.length() > MAX_JOURNAL_BYTES) {
            throw new IOException("Runtime update journal size is invalid");
        }
        byte[] bytes;
        try (FileInputStream input = new FileInputStream(journal);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[128];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
                if (output.size() > MAX_JOURNAL_BYTES) {
                    throw new IOException("Runtime update journal is too large");
                }
            }
            bytes = output.toByteArray();
        }
        String contents = new String(bytes, StandardCharsets.UTF_8);
        if (!contents.startsWith(JOURNAL_MAGIC) || !contents.endsWith("\n")) {
            throw new IOException("Runtime update journal format is invalid");
        }
        String release = contents.substring(JOURNAL_MAGIC.length(), contents.length() - 1);
        if (!release.matches("[1-9][0-9]{0,18}")) {
            throw new IOException("Runtime update journal release is invalid");
        }
        try {
            return Long.parseLong(release);
        } catch (NumberFormatException invalidRelease) {
            throw new IOException("Runtime update journal release is invalid", invalidRelease);
        }
    }

    private static void rollbackPending(File root, String directoryName, long releaseNo,
                                        boolean activeMayBeNew) throws IOException {
        File active = new File(root, directoryName);
        File backup = new File(root, directoryName + "-backup");
        File staging = new File(root, stagingName(directoryName, releaseNo));

        if (activeMayBeNew && active.exists()) {
            if (staging.exists()) {
                throw new IOException("Could not quarantine the uncommitted runtime update");
            }
            if (!active.renameTo(staging)) {
                throw new IOException("Could not quarantine the uncommitted runtime update");
            }
        }
        if (!active.exists() && backup.exists() && !backup.renameTo(active)) {
            if (staging.exists() && !staging.renameTo(active)) {
                throw new IOException("Could not restore either runtime update directory");
            }
            throw new IOException("Could not restore the preserved runtime update");
        }
        deleteRecursively(staging);
        clearJournals(root, directoryName);
    }

    private static void clearJournals(File root, String directoryName) throws IOException {
        deleteRecursively(activatedJournal(root, directoryName));
        deleteRecursively(preparedJournal(root, directoryName));
        deleteRecursively(journalTemporary(activatedJournal(root, directoryName)));
        deleteRecursively(journalTemporary(preparedJournal(root, directoryName)));
    }

    private static File preparedJournal(File root, String directoryName) {
        return new File(root, directoryName + PREPARED_SUFFIX);
    }

    private static File activatedJournal(File root, String directoryName) {
        return new File(root, directoryName + ACTIVATED_SUFFIX);
    }

    private static File journalTemporary(File journal) {
        return new File(journal.getParentFile(), journal.getName() + ".tmp");
    }

    private static String stagingName(String directoryName, long releaseNo) {
        return directoryName + "-staging-" + releaseNo;
    }

    private static long verifiedRelease(MarkerVerifier verifier, File directory)
            throws Exception {
        long release = verifier.verifiedRelease(directory);
        if (release < 0L) {
            throw new SecurityException("Verified runtime release cannot be negative");
        }
        return release;
    }

    private static long max(long first, long second, long third) {
        return Math.max(first, Math.max(second, third));
    }

    private static void validateRootAndName(File root, String directoryName) throws IOException {
        validateRootAndNameUnchecked(root, directoryName);
        if (!root.isDirectory()) {
            throw new IOException("Runtime update root is missing");
        }
    }

    private static void validateRootAndNameUnchecked(File root, String directoryName) {
        if (root == null || directoryName == null || !SAFE_NAME.matcher(directoryName).matches()) {
            throw new IllegalArgumentException("Runtime update directory is invalid");
        }
    }

    private static void deleteRecursively(File file) throws IOException {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) {
                throw new IOException("Could not inspect runtime update directory");
            }
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        if (!file.delete() && file.exists()) {
            throw new IOException("Could not remove runtime update transaction file");
        }
    }

    public interface MarkerVerifier {
        long verifiedRelease(File runtimeDirectory) throws Exception;
    }
}
