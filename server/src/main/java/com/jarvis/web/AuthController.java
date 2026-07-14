package com.jarvis.web;

import com.jarvis.auth.JwtService;
import com.jarvis.auth.UserContext;
import com.jarvis.domain.AuthResponse;
import com.jarvis.domain.LoginRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.RegisterRequest;
import com.jarvis.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Auth endpoints (ports src/auth/auth.ts). register/login sign a {@code jarvis_token}
 * cookie and return {@link AuthResponse}; me reads the user resolved by
 * {@link com.jarvis.auth.JwtAuthFilter} from {@link UserContext}; logout clears the cookie.
 * Errors flow through {@code GlobalExceptionHandler} as {@code {error:"..."}}.
 */
@RestController
@RequestMapping("/api/auth")
class AuthController {

    private final AuthService authService;
    private final JwtService jwtService;

    AuthController(AuthService authService, JwtService jwtService) {
        this.authService = authService;
        this.jwtService = jwtService;
    }

    /** POST /api/auth/register — create user, sign cookie, return the account. */
    @PostMapping("/register")
    ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        AuthResponse user = authService.register(request.username(), request.displayName(),
                request.password(), request.inviteCode());
        return withTokenCookie(user);
    }

    /** POST /api/auth/login — validate credentials, sign cookie; 401 on bad credentials. */
    @PostMapping("/login")
    ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        AuthResponse user = authService.login(request.username(), request.password());
        return withTokenCookie(user);
    }

    /** GET /api/auth/me — the current user (filter-resolved); 401 when unauthenticated. */
    @GetMapping("/me")
    AuthResponse me() {
        return authService.currentUser(UserContext.currentUserId(), UserContext.currentUsername());
    }

    /** POST /api/auth/logout — clear the token cookie. */
    @PostMapping("/logout")
    ResponseEntity<OkResponse> logout() {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, jwtService.buildClearCookie().toString())
                .body(new OkResponse(true));
    }

    private ResponseEntity<AuthResponse> withTokenCookie(AuthResponse user) {
        ResponseCookie cookie = jwtService.buildTokenCookie(
                jwtService.sign(user.userId(), user.username()));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(user);
    }
}
