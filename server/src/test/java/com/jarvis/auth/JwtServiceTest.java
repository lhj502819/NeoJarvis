package com.jarvis.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.auth.JwtService.TokenPayload;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseCookie;

class JwtServiceTest {

    private final JwtService jwt = new JwtService("test-secret-for-jwt-signing-1234567890");

    @Test
    void signThenVerifyRoundTripsClaims() {
        String token = jwt.sign("u-42", "alice");

        Optional<TokenPayload> payload = jwt.verify(token);

        assertThat(payload).isPresent();
        assertThat(payload.get().userId()).isEqualTo("u-42");
        assertThat(payload.get().username()).isEqualTo("alice");
    }

    @Test
    void verifyRejectsTamperedToken() {
        String token = jwt.sign("u-42", "alice");
        String tampered = token.substring(0, token.length() - 3) + "xxx";

        assertThat(jwt.verify(tampered)).isEmpty();
    }

    @Test
    void verifyRejectsTokenSignedWithDifferentSecret() {
        // A token from another key must not validate here (tampered/foreign signature).
        String foreign = new JwtService("a-totally-different-secret-value-000").sign("u", "bob");

        assertThat(jwt.verify(foreign)).isEmpty();
    }

    @Test
    void verifyRejectsGarbageAndBlankTokens() {
        assertThat(jwt.verify("not-a-jwt")).isEmpty();
        assertThat(jwt.verify("")).isEmpty();
        assertThat(jwt.verify(null)).isEmpty();
    }

    @Test
    void tokenCookieIsHttpOnlyScopedAndNamedJarvisToken() {
        ResponseCookie cookie = jwt.buildTokenCookie("abc");

        assertThat(cookie.getName()).isEqualTo("jarvis_token");
        assertThat(cookie.getValue()).isEqualTo("abc");
        assertThat(cookie.isHttpOnly()).isTrue();
        assertThat(cookie.getPath()).isEqualTo("/");
        assertThat(cookie.getMaxAge().toDays()).isEqualTo(30);
    }

    @Test
    void clearCookieExpiresImmediately() {
        ResponseCookie cookie = jwt.buildClearCookie();

        assertThat(cookie.getName()).isEqualTo("jarvis_token");
        assertThat(cookie.getMaxAge().isZero()).isTrue();
    }

    @Test
    void shortSecretStillProducesValidKey() {
        // Secret shorter than 256 bits must not throw (it is SHA-256 expanded).
        JwtService shortSecret = new JwtService("short");
        assertThat(shortSecret.verify(shortSecret.sign("u", "n"))).isPresent();
    }
}
