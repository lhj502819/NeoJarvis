package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.domain.TasksResponse;
import com.jarvis.service.TaskService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class TaskController {

    private final TaskService taskService;

    TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    /** GET /api/tasks — {@code { summary, tasks }} (mirrors TS dashboard /tasks). */
    @GetMapping("/tasks")
    TasksResponse tasks(@RequestParam(required = false) String since) {
        String userId = UserContext.currentUserId();
        // Load once (honouring since) and derive the summary from that same list, so summary
        // and tasks always describe the same set — no second full scan, no drift (CRITICAL-2).
        List<Task> tasks = taskService.listTasks(userId, since);
        return new TasksResponse(taskService.getTaskSummary(tasks), tasks);
    }

    /** GET /api/task/{taskId} — full detail, 404 {@code {error:"任务不存在"}} when missing. */
    @GetMapping("/task/{taskId}")
    TaskDetail taskDetail(@PathVariable String taskId) {
        return taskService.getTaskDetail(UserContext.currentUserId(), taskId)
                .orElseThrow(() -> new NotFoundException("任务不存在"));
    }
}
