package com.jarvis.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import org.junit.jupiter.api.Test;

class CryptoUtilTest {

    @Test
    void encryptThenDecryptRoundTrips() {
        // Given / When
        String plaintext = "sk-ant-abc123-秘密-🔑";
        String enc = CryptoUtil.encrypt(plaintext);

        // Then: decrypt returns the original
        assertThat(CryptoUtil.decrypt(enc)).isEqualTo(plaintext);
    }

    @Test
    void emptyStringRoundTrips() {
        assertThat(CryptoUtil.decrypt(CryptoUtil.encrypt(""))).isEmpty();
    }

    @Test
    void ciphertextIsThreeLowercaseHexSegments() {
        // When
        String enc = CryptoUtil.encrypt("hello");

        // Then: iv:tag:cipher, all lowercase hex; iv is 12 bytes, tag is 16 bytes
        String[] parts = enc.split(":");
        assertThat(parts).hasSize(3);
        assertThat(parts).allMatch(p -> p.matches("[0-9a-f]*"));
        assertThat(parts[0]).hasSize(24); // 12-byte IV
        assertThat(parts[1]).hasSize(32); // 16-byte auth tag
    }

    @Test
    void ivIsRandomPerEncryption() {
        assertThat(CryptoUtil.encrypt("x")).isNotEqualTo(CryptoUtil.encrypt("x"));
    }

    @Test
    void rejectsMalformedPayload() {
        assertThatThrownBy(() -> CryptoUtil.decrypt("onlyonepart"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CryptoUtil.decrypt("a:b"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * Binary-compatibility proof: this ciphertext was produced by the OLD TS crypto.ts
     * (Node scryptSync + aes-256-gcm) using the default SECRET. Java must decrypt it to
     * the original plaintext, guaranteeing old rows stay readable. Skipped if a custom
     * SETTINGS_SECRET is set (which would derive a different key).
     */
    @Test
    void decryptsCiphertextProducedByOldTsCrypto() {
        assumeTrue(System.getenv("SETTINGS_SECRET") == null,
                "golden vector uses the default SECRET");
        String fromNode = "67d6ca412293dadc74364823"
                + ":58562cfc625684a12c7903224597a207"
                + ":5c4444ce40952f7636f3a497ccb213f8fc156987c72ec212ab3e";
        assertThat(CryptoUtil.decrypt(fromNode)).isEqualTo("sk-jarvis-secret-测试-42");
    }
}
