package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.longThat;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.mapper.ArtifactMapper;
import com.jarvis.util.ArtifactStore;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Unit tests for the v0.3 artifact write side: files land on disk via {@link ArtifactStore},
 * DB rows carry {@code uri} (not {@code content}). Static store methods are stubbed with
 * Mockito static-mocking so we don't hit the filesystem in these unit tests — the on-disk
 * behaviour is covered by {@code ArtifactStoreTest} and the mapper integration test.
 */
@ExtendWith(MockitoExtension.class)
class ArtifactServiceTest {

    @Mock
    private ArtifactMapper artifactMapper;
    @InjectMocks
    private ArtifactService service;

    @Test
    void saveArtifactWritesFileThenInsertsWithUriAndNullContent() {
        var req = new SaveArtifactRequest("code", "Snippet", "the body", "ts", "task-7");
        try (MockedStatic<ArtifactStore> store = mockStatic(ArtifactStore.class)) {
            store.when(() -> ArtifactStore.write(eq("u1"), any(), eq("code"), eq("ts"),
                    eq("the body"))).thenReturn("file:///tmp/u1/foo.ts");

            String id = service.saveArtifact("u1", req);

            assertThat(id).isNotBlank();
            store.verify(() -> ArtifactStore.write(eq("u1"), eq(id), eq("code"), eq("ts"),
                    eq("the body")));
        }
        // content is null; uri is the URI returned by the store
        verify(artifactMapper).insert(any(), eq("u1"), eq("code"), eq("Snippet"),
                eq(null), eq("file:///tmp/u1/foo.ts"), eq("ts"), longThat(t -> t > 0),
                eq("task-7"));
    }

    @Test
    void saveArtifactAllowsNullLanguageAndTaskId() {
        var req = new SaveArtifactRequest("doc", "Notes", "x", null, null);
        try (MockedStatic<ArtifactStore> store = mockStatic(ArtifactStore.class)) {
            store.when(() -> ArtifactStore.write(eq("u1"), any(), eq("doc"), eq(null), eq("x")))
                    .thenReturn("file:///tmp/u1/doc.txt");

            String id = service.saveArtifact("u1", req);

            store.verify(() -> ArtifactStore.write(eq("u1"), eq(id), eq("doc"), eq(null), eq("x")));
        }
        verify(artifactMapper).insert(any(), eq("u1"), eq("doc"), eq("Notes"), eq(null),
                eq("file:///tmp/u1/doc.txt"), eq(null), longThat(t -> t > 0), eq(null));
    }

    @Test
    void updateContentWritesNewFileAndBumpsVersion() {
        // Existing row has uri already (new-style artifact) — update overwrites the same file
        when(artifactMapper.findDetailByIdAndUser("a1", "u1"))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "Title", null,
                        "file:///tmp/u1/a1.ts", "ts", 4)))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "New title", null,
                        "file:///tmp/u1/a1.ts", "ts", 5)));

        try (MockedStatic<ArtifactStore> store = mockStatic(ArtifactStore.class)) {
            store.when(() -> ArtifactStore.write("u1", "a1", "code", "ts", "body"))
                    .thenReturn("file:///tmp/u1/a1.ts");
            when(artifactMapper.updateUri(eq("a1"), eq("u1"), eq("file:///tmp/u1/a1.ts"),
                    eq("New title"), longThat(t -> t > 0))).thenReturn(1);

            var result = service.updateContent("u1", "a1", "body", "New title");

            assertThat(result).isPresent();
            assertThat(result.get().version()).isEqualTo(5);
            store.verify(() -> ArtifactStore.write("u1", "a1", "code", "ts", "body"));
        }
        verify(artifactMapper).updateUri(eq("a1"), eq("u1"), eq("file:///tmp/u1/a1.ts"),
                eq("New title"), longThat(t -> t > 0));
    }

    @Test
    void updateContentMigratesLegacyRowFromContentToUri() {
        // Legacy row: uri=null, content populated. Same code path — updateContent writes a
        // file and stores uri, so the legacy row is silently migrated on first edit.
        when(artifactMapper.findDetailByIdAndUser("legacy", "u1"))
                .thenReturn(Optional.of(new ArtifactDetail("legacy", "markdown", "Old",
                        "old body", null, null, 2)))
                .thenReturn(Optional.of(new ArtifactDetail("legacy", "markdown", "Old", null,
                        "file:///tmp/u1/legacy.md", null, 3)));

        try (MockedStatic<ArtifactStore> store = mockStatic(ArtifactStore.class)) {
            store.when(() -> ArtifactStore.write("u1", "legacy", "markdown", null, "new body"))
                    .thenReturn("file:///tmp/u1/legacy.md");
            when(artifactMapper.updateUri(eq("legacy"), eq("u1"), eq("file:///tmp/u1/legacy.md"),
                    eq(null), longThat(t -> t > 0))).thenReturn(1);

            var result = service.updateContent("u1", "legacy", "new body", null);

            assertThat(result).isPresent();
            // Refreshed row now has uri set and content cleared
            assertThat(result.get().uri()).isEqualTo("file:///tmp/u1/legacy.md");
            assertThat(result.get().content()).isNull();
        }
    }

    @Test
    void updateContentReturnsEmptyWhenNoRowMatched() {
        when(artifactMapper.findDetailByIdAndUser("nope", "u1")).thenReturn(Optional.empty());

        try (MockedStatic<ArtifactStore> store = mockStatic(ArtifactStore.class)) {
            var result = service.updateContent("u1", "nope", "x", null);

            assertThat(result).isEmpty();
            // Not-found short-circuits BEFORE any disk write.
            store.verifyNoInteractions();
        }
        // no update issued either
        verify(artifactMapper, org.mockito.Mockito.never()).updateUri(any(), any(), any(), any(),
                org.mockito.Mockito.anyLong());
    }
}
