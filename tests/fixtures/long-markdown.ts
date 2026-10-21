export function longMarkdownReport(rows = 1_000): string {
  return [
    '# Claude 输出与长文预览',
    '长文可以在 **渲染预览** 与源码之间切换。标题、列表、代码、表格和公式使用一致的阅读样式。参考说明[^details]。',
    '## 阅读体验',
    '- [x] 扩大输出区域\n- [x] 支持放大阅读\n- [ ] 继续检查远端会话',
    '> 放大阅读可以同时查看更多内容，关闭后回到原来的对话。',
    '```typescript\nconst preview = {\n  mode: "markdown",\n  continuous: true,\n  keepReadingPosition: true\n}\n```',
    String.raw`公式预览：\(a^2 + b^2 = c^2\)。`,
    '## 会话检查记录',
    '| 序号 | 检查项目 | 状态 |\n| ---: | :--- | :--- |\n' +
      Array.from(
        { length: rows },
        (_, index) => `| ${index + 1} | **远端会话对比 ${index + 1}** | 已核对 |`,
      ).join('\n'),
    '## 完成结论\n\n所有记录都可连续浏览。',
    '[相关文件](docs/related.md)',
    '[^details]: 这是文末说明，脚注可以跨越未显示的段落跳转。',
  ].join('\n\n')
}
