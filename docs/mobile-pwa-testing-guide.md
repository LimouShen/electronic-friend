# 手机端 Web / PWA 测试与关闭操作手册

更新时间：2026-07-31

这份文档用于指导你在 Windows 电脑上开启、测试和关闭电子挚友的手机端 Web / PWA 版本。步骤尽量写成可照着操作的形式。

本项目是私人情感陪伴 AI 应用。以下操作只用于本地开发和手机真机测试，不涉及新增工具 Agent 能力。

## 1. 先理解现在会启动哪些东西

手机端目前有三种运行或测试方式：

1. 本地项目服务
   - 用途：让电脑运行电子挚友项目。
   - 常见命令：`npm run dev`
   - 默认地址：`http://127.0.0.1:3001`
   - 如果用 `API_HOST=0.0.0.0` 启动，同一 Wi-Fi 下的手机也可以访问。

2. HTTPS 临时隧道
   - 用途：给手机一个 HTTPS 地址，用来完整测试 PWA 安装、service worker 和添加到主屏幕。
   - 常见命令：`cloudflared tunnel --protocol http2 --url http://127.0.0.1:3001`
   - 常见地址：`https://xxxx.trycloudflare.com`
   - 这个地址是公网临时地址。只要隧道窗口开着，知道链接的人理论上也可能访问。

前两种方式用于开发或临时验收；长期个人使用以第 3 种 Tailscale 桌面开关为准。

3. Tailscale 私人 HTTPS（长期个人使用）
   - 用途：让登录同一 Tailscale 个人网络的 iPhone，通过固定 HTTPS 地址访问电脑上的电子挚友。
   - 桌面“石头开关”同时控制 Node、电脑端 Tailscale 和临时防睡眠。
   - 本地项目仍只监听 `http://127.0.0.1:3001`，不需要改成 `0.0.0.0`。
   - Tailscale Serve 地址示例：`https://your-device.your-tailnet.ts.net:8443/`。
   - 原 443 地址暂时保留用于迁移，不再用于新安装的主屏幕 PWA。
   - 关闭控制器后，Node 和电脑端 Tailscale 都会停止，Windows 恢复原来的睡眠策略。

## 1.1 首次配置 Tailscale 私人 HTTPS

### Windows 电脑

1. 安装并打开 Tailscale。
2. 使用个人账号登录。
3. 保持 Tailscale 后台服务处于已连接状态。
4. 以管理员身份运行一次桌面控制器安装脚本：

```powershell
cd C:\AI-Lab\projects\electronic-friend
.\apps\api\install-private-host-controller.ps1
```

该脚本会删除旧的开机常驻任务、恢复原来的睡眠设置、将 Tailscale 改为按需启动，并在桌面创建“石头开关”。控制器启动时会把 Tailscale 依赖的 IP Helper 设置为“手动按需”，不要求用户另开 Tailscale。

5. 以管理员身份打开 PowerShell，配置一次固定 HTTPS 代理：

```powershell
tailscale serve --bg --https=8443 --yes http://127.0.0.1:3001
```

命令输出会显示固定的 `https://*.ts.net` 地址。Serve 配置会保留；日常使用不需要反复执行这条命令。

### iPhone

1. 从 App Store 安装 Tailscale。
2. 使用与 Windows 相同的个人账号登录。
3. 允许 iOS 添加 VPN 配置，并确认 Tailscale 显示已连接。
4. 用 Safari 打开 `https://your-device.your-tailnet.ts.net:8443/`。
5. 页面正常显示后，点击分享按钮，选择“添加到主屏幕”，名称保留“石头”。

Tailscale 默认不会把手机的全部上网流量转发到电脑；本方案不启用出口节点，只有访问私人地址时才使用这条连接。

### 日常启动与停止

1. 双击 Windows 桌面的“石头开关”。
2. 等窗口显示“石头已在线”。
3. 在 iPhone 打开“石头”PWA。
4. 使用期间保持控制器窗口开启；可以最小化，但不要关闭。
5. 用完后点击“关闭石头”或直接点击窗口右上角 `X`。

