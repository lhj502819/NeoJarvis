package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.longThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.mapper.ArtifactMapper;
import java.util.Optional;
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

    @Test
    void updateContentReturnsRefreshedArtifactWhenRowMatched() {
        when(artifactMapper.updateContent(eq("a1"), eq("u1"), eq("body"), eq("Title"),
                longThat(t -> t > 0))).thenReturn(1);
        when(artifactMapper.findDetailByIdAndUser("a1", "u1"))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "Title", "body", "ts", 5)));

        var result = service.updateContent("u1", "a1", "body", "Title");

        assertThat(result).isPresent();
        assertThat(result.get().version()).isEqualTo(5);
        verify(artifactMapper).updateContent(eq("a1"), eq("u1"), eq("body"), eq("Title"),
                longThat(t -> t > 0));
    }

    @Test
    void updateContentReturnsEmptyWhenNoRowMatched() {
        when(artifactMapper.updateContent(eq("nope"), eq("u1"), eq("x"), eq(null),
                longThat(t -> t > 0))).thenReturn(0);

        var result = service.updateContent("u1", "nope", "x", null);

        assertThat(result).isEmpty();
        // no re-read when nothing was updated
        verify(artifactMapper, org.mockito.Mockito.never()).findDetailByIdAndUser("nope", "u1");
    }
}
