package com.jarvis.util;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.HexFormat;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Password hashing for local accounts. The old TS (src/auth/users.ts) used
 * {@code scryptSync(password, salt, 64)} with a per-user {@code randomBytes(16)} hex salt,
 * storing {@code password_hash} + {@code salt} as two columns. We keep that exact
 * two-column structure but switch the KDF to PBKDF2-HMAC-SHA256 (pure JDK, no external
 * dep, OWASP-recommended): the salt column stays meaningful (unlike BCrypt, which embeds
 * its own salt and would leave the column dead). Old hashes are NOT compatible — a fresh
 * DB is assumed (task premise).
 *
 * <ul>
 *   <li>salt = {@code randomBytes(16)} as lowercase hex (matches the TS salt format)</li>
 *   <li>hash = PBKDF2WithHmacSHA256(password, saltHexBytes, iterations, 512-bit) as hex</li>
 * </ul>
 *
 * The salt string's UTF-8 bytes are fed to PBKDF2 (as the TS fed the hex string to scrypt),
 * so the two columns round-trip identically to the original design.
 */
public final class PasswordHasher {

    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int ITERATIONS = 210_000;
    private static final int KEY_BITS = 512; // 64-byte derived key, matching TS scrypt keylen.
    private static final int SALT_BYTES = 16;
    private static final SecureRandom RANDOM = new SecureRandom();

    private PasswordHasher() {
    }

    /** Generate a fresh per-user salt: 16 random bytes as lowercase hex (32 chars). */
    public static String generateSalt() {
        byte[] salt = new byte[SALT_BYTES];
        RANDOM.nextBytes(salt);
        return HexFormat.of().formatHex(salt);
    }

    /** Derive the lowercase-hex password hash for {@code password} under {@code salt}. */
    public static String hash(String password, String salt) {
        try {
            KeySpec spec = new PBEKeySpec(password.toCharArray(),
                    salt.getBytes(StandardCharsets.UTF_8), ITERATIONS, KEY_BITS);
            byte[] derived = SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).getEncoded();
            return HexFormat.of().formatHex(derived);
        } catch (Exception e) {
            throw new IllegalStateException("密码哈希失败", e);
        }
    }

    /** Constant-time comparison of a candidate password against the stored hash. */
    public static boolean verify(String password, String salt, String expectedHash) {
        return constantTimeEquals(hash(password, salt), expectedHash);
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) {
            return false;
        }
        int diff = 0;
        for (int i = 0; i < a.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }
}
