package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.longThat;
import static org.mockito.Mockito.verify;

import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.mapper.ArtifactMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Unit tests for the artifact write side (port of the internal TS saveArtifact). */
@ExtendWith(MockitoExtension.class)
class ArtifactServiceTest {

    @Mock
    private ArtifactMapper artifactMapper;
    @InjectMocks
    private ArtifactService service;

    @Test
    void saveArtifactReturnsGeneratedIdAndInsertsWithEpochCreatedAt() {
        var req = new SaveArtifactRequest("code", "Snippet", "the body", "ts", "task-7");

        String id = service.saveArtifact("u1", req);

        assertThat(id).isNotBlank();
        // created_at is a positive epoch-millis; fields and taskId pass straight through
        verify(artifactMapper).insert(eq(id), eq("u1"), eq("code"), eq("Snippet"),
                eq("the body"), eq("ts"), longThat(t -> t > 0), eq("task-7"));
    }

    @Test
    void saveArtifactAllowsNullLanguageAndTaskId() {
        var req = new SaveArtifactRequest("doc", "Notes", "x", null, null);

        String id = service.saveArtifact("u1", req);

        verify(artifactMapper).insert(eq(id), eq("u1"), eq("doc"), eq("Notes"), eq("x"),
                eq(null), longThat(t -> t > 0), eq(null));
    }
}