控制器打开期间会临时阻止系统睡眠和休眠，但不会阻止屏幕自动熄灭。窗口关闭后，Node 与电脑端 Tailscale 会停止，防睡眠请求自动释放，Windows 恢复原来的电源策略。

启用状态空闲 CPU 接近 0%，受控进程合计约 180 MB；关闭控制器后这些进程退出。Tailscale 未启用 Exit Node，普通游戏、办公和视频流量不经过石头连接。

关闭状态下 PWA 应显示“石头还没开”。重新双击桌面开关，等待在线后，在 PWA 点击“再试一次”即可恢复。

如果明确要取消 Tailscale HTTPS 入口，以管理员身份运行：

```powershell
tailscale serve reset
```

通常不需要执行 reset；只停止本地 Node.js 就足够了。

## 2. 测试完以后如何安全关闭

关闭顺序建议是：

1. 先关闭 `cloudflared` HTTPS 隧道。
2. 再关闭本地项目服务。
3. 最后在手机上退出 PWA 或浏览器页面。

### 第一步：关闭 HTTPS 隧道

找到运行 `cloudflared` 的 PowerShell 窗口。

这个窗口里通常会有类似文字：

```text
cloudflared
trycloudflare.com
Registered tunnel connection
```

点击这个窗口，让它成为当前窗口。

按键盘：

```text
Ctrl + C
```

预计结果：

```text
PS C:\Users\YourName>
```

如果 PowerShell 问你是否终止，输入：

```powershell
Y
```

然后按回车。

完成后，之前那个 `https://xxxx.trycloudflare.com` 地址就会失效。

### 第二步：关闭本地项目服务

找到运行项目的 PowerShell 窗口。

这个窗口里通常会有类似文字：

```text
npm run dev
node apps/api/server.mjs
Electronic Friend API running at http://127.0.0.1:3001
Chat UI available at http://127.0.0.1:3001
```

点击这个窗口，让它成为当前窗口。

按键盘：

```text
Ctrl + C
```

预计结果：

```text
PS C:\AI-Lab\projects\electronic-friend>
```

如果 PowerShell 问你是否终止，输入：

```powershell
Y
```

然后按回车。

完成后，电脑本地的电子挚友网页服务也停止了。

### 第三步：确认服务已经关掉

在电脑浏览器里打开：

```text
http://127.0.0.1:3001
```

预计结果：

```text
页面打不开，或显示无法访问
```

这是正常的，说明本地服务已经关闭。

也可以在 PowerShell 输入：

```powershell
Test-NetConnection 127.0.0.1 -Port 3001
```

如果看到：

```text
TcpTestSucceeded : False
```

说明 `3001` 端口已经没有服务在运行。

### 第四步：关闭手机上的 PWA 或浏览器页面

如果你是从手机桌面图标打开的 PWA：

1. 从手机后台任务列表里找到它。
2. 上滑关闭。

如果你是从 Safari 或 Chrome 打开的网页：

1. 关闭对应标签页。
2. 或直接退出浏览器。

手机桌面上的 PWA 图标本身不危险，它只是一个入口。项目服务关闭后，即使点开也无法继续正常聊天。

## 3. 如果关不掉怎么办

### 情况 A：按 `Ctrl + C` 没反应

先点一下对应的 PowerShell 窗口，再按一次：

```text
Ctrl + C
```

### 情况 B：仍然没有反应

可以直接点击 PowerShell 窗口右上角的关闭按钮。

如果弹出确认窗口，选择关闭。

然后用电脑浏览器检查：

```text
http://127.0.0.1:3001
```

如果打不开，说明已经关掉。

### 情况 C：不确定哪个窗口是哪个

看窗口内容：

- 有 `cloudflared`、`trycloudflare.com` 的，是 HTTPS 隧道窗口。
- 有 `npm run dev`、`node apps/api/server.mjs`、`Chat UI available` 的，是本地项目服务窗口。

建议先关闭 `cloudflared` 窗口，再关闭 `npm run dev` 窗口。

