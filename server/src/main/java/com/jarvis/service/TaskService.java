package com.jarvis.service;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.ArtifactSummary;
import com.jarvis.domain.RecipeRow;
import com.jarvis.domain.SubTask;
import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubTaskTurn;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.domain.TaskRow;
import com.jarvis.mapper.ArtifactMapper;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.mapper.SubtaskTurnMapper;
import com.jarvis.mapper.TaskMapper;
import com.jarvis.util.Json;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Task read model. Ports src/task/manager.ts: assembles API tasks (rows + subtasks +
 * permanent/adhoc identity), the active-task summary string, and the full task detail.
 */
@Service
public class TaskService {

    private static final Logger log = LoggerFactory.getLogger(TaskService.class);
    private static final Set<String> TERMINAL = Set.of("completed", "failed", "cancelled");

    private final TaskMapper taskMapper;
    private final SubtaskMapper subtaskMapper;
    private final RecipeMapper recipeMapper;
    private final SubtaskTurnMapper turnMapper;
    private final ArtifactMapper artifactMapper;

    public TaskService(TaskMapper taskMapper, SubtaskMapper subtaskMapper, RecipeMapper recipeMapper,
            SubtaskTurnMapper turnMapper, ArtifactMapper artifactMapper) {
        this.taskMapper = taskMapper;
        this.subtaskMapper = subtaskMapper;
        this.recipeMapper = recipeMapper;
        this.turnMapper = turnMapper;
        this.artifactMapper = artifactMapper;
    }

    @Transactional(readOnly = true)
    public List<Task> listTasks(String userId, String since) {
        log.debug("list_tasks userId={} since={}", userId, since);
        List<TaskRow> rows = (since == null || since.isBlank())
                ? taskMapper.listByUser(userId)
                : taskMapper.listByUserSince(userId, since);
        return rows.stream().map(this::assembleTask).toList();
    }

    /**
     * Active-task overview string (mirrors TS getTaskSummary). Operates on an already-loaded
     * task list rather than re-querying, so the summary and the returned tasks describe the
     * SAME set (e.g. both honour the {@code since} filter). Pure text assembly, no DB access.
     */
    public String getTaskSummary(List<Task> tasks) {
        if (tasks.isEmpty()) {
            return "当前没有任何任务。";
        }
        String body = tasks.stream()
                .filter(t -> !TERMINAL.contains(t.status()))
                .map(this::summariseTask)
                .collect(Collectors.joining("\n\n"));
        return body.isEmpty() ? "当前没有活跃任务。" : body;
    }

    @Transactional(readOnly = true)
    public Optional<TaskDetail> getTaskDetail(String userId, String taskId) {
        return taskMapper.findByIdAndUser(taskId, userId).map(row -> {
            Task task = assembleTask(row);

            Map<String, List<SubTaskTurn>> turnsBySubtask = new LinkedHashMap<>();
            Map<String, List<Object>> messagesBySubtask = new LinkedHashMap<>();
            for (SubTask st : task.subtasks()) {
                turnsBySubtask.put(st.id(), turnMapper.listBySubtask(st.id()));
                // A2 has no A2A bus yet — mirror TS empty-conversation branch.
                messagesBySubtask.put(st.id(), List.of());
            }

            List<ArtifactSummary> artifacts = artifactMapper.listSummaryByTask(taskId, userId);
            return new TaskDetail(task, turnsBySubtask, messagesBySubtask, null, artifacts);
        });
    }

    // ─── assembly helpers ───

    private Task assembleTask(TaskRow row) {
        List<SubTask> subtasks = loadSubTasks(row.id());
        return new Task(row.id(), row.name(), row.description(), row.status(), row.plan(),
                subtasks, row.result(), row.error(), row.createdAt(), row.updatedAt());
    }

    /** Load subtasks and tag each with permanent/adhoc identity (mirrors TS loadSubTasks). */
    private List<SubTask> loadSubTasks(String taskId) {
        List<SubTaskRow> rows = subtaskMapper.listByTask(taskId);
        Map<String, String> recipeNames = resolveRecipeNames(rows);
        return rows.stream().map(r -> toSubTask(r, recipeNames)).toList();
    }

    private Map<String, String> resolveRecipeNames(List<SubTaskRow> rows) {
        List<String> assignees = rows.stream().map(SubTaskRow::assignee)
                .filter(a -> a != null && !a.isBlank()).distinct().toList();
        if (assignees.isEmpty()) {
            return Map.of();
        }
        return recipeMapper.findByIds(assignees).stream()
                .collect(Collectors.toMap(RecipeRow::id, RecipeRow::name, (a, b) -> a));
    }

    private SubTask toSubTask(SubTaskRow r, Map<String, String> recipeNames) {
        boolean permanent = recipeNames.containsKey(r.assignee());
        return new SubTask(
                r.id(), r.taskId(), r.name(), r.description(), r.assignee(),
                blankToNull(r.domain()), blankToNull(r.cwd()), r.status(),
                blankToNull(r.progress()), blankToNull(r.result()), blankToNull(r.error()),
                blankToNull(r.blockedReason()), Json.stringListOrNull(r.dependsOn()),
                blankToNull(r.startedAt()), r.turnCount(), r.retryCount(),
                r.tokensInput(), r.tokensOutput(), r.createdAt(), r.updatedAt(),
                permanent ? "permanent" : "adhoc",
                permanent ? recipeNames.get(r.assignee()) : r.assignee());
    }

    /** Reproduce the multi-line block TS getTaskSummary builds per active task. */
    private String summariseTask(Task t) {
        String subtaskLines = t.subtasks().stream().map(st -> {
            boolean canMessage = "running".equals(st.status()) || "input-required".equals(st.status());
            String idPart = canMessage ? " (subtaskId: " + st.id() + ")" : "";
            String progress = st.progress() != null ? " " + st.progress() : "";
            return "  - " + st.name() + " [" + st.status() + "]" + idPart + progress;
        }).collect(Collectors.joining("\n"));
        return "[" + t.status() + "] " + t.name() + " (id: " + t.id() + ")\n  "
                + t.description() + "\n" + subtaskLines;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isEmpty()) ? null : s;
    }
}
