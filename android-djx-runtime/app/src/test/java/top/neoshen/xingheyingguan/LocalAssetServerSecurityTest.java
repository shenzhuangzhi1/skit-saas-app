package top.neoshen.xingheyingguan;

import android.content.res.AssetManager;

import org.junit.After;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class LocalAssetServerSecurityTest {

    private static final int MAX_REQUEST_LINE_BYTES = 8 * 1024;
    private static final int MAX_REQUEST_HEADER_BYTES = 16 * 1024;
    private static final int MAX_REQUEST_WORKERS = 4;
    private static final int MAX_QUEUED_CONNECTIONS = 8;
    private static final int LARGE_ASSET_BYTES = 8 * 1024 * 1024;

    private final TemporaryFolder temporaryFolder = new TemporaryFolder();
    private final List<Socket> clients = new ArrayList<>();
    private Closeable server;

    @After
    public void tearDown() throws Exception {
        for (Socket client : clients) {
            try {
                client.close();
            } catch (Exception ignored) {
            }
        }
        if (server != null) {
            server.close();
        }
        temporaryFolder.delete();
    }

    @Test
    public void slowHeadersAreDisconnectedWithinTheSocketReadDeadline() throws Exception {
        URI baseUrl = startServer();
        Socket client = connect(baseUrl);
        client.setSoTimeout(3_000);
        write(client, "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Slow: ");

        long startedAt = System.nanoTime();
        try {
            assertEquals(-1, client.getInputStream().read());
        } catch (SocketTimeoutException noServerDeadline) {
            fail("the asset server left a slow header connection open");
        }
        long elapsedMillis = (System.nanoTime() - startedAt) / 1_000_000L;

        assertTrue("the server read deadline must be shorter than the client guard",
                elapsedMillis < 2_900L);
    }

    @Test
    public void occupiedPreferredPortFallsBackToAnEphemeralLoopbackPort() throws Exception {
        try (ServerSocket occupied = new ServerSocket(
                0, 1, InetAddress.getByName("127.0.0.1"))) {
            URI baseUrl = startServer(0, occupied.getLocalPort());

            assertEquals("127.0.0.1", baseUrl.getHost());
            assertTrue(baseUrl.getPort() > 0);
            assertTrue(baseUrl.getPort() != occupied.getLocalPort());
            String responseHead = exchange(
                    baseUrl,
                    "GET /index.html HTTP/1.1\r\nHost: localhost\r\n\r\n");
            assertTrue(responseHead, responseHead.startsWith("HTTP/1.1 200 "));
        }
    }

    @Test
    public void trickleBytesCannotRefreshTheWholeHeaderDeadline() throws Exception {
        URI baseUrl = startServer();
        Socket client = connect(baseUrl);
        write(client, "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Slow: ");

        boolean disconnected = false;
        for (int index = 0; index < 4; index++) {
            Thread.sleep(600L);
            try {
                write(client, "A");
            } catch (SocketException closedByDeadline) {
                disconnected = true;
                break;
            }
        }

        if (!disconnected) {
            client.setSoTimeout(500);
            try {
                assertEquals(-1, client.getInputStream().read());
            } catch (SocketTimeoutException trickleKeptConnectionAlive) {
                fail("trickle bytes refreshed the whole request header deadline");
            } catch (SocketException resetByServer) {
                // A reset also proves the absolute header deadline closed the connection.
            }
        }
    }

    @Test
    public void requestLineHasAHardEightKiBLimit() throws Exception {
        URI baseUrl = startServer();
        String prefix = "GET /index.html HTTP/1.1";
        String requestLine = prefix + repeat('A', MAX_REQUEST_LINE_BYTES + 1 - prefix.length());

        String responseHead = exchange(baseUrl,
                requestLine + "\r\nHost: localhost\r\n\r\n");

        assertTrue(responseHead, responseHead.startsWith("HTTP/1.1 414 "));
    }

    @Test
    public void requestHeadersHaveAHardSixteenKiBLimit() throws Exception {
        URI baseUrl = startServer();
        String prefix = "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Fill: ";
        String suffix = "\r\n\r\n";
        String request = prefix
                + repeat('A', MAX_REQUEST_HEADER_BYTES + 1 - prefix.length() - suffix.length())
                + suffix;

        String responseHead = exchange(baseUrl, request);

        assertTrue(responseHead, responseHead.startsWith("HTTP/1.1 431 "));
    }

    @Test
    public void requestWorkerThreadsRemainBoundedUnderSlowConnections() throws Exception {
        URI baseUrl = startServer();
        openSlowConnections(baseUrl, 20);

        waitFor(() -> requestWorkerCount() >= MAX_REQUEST_WORKERS, 1_000L);

        assertTrue("slow clients created more than four request workers",
                requestWorkerCount() <= MAX_REQUEST_WORKERS);
    }

    @Test
    public void connectionsBeyondTheWorkerAndQueueCapacityAreRejected() throws Exception {
        URI baseUrl = startServer();
        openSlowConnections(baseUrl, MAX_REQUEST_WORKERS + MAX_QUEUED_CONNECTIONS);
        waitFor(() -> requestWorkerCount() >= MAX_REQUEST_WORKERS, 1_000L);

        Socket excess = connect(baseUrl);
        excess.setSoTimeout(1_000);
        write(excess, "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Hold: ");

        try {
            assertEquals(-1, excess.getInputStream().read());
        } catch (SocketTimeoutException notRejected) {
            fail("the asset server accepted a connection beyond its worker and queue capacity");
        } catch (SocketException resetByServer) {
            // A TCP reset is also an immediate rejection when unread request bytes remain.
        }
    }

    @Test
    public void slowResponseReadersCannotExhaustAllRequestWorkers() throws Exception {
        URI baseUrl = startServer(LARGE_ASSET_BYTES);
        for (int index = 0; index < MAX_REQUEST_WORKERS; index++) {
            Socket slowReader = connectWithReceiveBuffer(baseUrl, 1_024);
            write(slowReader, "GET /large.bin HTTP/1.1\r\nHost: localhost\r\n\r\n");
        }
        waitFor(() -> requestWorkerCount() >= MAX_REQUEST_WORKERS, 1_000L);
        Thread.sleep(250L);

        String responseHead = exchange(
                baseUrl,
                "GET /index.html HTTP/1.1\r\nHost: localhost\r\n\r\n",
                6_000);

        assertTrue(responseHead, responseHead.startsWith("HTTP/1.1 200 "));
    }

    private URI startServer() throws Exception {
        return startServer(0);
    }

    private URI startServer(int largeAssetBytes) throws Exception {
        return startServer(largeAssetBytes, null);
    }

    private URI startServer(int largeAssetBytes, Integer preferredPort) throws Exception {
        temporaryFolder.create();
        File updateRoot = temporaryFolder.newFolder("www-update");
        try (FileOutputStream output = new FileOutputStream(new File(updateRoot, "index.html"))) {
            output.write("ok".getBytes(StandardCharsets.UTF_8));
        }
        if (largeAssetBytes > 0) {
            try (FileOutputStream output = new FileOutputStream(new File(updateRoot, "large.bin"))) {
                byte[] chunk = new byte[8 * 1024];
                int remaining = largeAssetBytes;
                while (remaining > 0) {
                    int writeBytes = Math.min(chunk.length, remaining);
                    output.write(chunk, 0, writeBytes);
                    remaining -= writeBytes;
                }
            }
        }

        Class<?> serverType = Class.forName(
                "top.neoshen.xingheyingguan.MainActivity$LocalAssetServer");
        Constructor<?> constructor;
        Object instance;
        if (preferredPort == null) {
            constructor = serverType.getDeclaredConstructor(
                    AssetManager.class, String.class, File.class);
            constructor.setAccessible(true);
            instance = constructor.newInstance(null, "www", updateRoot);
        } else {
            constructor = serverType.getDeclaredConstructor(
                    AssetManager.class, String.class, File.class, int.class);
            constructor.setAccessible(true);
            instance = constructor.newInstance(null, "www", updateRoot, preferredPort);
        }
        Method start = serverType.getDeclaredMethod("start");
        Method getBaseUrl = serverType.getDeclaredMethod("getBaseUrl");
        start.setAccessible(true);
        getBaseUrl.setAccessible(true);
        start.invoke(instance);
        server = (Closeable) instance;
        return URI.create((String) getBaseUrl.invoke(instance));
    }

    private Socket connect(URI baseUrl) throws Exception {
        Socket socket = new Socket(baseUrl.getHost(), baseUrl.getPort());
        clients.add(socket);
        return socket;
    }

    private Socket connectWithReceiveBuffer(URI baseUrl, int receiveBufferBytes) throws Exception {
        Socket socket = new Socket();
        socket.setReceiveBufferSize(receiveBufferBytes);
        socket.connect(new InetSocketAddress(baseUrl.getHost(), baseUrl.getPort()));
        clients.add(socket);
        return socket;
    }

    private String exchange(URI baseUrl, String request) throws Exception {
        return exchange(baseUrl, request, 2_000);
    }

    private String exchange(URI baseUrl, String request, int timeoutMillis) throws Exception {
        Socket client = connect(baseUrl);
        client.setSoTimeout(timeoutMillis);
        write(client, request);
        client.shutdownOutput();
        InputStream input = client.getInputStream();
        ByteArrayOutputStream response = new ByteArrayOutputStream();
        int previous = -1;
        int current;
        while ((current = input.read()) != -1) {
            response.write(current);
            if (previous == '\r' && current == '\n') {
                break;
            }
            previous = current;
        }
        return response.toString("UTF-8");
    }

    private void openSlowConnections(URI baseUrl, int count) throws Exception {
        for (int index = 0; index < count; index++) {
            Socket client = connect(baseUrl);
            write(client, "GET /index.html HTTP/1.1\r\nHost: localhost\r\nX-Hold: ");
        }
    }

    private void write(Socket socket, String value) throws Exception {
        OutputStream output = socket.getOutputStream();
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.flush();
    }

    private int requestWorkerCount() {
        int count = 0;
        for (Thread thread : Thread.getAllStackTraces().keySet()) {
            if (thread.isAlive() && thread.getName().startsWith("skit-djx-request")) {
                count++;
            }
        }
        return count;
    }

    private void waitFor(Condition condition, long timeoutMillis) throws Exception {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (!condition.evaluate() && System.nanoTime() < deadline) {
            Thread.sleep(10L);
        }
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index++) {
            result.append(value);
        }
        return result.toString();
    }

    private interface Condition {
        boolean evaluate();
    }
}
