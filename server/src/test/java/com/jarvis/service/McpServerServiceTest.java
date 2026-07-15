package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AddMcpServerRequest;
import com.jarvis.domain.McpServer;
import com.jarvis.domain.McpServerRow;
import com.jarvis.domain.UpdateMcpServerRequest;
import com.jarvis.mapper.McpServerMapper;
import com.jarvis.util.CryptoUtil;
import com.jarvis.util.Json;
import com.jarvis.web.BadRequestException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class McpServerServiceTest {

    private McpServerMapper mapper;
    private McpServerService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(McpServerMapper.class);
        service = new McpServerService(mapper);
    }

    private static McpServerRow row(String envEnc, String argsJson, int enabled) {
        return new McpServerRow("m1", "local", "fs", "stdio", "npx", argsJson, null, envEnc, "desc",
                enabled, "2026-07-10T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void addEncryptsEnvAndListNeverExposesPlaintextOnlyKeys() {
        String enc = CryptoUtil.encrypt(Json.stringify(new java.util.LinkedHashMap<String, Object>(
                Map.of("API_KEY", "sk-secret"))));
        when(mapper.findByUserAndName("local", "fs"))
                .thenReturn(Optional.of(row(enc, null, 1)));

        McpServer result = service.add("local", new AddMcpServerRequest(
                "fs", "stdio", "npx", List.of("-y", "fs"), null, Map.of("API_KEY", "sk-secret"),
                "desc"));

        // stored env must be ciphertext, not plaintext; response carries only the key name
        var envEnc = ArgumentCaptor.forClass(String.class);
        verify(mapper).insert(anyString(), eq("local"), eq("fs"), eq("stdio"), eq("npx"),
                eq("[\"-y\",\"fs\"]"), eq(null), envEnc.capture(), eq("desc"), anyString(),
                anyString());
        assertThat(envEnc.getValue()).doesNotContain("sk-secret");
        assertThat(CryptoUtil.decrypt(envEnc.getValue())).contains("sk-secret");
        assertThat(result.envKeys()).containsExactly("API_KEY");
    }

    @Test
    void addRejectsStdioWithoutCommand() {
        assertThatThrownBy(() -> service.add("local", new AddMcpServerRequest(
                "fs", "stdio", null, null, null, null, null)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("command");
        verify(mapper, never()).insert(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString());
    }

    @Test
    void addRejectsHttpWithoutUrl() {
        assertThatThrownBy(() -> service.add("local", new AddMcpServerRequest(
                "web", "http", null, null, null, null, null)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("url");
    }

    @Test
    void updateAbsentEnvKeepsExistingCiphertextAndPresentReplaces() {
        McpServerRow existing = row("enc-old", "[\"a\"]", 1);
        when(mapper.findByUserAndName("local", "fs")).thenReturn(Optional.of(existing));

        // env=null -> keep old ciphertext; args=null -> keep old json; only enabled toggled
        service.update("local", "fs", new UpdateMcpServerRequest(
                null, null, null, null, null, null, false));

        verify(mapper).update(eq("local"), eq("fs"), eq("stdio"), eq("npx"), eq("[\"a\"]"),
                eq(null), eq("enc-old"), eq("desc"), eq(0), anyString());
    }

    @Test
    void updatePresentEmptyEnvClearsToNull() {
        McpServerRow existing = row("enc-old", null, 1);
        when(mapper.findByUserAndName("local", "fs")).thenReturn(Optional.of(existing));

        service.update("local", "fs", new UpdateMcpServerRequest(
                null, null, null, null, Map.of(), null, null));

        // empty env map replaces -> env_enc becomes NULL
        verify(mapper).update(eq("local"), eq("fs"), eq("stdio"), eq("npx"), eq(null),
                eq(null), eq(null), eq("desc"), eq(1), anyString());
    }

    @Test
    void updateMissingReturnsEmpty() {
        when(mapper.findByUserAndName("local", "nope")).thenReturn(Optional.empty());
        assertThat(service.update("local", "nope", new UpdateMcpServerRequest(
                null, null, null, null, null, null, null))).isEmpty();
        verify(mapper, never()).update(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyInt(), anyString());
    }

    @Test
    void removeReturnsMapperBoolean() {
        when(mapper.delete("local", "fs")).thenReturn(1);
        assertThat(service.remove("local", "fs")).isTrue();
        when(mapper.delete("local", "gone")).thenReturn(0);
        assertThat(service.remove("local", "gone")).isFalse();
    }

    @Test
    void resolveDecryptsEnvAndKeepsEmptyMapWhenNoEnv() {
        String enc = CryptoUtil.encrypt(Json.stringify(new java.util.LinkedHashMap<String, Object>(
                Map.of("API_KEY", "sk-secret"))));
        McpServerRow withEnv = row(enc, "[\"-y\",\"fs\"]", 1);
        McpServerRow noEnv = new McpServerRow("m2", "local", "web", "http", null, null,
                "https://x", null, null, 1, "2026-07-11T00:00:00Z", "2026-07-11T00:00:00Z");
        when(mapper.listEnabledByUser("local")).thenReturn(List.of(withEnv, noEnv));

        var resolved = service.resolve("local");

        assertThat(resolved).hasSize(2);
        assertThat(resolved.get(0).env()).containsEntry("API_KEY", "sk-secret");
        assertThat(resolved.get(0).args()).containsExactly("-y", "fs");
        // no env -> empty map (never null), matching TS Record default
        assertThat(resolved.get(1).env()).isEmpty();
        assertThat(resolved.get(1).url()).isEqualTo("https://x");
        assertThat(resolved.get(1).command()).isNull();
    }

    @Test
    void resolveSkipsServerWhoseEnvFailsToDecrypt() {
        McpServerRow corrupt = row("not-a-valid-ciphertext", null, 1);
        when(mapper.listEnabledByUser("local")).thenReturn(List.of(corrupt));

        // decrypt failure -> skip that server (TS continue), never throw
        assertThat(service.resolve("local")).isEmpty();
    }
}
