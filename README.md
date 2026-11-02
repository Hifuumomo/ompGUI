# OMP Desktop

omp（oh-my-pi）的桌面显示软件，后端调用本机 omp，提供图形化操作界面。

## 启动方式

当前面向 Windows x64。需要 Node.js 24 或更新版本、npm，以及已安装的原生 `omp.exe`。首次使用前，请在 omp CLI 中完成登录或 API 密钥配置。

在项目根目录执行：

```powershell
npm install
npm run dev
```

启动后，在「设置 → 本机 omp 连接」中选择 `omp.exe` 和工作目录，即可使用。

### 开发性能日志（可选）

默认 `npm run dev` 不启用性能日志，不新增采样、诊断 IPC 或日志文件，原有功能及启停流程保持不变。需要诊断时显式执行：

```powershell
npm run dev -- --perf
```

启用成功后，终端输出 `[perf] <日志文件绝对路径>`；文件位于当前 Electron `userData` 的 `performance` 子目录，不要按仓库位置猜测。复制该绝对路径，在另一个 PowerShell 窗口实时查看：

```powershell
$perfLog = Read-Host '粘贴 [perf] 后的日志文件绝对路径'
Get-Content -LiteralPath $perfLog -Encoding UTF8 -Tail 30 -Wait
```

每行是一个 JSON 对象；正常每 250ms 尝试异步写入，每 2 秒汇总采样。单文件达到 20MiB 前分卷，切卷后需查看同目录的新分卷。仅开发模式支持此开关；打包应用不会因 `--perf` 或 `OMPGUI_PERF` 启用日志。资源数据仅覆盖 Electron，不包含 `omp.exe` 的 CPU／内存。字段、隐私边界、容量限制和验证状态见 [性能日志设计与使用](docs/performance-logging/PLAN.md)。

## 注意事项

这是一个供个人使用的实验性项目，正在逐步修改和完善，可能存在缺陷及潜在风险。请谨慎使用，并提前备份重要数据。
