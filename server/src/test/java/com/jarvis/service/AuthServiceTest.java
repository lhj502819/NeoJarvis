package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AuthResponse;
import com.jarvis.domain.UserRow;
import com.jarvis.web.ForbiddenException;
import com.jarvis.web.UnauthorizedException;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class AuthServiceTest {

    private UserService userService = Mockito.mock(UserService.class);

    private AuthService withInviteCode(String code) {
        return new AuthService(userService, code);
    }

    private static UserRow user(String role) {
        return new UserRow("u1", "alice", "Alice", "hash", "salt", role, "2026-07-14T00:00:00Z");
    }

    @Test
    void registerDefaultsDisplayNameToUsernameWhenBlank() {
        when(userService.createUser("alice", "alice", "pw")).thenReturn(user("admin"));
        AuthService auth = withInviteCode("");

        AuthResponse res = auth.register("alice", null, "pw", null);

        assertThat(res.username()).isEqualTo("alice");
        assertThat(res.displayName()).isEqualTo("Alice");
        assertThat(res.role()).isEqualTo("admin");
    }

    @Test
    void registerRejectsWrongInviteCodeButAcceptsCorrectOne() {
        AuthService auth = withInviteCode("SECRET");

        assertThatThrownBy(() -> auth.register("bob", "Bob", "pw", "nope"))
                .isInstanceOf(ForbiddenException.class)
                .hasMessage("邀请码无效");

        when(userService.createUser("bob", "Bob", "pw")).thenReturn(user("user"));
        assertThat(auth.register("bob", "Bob", "pw", "SECRET").username()).isEqualTo("alice");
    }

    @Test
    void loginRejectsUnknownUserAndBadPassword() {
        AuthService auth = withInviteCode("");
        when(userService.findByUsername("ghost")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> auth.login("ghost", "pw"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("用户名或密码错误");

        UserRow u = user("user");
        when(userService.findByUsername("alice")).thenReturn(Optional.of(u));
        when(userService.validatePassword(u, "bad")).thenReturn(false);
        assertThatThrownBy(() -> auth.login("alice", "bad"))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void loginSucceedsWithCorrectPassword() {
        AuthService auth = withInviteCode("");
        UserRow u = user("user");
        when(userService.findByUsername("alice")).thenReturn(Optional.of(u));
        when(userService.validatePassword(u, "pw")).thenReturn(true);

        assertThat(auth.login("alice", "pw").userId()).isEqualTo("u1");
    }

    @Test
    void currentUserFallsBackToUserRoleWhenNotInDb() {
        AuthService auth = withInviteCode("");
        when(userService.findById("local")).thenReturn(Optional.empty());

        AuthResponse res = auth.currentUser("local", "local");

        assertThat(res.role()).isEqualTo("user");
        assertThat(res.displayName()).isEqualTo("local");
    }

    @Test
    void requireAdminThrowsForNonAdmin() {
        AuthService auth = withInviteCode("");
        when(userService.isAdmin("u2")).thenReturn(false);
        assertThatThrownBy(() -> auth.requireAdmin("u2"))
                .isInstanceOf(ForbiddenException.class)
                .hasMessage("需要管理员权限");

        when(userService.isAdmin("u1")).thenReturn(true);
        auth.requireAdmin("u1"); // no throw
    }

    @Test
    void inviteCodeGetReportsConfiguredPutRotatesActive() {
        AuthService auth = withInviteCode("ORIGINAL");
        assertThat(auth.configuredInviteCode()).isEqualTo("ORIGINAL");

        // Rotating the active code changes registration validation but not the reported one.
        assertThat(auth.updateInviteCode("NEW")).isEqualTo("NEW");
        assertThat(auth.configuredInviteCode()).isEqualTo("ORIGINAL");
        when(userService.createUser("x", "x", "pw")).thenReturn(user("user"));
        assertThatThrownBy(() -> auth.register("x", "x", "pw", "ORIGINAL"))
                .isInstanceOf(ForbiddenException.class);
        assertThat(auth.register("x", "x", "pw", "NEW")).isNotNull();
    }
}
