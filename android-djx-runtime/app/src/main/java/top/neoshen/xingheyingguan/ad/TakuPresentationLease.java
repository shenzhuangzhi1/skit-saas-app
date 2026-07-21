package top.neoshen.xingheyingguan.ad;

/** Serializes cancellation before show against the SDK's loaded callback. */
public final class TakuPresentationLease {
    private enum State {
        PENDING,
        SHOW_REQUESTED,
        TERMINAL
    }

    private State state = State.PENDING;

    public synchronized boolean requestShow() {
        if (state != State.PENDING) {
            return false;
        }
        state = State.SHOW_REQUESTED;
        return true;
    }

    public synchronized boolean cancelBeforeShow() {
        if (state != State.PENDING) {
            return false;
        }
        state = State.TERMINAL;
        return true;
    }

    public synchronized void terminate() {
        state = State.TERMINAL;
    }
}
