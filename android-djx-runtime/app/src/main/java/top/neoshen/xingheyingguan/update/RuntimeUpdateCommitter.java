package top.neoshen.xingheyingguan.update;

import java.io.IOException;

/** Coordinates a recoverable runtime directory transaction with anti-rollback persistence. */
public final class RuntimeUpdateCommitter {

    private RuntimeUpdateCommitter() {
    }

    public static void commit(long releaseNo, Transaction transaction,
                              ReleaseState releaseState) throws Exception {
        if (releaseNo <= 0L || transaction == null || releaseState == null) {
            throw new IllegalArgumentException("Runtime update commit input is invalid");
        }
        try {
            transaction.activate();
        } catch (Exception activationFailure) {
            rollback(transaction, activationFailure);
            throw activationFailure;
        }

        try {
            if (!releaseState.persist(releaseNo)) {
                throw new IOException("Could not persist anti-rollback state");
            }
        } catch (Exception persistenceFailure) {
            rollback(transaction, persistenceFailure);
            throw persistenceFailure;
        }

        // Persistence is already durable. A completion failure must leave the journal and backup
        // available for startup recovery; rolling back here would mismatch the persisted floor.
        transaction.complete();
    }

    private static void rollback(Transaction transaction, Exception cause) {
        try {
            transaction.rollback();
        } catch (Exception rollbackFailure) {
            cause.addSuppressed(rollbackFailure);
        }
    }

    public interface Transaction {
        void activate() throws Exception;

        void rollback() throws Exception;

        void complete() throws Exception;
    }

    public interface ReleaseState {
        boolean persist(long releaseNo);
    }
}
