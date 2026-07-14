package com.jarvis.auth;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class JwtAuthFilterTest {

    private final JwtService jwt = new JwtService("filter-test-secret-abcdefghijklmnop");

    @AfterEach
    void cleanup() {
        UserContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void validTokenBindsThatUserDuringRequestAndClearsAfter() throws Exception {
        // Given: a request carrying a valid token cookie
        JwtAuthFilter filter = new JwtAuthFilter(jwt, false);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(JwtService.COOKIE_NAME, jwt.sign("u-7", "carol")));
        String[] seen = new String[2];

        // When: the filter runs, the chain observes the bound principal
        FilterChain chain = (req, res) -> {
            seen[0] = UserContext.currentUserId();
            seen[1] = UserContext.currentUsername();
            assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        };
        filter.doFilterInternal(request, new MockHttpServletResponse(), chain);

        // Then: bound during the request, cleared afterwards
        assertThat(seen).containsExactly("u-7", "carol");
        assertThat(UserContext.isAuthenticated()).isFalse();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void devBypassInjectsLocalWhenNoToken() throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter(jwt, true);
        String[] seen = new String[1];

        filter.doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(),
                (req, res) -> seen[0] = UserContext.currentUserId());

        assertThat(seen[0]).isEqualTo(UserContext.LOCAL_USER);
        assertThat(UserContext.isAuthenticated()).isFalse(); // cleared in finally
    }

    @Test
    void noBypassLeavesRequestAnonymousWhenNoToken() throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter(jwt, false);
        boolean[] authenticatedDuring = {true};

        filter.doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(),
                (req, res) -> authenticatedDuring[0] = UserContext.isAuthenticated());

        assertThat(authenticatedDuring[0]).isFalse();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void invalidTokenWithBypassFallsBackToLocal() throws Exception {
        JwtAuthFilter filter = new JwtAuthFilter(jwt, true);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(JwtService.COOKIE_NAME, "garbage.token.value"));
        String[] seen = new String[1];

        filter.doFilterInternal(request, new MockHttpServletResponse(),
                (req, res) -> seen[0] = UserContext.currentUserId());

        assertThat(seen[0]).isEqualTo(UserContext.LOCAL_USER);
    }

    @Test
    void threadLocalClearedEvenWhenChainThrows() {
        JwtAuthFilter filter = new JwtAuthFilter(jwt, true);
        FilterChain boom = (req, res) -> {
            throw new RuntimeException("downstream failure");
        };

        try {
            filter.doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(), boom);
        } catch (Exception ignored) {
            // expected
        }

        assertThat(UserContext.isAuthenticated()).isFalse();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }
}
