package com.jarvis.web;

import com.jarvis.domain.InternalCreateUserRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
import com.jarvis.service.UserService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Internal user data-layer endpoints backing the TS intelligence layer's src/auth/users.ts.
 * These are the Plan C equivalent of the other {@code /api/*} data controllers: every TS
 * data function has a Java endpoint behind it. They are NOT browser-facing — trusted only
 * under dev-bypass via the {@code X-Internal-User} header (see {@link com.jarvis.auth.JwtAuthFilter}).
 *
 * <p>Unlike the public {@code /api/auth} + {@code /api/admin} routes, these carry no
 * invite-code or admin gating: that policy lives in the caller (auth.ts). {@code by-username}
 * and {@code /{id}} return the full {@link UserRow} (including {@code passwordHash} + {@code salt})
 * so the TS {@code validatePassword} can stay a synchronous local check without a signature
 * change; the list endpoint returns the redacted {@link User} view.
 */
@RestController
@RequestMapping("/api/internal/users")
class InternalUserController {

    private final UserService userService;

    InternalUserController(UserService userService) {
        this.userService = userService;
    }

    /** POST /api/internal/users — create a user (no invite gate); returns the full row. */
    @PostMapping
    UserRow create(@Valid @RequestBody InternalCreateUserRequest request) {
        String displayName = (request.displayName() == null || request.displayName().isBlank())
                ? request.username()
                : request.displayName();
        return userService.createUser(request.username(), displayName, request.password());
    }

    /** GET /api/internal/users/by-username?username= — full row for login; 404 when unknown. */
    @GetMapping("/by-username")
    UserRow byUsername(@RequestParam String username) {
        return userService.findByUsername(username)
                .orElseThrow(() -> new NotFoundException("用户不存在"));
    }

    /** GET /api/internal/users — redacted user list (mirrors listUsers()). */
    @GetMapping
    List<User> list() {
        return userService.listUsers();
    }

    /** GET /api/internal/users/{id} — full row for /me role + isAdmin; 404 when unknown. */
    @GetMapping("/{id}")
    UserRow byId(@PathVariable String id) {
        return userService.findById(id)
                .orElseThrow(() -> new NotFoundException("用户不存在"));
    }

    /** DELETE /api/internal/users/{id} — {@code {ok:true}}; 404 missing, 400 for admins. */
    @DeleteMapping("/{id}")
    OkResponse delete(@PathVariable String id) {
        if (!userService.deleteUser(id)) {
            throw new NotFoundException("用户不存在");
        }
        return new OkResponse(true);
    }
}
