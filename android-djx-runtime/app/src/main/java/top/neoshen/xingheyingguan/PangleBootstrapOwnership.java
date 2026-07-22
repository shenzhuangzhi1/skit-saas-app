package top.neoshen.xingheyingguan;

import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Process-scoped ownership state for the global TTAdSdk singleton.
 *
 * <p>A ready singleton is trusted only after this app completed its own accepted init/start
 * attempt. This prevents another SDK path from winning the singleton identity race.</p>
 */
final class PangleBootstrapOwnership {
    enum Decision {
        START_OWNED,
        JOIN_OWNED_START,
        REUSE_OWNED,
        REJECT_UNOWNED_READY,
        REJECT_OWNED_STATE_LOST
    }

    static final class Request {
        private final Decision decision;
        private final long attempt;

        private Request(Decision decision, long attempt) {
            this.decision = decision;
            this.attempt = attempt;
        }

        Decision getDecision() {
            return decision;
        }

        long getAttempt() {
            return attempt;
        }
    }

    private enum State {
        IDLE,
        STARTING
    }

    private static final int MAX_RECOVERABLE_TIMEOUTS = 16;

    private State state = State.IDLE;
    private long currentAttempt;
    private boolean ownedReady;
    private final Set<Long> timedOutOwnedAttempts = new LinkedHashSet<>();

    synchronized Request request(boolean globalReady) {
        if (state == State.STARTING) {
            return new Request(Decision.JOIN_OWNED_START, currentAttempt);
        }
        if (ownedReady) {
            return new Request(
                    globalReady ? Decision.REUSE_OWNED : Decision.REJECT_OWNED_STATE_LOST,
                    currentAttempt);
        }
        if (globalReady) {
            return new Request(Decision.REJECT_UNOWNED_READY, currentAttempt);
        }
        state = State.STARTING;
        currentAttempt += 1;
        return new Request(Decision.START_OWNED, currentAttempt);
    }

    synchronized boolean completeSuccess(long attempt) {
        if (state != State.STARTING || currentAttempt != attempt) {
            return false;
        }
        state = State.IDLE;
        ownedReady = true;
        timedOutOwnedAttempts.clear();
        return true;
    }

    synchronized boolean completeFailure(long attempt) {
        if (state != State.STARTING || currentAttempt != attempt) {
            return false;
        }
        state = State.IDLE;
        return true;
    }

    synchronized boolean completeTimeout(long attempt) {
        if (state != State.STARTING || currentAttempt != attempt) {
            return false;
        }
        state = State.IDLE;
        timedOutOwnedAttempts.add(attempt);
        while (timedOutOwnedAttempts.size() > MAX_RECOVERABLE_TIMEOUTS) {
            Iterator<Long> iterator = timedOutOwnedAttempts.iterator();
            iterator.next();
            iterator.remove();
        }
        return true;
    }

    synchronized boolean reconcileTimedOutSuccess(long attempt) {
        if (!timedOutOwnedAttempts.remove(attempt)) {
            return false;
        }
        ownedReady = true;
        timedOutOwnedAttempts.clear();
        return true;
    }

    synchronized boolean reconcileTimedOutFailure(long attempt) {
        return timedOutOwnedAttempts.remove(attempt);
    }
}