## 4. 下次只在电脑本地测试

适用于只在电脑浏览器里看页面，不需要手机。

打开 PowerShell。

输入：

```powershell
cd C:\AI-Lab\projects\electronic-friend
npm run dev
```

预计看到：

```text
Electronic Friend API running at http://127.0.0.1:3001
Chat UI available at http://127.0.0.1:3001
```

然后在电脑浏览器打开：

```text
http://127.0.0.1:3001
```

测试完以后，在这个 PowerShell 窗口按：

```text
Ctrl + C
```

## 5. 下次用手机同 Wi-Fi 测普通网页

适用于测试手机尺寸、触控、输入框、页面布局，但不完整测试 PWA 安装能力。

### 第一步：启动项目，让手机也能访问

打开 PowerShell。

输入：

```powershell
cd C:\AI-Lab\projects\electronic-friend
$env:API_HOST="0.0.0.0"
$env:API_PORT="3001"
npm run dev
```

预计看到：

```text
Electronic Friend API running at http://0.0.0.0:3001
Chat UI available at http://0.0.0.0:3001
```

这个窗口不要关。

### 第二步：找到电脑的局域网 IP

再打开一个 PowerShell，输入：

```powershell
ipconfig
```

找到类似这一行：

```text
IPv4 Address . . . . . . . . . . . : 192.168.1.2
```

这里的 `192.168.1.2` 就是电脑在局域网里的地址。你电脑下次可能会变，所以以当次看到的为准。

### 第三步：手机打开网页

确认手机和电脑连接的是同一个 Wi-Fi。

在手机浏览器打开：

```text
http://电脑IPv4地址:3001
```

例如：

```text
http://192.168.1.2:3001
```

### 第四步：测试完关闭

回到运行 `npm run dev` 的 PowerShell 窗口，按：

```text
Ctrl + C
```

预计回到：

```text
PS C:\AI-Lab\projects\electronic-friend>
```

## 6. 下次完整测试 PWA 安装

适用于测试：

- HTTPS 访问
- 添加到主屏幕
- PWA 桌面图标启动
- service worker
- 离线壳

完整 PWA 测试需要两个 PowerShell 窗口。

### 第一个窗口：启动本地项目

打开 PowerShell。

输入：

```powershell
cd C:\AI-Lab\projects\electronic-friend
npm run dev
```

预计看到：

```text
Electronic Friend API running at http://127.0.0.1:3001
Chat UI available at http://127.0.0.1:3001
```

这个窗口不要关。

### 第二个窗口：启动 HTTPS 隧道

再打开一个新的 PowerShell 窗口。

输入：

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:3001
```

预计看到类似：

```text
Your quick Tunnel has been created! Visit it at:
https://xxxx.trycloudflare.com
```

这个 `https://xxxx.trycloudflare.com` 就是手机要打开的网址。

这个窗口也不要关。关掉后，这个 HTTPS 地址就会失效。

### 第三步：手机打开 HTTPS 地址

在手机上打开：

```text
https://xxxx.trycloudflare.com
```

建议复制完整地址，不要手打，避免少字母或多空格。

### 第四步：iPhone Safari 添加到主屏幕

1. 用 Safari 打开 `https://xxxx.trycloudflare.com`。
2. 等页面正常显示。
3. 点击底部分享按钮。
4. 选择“添加到主屏幕”。
5. 名称可以保留“石头”。
6. 点击“添加”。
7. 回到手机桌面，点击“石头”图标启动。

### 第五步：Android Chrome 添加到主屏幕

1. 用 Chrome 打开 `https://xxxx.trycloudflare.com`。
2. 等页面正常显示。
3. 如果页面里出现“安装”按钮，可以点击安装。
4. 如果没有出现，点击右上角三个点。
5. 选择“安装应用”或“添加到主屏幕”。
6. 回到手机桌面，点击“石头”图标启动。

### 第六步：测试完安全关闭

先关闭 HTTPS 隧道窗口：

```text
Ctrl + C
```

