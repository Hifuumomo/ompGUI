import { useId, useState } from "react";
import type { TodoPhase, TodoStatus } from "../../shared/todo";
import type { SessionSummary } from "../../shared/protocol";
import { RichContent } from "./RichContent";
import "./todo-panel.css";

const statusLabels: Record<TodoStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "受阻",
  abandoned: "已放弃",
};
const statusIcons: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "◉",
  completed: "✓",
  blocked: "!",
  abandoned: "−",
};

/** 输入框上方共用展开入口的 TODO 与 Recap；正文统一限高滚动。 */
export function TodoPanel({
  phases,
  recap,
}: {
  phases: TodoPhase[];
  recap?: SessionSummary["recap"];
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const tasks = phases.flatMap((phase) => phase.tasks);
  if (!tasks.length && !recap) return null;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const abandoned = tasks.filter((task) => task.status === "abandoned").length;
  const closed = completed + abandoned;
  const current =
    tasks.find((task) => task.status === "in_progress") ??
    tasks.find((task) => task.status === "blocked") ??
    tasks.find((task) => task.status === "pending");
  const progressText = abandoned
    ? `${closed}/${tasks.length} 已结束 · ${abandoned} 项已放弃`
    : `${completed}/${tasks.length} 已完成`;

  return (
    <section className="todo-panel" aria-label="TODO 与 Recap">
      <button
        className="todo-panel-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        {current?.status === "in_progress" ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">☷</span>
        )}
        <strong>TODO 与 Recap</strong>
        <span className="todo-current" title={current?.content}>
          {current
            ? `${statusLabels[current.status]}：${current.content}`
            : tasks.length ? "计划已结束" : "会话回顾"}
        </span>
        <span
          className="todo-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {tasks.length > 0 ? progressText : ""}
        </span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {tasks.length > 0 && (
        <progress
          className="todo-progress"
          aria-label="TODO 已结束任务进度"
          max={tasks.length}
          value={closed}
        />
      )}
      <div
        className="todo-list"
        id={listId}
        hidden={!expanded}
        tabIndex={0}
        role="group"
        aria-label="TODO 与 Recap 内容"
      >
        {tasks.length > 0 && <h3 className="context-section-title">TODO</h3>}
        {phases.map(
          (phase, phaseIndex) =>
            phase.tasks.length > 0 && (
              <div className="todo-phase" key={phaseIndex}>
                <div className="todo-phase-title">
                  <strong>{phase.name}</strong>
                  <span>
                    {
                      phase.tasks.filter(
                        (task) =>
                          task.status === "completed" ||
                          task.status === "abandoned",
                      ).length
                    }
                    /{phase.tasks.length}
                  </span>
                </div>
                <ul>
                  {phase.tasks.map((task, taskIndex) => (
                    <li
                      className={`todo-task todo-${task.status}`}
                      key={taskIndex}
                      aria-label={`${statusLabels[task.status]}：${task.content}`}
                    >
                      <span className="todo-icon" aria-hidden="true">
                        {task.status === "in_progress" ? (
                          <span className="spinner" />
                        ) : (
                          statusIcons[task.status]
                        )}
                      </span>
                      <div className="todo-task-text">
                        <span className="todo-task-content">
                          {task.content}
                        </span>
                        {task.blocker && (
                          <small>受阻原因：{task.blocker}</small>
                        )}
                      </div>
                      <span className="todo-task-status">
                        {statusLabels[task.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
        {tasks.length > 0 && recap && <hr className="context-divider" />}
        {recap && (
          <section className="session-recap" aria-label="Recap">
            <h3 className="context-section-title">
              Recap
              <time dateTime={new Date(recap.createdAt * 1000).toISOString()}>
                {new Date(recap.createdAt * 1000).toLocaleString("zh-CN")}
              </time>
            </h3>
            <RichContent text={recap.text} />
          </section>
        )}
      </div>
    </section>
  );
}
