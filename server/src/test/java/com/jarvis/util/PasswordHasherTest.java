package com.jarvis.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PasswordHasherTest {

    @Test
    void hashVerifiesCorrectPasswordAndRejectsWrongOne() {
        // Given
        String salt = PasswordHasher.generateSalt();
        String hash = PasswordHasher.hash("s3cr3t-密码", salt);

        // Then
        assertThat(PasswordHasher.verify("s3cr3t-密码", salt, hash)).isTrue();
        assertThat(PasswordHasher.verify("wrong", salt, hash)).isFalse();
    }

    @Test
    void saltIsRandom16ByteHex() {
        // 16 bytes -> 32 lowercase hex chars, and two calls differ
        String a = PasswordHasher.generateSalt();
        String b = PasswordHasher.generateSalt();
        assertThat(a).hasSize(32).matches("[0-9a-f]+");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void sameInputIsDeterministicDifferentSaltDiffers() {
        String salt = PasswordHasher.generateSalt();
        assertThat(PasswordHasher.hash("pw", salt)).isEqualTo(PasswordHasher.hash("pw", salt));
        assertThat(PasswordHasher.hash("pw", salt))
                .isNotEqualTo(PasswordHasher.hash("pw", PasswordHasher.generateSalt()));
    }

    @Test
    void verifyToleratesNullExpectedHash() {
        assertThat(PasswordHasher.verify("pw", PasswordHasher.generateSalt(), null)).isFalse();
    }
}
