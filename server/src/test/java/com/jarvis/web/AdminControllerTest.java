package com.jarvis.web;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.User;
import com.jarvis.service.AuthService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(AdminController.class)
class AdminControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private AuthService authService;

    @Test
    void listUsersReturnsRedactedUsersForAdmin() throws Exception {
        doNothing().when(authService).requireAdmin(anyString());
        when(authService.listUsers()).thenReturn(List.of(
                new User("u1", "alice", "Alice", "admin", "2026-07-14T00:00:00Z")));

        mockMvc.perform(get("/api/admin/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users[0].username").value("alice"))
                .andExpect(jsonPath("$.users[0].passwordHash").doesNotExist());
    }

    @Test
    void nonAdminIsForbidden() throws Exception {
        doThrow(new ForbiddenException("需要管理员权限")).when(authService).requireAdmin(anyString());

        mockMvc.perform(get("/api/admin/users"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("需要管理员权限"));
    }

    @Test
    void deleteMissingUserReturns404() throws Exception {
        doNothing().when(authService).requireAdmin(anyString());
        doThrow(new NotFoundException("用户不存在")).when(authService).deleteUser("gone");

        mockMvc.perform(delete("/api/admin/users/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("用户不存在"));
    }

    @Test
    void inviteCodeGetShowsHintWhenUnset() throws Exception {
        doNothing().when(authService).requireAdmin(anyString());
        when(authService.configuredInviteCode()).thenReturn("");

        mockMvc.perform(get("/api/admin/invite-code"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inviteCode").value("(未设置，任何人可注册)"));
    }

    @Test
    void inviteCodePutRotatesCode() throws Exception {
        doNothing().when(authService).requireAdmin(anyString());
        when(authService.updateInviteCode("NEW")).thenReturn("NEW");

        mockMvc.perform(put("/api/admin/invite-code").contentType("application/json")
                        .content("{\"code\":\"NEW\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inviteCode").value("NEW"));
    }
}
