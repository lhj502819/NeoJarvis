package com.jarvis.service;

import com.jarvis.domain.AuthResponse;
import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
import com.jarvis.web.ForbiddenException;
import com.jarvis.web.NotFoundException;
import com.jarvis.web.UnauthorizedException;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Registration / login / current-user orchestration. Ports src/auth/auth.ts.
 *
 * <p>Invite code: seeded from {@code jarvis.auth.invite-code} (env {@code INVITE_CODE},
 * default empty = open registration). Registration is gated only when a non-empty code is
 * active. Mirroring the TS quirk, admins can rotate the *active* code at runtime while the
 * admin GET still reports the originally configured one.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserService userService;
    private final String initialInviteCode;
    private volatile String currentInviteCode;

    public AuthService(UserService userService,
            @Value("${jarvis.auth.invite-code:}") String inviteCode) {
        this.userService = userService;
        this.initialInviteCode = inviteCode == null ? "" : inviteCode;
        this.currentInviteCode = this.initialInviteCode;
    }

    /** Create a user after checking the invite code; caller signs the JWT from the result. */
    public AuthResponse register(String username, String displayName, String password,
            String inviteCode) {
        if (!currentInviteCode.isEmpty() && !currentInviteCode.equals(inviteCode)) {
            throw new ForbiddenException("邀请码无效");
        }
        String name = (displayName == null || displayName.isBlank()) ? username : displayName;
        UserRow user = userService.createUser(username, name, password);
        return toResponse(user);
    }

    /** Validate credentials; {@link UnauthorizedException} on unknown user or bad password. */
    public AuthResponse login(String username, String password) {
        UserRow user = userService.findByUsername(username)
                .filter(u -> userService.validatePassword(u, password))
                .orElseThrow(() -> new UnauthorizedException("用户名或密码错误"));
        log.info("login username={} userId={}", username, user.id());
        return toResponse(user);
    }

    /** Resolve the current authenticated user for {@code /me} (role from DB, fallback user). */
    public AuthResponse currentUser(String userId, String username) {
        Optional<UserRow> user = userService.findById(userId);
        String role = user.map(UserRow::role).orElse("user");
        String displayName = user.map(UserRow::displayName).orElse(username);
        return new AuthResponse(userId, username, displayName, role);
    }

    // ─── admin operations (ported from auth.ts /admin routes) ───

    /** Guard for admin-only routes: {@link ForbiddenException} unless the user is an admin. */
    public void requireAdmin(String userId) {
        if (!userService.isAdmin(userId)) {
            throw new ForbiddenException("需要管理员权限");
        }
    }

    public List<User> listUsers() {
        return userService.listUsers();
    }

    public void deleteUser(String userId) {
        if (!userService.deleteUser(userId)) {
            throw new NotFoundException("用户不存在");
        }
    }

    /** GET reports the originally configured code (matches the TS admin route). */
    public String configuredInviteCode() {
        return initialInviteCode;
    }

    /** PUT rotates the active code used for registration validation. */
    public String updateInviteCode(String code) {
        this.currentInviteCode = code == null ? "" : code;
        return this.currentInviteCode;
    }

    private static AuthResponse toResponse(UserRow user) {
        return new AuthResponse(user.id(), user.username(), user.displayName(), user.role());
    }
}
