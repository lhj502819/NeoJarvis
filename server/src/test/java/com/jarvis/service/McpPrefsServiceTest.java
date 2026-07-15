package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.mapper.McpPrefsMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class McpPrefsServiceTest {

    private McpPrefsMapper mapper;
    private McpPrefsService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(McpPrefsMapper.class);
        service = new McpPrefsService(mapper);
    }

    @Test
    void getDisabledWrapsMapperResultWithCodeZero() {
        // Given the mapper returns the user's blacklist
        when(mapper.listDisabled("u1")).thenReturn(List.of("chrome-devtools", "context7"));

        // When we ask the service for the response DTO
        var response = service.getDisabled("u1");

        // Then the payload matches TS-expected shape { code: 0, disabled: [...] }
        assertThat(response.code()).isZero();
        assertThat(response.disabled()).containsExactly("chrome-devtools", "context7");
    }

    @Test
    void setEnabledTrueRemovesTheBlacklistRow() {
        service.setEnabled("u1", "chrome-devtools", true);
        verify(mapper).delete("u1", "chrome-devtools");
    }

    @Test
    void setEnabledFalseInsertsBlacklistRow() {
        service.setEnabled("u1", "chrome-devtools", false);
        verify(mapper).insertIgnore("u1", "chrome-devtools");
    }
}
