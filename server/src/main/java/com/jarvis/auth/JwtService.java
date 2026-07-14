package com.jarvis.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

/**
 * JWT signing / verification and cookie building. Ports src/auth/auth.ts:
 * <ul>
 *   <li>cookie {@code jarvis_token}, httpOnly, path=/, SameSite=Lax, 30-day maxAge</li>
 *   <li>payload carries {@code userId} + {@code username} claims, 30-day expiry</li>
 *   <li>secret from env {@code JWT_SECRET} (dev default with a warn log)</li>
 * </ul>
 * The raw secret is SHA-256 hashed to a 256-bit key so any-length secret is valid for
 * HS256 (jjwt rejects sub-256-bit keys), rather than forcing operators to pad it.
 */
@Service
public class JwtService {

    /** Cookie name holding the JWT — must match src/auth/auth.ts COOKIE_NAME. */
    public static final String COOKIE_NAME = "jarvis_token";

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private static final String DEV_SECRET = "jarvis-dev-secret-change-in-prod";
    private static final Duration TOKEN_EXPIRY = Duration.ofDays(30);

    private final SecretKey key;

    public JwtService(@Value("${jarvis.auth.jwt-secret:}") String configuredSecret) {
        String secret = (configuredSecret == null || configuredSecret.isBlank())
                ? System.getenv("JWT_SECRET") : configuredSecret;
        if (secret == null || secret.isBlank()) {
            log.warn("JWT_SECRET not set — using insecure development default. "
                    + "Set the JWT_SECRET env var before deploying.");
            secret = DEV_SECRET;
        }
        this.key = deriveKey(secret);
    }

    /** Sign a token embedding the user id (subject + claim) and username. */
    public String sign(String userId, String username) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .claim("userId", userId)
                .claim("username", username)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(TOKEN_EXPIRY)))
                .signWith(key)
                .compact();
    }

    /** Verify + parse a token; empty when missing/expired/tampered (mirrors TS returning null). */
    public Optional<TokenPayload> verify(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(token).getPayload();
            String userId = claims.get("userId", String.class);
            String username = claims.get("username", String.class);
            if (userId == null) {
                return Optional.empty();
            }
            return Optional.of(new TokenPayload(userId, username));
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("jwt_verify_failed reason={}", e.getMessage());
            return Optional.empty();
        }
    }

    /** Build the Set-Cookie for a freshly signed token (httpOnly, 30 days). */
    public ResponseCookie buildTokenCookie(String token) {
        return ResponseCookie.from(COOKIE_NAME, token)
                .httpOnly(true)
                .sameSite("Lax")
                .path("/")
                .maxAge(TOKEN_EXPIRY)
                .build();
    }

    /** Build the Set-Cookie that clears the token (logout). */
    public ResponseCookie buildClearCookie() {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
    }

    private static SecretKey deriveKey(String secret) {
        try {
            byte[] hashed = MessageDigest.getInstance("SHA-256")
                    .digest(secret.getBytes(StandardCharsets.UTF_8));
            return Keys.hmacShaKeyFor(hashed);
        } catch (Exception e) {
            throw new IllegalStateException("无法初始化 JWT 密钥", e);
        }
    }

    /** Decoded token claims. */
    public record TokenPayload(String userId, String username) {
    }
}
