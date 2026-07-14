package com.jarvis.config;

import com.jarvis.auth.JwtAuthFilter;
import com.jarvis.auth.JwtService;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * API security for the cookie-JWT scheme. Stateless (no server session), CSRF and the
 * default form login / http-basic disabled — auth is carried entirely by the
 * {@code jarvis_token} cookie parsed in {@link JwtAuthFilter}.
 *
 * <p>Public paths mirror the TS routes mounted before authMiddleware: health checks and
 * register/login/logout. Everything else under {@code /api/**} requires authentication;
 * with dev-bypass on, {@link JwtAuthFilter} injects the local user so those requests still
 * pass, and with it off an anonymous request hits {@link #unauthorizedEntryPoint()} → 401
 * {@code {"error":"未登录"}}.
 */
@Configuration
public class SecurityConfig {

    private final JwtService jwtService;
    private final boolean devBypass;

    public SecurityConfig(JwtService jwtService,
            @Value("${jarvis.auth.dev-bypass:true}") boolean devBypass) {
        this.jwtService = jwtService;
        this.devBypass = devBypass;
    }

    /** The cookie-JWT filter, wired here (not {@code @Component}) to keep it out of web slices. */
    @Bean
    JwtAuthFilter jwtAuthFilter() {
        return new JwtAuthFilter(jwtService, devBypass);
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/health", "/api/health/**",
                                "/api/auth/register", "/api/auth/login", "/api/auth/logout")
                        .permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint(unauthorizedEntryPoint()))
                .addFilterBefore(jwtAuthFilter(), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** 401 responder that matches the {@code {error:"..."}} body used across the API. */
    private AuthenticationEntryPoint unauthorizedEntryPoint() {
        return (request, response, authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"error\":\"未登录\"}");
        };
    }
}
