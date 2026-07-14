package top.neoshen.xingheyingguan.update;

import java.io.IOException;

/**
 * Orders runtime activation ahead of anti-rollback persistence.
 *
 * <p>If the process dies after the directory swap, the previously persisted release remains
 * eligible, so the exact same signed release can be retried and committed after restart.</p>
 */
public final class RuntimeUpdateCommitter {

    private RuntimeUpdateCommitter() {
    }

    public static void activateThenPersist(long releaseNo, Activation activation,
                                           ReleaseState releaseState) throws Exception {
        if (releaseNo <= 0L || activation == null || releaseState == null) {
            throw new IllegalArgumentException("Runtime update commit input is invalid");
        }
        activation.activate();
        if (!releaseState.persist(releaseNo)) {
            throw new IOException("Could not persist anti-rollback state");
        }
    }

    public interface Activation {
        void activate() throws Exception;
    }

    public interface ReleaseState {
        boolean persist(long releaseNo);
    }
}