再关闭本地项目窗口：

```text
Ctrl + C
```

最后在手机后台关闭 PWA 或浏览器页面。

## 7. 常见问题排查

### “石头开关”提示无法启动 Tailscale

已发现过的原因是 Windows `IP Helper` 服务被第三方优化设置为“禁用”，导致 Tailscale 的依赖服务无法启动。当前控制器会自动将它调整为“手动按需”后再连接，不需要用户单独打开 Tailscale。

如果仍然失败：

1. 关闭报错窗口。
2. 以管理员身份打开 PowerShell。
3. 重新运行安装器：

```powershell
cd C:\AI-Lab\projects\electronic-friend
.\apps\api\install-private-host-controller.ps1
```

4. 再双击桌面“石头开关”。

### 双击“石头开关”完全没有反应

2026-07-13 已遇到过 Windows Code Integrity 启用更严格企业签名策略，拦截旧版、由本地 C# 编译且未签名的 `private-host-controller.exe`。典型事件是 Code Integrity 3033 / 3077，计划任务结果可能显示 `0x800711C7`。

当前控制器已改为由 Microsoft 签名的 Windows PowerShell 承载，运行入口为 `apps/api/private-host-controller.ps1`，不需要关闭或降低 Windows 安全策略。

修复方式：以管理员身份重新运行安装器：

```powershell
cd C:\AI-Lab\projects\electronic-friend
.\apps\api\install-private-host-controller.ps1
```

安装后检查：

1. 双击桌面“石头开关”。
2. 确认窗口显示“石头已在线”。
3. 打开 `http://127.0.0.1:3001/api/health`，应看到 `"ok": true`。
4. 不要把旧 EXE 加入系统安全白名单，也不要关闭 Code Integrity。

### 电脑端关闭后 PWA 白屏，或仍显示可输入的聊天页

v24 将 iPhone 入口收敛为纯在线主屏幕 Web App，不再注册 service worker。石头聊天本来就要求 Windows 电脑、Node 和 Tailscale 在线；离线壳无法提供聊天能力，反而会让 iOS 长期保留旧页面和旧 API 代理。

在线启动时，Node 会把 `styles.css` 和 `app.js` 压缩并直接嵌入首页 HTML。Safari 只要成功收到首页，就不需要再请求外部 CSS 或启动脚本，从而避开旧 Worker 在第二个请求上卡死的问题。应用脚本开始运行后立即撤掉启动层，设置和历史对话继续在后台加载。历史 service worker 和名称以 `electronic-friend-pwa-` 开头的 Cache Storage 会延后到后台尽力清理；即使 iOS 的 `getRegistrations()` 或某个初始化请求一直不返回，也不会再卡住聊天页面。

`sw.js` 现在是历史 Worker 的自动退役脚本：浏览器检查到更新后会删除旧 PWA 缓存、注销自身，并让已打开页面重新走直连。它没有 `fetch` 处理器，也不会再缓存或代理页面。HTML 仍提供不依赖外部 CSS 或模块脚本的启动保护层，并为 `100dvh` 增加 `100vh` 回退。

移动网络实测中，如果电脑到 iPhone 未能建立 Tailscale 直连，可能会经过 DERP 中继并产生明显延迟。电脑侧 `tailscale netcheck` 若显示 NAT 映射不利于点对点打洞，单响应启动只能减少请求次数，不能消除中继本身的延迟。若要继续改善，可检查路由器的 UPnP/NAT-PMP 或 UDP 端口映射，再用 `tailscale ping your-phone.your-tailnet.ts.net` 确认输出是否变为 `direct`。

如果旧 443 origin 已经被 iOS 的离线 Worker 锁住，可改用 `https://your-device.your-tailnet.ts.net:8443/`。端口是 Web origin 的一部分，因此 8443 对 Safari 是一个全新站点，不会继承旧地址的 Service Worker、Cache Storage 或 PWA 页面状态。电脑端仍可代理到同一个 `127.0.0.1:3001`，不会增加 Node 进程或数据副本。

