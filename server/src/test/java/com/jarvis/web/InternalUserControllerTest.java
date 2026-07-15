package com.jarvis.web;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
import com.jarvis.service.UserService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(InternalUserController.class)
class InternalUserControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private UserService userService;

    private static UserRow row() {
        return new UserRow("u1", "alice", "Alice", "hash", "salt", "admin", "2026-07-15T00:00:00Z");
    }

    @Test
    void createReturnsFullRowIncludingHashAndSalt() throws Exception {
        when(userService.createUser("alice", "Alice", "pw")).thenReturn(row());

        mockMvc.perform(post("/api/internal/users").contentType("application/json")
                        .content("{\"username\":\"alice\",\"displayName\":\"Alice\",\"password\":\"pw\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("u1"))
                .andExpect(jsonPath("$.passwordHash").value("hash"))
                .andExpect(jsonPath("$.salt").value("salt"));
    }

    @Test
    void createDefaultsDisplayNameToUsername() throws Exception {
        when(userService.createUser("bob", "bob", "pw")).thenReturn(
                new UserRow("u2", "bob", "bob", "h", "s", "user", "2026-07-15T00:00:00Z"));

        mockMvc.perform(post("/api/internal/users").contentType("application/json")
                        .content("{\"username\":\"bob\",\"password\":\"pw\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("bob"));
    }

    @Test
    void createRejectsBlankUsername() throws Exception {
        mockMvc.perform(post("/api/internal/users").contentType("application/json")
                        .content("{\"username\":\"\",\"password\":\"pw\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void byUsernameReturnsFullRow() throws Exception {
        when(userService.findByUsername("alice")).thenReturn(Optional.of(row()));

        mockMvc.perform(get("/api/internal/users/by-username").param("username", "alice"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.passwordHash").value("hash"));
    }

    @Test
    void byUsernameMissingReturns404() throws Exception {
        when(userService.findByUsername("ghost")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/internal/users/by-username").param("username", "ghost"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("用户不存在"));
    }

    @Test
    void byIdReturnsFullRow() throws Exception {
        when(userService.findById("u1")).thenReturn(Optional.of(row()));

        mockMvc.perform(get("/api/internal/users/u1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("admin"));
    }

    @Test
    void byIdMissingReturns404() throws Exception {
        when(userService.findById("gone")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/internal/users/gone"))
                .andExpect(status().isNotFound());
    }

    @Test
    void listReturnsRedactedUsers() throws Exception {
        when(userService.listUsers()).thenReturn(List.of(
                new User("u1", "alice", "Alice", "admin", "2026-07-15T00:00:00Z")));

        mockMvc.perform(get("/api/internal/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].username").value("alice"))
                .andExpect(jsonPath("$[0].passwordHash").doesNotExist());
    }

    @Test
    void deleteReturnsOk() throws Exception {
        when(userService.deleteUser("u2")).thenReturn(true);

        mockMvc.perform(delete("/api/internal/users/u2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void deleteMissingReturns404() throws Exception {
        when(userService.deleteUser("gone")).thenReturn(false);

        mockMvc.perform(delete("/api/internal/users/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("用户不存在"));
    }

    @Test
    void deleteAdminReturns400() throws Exception {
        doThrow(new BadRequestException("不能删除管理员")).when(userService).deleteUser(anyString());

        mockMvc.perform(delete("/api/internal/users/u1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("不能删除管理员"));
    }
}
