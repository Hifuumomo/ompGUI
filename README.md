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

## 注意事项

这是一个供个人使用的实验性项目，正在逐步修改和完善，可能存在缺陷及潜在风险。请谨慎使用，并提前备份重要数据。
