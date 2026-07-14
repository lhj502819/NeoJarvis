package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.RecipeRow;
import com.jarvis.domain.SubTask;
import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.domain.TaskRow;
import com.jarvis.mapper.ArtifactMapper;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.mapper.SubtaskTurnMapper;
import com.jarvis.mapper.TaskMapper;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class TaskServiceTest {

    private TaskMapper taskMapper;
    private SubtaskMapper subtaskMapper;
    private RecipeMapper recipeMapper;
    private SubtaskTurnMapper turnMapper;
    private ArtifactMapper artifactMapper;
    private TaskService service;

    @BeforeEach
    void setUp() {
        taskMapper = Mockito.mock(TaskMapper.class);
        subtaskMapper = Mockito.mock(SubtaskMapper.class);
        recipeMapper = Mockito.mock(RecipeMapper.class);
        turnMapper = Mockito.mock(SubtaskTurnMapper.class);
        artifactMapper = Mockito.mock(ArtifactMapper.class);
        service = new TaskService(taskMapper, subtaskMapper, recipeMapper, turnMapper, artifactMapper);
        // default: no turns / no artifacts unless a test overrides
        when(turnMapper.listBySubtask(any())).thenReturn(List.of());
        when(artifactMapper.listSummaryByTask(any(), any())).thenReturn(List.of());
    }

    @Test
    void subtaskTaggedPermanentWhenAssigneeHitsRecipe() {
        // Given: a subtask assigned to a recipe id that exists
        when(taskMapper.listByUser("local")).thenReturn(List.of(taskRow("t1")));
        when(subtaskMapper.listByTask("t1")).thenReturn(List.of(subRow("s1", "r1", "[\"d1\"]")));
        when(recipeMapper.findByIds(List.of("r1")))
                .thenReturn(List.of(recipeRow("r1", "Researcher")));

        // When
        SubTask st = service.listTasks("local", null).get(0).subtasks().get(0);

        // Then: permanent + recipe name, and depends_on parsed to a list
        assertThat(st.agentType()).isEqualTo("permanent");
        assertThat(st.agentName()).isEqualTo("Researcher");
        assertThat(st.dependsOn()).containsExactly("d1");
    }

    @Test
    void subtaskTaggedAdhocWhenAssigneeHasNoRecipe() {
        // Given: assignee not present in recipe table
        when(taskMapper.listByUser("local")).thenReturn(List.of(taskRow("t1")));
        when(subtaskMapper.listByTask("t1")).thenReturn(List.of(subRow("s1", "temp-worker", null)));
        when(recipeMapper.findByIds(List.of("temp-worker"))).thenReturn(List.of());

        // When
        SubTask st = service.listTasks("local", null).get(0).subtasks().get(0);

        // Then: adhoc + raw assignee name; null depends_on omitted
        assertThat(st.agentType()).isEqualTo("adhoc");
        assertThat(st.agentName()).isEqualTo("temp-worker");
        assertThat(st.dependsOn()).isNull();
    }

    @Test
    void getTaskSummaryHandlesEmptyAndNoActive() {
        // No tasks at all -> operates on the passed list, no DB access
        assertThat(service.getTaskSummary(List.of())).isEqualTo("当前没有任何任务。");

        // Tasks exist but all terminal -> "no active"
        Task completed = new Task("t1", "task-t1", "desc", "completed", null,
                List.of(), null, null, "2026-07-14", "2026-07-14");
        assertThat(service.getTaskSummary(List.of(completed))).isEqualTo("当前没有活跃任务。");
    }

    @Test
    void listTasksUsesSinceQueryWhenSincePresent() {
        // Given a non-blank since value
        when(taskMapper.listByUserSince("local", "2026-07-14T00:00:00Z"))
                .thenReturn(List.of(taskRow("t2")));
        when(subtaskMapper.listByTask("t2")).thenReturn(List.of());

        // When
        List<Task> tasks = service.listTasks("local", "2026-07-14T00:00:00Z");

        // Then: incremental query used, full-list query never touched
        assertThat(tasks).extracting(Task::id).containsExactly("t2");
        verify(taskMapper).listByUserSince("local", "2026-07-14T00:00:00Z");
        verify(taskMapper, never()).listByUser(any());
    }

    @Test
    void listTasksFallsBackToFullListWhenSinceBlank() {
        // Given a blank since string (empty) -> should fall through to the full list
        when(taskMapper.listByUser("local")).thenReturn(List.of(taskRow("t1")));
        when(subtaskMapper.listByTask("t1")).thenReturn(List.of());

        // When
        List<Task> tasks = service.listTasks("local", "");

        // Then: full-list query used, incremental query never touched
        assertThat(tasks).extracting(Task::id).containsExactly("t1");
        verify(taskMapper).listByUser("local");
        verify(taskMapper, never()).listByUserSince(any(), any());
    }

    @Test
    void summaryDerivesFromSinceFilteredListNotFullScan() {
        // Given: full list has t1 (active) but the since-filtered slice only has t2 (active)
        when(taskMapper.listByUserSince("local", "since1")).thenReturn(List.of(taskRow("t2")));
        when(subtaskMapper.listByTask("t2")).thenReturn(List.of());

        // When: summary is built from the same list the caller loaded (CRITICAL-2)
        List<Task> filtered = service.listTasks("local", "since1");
        String summary = service.getTaskSummary(filtered);

        // Then: summary describes only the filtered task, and no full-scan query was issued
        assertThat(summary).contains("task-t2").doesNotContain("task-t1");
        verify(taskMapper, never()).listByUser(eq("local"));
    }

    @Test
    void getTaskDetailEmptyWhenMissing() {
        when(taskMapper.findByIdAndUser("nope", "local")).thenReturn(Optional.empty());
        assertThat(service.getTaskDetail("local", "nope")).isEmpty();
    }

    @Test
    void getTaskDetailAssemblesTurnsAndNullConversation() {
        when(taskMapper.findByIdAndUser("t1", "local")).thenReturn(Optional.of(taskRow("t1")));
        when(subtaskMapper.listByTask("t1")).thenReturn(List.of(subRow("s1", "r1", null)));
        when(recipeMapper.findByIds(List.of("r1"))).thenReturn(List.of(recipeRow("r1", "R")));

        TaskDetail detail = service.getTaskDetail("local", "t1").orElseThrow();

        assertThat(detail.task().id()).isEqualTo("t1");
        assertThat(detail.turnsBySubtask()).containsKey("s1");
        assertThat(detail.messagesBySubtask().get("s1")).isEmpty();
        assertThat(detail.conversation()).isNull();
    }

    // ─── fixtures ───

    private static TaskRow taskRow(String id) {
        return taskRow(id, "executing");
    }

    private static TaskRow taskRow(String id, String status) {
        return new TaskRow(id, "task-" + id, "desc", status, null, null, null,
                "2026-07-14", "2026-07-14");
    }

    private static SubTaskRow subRow(String id, String assignee, String dependsOn) {
        return new SubTaskRow(id, "t1", "sub", "desc", assignee, null, null, "pending",
                null, null, null, null, dependsOn, null, null, null, null, null,
                "2026-07-14", "2026-07-14");
    }

    private static RecipeRow recipeRow(String id, String name) {
        return new RecipeRow(id, name, "d", "sp", "[]", "sonnet", "{}", 1, 0, "jarvis",
                "2026-07-14", "", "[]");
    }
}
