package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.InviteCodeRequest;
import com.jarvis.domain.InviteCodeResponse;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.UsersResponse;
import com.jarvis.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin-only user management (ports the auth.ts /admin routes). Every handler first calls
 * {@link AuthService#requireAdmin} on the filter-resolved current user (403 otherwise).
 * The GET invite-code reports the configured code; PUT rotates the active one.
 */
@RestController
@RequestMapping("/api/admin")
class AdminController {

    private final AuthService authService;

    AdminController(AuthService authService) {
        this.authService = authService;
    }

    /** GET /api/admin/users — redacted user list. */
    @GetMapping("/users")
    UsersResponse listUsers() {
        authService.requireAdmin(UserContext.currentUserId());
        return new UsersResponse(authService.listUsers());
    }

    /** DELETE /api/admin/users/{userId} — {@code {ok:true}}; 404 missing, 400 for admins. */
    @DeleteMapping("/users/{userId}")
    OkResponse deleteUser(@PathVariable String userId) {
        authService.requireAdmin(UserContext.currentUserId());
        authService.deleteUser(userId);
        return new OkResponse(true);
    }

    /** GET /api/admin/invite-code — the configured code (empty shown as a hint). */
    @GetMapping("/invite-code")
    InviteCodeResponse getInviteCode() {
        authService.requireAdmin(UserContext.currentUserId());
        String code = authService.configuredInviteCode();
        return new InviteCodeResponse(code.isEmpty() ? "(未设置，任何人可注册)" : code);
    }

    /** PUT /api/admin/invite-code — rotate the active code (empty closes registration). */
    @PutMapping("/invite-code")
    InviteCodeResponse updateInviteCode(@Valid @RequestBody InviteCodeRequest request) {
        authService.requireAdmin(UserContext.currentUserId());
        String updated = authService.updateInviteCode(request.code());
        return new InviteCodeResponse(updated.isEmpty() ? "(已关闭邀请码)" : updated);
    }
}
