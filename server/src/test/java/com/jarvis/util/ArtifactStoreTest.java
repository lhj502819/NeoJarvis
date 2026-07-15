package com.jarvis.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Tests for the on-disk artifact store. Writes land under {@code ~/.jarvis/artifacts}
 * by construction — we scope each test to a random userId and clean up after so the
 * suite doesn't leak files across runs.
 */
class ArtifactStoreTest {

    private String userId;

    @BeforeEach
    void setUp() {
        userId = "test-user-" + UUID.randomUUID();
    }

    @AfterEach
    void tearDown() throws IOException {
        // Best-effort recursive delete of {ROOT}/{userId}.
        Path userDir = Paths.get(ArtifactStore.ARTIFACT_ROOT, userId);
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
    void writeReturnsFileUriAndPersistsContent() throws IOException {
        String artifactId = "art-1";
        String content = "hello 你好 🌊";

        String uri = ArtifactStore.write(userId, artifactId, "markdown", null, content);

        assertThat(uri).startsWith(ArtifactStore.FILE_URI_PREFIX);
        assertThat(uri).endsWith("/" + artifactId + ".md");
        Path file = Paths.get(uri.substring(ArtifactStore.FILE_URI_PREFIX.length()));
        assertThat(Files.exists(file)).isTrue();
        assertThat(Files.readString(file, StandardCharsets.UTF_8)).isEqualTo(content);
    }

    @Test
    void writeCreatesParentDirectoriesAsNeeded() {
        // Fresh userId → directory does not exist yet
        Path userDir = Paths.get(ArtifactStore.ARTIFACT_ROOT, userId);
        assertThat(Files.exists(userDir)).isFalse();

        ArtifactStore.write(userId, "art-nested", "html", null, "<p>x</p>");

        assertThat(Files.exists(userDir)).isTrue();
    }

    @Test
    void writeOverwritesExistingFileOnSecondCall() throws IOException {
        String artifactId = "art-overwrite";
        String firstUri = ArtifactStore.write(userId, artifactId, "code", "typescript", "v1");
        String secondUri = ArtifactStore.write(userId, artifactId, "code", "typescript", "v2");

        // Same path both times → PATCH reuses the file in place.
        assertThat(firstUri).isEqualTo(secondUri);
        Path file = Paths.get(secondUri.substring(ArtifactStore.FILE_URI_PREFIX.length()));
        assertThat(Files.readString(file, StandardCharsets.UTF_8)).isEqualTo("v2");
    }

    @Test
    void readRoundTripsWriteReturnedUri() {
        String content = "the body";
        String uri = ArtifactStore.write(userId, "art-rt", "code", "python", content);

        assertThat(ArtifactStore.read(uri)).isEqualTo(content);
    }

    @Test
    void inferExtensionCoversAllArtifactTypes() {
        // Non-code types have fixed extensions
        assertThat(ArtifactStore.inferExtension("markdown", null)).isEqualTo("md");
        assertThat(ArtifactStore.inferExtension("html", null)).isEqualTo("html");
        assertThat(ArtifactStore.inferExtension("mermaid", null)).isEqualTo("mmd");
        // Unknown / other types fall back to txt
        assertThat(ArtifactStore.inferExtension("something-else", null)).isEqualTo("txt");
        assertThat(ArtifactStore.inferExtension(null, null)).isEqualTo("txt");
    }

    @Test
    void inferExtensionForCodeUsesLanguageMap() {
        assertThat(ArtifactStore.inferExtension("code", "typescript")).isEqualTo("ts");
        assertThat(ArtifactStore.inferExtension("code", "python")).isEqualTo("py");
        assertThat(ArtifactStore.inferExtension("code", "go")).isEqualTo("go");
        // Case-insensitive
        assertThat(ArtifactStore.inferExtension("code", "TypeScript")).isEqualTo("ts");
        // Unknown language → txt fallback
        assertThat(ArtifactStore.inferExtension("code", "brainfuck")).isEqualTo("txt");
        // Missing language → txt
        assertThat(ArtifactStore.inferExtension("code", null)).isEqualTo("txt");
    }

    @Test
    void readRejectsNonFileScheme() {
        assertThatThrownBy(() -> ArtifactStore.read("https://example.com/x.md"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("file://");
    }

    @Test
    void readRejectsBlankUri() {
        assertThatThrownBy(() -> ArtifactStore.read(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ArtifactStore.read(""))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void writeRejectsBlankUserOrId() {
        assertThatThrownBy(() -> ArtifactStore.write("", "id", "code", null, "x"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ArtifactStore.write("u", "", "code", null, "x"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
