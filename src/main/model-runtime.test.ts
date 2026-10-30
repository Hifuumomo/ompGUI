// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  request: vi.fn(),
  cycleRoleModel: vi.fn(),
  modelHub: vi.fn(),
  agentsHub: vi.fn(),
  seance: vi.fn(),
  ownsUIRequest: vi.fn(),
  respondUI: vi.fn(),
}));
vi.mock("./rpc", () => ({
  OmpRuntime: class {
    start = fake.start;
    stop = fake.stop;
    request = fake.request;
    cycleRoleModel = fake.cycleRoleModel;
    modelHub = fake.modelHub;
    agentsHub = fake.agentsHub;
    seance = fake.seance;
    ownsUIRequest = fake.ownsUIRequest;
    respondUI = fake.respondUI;
  },
}));
import { ModelRuntime, applyModelSelection } from "./model-runtime";
import { OmpRuntime } from "./rpc";

const options = {
  executable: "omp.exe",
  cwd: "D:/project",
  sessionPath: "D:/occupied.jsonl",
};
const selection = {
  provider: "test",
  modelId: "selected",
  thinkingLevel: "high",
};

it("代理管理走独立配置通道，不发送聊天 prompt", async () => {
  const models = new ModelRuntime(vi.fn());
  const action = { op: "list" };
  await models.request({ type: "agents_hub", action });
  expect(fake.agentsHub).toHaveBeenCalledExactlyOnceWith(action);
  expect(fake.request).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.resetAllMocks();
  fake.request.mockResolvedValue({
    model: { provider: "test", id: "selected", name: "模型" },
    thinkingLevel: "high",
  });
});

it("模型管理和登录走独立模型进程，UI响应不排在等待登录的队列后", async () => {
  const models = new ModelRuntime(vi.fn());
  const action = { op: "list" };
  await models.request({ type: "model_hub", action });
  expect(fake.modelHub).toHaveBeenCalledExactlyOnceWith(action);
  let finishLogin!: () => void;
  fake.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishLogin = resolve;
      }),
  );
  const login = models.request({ type: "login", providerId: "provider" });
  await Promise.resolve();
  await models.respondUI({ id: "login-input", value: "code" });
  expect(fake.respondUI).toHaveBeenCalledExactlyOnceWith({
    id: "login-input",
    value: "code",
  });
  finishLogin();
  await login;
});

it("预设角色切换走内部桥接，不误发原生全模型循环", async () => {
  const models = new ModelRuntime(vi.fn());
  fake.cycleRoleModel.mockResolvedValue({
    role: "slow",
    order: ["default", "slow"],
  });
  await expect(
    models.request({ type: "cycle_role_model", direction: "backward" }),
  ).resolves.toMatchObject({ role: "slow" });
  expect(fake.cycleRoleModel).toHaveBeenCalledExactlyOnceWith("backward");
  expect(fake.request).not.toHaveBeenCalled();
});

it("并发准备共用一个内存进程，忽略历史路径；切换目录先停止再重建", async () => {
  const models = new ModelRuntime(vi.fn());
  await Promise.all([
    models.prepare(options, "bridge"),
    models.prepare(options, "bridge"),
  ]);
  expect(fake.start).toHaveBeenCalledExactlyOnceWith(
    { executable: "omp.exe", cwd: "D:/project" },
    "bridge",
    true,
  );
  await models.prepare({ ...options, cwd: "D:/other" }, "bridge");
  expect(fake.start).toHaveBeenCalledTimes(2);
  expect(fake.stop).toHaveBeenCalledTimes(2);
  expect(fake.stop.mock.invocationCallOrder[1]).toBeLessThan(
    fake.start.mock.invocationCallOrder[1],
  );
  await models.stop();
  expect(fake.stop).toHaveBeenCalledTimes(3);
});

it("模型 IPC 拒绝聊天、会话导航及非法参数，只转发明确的模型字段", async () => {
  const models = new ModelRuntime(vi.fn());
  for (const type of [
    "prompt",
    "open_session",
    "new_session",
    "bash",
    "__proto__",
  ])
    await expect(models.request({ type })).rejects.toThrow("仅接受模型");
  await expect(
    models.request({ type: "set_model", provider: "test", modelId: "" }),
  ).rejects.toThrow("无效");
  expect(fake.request).not.toHaveBeenCalled();
  await models.request({
    type: "set_model",
    provider: "test",
    modelId: "selected",
    sessionPath: options.sessionPath,
  });
  expect(fake.request).toHaveBeenCalledExactlyOnceWith({
    type: "set_model",
    provider: "test",
    modelId: "selected",
  });
});

it("显式模型先于思考等级应用；没有明确选择时保留恢复会话的模型", async () => {
  const runtime = new OmpRuntime(() => {});
  await applyModelSelection(runtime);
  expect(fake.request).not.toHaveBeenCalled();
  await applyModelSelection(runtime, selection);
  expect(fake.request.mock.calls.map(([command]) => command)).toEqual([
    { type: "set_model", provider: "test", modelId: "selected" },
    { type: "set_thinking_level", level: "high" },
  ]);
});

it("模型或思考等级应用失败向上传播，不静默改用其他模型", async () => {
  const runtime = new OmpRuntime(() => {});
  fake.request.mockRejectedValueOnce(new Error("模型不可用"));
  await expect(applyModelSelection(runtime, selection)).rejects.toThrow(
    "模型不可用",
  );
  expect(fake.request).toHaveBeenCalledTimes(1);
  fake.request
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("思考等级不可用"));
  await expect(applyModelSelection(runtime, selection)).rejects.toThrow(
    "思考等级不可用",
  );
});

it("只读历史检查使用独立内存进程，配置入口拒绝运行 seance", async () => {
  const models = new ModelRuntime(vi.fn());
  const source = { path: "D:/history.jsonl", modelSelectors: ["test/model"] };
  fake.seance.mockResolvedValue(source);
  await models.prepare(options, "bridge");
  await expect(models.seance({ op: "inspect", sourceSession: source.path }))
    .resolves.toEqual(source);
  expect(fake.start).toHaveBeenCalledExactlyOnceWith(
    { executable: options.executable, cwd: options.cwd }, "bridge", true,
  );
  expect(fake.seance).toHaveBeenCalledExactlyOnceWith({
    op: "inspect", sourceSession: source.path,
  });
  await expect(models.seance({
    // @ts-expect-error 即使非类型化调用者绕过协议，内存配置会话也不运行代理。
    op: "run", sourceSession: source.path,
  })).rejects.toThrow("仅允许只读检查");
  await expect(models.request({
    type: "seance", sourceSession: source.path,
  })).rejects.toThrow("仅接受模型");
  expect(fake.seance).toHaveBeenCalledTimes(1);
});
