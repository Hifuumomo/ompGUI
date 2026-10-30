import { describe, expect, it } from "vitest";
import { parseJobsOutput } from "./jobs-output";

// 本机 omp 实测 /jobs 输出（3 个并行后台 bash）。
const threeJobs = [
  "Background Jobs",
  "Running: 3",
  "",
  "```text",
  "[bg_1] bash (running) — 14s",
  `  eval 'for i in $(seq 1 60); do echo "tick $i"; sleep 2; done'`,
  "[bg_2] bash (running) — 11s",
  `  eval 'for i in $(seq 1 60); do echo "build step $i"; sleep 3; done'`,
  "[bg_3] bash (running) — 9s",
  "  sleep 200",
  "```",
].join("\n");

describe("parseJobsOutput", () => {
  it("把每个任务头与其命令拆成独立条目", () => {
    const report = parseJobsOutput(threeJobs);
    expect(report.running).toBe(3);
    expect(report.entries).toEqual([
      {
        kind: "job",
        id: "bg_1",
        type: "bash",
        status: "running",
        duration: "14s",
        depth: 0,
        command: `eval 'for i in $(seq 1 60); do echo "tick $i"; sleep 2; done'`,
      },
      expect.objectContaining({ id: "bg_2", duration: "11s" }),
      expect.objectContaining({ id: "bg_3", command: "sleep 200" }),
    ]);
  });

  it("full 模式多行命令保留自身缩进，去除颜色控制序列", () => {
    const report = parseJobsOutput(
      [
        "\u001b[1mBackground Jobs\u001b[22m",
        "Running: 1",
        "",
        "```text",
        "[bg_4] bash (running) — 2m",
        "  for f in *.ts; do",
        "    echo $f",
        "  done",
        "```",
      ].join("\n"),
    );
    expect(report.entries[0]).toMatchObject({
      id: "bg_4",
      duration: "2m",
      command: "for f in *.ts; do\n  echo $f\ndone",
    });
  });

  it("子代理分组与嵌套任务按树结构解析，含反引号的命令使用加长围栏", () => {
    const report = parseJobsOutput(
      [
        "Background Jobs",
        "Running: 2",
        "",
        "````text",
        "Reviewer",
        "├─ [bg_7] task (running) — 40s Reviewer",
        "│    review ```diff``` output",
        "└─ [bg_8] bash (completed) — 5s",
        "     npm test",
        "````",
      ].join("\n"),
    );
    expect(report.entries).toEqual([
      { kind: "agent", id: "Reviewer", depth: 0 },
      expect.objectContaining({
        id: "bg_7",
        type: "task",
        agent: "Reviewer",
        depth: 3,
        command: "review ```diff``` output",
      }),
      expect.objectContaining({ id: "bg_8", status: "completed", command: "npm test" }),
    ]);
  });

  it("无任务列表的原生文本保留为消息", () => {
    const report = parseJobsOutput("No background jobs running.");
    expect(report).toEqual({ entries: [], message: "No background jobs running." });
  });
});
