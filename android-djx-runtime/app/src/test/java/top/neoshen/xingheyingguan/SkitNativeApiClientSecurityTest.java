package top.neoshen.xingheyingguan;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

public class SkitNativeApiClientSecurityTest {

    private static final String PLAYER_GRANT_HEADER = "X-Skit-Player-Grant";
    private static final String PLAYER_GRANT =
            "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

    private final List<MockWebServer> servers = new ArrayList<>();

    @After
    public void tearDown() throws Exception {
        for (MockWebServer server : servers) {
            server.shutdown();
        }
    }

    @Test
    public void sameOriginRedirectIsNotFollowedAndGrantNeverReachesSecondRequest() throws Exception {
        MockWebServer server = server();
        server.enqueue(redirect(server.url("/capture")));
        server.enqueue(new MockResponse().setResponseCode(200).setBody("ok"));

        assertRedirectRejected(SkitNativeApiClient.newHttpClient(), server.url("/start"),
                server, server);
    }

    @Test
    public void crossHostRedirectIsNotFollowedAndGrantNeverReachesSecondHost() throws Exception {
        MockWebServer source = server();
        MockWebServer target = server();
        HttpUrl crossHostTarget = target.url("/capture").newBuilder()
                .host("127.0.0.1")
                .build();
        source.enqueue(redirect(crossHostTarget));
        target.enqueue(new MockResponse().setResponseCode(200).setBody("ok"));

        assertRedirectRejected(SkitNativeApiClient.newHttpClient(), source.url("/start"),
                source, target);
    }

    @Test
    public void httpToHttpsRedirectIsNotFollowedAndGrantNeverReachesTlsTarget() throws Exception {
        HeldCertificate certificate = new HeldCertificate.Builder()
                .commonName("localhost")
                .addSubjectAlternativeName("localhost")
                .build();
        HandshakeCertificates serverCertificates = new HandshakeCertificates.Builder()
                .heldCertificate(certificate)
                .build();
        HandshakeCertificates clientCertificates = new HandshakeCertificates.Builder()
                .addTrustedCertificate(certificate.certificate())
                .build();

        MockWebServer source = server();
        MockWebServer target = new MockWebServer();
        target.useHttps(serverCertificates.sslSocketFactory(), false);
        target.start();
        servers.add(target);
        source.enqueue(redirect(target.url("/capture")));
        target.enqueue(new MockResponse().setResponseCode(200).setBody("ok"));
        OkHttpClient client = SkitNativeApiClient.newHttpClient().newBuilder()
                .sslSocketFactory(clientCertificates.sslSocketFactory(),
                        clientCertificates.trustManager())
                .build();

        assertRedirectRejected(client, source.url("/start"), source, target);
    }

    @Test
    public void normalSuccessfulResponseStillCompletesWithoutDroppingGrant() throws Exception {
        MockWebServer server = server();
        server.enqueue(new MockResponse().setResponseCode(200).setBody("ok"));
        OkHttpClient client = SkitNativeApiClient.newHttpClient();

        try (Response response = client.newCall(request(server.url("/ok"))).execute()) {
            assertEquals(200, response.code());
        }

        RecordedRequest received = server.takeRequest(1, TimeUnit.SECONDS);
        assertEquals(PLAYER_GRANT, received == null ? null : received.getHeader(PLAYER_GRANT_HEADER));
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS));
    }

    @Test
    public void rewardProvenanceParserAcceptsOnlyVerifiedServerPairs() throws Exception {
        assertEquals("abcdefghijklmnopqrstuv",
                SkitNativeApiClient.parseVerifiedRewardProvenance(
                        7, true, 7, "TAKU", "abcdefghijklmnopqrstuv", "taku-show-20260719")
                        .getSessionId());
        assertEquals("taku-show-20260719",
                SkitNativeApiClient.parseVerifiedRewardProvenance(
                        7, true, 7, "TAKU", "abcdefghijklmnopqrstuv", "taku-show-20260719")
                        .getProviderShowId());
        assertNull(SkitNativeApiClient.parseVerifiedRewardProvenance(
                7, false, 7, "TAKU", "", ""));
        assertThrows(java.io.IOException.class,
                () -> SkitNativeApiClient.parseVerifiedRewardProvenance(
                        7, true, 7, "TAKU", "f69f9b70d1c9", "taku-show-20260719"));
    }

    private void assertRedirectRejected(OkHttpClient client, HttpUrl start,
                                        MockWebServer source, MockWebServer target) throws Exception {
        assertFalse(client.followRedirects());
        assertFalse(client.followSslRedirects());
        try (Response response = client.newCall(request(start)).execute()) {
            assertEquals(302, response.code());
        }

        RecordedRequest first = source.takeRequest(1, TimeUnit.SECONDS);
        assertEquals(PLAYER_GRANT, first == null ? null : first.getHeader(PLAYER_GRANT_HEADER));
        if (source == target) {
            assertNull(source.takeRequest(200, TimeUnit.MILLISECONDS));
        } else {
            assertNull(target.takeRequest(200, TimeUnit.MILLISECONDS));
        }
    }

    private Request request(HttpUrl url) {
        return new Request.Builder()
                .url(url)
                .header(PLAYER_GRANT_HEADER, PLAYER_GRANT)
                .build();
    }

    private MockResponse redirect(HttpUrl target) {
        return new MockResponse()
                .setResponseCode(302)
                .addHeader("Location", target);
    }

    private MockWebServer server() throws Exception {
        MockWebServer server = new MockWebServer();
        server.start();
        servers.add(server);
        return server;
    }
}
