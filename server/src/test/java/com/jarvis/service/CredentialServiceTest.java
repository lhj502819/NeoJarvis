package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.CreateCredentialRequest;
import com.jarvis.domain.Credential;
import com.jarvis.domain.CredentialRow;
import com.jarvis.domain.UpdateCredentialRequest;
import com.jarvis.mapper.CredentialMapper;
import com.jarvis.util.CryptoUtil;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class CredentialServiceTest {

    private CredentialMapper mapper;
    private CredentialService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(CredentialMapper.class);
        service = new CredentialService(mapper);
    }

    @Test
    void firstCredentialIsForcedDefaultAndKeyIsEncrypted() {
        when(mapper.countByUser("local")).thenReturn(0);

        Credential result = service.add("local", new CreateCredentialRequest(
                "Prod", "standard", "sk-secret", "https://api", "sonnet", false));

        // forced default because it is the first credential
        assertThat(result.isDefault()).isTrue();
        verify(mapper).clearDefault("local");
        // stored key must be ciphertext, not the plaintext
        var enc = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(mapper).insert(anyString(), eq("local"), eq("Prod"), eq("standard"), enc.capture(),
                eq("https://api"), eq("sonnet"), eq(1), anyString(), anyString());
        assertThat(enc.getValue()).isNotEqualTo("sk-secret");
        assertThat(CryptoUtil.decrypt(enc.getValue())).isEqualTo("sk-secret");
    }

    @Test
    void nonDefaultAdditionWhenOthersExistDoesNotClearDefault() {
        when(mapper.countByUser("local")).thenReturn(2);

        Credential result = service.add("local", new CreateCredentialRequest(
                "Second", "standard", "sk-2", "https://api", "sonnet", false));

        assertThat(result.isDefault()).isFalse();
        verify(mapper, never()).clearDefault(anyString());
    }

    @Test
    void updateWithBlankApiKeyKeepsExistingEncryptedKey() {
        var row = new CredentialRow("c1", "local", "Old", "standard", "enc-existing",
                "https://api", "sonnet", true, "2026-07-10T00:00:00Z", "2026-07-10T00:00:00Z");
        when(mapper.findByIdAndUser("c1", "local")).thenReturn(Optional.of(row));

        service.update("local", "c1", new UpdateCredentialRequest(
                "Renamed", null, "", null, null, null));

        // blank apiKey -> existing ciphertext retained; null fields keep old values
        verify(mapper).update(eq("c1"), eq("local"), eq("Renamed"), eq("standard"),
                eq("enc-existing"), eq("https://api"), eq("sonnet"), eq(1), anyString());
    }

    @Test
    void updateMissingReturnsEmpty() {
        when(mapper.findByIdAndUser("nope", "local")).thenReturn(Optional.empty());
        assertThat(service.update("local", "nope", new UpdateCredentialRequest(
                "x", null, null, null, null, null))).isEmpty();
        verify(mapper, never()).update(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyInt(), anyString());
    }

    @Test
    void deletingDefaultPromotesEarliestRemaining() {
        var row = new CredentialRow("c1", "local", "Def", "standard", "enc", "https://api",
                "sonnet", true, "2026-07-10T00:00:00Z", "2026-07-10T00:00:00Z");
        when(mapper.findByIdAndUser("c1", "local")).thenReturn(Optional.of(row));
        when(mapper.findEarliestId("local")).thenReturn(Optional.of("c2"));

        assertThat(service.delete("local", "c1")).isTrue();
        verify(mapper).delete("c1", "local");
        verify(mapper).setDefault("c2", "local");
    }

    @Test
    void deletingMissingReturnsFalse() {
        when(mapper.findByIdAndUser("gone", "local")).thenReturn(Optional.empty());
        assertThat(service.delete("local", "gone")).isFalse();
        verify(mapper, never()).delete(anyString(), anyString());
    }
}
