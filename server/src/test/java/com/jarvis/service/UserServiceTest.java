package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.UserRow;
import com.jarvis.mapper.UserMapper;
import com.jarvis.web.BadRequestException;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class UserServiceTest {

    private UserMapper mapper;
    private UserService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(UserMapper.class);
        service = new UserService(mapper);
    }

    @Test
    void firstUserBecomesAdminAndPasswordIsHashedNotStoredPlain() {
        when(mapper.findRowByUsername("alice")).thenReturn(Optional.empty());
        when(mapper.count()).thenReturn(0);

        UserRow created = service.createUser("alice", "Alice", "pw-plain");

        assertThat(created.role()).isEqualTo("admin");
        ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> salt = ArgumentCaptor.forClass(String.class);
        verify(mapper).insert(anyString(), eq("alice"), eq("Alice"), hash.capture(),
                salt.capture(), eq("admin"), anyString());
        // hash is not the plaintext, and verifies against the captured salt
        assertThat(hash.getValue()).isNotEqualTo("pw-plain");
        assertThat(created.passwordHash()).isEqualTo(hash.getValue());
        assertThat(service.validatePassword(created, "pw-plain")).isTrue();
        assertThat(service.validatePassword(created, "wrong")).isFalse();
    }

    @Test
    void secondUserIsPlainUser() {
        when(mapper.findRowByUsername("bob")).thenReturn(Optional.empty());
        when(mapper.count()).thenReturn(1);

        assertThat(service.createUser("bob", "Bob", "pw").role()).isEqualTo("user");
    }

    @Test
    void duplicateUsernameRejected() {
        when(mapper.findRowByUsername("alice"))
                .thenReturn(Optional.of(new UserRow("u1", "alice", "Alice", "h", "s", "user", "t")));

        assertThatThrownBy(() -> service.createUser("alice", "Alice", "pw"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("用户名已存在");
        verify(mapper, never()).insert(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
    }

    @Test
    void isAdminReflectsStoredRole() {
        when(mapper.findRole("u1")).thenReturn(Optional.of("admin"));
        when(mapper.findRole("u2")).thenReturn(Optional.of("user"));
        when(mapper.findRole("gone")).thenReturn(Optional.empty());

        assertThat(service.isAdmin("u1")).isTrue();
        assertThat(service.isAdmin("u2")).isFalse();
        assertThat(service.isAdmin("gone")).isFalse();
    }

    @Test
    void deleteMissingReturnsFalseAdminRejectedUserDeleted() {
        when(mapper.findRole("gone")).thenReturn(Optional.empty());
        assertThat(service.deleteUser("gone")).isFalse();

        when(mapper.findRole("admin1")).thenReturn(Optional.of("admin"));
        assertThatThrownBy(() -> service.deleteUser("admin1"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("不能删除管理员");
        verify(mapper, never()).delete("admin1");

        when(mapper.findRole("user1")).thenReturn(Optional.of("user"));
        assertThat(service.deleteUser("user1")).isTrue();
        verify(mapper).delete("user1");
    }
}
