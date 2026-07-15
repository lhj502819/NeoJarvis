package com.jarvis.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Resolves the request's user from the {@code jarvis_token} cookie and binds it to both
 * {@link UserContext} (for the service layer) and the Spring {@link SecurityContextHolder}
 * (for authorization). Ports src/auth/middleware.ts.
 *
 * <p>Dev bypass ({@code jarvis.auth.dev-bypass=true}, default on): when no valid token is
 * present, the request is resolved by (in priority order) an {@code X-Internal-User} header
 * — set by the TS intelligence layer's internal HTTP calls to carry the acting user id —
 * else {@link UserContext#LOCAL_USER}, so local runs and web-slice tests need no login.
 * With the flag off (prod), a missing/invalid token leaves the request anonymous and
 * {@code SecurityConfig} returns 401 for protected paths.
 *
 * <p>TODO(prod): {@code X-Internal-User} is trusted only under dev-bypass. A real
 * service-to-service auth scheme (shared secret / mTLS) is needed before honouring it in prod.
 *
 * <p>Both contexts are always cleared in {@code finally} to avoid leaking onto pooled
 * request threads.
 *
 * <p>Registered as a {@code @Bean} in {@code SecurityConfig} (not {@code @Component}) so
 * {@code @WebMvcTest} slices — which auto-include {@code Filter} beans — do not try to
 * instantiate it without its {@link JwtService} dependency.
 */
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final List<SimpleGrantedAuthority> AUTHORITIES =
            List.of(new SimpleGrantedAuthority("ROLE_USER"));

    /** Header carrying the acting user id on internal calls from the TS layer (dev-bypass only). */
    static final String INTERNAL_USER_HEADER = "X-Internal-User";

    private final JwtService jwtService;
    private final boolean devBypass;

    public JwtAuthFilter(JwtService jwtService,
            @Value("${jarvis.auth.dev-bypass:true}") boolean devBypass) {
        this.jwtService = jwtService;
        this.devBypass = devBypass;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        try {
            Optional<JwtService.TokenPayload> payload = readToken(request).flatMap(jwtService::verify);
            if (payload.isPresent()) {
                authenticate(payload.get().userId(), payload.get().username());
            } else if (devBypass) {
                // Internal TS calls forward the acting user via X-Internal-User; fall back to LOCAL_USER.
                String internalUser = request.getHeader(INTERNAL_USER_HEADER);
                if (internalUser != null && !internalUser.isBlank()) {
                    authenticate(internalUser, internalUser);
                } else {
                    authenticate(UserContext.LOCAL_USER, UserContext.LOCAL_USER);
                }
            }
            chain.doFilter(request, response);
        } finally {
            UserContext.clear();
            SecurityContextHolder.clearContext();
        }
    }

    private void authenticate(String userId, String username) {
        UserContext.set(userId, username);
        var auth = new UsernamePasswordAuthenticationToken(userId, null, AUTHORITIES);
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private Optional<String> readToken(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        for (Cookie cookie : cookies) {
            if (JwtService.COOKIE_NAME.equals(cookie.getName())) {
                return Optional.ofNullable(cookie.getValue());
            }
        }
        return Optional.empty();
    }
}
