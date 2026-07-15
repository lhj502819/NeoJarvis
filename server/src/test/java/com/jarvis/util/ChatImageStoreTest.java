package com.jarvis.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Tests for the on-disk chat-image store. Writes land under
 * {@code ~/.jarvis/chat-images} by construction — we scope each test to a random
 * userId and clean up after so the suite doesn't leak files across runs.
 */
class ChatImageStoreTest {

    private String userId;

    @BeforeEach
    void setUp() {
        userId = "test-user-" + UUID.randomUUID();
    }

    @AfterEach
    void tearDown() throws IOException {
        // Best-effort recursive delete of {ROOT}/{userId}.
        Path userDir = Paths.get(ChatImageStore.CHAT_IMAGE_ROOT, userId);
        if (Files.exists(userDir)) {
            try (var stream = Files.walk(userDir)) {
                stream.sorted((a, b) -> b.compareTo(a)).forEach(p -> {
                    try {
                        Files.deleteIfExists(p);
                    } catch (IOException ignored) {
                        // best-effort
                    }
                });
            }
        }
    }

    @Test
    void writeDecodesBase64AndPersistsBytesWithFileUri() throws IOException {
        String imageId = "img-1";
        byte[] rawBytes = new byte[]{0x00, 0x01, 0x02, 0x03, (byte) 0xFF};
        String base64 = Base64.getEncoder().encodeToString(rawBytes);

        String uri = ChatImageStore.write(userId, imageId, "image/png", base64);

        assertThat(uri).startsWith(ChatImageStore.FILE_URI_PREFIX);
        assertThat(uri).endsWith("/" + imageId + ".png");
        Path file = Paths.get(uri.substring(ChatImageStore.FILE_URI_PREFIX.length()));
        assertThat(Files.exists(file)).isTrue();
        // Bytes written are the DECODED payload, not the base64 string
        assertThat(Files.readAllBytes(file)).containsExactly(rawBytes);
    }

    @Test
    void writeCreatesParentDirectoriesAsNeeded() {
        Path userDir = Paths.get(ChatImageStore.CHAT_IMAGE_ROOT, userId);
        assertThat(Files.exists(userDir)).isFalse();

        ChatImageStore.write(userId, "img-nested", "image/png",
                Base64.getEncoder().encodeToString(new byte[]{1, 2, 3}));

        assertThat(Files.exists(userDir)).isTrue();
    }

    @Test
    void readRoundTripsWriteReturnedUri() {
        byte[] payload = "the binary body".getBytes();
        String base64 = Base64.getEncoder().encodeToString(payload);
        String uri = ChatImageStore.write(userId, "img-rt", "image/jpeg", base64);

        assertThat(ChatImageStore.read(uri)).containsExactly(payload);
    }

    @Test
    void inferExtensionCoversCommonMediaTypes() {
        assertThat(ChatImageStore.inferExtension("image/png")).isEqualTo("png");
        assertThat(ChatImageStore.inferExtension("image/jpeg")).isEqualTo("jpg");
        assertThat(ChatImageStore.inferExtension("image/jpg")).isEqualTo("jpg");
        assertThat(ChatImageStore.inferExtension("image/gif")).isEqualTo("gif");
        assertThat(ChatImageStore.inferExtension("image/webp")).isEqualTo("webp");
    }

    @Test
    void inferExtensionCaseInsensitive() {
        assertThat(ChatImageStore.inferExtension("IMAGE/PNG")).isEqualTo("png");
        assertThat(ChatImageStore.inferExtension("Image/Jpeg")).isEqualTo("jpg");
    }

    @Test
    void inferExtensionFallsBackToBinForUnknownOrBlank() {
        assertThat(ChatImageStore.inferExtension("image/tiff")).isEqualTo("bin");
        assertThat(ChatImageStore.inferExtension("application/octet-stream")).isEqualTo("bin");
        assertThat(ChatImageStore.inferExtension(null)).isEqualTo("bin");
        assertThat(ChatImageStore.inferExtension("")).isEqualTo("bin");
    }

    @Test
    void readRejectsNonFileScheme() {
        assertThatThrownBy(() -> ChatImageStore.read("https://example.com/x.png"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("file://");
    }

    @Test
    void readRejectsBlankUri() {
        assertThatThrownBy(() -> ChatImageStore.read(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ChatImageStore.read(""))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void writeRejectsBlankUserOrIdOrData() {
        String validB64 = Base64.getEncoder().encodeToString(new byte[]{1});
        assertThatThrownBy(() -> ChatImageStore.write("", "id", "image/png", validB64))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ChatImageStore.write("u", "", "image/png", validB64))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ChatImageStore.write("u", "id", "image/png", null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
