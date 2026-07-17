package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.SubTask;
import com.jarvis.domain.SubTaskTurn;
import com.jarvis.domain.SubtaskFullHistory;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.service.SubtaskHistoryService;
import com.jarvis.service.TaskService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(TaskController.class)
class TaskControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private TaskService taskService;
    @MockBean
    private SubtaskHistoryService subtaskHistoryService;

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

    @Test
    void createTaskReturnsCreatedTask() throws Exception {
        Task task = new Task("abc12345", "hello", "d", "created", null, List.of(), null, null,
                "2026-07-15", "2026-07-15");
        when(taskService.createTask(eq("local"), any())).thenReturn(task);

        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"hello\",\"description\":\"d\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("abc12345"))
                .andExpect(jsonPath("$.status").value("created"));
    }

    @Test
    void createTaskRejectsBlankName() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"description\":\"d\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateTaskReturnsUpdatedTask() throws Exception {
        Task task = new Task("t1", "T", "d", "completed", null, List.of(), "done", null,
                "2026-07-15", "2026-07-15");
        when(taskService.updateTask(eq("local"), eq("t1"), any())).thenReturn(task);

        mockMvc.perform(patch("/api/task/t1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"completed\",\"result\":\"done\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"))
                .andExpect(jsonPath("$.result").value("done"));
    }

    @Test
    void addSubTaskReturnsSubTask() throws Exception {
        SubTask st = new SubTask("s1", "t1", "sub", "d", "worker-a", null, null, "pending", null,
                null, null, null, null, null, null, null, null, null, "2026-07-15", "2026-07-15",
                "adhoc", "worker-a");
        when(taskService.addSubTask(eq("local"), eq("t1"), any())).thenReturn(st);

        mockMvc.perform(post("/api/task/t1/subtasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"sub\",\"description\":\"d\",\"assignee\":\"worker-a\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("s1"))
                .andExpect(jsonPath("$.status").value("pending"));
    }

    @Test
    void updateSubTaskReturnsSubTask() throws Exception {
        SubTask st = new SubTask("s1", "t1", "sub", "d", "worker-a", null, null, "running", "50%",
                null, null, null, null, null, null, null, null, null, "2026-07-15", "2026-07-15",
                "adhoc", "worker-a");
        when(taskService.updateSubTask(eq("local"), eq("s1"), any())).thenReturn(st);

        mockMvc.perform(patch("/api/subtask/s1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"running\",\"progress\":\"50%\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("running"));
    }

    @Test
    void setSubtaskStartedReturnsOk() throws Exception {
        mockMvc.perform(patch("/api/subtask/s1/started").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startedAt\":\"2026-07-15T00:00:00Z\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(taskService).setSubtaskStarted("s1", "2026-07-15T00:00:00Z");
    }

    @Test
    void getSubtaskTurnsReturnsArray() throws Exception {
        SubTaskTurn turn = new SubTaskTurn("tn1", "s1", 1, "body", "2026-07-15", null, "2026-07-15");
        when(taskService.getSubtaskTurns("s1")).thenReturn(List.of(turn));

        mockMvc.perform(get("/api/subtask/s1/turns"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("tn1"))
                .andExpect(jsonPath("$[0].turnIndex").value(1));
    }

    @Test
    void recordTurnReturnsOk() throws Exception {
        mockMvc.perform(post("/api/subtask/s1/turns").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"turnIndex\":2,\"text\":\"body\",\"startedAt\":\"s\",\"endedAt\":\"e\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(taskService).recordTurn(eq("s1"), any());
    }

    @Test
    void finalizeSubtaskMetaReturnsOk() throws Exception {
        mockMvc.perform(patch("/api/subtask/s1/meta").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"turnCount\":3,\"retryCount\":0,\"tokensInput\":100,\"tokensOutput\":200}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(taskService).finalizeSubtaskMeta(eq("s1"), any());
    }

    @Test
    void cleanupStaleReturnsOk() throws Exception {
        mockMvc.perform(post("/api/tasks/cleanup-stale"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(taskService).cleanupStaleTasks("local");
    }

    @Test
    void fullHistoryReturnsAggregatedShape() throws Exception {
        when(subtaskHistoryService.getFullHistory("local", "s1")).thenReturn(
                new SubtaskFullHistory("s1", "t1", "数 md 文件", List.of(), List.of(), List.of()));

        mockMvc.perform(get("/api/subtask/s1/full-history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subtaskId").value("s1"))
                .andExpect(jsonPath("$.taskId").value("t1"))
                .andExpect(jsonPath("$.description").value("数 md 文件"));
    }
}
