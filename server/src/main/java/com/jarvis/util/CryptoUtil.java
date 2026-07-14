package com.jarvis.util;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.bouncycastle.crypto.generators.SCrypt;

/**
 * Symmetric encryption for stored secrets (BYOK api keys). A byte-for-byte port of
 * src/shared/crypto.ts so ciphertext written by either the TS or Java service decrypts
 * on both sides:
 *
 * <ul>
 *   <li>Key = scrypt(SECRET, "jarvis-settings-salt", N=16384 r=8 p=1, 32 bytes) — the
 *       exact defaults Node's {@code scryptSync(secret, salt, 32)} uses.</li>
 *   <li>Cipher = AES-256-GCM, 12-byte random IV, 16-byte (128-bit) auth tag.</li>
 *   <li>Wire format = {@code ivHex:authTagHex:ciphertextHex} (lowercase hex, colon
 *       separated). Node's GCM exposes the tag separately; the JCE appends it to the
 *       ciphertext, so encrypt splits it back out and decrypt re-joins it.</li>
 * </ul>
 */
public final class CryptoUtil {

    private static final String DEFAULT_SECRET = "jarvis-dev-settings-secret-change-in-prod";
    private static final byte[] SALT = "jarvis-settings-salt".getBytes(StandardCharsets.UTF_8);
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int TAG_BYTES = 16;

    private static final byte[] KEY = deriveKey();
    private static final SecureRandom RANDOM = new SecureRandom();

    private CryptoUtil() {
    }

    /** Encrypt UTF-8 plaintext, returning {@code ivHex:authTagHex:ciphertextHex}. */
    public static String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[IV_BYTES];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(KEY, "AES"),
                    new GCMParameterSpec(TAG_BITS, iv));
            byte[] out = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            // JCE returns ciphertext||tag; Node stores them separately.
            int cipherLen = out.length - TAG_BYTES;
            byte[] ciphertext = Arrays.copyOfRange(out, 0, cipherLen);
            byte[] authTag = Arrays.copyOfRange(out, cipherLen, out.length);
            HexFormat hex = HexFormat.of();
            return hex.formatHex(iv) + ":" + hex.formatHex(authTag) + ":" + hex.formatHex(ciphertext);
        } catch (Exception e) {
            throw new IllegalStateException("加密失败", e);
        }
    }

    /** Decrypt a {@code ivHex:authTagHex:ciphertextHex} payload back to UTF-8 plaintext. */
    public static String decrypt(String payload) {
        // Keep trailing empty segments (limit -1) so empty-string ciphertext still splits
        // into 3 parts, matching JS String.split(':').
        String[] parts = payload.split(":", -1);
        if (parts.length != 3) {
            throw new IllegalArgumentException("密文格式非法");
        }
        try {
            HexFormat hex = HexFormat.of();
            byte[] iv = hex.parseHex(parts[0]);
            byte[] authTag = hex.parseHex(parts[1]);
            byte[] ciphertext = hex.parseHex(parts[2]);
            // Re-join ciphertext||tag for the JCE.
            byte[] combined = new byte[ciphertext.length + authTag.length];
            System.arraycopy(ciphertext, 0, combined, 0, ciphertext.length);
            System.arraycopy(authTag, 0, combined, ciphertext.length, authTag.length);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(KEY, "AES"),
                    new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("解密失败", e);
        }
    }

    private static byte[] deriveKey() {
        String secret = System.getenv("SETTINGS_SECRET");
        if (secret == null || secret.isEmpty()) {
            secret = DEFAULT_SECRET;
        }
        byte[] secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        return SCrypt.generate(secretBytes, SALT, 16384, 8, 1, 32);
    }
}
