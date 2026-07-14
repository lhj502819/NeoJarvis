package com.jarvis.web;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.SubTask;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.service.TaskService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(TaskController.class)
class TaskControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private TaskService taskService;

    @Test
    void tasksReturnsSummaryAndTasksShape() throws Exception {
        SubTask st = new SubTask("s1", "t1", "sub", "d", "r1", null, null, "running", null, null,
                null, null, null, null, null, null, null, null, "2026-07-14", "2026-07-14",
                "permanent", "Researcher");
        Task task = new Task("t1", "Task One", "d", "executing", null, List.of(st), null, null,
                "2026-07-14", "2026-07-14");
        when(taskService.getTaskSummary(anyList())).thenReturn("some summary");
        when(taskService.listTasks(eq("local"), eq(null))).thenReturn(List.of(task));

        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary").value("some summary"))
                .andExpect(jsonPath("$.tasks[0].id").value("t1"))
                .andExpect(jsonPath("$.tasks[0].subtasks[0].agentType").value("permanent"))
                .andExpect(jsonPath("$.tasks[0].subtasks[0].agentName").value("Researcher"));
    }

    @Test
    void tasksEmptyList() throws Exception {
        when(taskService.getTaskSummary(anyList())).thenReturn("当前没有任何任务。");
        when(taskService.listTasks(eq("local"), eq(null))).thenReturn(List.of());

        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tasks").isArray())
                .andExpect(jsonPath("$.tasks").isEmpty());
    }

    @Test
    void taskDetailReturns200WhenPresent() throws Exception {
        Task task = new Task("t1", "Task One", "d", "executing", null, List.of(), null, null,
                "2026-07-14", "2026-07-14");
        TaskDetail detail = new TaskDetail(task, Map.of(), Map.of(), null, List.of());
        when(taskService.getTaskDetail("local", "t1")).thenReturn(Optional.of(detail));

        mockMvc.perform(get("/api/task/t1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.task.id").value("t1"))
                .andExpect(jsonPath("$.turnsBySubtask").exists())
                .andExpect(jsonPath("$.artifacts").isArray());
    }

    @Test
    void taskDetailReturns404WhenMissing() throws Exception {
        when(taskService.getTaskDetail("local", "nope")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/task/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("任务不存在"));
    }
}