更新步骤：

1. 打开桌面“石头开关”，等待“石头已在线”。
2. iPhone Safari 打开推荐的 8443 固定 HTTPS 地址并刷新。
3. 页面应直接进入聊天界面，不再等待“连接组件”清理。
4. 完全关闭 Safari 和主屏幕页面，再在线打开一次，给历史 Worker 一次完成退役的机会。

如果仍然使用旧缓存，删除 iPhone 主屏幕上的“石头”，用 Safari 重新访问固定地址并添加到主屏幕。

### 手机打不开局域网地址

按这个顺序检查：

1. 手机和电脑是否在同一个 Wi-Fi。
2. 手机是否关掉了蜂窝网络优先、VPN 或代理。
3. 地址是不是 `http://电脑IPv4地址:3001`，不要写成 `127.0.0.1`。
4. 项目是否用 `API_HOST=0.0.0.0` 启动。
5. Windows 防火墙是否弹过提示，如果弹过，允许“专用网络”。
6. 电脑 IP 是否变了，重新运行 `ipconfig` 查看。
7. 电脑自己能不能打开 `http://127.0.0.1:3001`。

### 手机打不开 trycloudflare 地址

按这个顺序检查：

1. `cloudflared` 窗口是否还开着。
2. 地址是否是 `https://` 开头。
3. 地址是否复制完整。
4. 等 30 秒后刷新一次，临时隧道刚创建时可能需要一点时间。
5. 手机是否开了 VPN 或代理，先关掉再试。
6. 电脑浏览器能不能打开同一个 `https://xxxx.trycloudflare.com` 地址。
7. 如果电脑和手机都打不开，关闭 `cloudflared` 后重新运行命令，换一个新的地址。

### cloudflared 提示 URL 格式错误

常见原因是命令粘贴重复了，比如把 `cloudflared` 粘在 `3001` 后面。

正确命令只有这一整行：

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:3001
```

错误示例：

```text
http://127.0.0.1:3001cloudflared
```

如果看到这种错误，重新输入正确命令即可。

### 手机 PWA 仍然显示旧样式

可能是 service worker 缓存还没刷新。

可以按这个顺序处理：

1. 完全关闭手机后台里的 PWA。
2. 用 Safari 或 Chrome 打开最新的 HTTPS 地址。
3. 刷新网页。
4. 再从桌面图标打开 PWA。
5. 如果仍然旧，删除桌面图标后重新添加到主屏幕。

## 8. 安全建议

1. 测试完就关闭 `cloudflared`。
2. 测试完就关闭 `npm run dev`。
3. 不要把 `https://xxxx.trycloudflare.com` 地址发给别人。
4. 不要长期挂着公网隧道。
5. 手机 PWA 图标可以保留，它只是入口。真正需要关闭的是电脑上的服务和隧道。
6. 如果只是电脑本地测试，不需要开启 `API_HOST=0.0.0.0`，也不需要开启 `cloudflared`。
7. 日常使用只打开桌面的“石头开关”；用完关闭控制器窗口即可，不需要另开或另关 Tailscale。
8. 控制器关闭后，Node、电脑端 Tailscale 和临时防睡眠均应停止；iPhone 桌面图标可以保留。

## 9. 最短记忆版流程

### 日常私人使用

开启：双击 Windows 桌面的“石头开关”，等“石头已在线”，再打开 iPhone PWA。

关闭：点击“关闭石头”或直接关闭控制器窗口。Windows 会恢复原来的睡眠策略。

### 开启完整 PWA 测试

第一个 PowerShell：

```powershell
cd C:\AI-Lab\projects\electronic-friend
npm run dev
```

第二个 PowerShell：

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:3001
```

手机打开第二个窗口给出的：

```text
https://xxxx.trycloudflare.com
```

### 关闭完整 PWA 测试

先在 `cloudflared` 窗口按：

```text
Ctrl + C
```

再在 `npm run dev` 窗口按：

```text
Ctrl + C
```

最后关闭手机上的 PWA 或浏览器页面。
