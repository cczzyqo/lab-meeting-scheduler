# 周一见 · 课题组组会排班

[打开共享排期](https://cczzyqo.github.io/lab-meeting-scheduler/) · [GitHub 仓库](https://github.com/cczzyqo/lab-meeting-scheduler)

所有服务均使用 GitHub。静态页面从仓库根目录的 `schedule.json` 读取全组共同排期，`main` 分支提交后由 GitHub Pages 自动发布。没有数据库、服务器、访问令牌或第三方同步服务。当前共享版本保留原浏览器中的 14 位学生和 20 周设置。

## 修改和发布

1. 点击 **编辑排期**。添加、删除、排序、实习/暂停状态及日期设置只会保存为本机草稿，不会影响全组已发布版本。
2. 点击 **发布草稿 → 下载 schedule.json**。系统先核对 GitHub 仓库版本；有冲突时保留草稿，提示核对后再继续。
3. 点击 **打开 GitHub 上传页**，用有仓库写入权限的账号上传文件，替换根目录的 `schedule.json`，点击 **Commit changes** 提交到 `main`。如果浏览器把文件名改成 `schedule (1).json`，请先改回 `schedule.json`。
4. 等待 Pages 发布，返回页面点击 **检查发布结果**。页面验证线上内容与当前草稿一致后才显示成功。大家打开或刷新同一网址即可看到更新。

查看页面时默认显示已发布版本，继续草稿需单独点击。刷新、离线、版本冲突都不会静默覆盖未发布修改。下载后又做的新修改也不会因旧文件发布成功而丢失。旧版浏览器数据会迁移为草稿；内容已与共享版本一致时，自动切回共享版本。

这适合单人或少数管理员低频维护，不是实时协同编辑。文件下载到 GitHub 提交之间仍可能有别人修改，请在提交前检查差异，避免同时发布。仓库为公开仓库，名单与排期也公开；发布权限由 GitHub 控制。

## 排期与备份

- 每周一，一位在校学生，按名单顺序循环；不自动跳过节假日。
- 实习/暂停自动跳过，返校恢复在校后重新参与。
- 修改名单时会保留已经过去的排期，今天及以后可调整；更改首场日期会重新开始排期。
- 支持 CSV、打印/PDF、JSON 备份和导入。导入只影响本机草稿，需要另行发布。
- 本机草稿在当前浏览器保存；在线共享数据从 Pages 读取。换设备接续未发布草稿时，先导出备份。

## 开发与部署

本目录直接作为 GitHub Pages 的 main 分支根目录发布，.nojekyll 禁用 Jekyll 处理。原生 HTML/CSS/JavaScript，无依赖和构建步骤。

```sh
python3 -m http.server 4173 --bind 127.0.0.1
node --test scheduler.test.cjs publication.test.cjs
node --check app.js
```

本地 localhost/127.0.0.1 预览从本地 schedule.json 做发布检查；线上和独立文件通过 GitHub 仓库检查。部署到其他仓库时，需修改 app.js 中 repositoryURL 以及 index.html 的 GitHub 上传链接。
