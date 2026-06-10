# Windows 一键启动指南

## 快速启动

在项目根目录双击：

```text
start-workbench.bat
```

也可以在 PowerShell 或 CMD 中运行：

```powershell
Set-Location F:\字节比赛\最终程序
cmd /c start-workbench.bat
```

## 首次运行

1. 脚本会进入项目目录并检查 Node.js 与 npm。
2. 如果 `node_modules` 不存在，脚本会自动执行 `npm install`。
3. 如果 `configs\api_config.local.json` 不存在，脚本会从 `configs\api_config.template.json` 复制一份。
4. 复制本地配置后，脚本会暂停并退出。请手动填写自己的 API key 和 model，再重新运行脚本。
5. 脚本不会自动填写、打印或提交任何密钥。

## 日常运行

本地配置存在后，再次运行 `start-workbench.bat` 会自动完成：

1. 初始化数据库：`npm run db:init`
2. 清理旧的 `9999` 和 `8787` 端口占用，只处理 `LISTENING` 进程。
3. 后台启动后端 API：`npm run dev:server`
4. 启动前端工作台：`npm run dev`
5. 打开工作台地址：

```text
http://127.0.0.1:9999
```

## 端口说明

- 前端工作台：`http://127.0.0.1:9999`
- 后端 API：`http://127.0.0.1:8787`

如果端口被旧进程占用，脚本会尝试结束对应的旧 `LISTENING` PID。脚本不会处理 `TIME_WAIT` 连接。

## 注意事项

- 不要把 `configs\api_config.local.json` 提交到 Git。
- 不要提交 `.env`、本地数据库、`runs/`、`node_modules/` 或 `dist/`。
- 如果 Node.js / npm 未安装，请先安装 Node.js 后重新运行脚本。
